import { clampWindow, followTime, niceTicks, panWindow, zoomWindow } from '../../core/timeline.js';
import { drawWaveformOverview, drawWaveformRange } from './waveform.js';

// Interactive recording view for the Tap Analyser: waveform, crop regions
// with draggable edges, and tap markers that can be moved, added and
// removed, with zoom/pan and an overview strip of the whole file. It owns
// only drawing, the visible window and drag state; the page passes in a
// `view` and gets edits back through the callbacks:
//
//   view = { audioBuffer, cropStart, cropStartAuto, cropEnd, taps, edited, pending, error }
//          (all times in seconds; cropEnd = seconds cut off the end)
//   onCropChange({ cropStart } | { cropEnd })   after a crop edge is dropped
//   onTapsChange(taps)                          after a tap is moved, added or removed
//   snap(timeSec) -> timeSec                    where a dropped tap should land (Alt skips it)
//   onSeek(timeSec)                             a click on empty space (moves the playhead)
//   onZoom({ start, end, duration })            the visible window changed
//
// Zoom: Ctrl/⌘ + wheel or trackpad pinch (around the cursor), or zoomBy() /
// fit() / zoomTo(). Pan: horizontal wheel / Shift + wheel, or drag on the
// overview strip.

// Each tap's FFT window, as in analyse_taps (python/waveform_lab/tap.py).
const WINDOW_OFFSET = 0.1, WINDOW_LENGTH = 1.0;
const HIT_PX = 7;        // CSS pixels
const MIN_SPAN = 0.005;  // seconds — deepest zoom

// Each tap is drawn as a block from its attack to the end of its analysis
// window, with a numbered header bar at the top (the handle). Blocks whose
// windows overlap go into separate lanes.
const LANE_TOP = 4, LANE_H = 16, LANE_GAP = 2, MAX_LANES = 6;

const COLORS = {
  crop: 'rgba(194,59,46,0.16)',
  autoHatch: 'rgba(194,59,46,0.30)',
  edge: '#a8322a',
  tap: '#b5690a',
  tapGap: 'rgba(181,105,10,0.35)',
  tapBody: 'rgba(181,105,10,0.07)',
  tapOff: '#b4b4ad',
  tapOffBody: 'rgba(130,130,125,0.06)',
  label: '#6b6b64',
};

export function createTapEditor(canvas, overview, { onCropChange, onTapsChange, snap, onSeek, onZoom }){
  let view = null;
  let win = { start: 0, end: 1 };
  let playhead = null;
  let base = null;       // cached waveform for the current window
  let overBase = null;   // cached whole-file waveform for the overview
  let drag = null;       // { kind: 'start' | 'end' | 'tap', index, time }
  let hover = null;
  let panDrag = null;    // { offset } while dragging the overview window

  const dur = () => view.audioBuffer.duration || 1;
  const span = () => win.end - win.start;
  const toX = (t) => ((t - win.start) / span()) * canvas.width;
  const toT = (x) => Math.min(dur(), Math.max(0, win.start + (x / canvas.width) * span()));
  const scaleOf = (c) => { const w = c.getBoundingClientRect().width; return w ? c.width / w : 1; };
  const eventX = (e, c = canvas) => (e.clientX - c.getBoundingClientRect().left) * scaleOf(c);
  const eventY = (e) => { const r = canvas.getBoundingClientRect(); return r.height ? (e.clientY - r.top) * (canvas.height / r.height) : 0; };

  function setWindow(next){
    win = clampWindow(next.start, next.end, dur(), MIN_SPAN);
    redraw();
    if (onZoom) onZoom({ start: win.start, end: win.end, duration: dur() });
  }

  function cropStartT(){ return drag && drag.kind === 'start' ? drag.time : view.cropStart; }
  function cropEndT(){ return drag && drag.kind === 'end' ? drag.time : dur() - view.cropEnd; }
  function tapTimes(){
    if (!drag || drag.kind !== 'tap') return view.taps;
    return view.taps.map((t, i) => (i === drag.index ? drag.time : t));
  }
  const inside = (t) => t >= cropStartT() && t < cropEndT();

  // Lane per tap (by index): first lane whose previous block has ended.
  function assignLanes(times){
    const order = times.map((t, i) => i).sort((a, b) => times[a] - times[b]);
    const ends = [], lanes = new Array(times.length);
    for (const i of order){
      let lane = ends.findIndex((e) => e <= times[i]);
      if (lane < 0) lane = ends.length < MAX_LANES ? ends.length : ends.indexOf(Math.min(...ends));
      ends[lane] = times[i] + WINDOW_OFFSET + WINDOW_LENGTH;
      lanes[i] = lane;
    }
    return lanes;
  }
  const lanesNow = () => (drag && drag.lanes) || assignLanes(view.taps);
  const laneY = (lane) => LANE_TOP + lane * (LANE_H + LANE_GAP);

  // Header bar of tap i: from the attack to the end of its window (cut at
  // the crop end when the tap is inside the crop).
  function header(t, lane){
    const end = t + WINDOW_OFFSET + WINDOW_LENGTH;
    return { x0: toX(t), x1: toX(inside(t) ? Math.min(end, cropEndT()) : end), y0: laneY(lane), y1: laneY(lane) + LANE_H };
  }

  // What's under (x, y): a tap (its header bar, or its attack line at any
  // height), else a crop edge.
  function hit(x, y){
    const tol = HIT_PX * scaleOf(canvas);
    const taps = tapTimes(), lanes = lanesNow();
    for (let i = taps.length - 1; i >= 0; i--){
      const r = header(taps[i], lanes[i]);
      if (y >= r.y0 && y <= r.y1 && x >= r.x0 - tol && x <= Math.max(r.x1, r.x0 + tol)) return { kind: 'tap', index: i };
    }
    let best = null;
    taps.forEach((t, i) => {
      const d = Math.abs(toX(t) - x);
      if (d <= tol && (!best || d < best.d)) best = { kind: 'tap', index: i, d };
    });
    if (best) return best;
    if (Math.abs(toX(cropStartT()) - x) <= tol) return { kind: 'start' };
    if (Math.abs(toX(cropEndT()) - x) <= tol) return { kind: 'end' };
    return null;
  }

  function hatch(ctx, x0, x1, h){
    ctx.save();
    ctx.beginPath(); ctx.rect(x0, 0, x1 - x0, h); ctx.clip();
    ctx.fillStyle = 'rgba(194,59,46,0.07)';
    ctx.fillRect(x0, 0, x1 - x0, h);
    ctx.strokeStyle = COLORS.autoHatch; ctx.lineWidth = 1;
    for (let x = x0 - h; x < x1; x += 10){ ctx.beginPath(); ctx.moveTo(x, h); ctx.lineTo(x + h, 0); ctx.stroke(); }
    ctx.restore();
  }

  function edge(ctx, x, h, active){
    ctx.fillStyle = COLORS.edge;
    ctx.fillRect(x - 1, 0, 2, h);
    ctx.fillRect(x - 4, h / 2 - 14, 8, 28);
    if (active){ ctx.strokeStyle = '#111'; ctx.lineWidth = 1; ctx.strokeRect(x - 4.5, h / 2 - 14.5, 9, 29); }
  }

  function drawEmpty(c, text){
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#f4f4f0'; ctx.fillRect(0, 0, c.width, c.height);
    if (text){ ctx.fillStyle = COLORS.label; ctx.font = '14px "JetBrains Mono", monospace'; ctx.fillText(text, 16, c.height / 2); }
  }

  function redraw(){
    if (!view){
      drawEmpty(canvas, 'Load a recording on the left to see its crop and taps here.');
      drawEmpty(overview);
      canvas.dataset.tapCount = '0';
      delete canvas.dataset.cropStart;
      return;
    }
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    if (!base || base.audioBuffer !== view.audioBuffer || base.start !== win.start || base.end !== win.end || base.w !== w || base.h !== h){
      const off = document.createElement('canvas');
      off.width = w; off.height = h;
      drawWaveformRange(off, view.audioBuffer, win.start, win.end, niceTicks(win.start, win.end, 7));
      base = { audioBuffer: view.audioBuffer, start: win.start, end: win.end, w, h, canvas: off };
    }
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(base.canvas, 0, 0);

    const cs = cropStartT(), ce = cropEndT();
    const xs = toX(cs), xe = toX(ce);
    if (xs > 0){
      if (view.cropStartAuto && !(drag && drag.kind === 'start')) hatch(ctx, 0, Math.min(w, xs), h);
      else { ctx.fillStyle = COLORS.crop; ctx.fillRect(0, 0, Math.min(w, xs), h); }
    }
    if (xe < w){ ctx.fillStyle = COLORS.crop; ctx.fillRect(Math.max(0, xe), 0, w - Math.max(0, xe), h); }

    const taps = tapTimes(), lanes = lanesNow();
    let number = 0;
    const numbers = taps.map((t) => (inside(t) ? ++number : null));
    ctx.font = '11px "JetBrains Mono", monospace';
    taps.forEach((t, i) => {
      const r = header(t, lanes[i]);
      if (r.x1 < 0 || r.x0 > w) return;
      const on = inside(t);
      const active = (drag && drag.kind === 'tap' && drag.index === i) || (hover && hover.kind === 'tap' && hover.index === i);
      const xg = Math.min(r.x1, toX(t + WINDOW_OFFSET)); // end of the 0.1 s gap
      // Body: the analysed window, down to the bottom.
      ctx.fillStyle = on ? COLORS.tapBody : COLORS.tapOffBody;
      ctx.fillRect(xg, r.y1, r.x1 - xg, h - r.y1);
      // Attack line.
      ctx.fillStyle = on ? COLORS.tap : COLORS.tapOff;
      ctx.fillRect(r.x0 - (active ? 1.5 : 1), r.y0, active ? 3 : 2, h - r.y0);
      // Header: lighter over the gap, solid over the window, numbered.
      ctx.fillStyle = on ? COLORS.tapGap : 'rgba(180,180,173,0.35)';
      ctx.fillRect(r.x0, r.y0, xg - r.x0, LANE_H);
      ctx.fillStyle = on ? COLORS.tap : COLORS.tapOff;
      ctx.fillRect(xg, r.y0, r.x1 - xg, LANE_H);
      if (!on){
        ctx.strokeStyle = '#8a8a83'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
        ctx.strokeRect(r.x0 + 0.5, r.y0 + 0.5, r.x1 - r.x0 - 1, LANE_H - 1);
        ctx.setLineDash([]);
      }
      if (active){ ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5; ctx.strokeRect(r.x0 + 0.75, r.y0 + 0.75, r.x1 - r.x0 - 1.5, LANE_H - 1.5); }
      if (numbers[i] != null && r.x1 - xg > 14){
        ctx.fillStyle = '#fff';
        ctx.fillText(String(numbers[i]), Math.max(xg, 0) + 4, r.y0 + 12);
      }
    });

    if (xs >= -5 && xs <= w + 5) edge(ctx, xs, h, (drag && drag.kind === 'start') || (hover && hover.kind === 'start'));
    if (xe >= -5 && xe <= w + 5) edge(ctx, xe, h, (drag && drag.kind === 'end') || (hover && hover.kind === 'end'));

    ctx.font = '12px "JetBrains Mono", monospace';
    if (view.cropStartAuto && xs > 70 && !(drag && drag.kind === 'start')){
      ctx.fillStyle = COLORS.edge; ctx.fillText('auto crop', 8, h - 26);
    }
    if (view.pending || view.error){
      const msg = view.error ? `⚠ ${view.error}` : 'detecting taps…';
      ctx.fillStyle = view.error ? COLORS.edge : COLORS.label;
      ctx.fillText(msg, w - ctx.measureText(msg).width - 10, 16);
    }

    if (playhead != null){
      const x = toX(playhead);
      if (x >= 0 && x <= w){ ctx.fillStyle = '#111'; ctx.fillRect(x - 1, 0, 2, h); }
    }

    canvas.dataset.tapCount = String(view.taps.filter((t) => t >= view.cropStart && t < dur() - view.cropEnd).length);
    canvas.dataset.cropStart = view.cropStart.toFixed(3);
    canvas.dataset.taps = view.taps.map((t) => t.toFixed(4)).join(',');
    canvas.dataset.viewStart = win.start.toFixed(4);
    canvas.dataset.viewEnd = win.end.toFixed(4);
    drawOverview();
  }

  // Whole-file strip: waveform, crop, taps, playhead and the visible window.
  function drawOverview(){
    const ctx = overview.getContext('2d');
    const w = overview.width, h = overview.height;
    if (!overBase || overBase.audioBuffer !== view.audioBuffer || overBase.w !== w || overBase.h !== h){
      const off = document.createElement('canvas');
      off.width = w; off.height = h;
      drawWaveformOverview(off, view.audioBuffer);
      overBase = { audioBuffer: view.audioBuffer, w, h, canvas: off };
    }
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(overBase.canvas, 0, 0);
    const ox = (t) => (t / dur()) * w;
    ctx.fillStyle = COLORS.crop;
    ctx.fillRect(0, 0, ox(view.cropStart), h);
    ctx.fillRect(ox(dur() - view.cropEnd), 0, w, h);
    ctx.fillStyle = COLORS.tap;
    view.taps.forEach((t) => ctx.fillRect(ox(t) - 1, 0, 2, 7));
    if (playhead != null){ ctx.fillStyle = '#111'; ctx.fillRect(ox(playhead) - 1, 0, 2, h); }
    const a = ox(win.start), b = ox(win.end);
    ctx.fillStyle = 'rgba(17,17,17,0.10)';
    ctx.fillRect(0, 0, a, h);
    ctx.fillRect(b, 0, w - b, h);
    ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5;
    ctx.strokeRect(a + 0.75, 0.75, Math.max(2, b - a - 1.5), h - 1.5);
  }

  // ---------------- main canvas: crop / taps / seek ----------------
  canvas.addEventListener('pointerdown', (e) => {
    if (!view || e.button !== 0) return;
    const target = hit(eventX(e), eventY(e));
    if (!target){ if (onSeek) onSeek(toT(eventX(e))); return; }
    const time = target.kind === 'tap' ? view.taps[target.index] : target.kind === 'start' ? view.cropStart : dur() - view.cropEnd;
    // A tap grabbed by its header keeps the grab offset; lanes stay put while dragging.
    const grab = target.kind === 'tap' ? toT(eventX(e)) - time : 0;
    drag = { ...target, time, grab, moved: false, lanes: assignLanes(view.taps) };
    canvas.setPointerCapture(e.pointerId);
    redraw();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!view) return;
    const x = eventX(e);
    if (drag){
      let t = toT(x) - (drag.grab || 0);
      if (drag.kind === 'start') t = Math.min(t, cropEndT() - 0.01);
      if (drag.kind === 'end') t = Math.max(t, cropStartT() + 0.01);
      drag.time = t;
      drag.moved = true;
      redraw();
      return;
    }
    const h = hit(x, eventY(e));
    if ((h && h.kind) !== (hover && hover.kind) || (h && h.index) !== (hover && hover.index)){ hover = h; redraw(); }
    canvas.style.cursor = !h ? 'text' : h.kind === 'tap' ? 'grab' : 'ew-resize';
    canvas.title = !h ? '' : h.kind === 'tap'
      ? `Tap at ${view.taps[h.index].toFixed(3)} s — drag to move, right-click to remove`
      : `Crop ${h.kind} — drag to change`;
  });

  canvas.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (!d.moved){ redraw(); return; } // a click on an edge or tap is not an edit
    // Round crops to what one screen pixel can resolve: 0.01 s zoomed out,
    // down to 0.0001 s zoomed in.
    const perPx = span() / (canvas.clientWidth || canvas.width);
    const digits = Math.min(4, Math.max(2, Math.floor(-Math.log10(perPx))));
    const round = (t) => +t.toFixed(digits);
    if (d.kind === 'start') onCropChange({ cropStart: round(d.time) });
    else if (d.kind === 'end') onCropChange({ cropEnd: round(Math.max(0, dur() - d.time)) });
    else {
      const t = e.altKey ? d.time : snap(d.time);
      onTapsChange(view.taps.map((x, i) => (i === d.index ? t : x)).sort((a, b) => a - b));
    }
    redraw();
  });

  canvas.addEventListener('pointerleave', () => { if (hover && !drag){ hover = null; redraw(); } });

  canvas.addEventListener('dblclick', (e) => {
    if (!view || hit(eventX(e), eventY(e))) return;
    const t0 = toT(eventX(e));
    const t = e.altKey ? t0 : snap(t0);
    onTapsChange([...view.taps, t].sort((a, b) => a - b));
  });

  canvas.addEventListener('contextmenu', (e) => {
    if (!view) return;
    const target = hit(eventX(e), eventY(e));
    if (!target || target.kind !== 'tap') return;
    e.preventDefault();
    hover = null;
    onTapsChange(view.taps.filter((_, i) => i !== target.index));
  });

  // Ctrl/⌘ + wheel (and trackpad pinch, which arrives as Ctrl + wheel) zooms
  // around the cursor; horizontal wheel or Shift + wheel pans. A plain
  // vertical wheel is left alone so the page still scrolls.
  canvas.addEventListener('wheel', (e) => {
    if (!view) return;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvas.clientWidth : 1;
    if (e.ctrlKey || e.metaKey){
      e.preventDefault();
      setWindow(zoomWindow(win, Math.exp(e.deltaY * unit * 0.002), toT(eventX(e)), dur(), MIN_SPAN));
    } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)){
      e.preventDefault();
      const px = (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * unit;
      setWindow(panWindow(win, (px / canvas.clientWidth) * span(), dur(), MIN_SPAN));
    }
  }, { passive: false });

  // ---------------- overview strip: pan ----------------
  const overT = (e) => (eventX(e, overview) / overview.width) * dur();
  overview.addEventListener('pointerdown', (e) => {
    if (!view || e.button !== 0) return;
    const t = overT(e);
    if (t < win.start || t > win.end){
      setWindow({ start: t - span() / 2, end: t + span() / 2 }); // jump, centred on the click
    }
    panDrag = { offset: t - win.start };
    overview.setPointerCapture(e.pointerId);
  });
  overview.addEventListener('pointermove', (e) => {
    if (!view) return;
    if (panDrag){
      const start = overT(e) - panDrag.offset;
      setWindow({ start, end: start + span() });
    }
    overview.style.cursor = panDrag ? 'grabbing' : 'grab';
  });
  overview.addEventListener('pointerup', () => { panDrag = null; });

  return {
    show(next){
      const fileChanged = !view || !next || view.audioBuffer !== next.audioBuffer;
      view = next; drag = null;
      if (view && fileChanged){ win = { start: 0, end: dur() }; if (onZoom) onZoom({ start: 0, end: dur(), duration: dur() }); }
      redraw();
    },
    // `follow`: scroll the window so the playhead stays visible (playback).
    setPlayhead(t, follow){
      playhead = t;
      if (view && follow && t != null){
        const next = followTime(win, t, dur(), MIN_SPAN);
        if (next !== win){ setWindow(next); return; }
      }
      redraw();
    },
    // Zoom around the playhead if it's visible, else the centre.
    zoomBy(factor){
      if (!view) return;
      const anchor = playhead != null && playhead >= win.start && playhead <= win.end ? playhead : (win.start + win.end) / 2;
      setWindow(zoomWindow(win, factor, anchor, dur(), MIN_SPAN));
    },
    zoomTo(start, end){ if (view) setWindow({ start, end }); },
    fit(){ if (view) setWindow({ start: 0, end: dur() }); },
    redraw,
  };
}
