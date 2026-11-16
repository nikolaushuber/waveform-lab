import { drawWaveformOverview } from './waveform.js';

// Interactive recording view for the Tap Analyser: waveform, crop regions
// with draggable edges, and tap markers that can be moved, added and
// removed. It owns only drawing and drag state; the page passes in a `view`
// and gets edits back through the callbacks:
//
//   view = { audioBuffer, cropStart, cropStartAuto, cropEnd, taps, edited, pending, error }
//          (all times in seconds; cropEnd = seconds cut off the end)
//   onCropChange({ cropStart } | { cropEnd })   after a crop edge is dropped
//   onTapsChange(taps)                          after a tap is moved, added or removed
//   snap(timeSec) -> timeSec                    where a dropped tap should land (Alt skips it)

// Each tap's FFT window, as in analyse_taps (python/waveform_lab/tap.py).
const WINDOW_OFFSET = 0.1, WINDOW_LENGTH = 1.0;
const HIT_PX = 7; // CSS pixels

const COLORS = {
  crop: 'rgba(194,59,46,0.16)',
  autoHatch: 'rgba(194,59,46,0.30)',
  edge: '#a8322a',
  tap: '#b5690a',
  tapOff: '#b4b4ad',
  window: 'rgba(47,111,176,0.09)',
  label: '#6b6b64',
};

export function createTapEditor(canvas, { onCropChange, onTapsChange, snap }){
  let view = null;
  let drag = null;   // { kind: 'start' | 'end' | 'tap', index, time }
  let hover = null;

  const dur = () => view.audioBuffer.duration || 1;
  const toX = (t) => (t / dur()) * canvas.width;
  const toT = (x) => Math.min(dur(), Math.max(0, (x / canvas.width) * dur()));
  const scale = () => { const w = canvas.getBoundingClientRect().width; return w ? canvas.width / w : 1; };
  const eventX = (e) => (e.clientX - canvas.getBoundingClientRect().left) * scale();

  function cropStartT(){ return drag && drag.kind === 'start' ? drag.time : view.cropStart; }
  function cropEndT(){ return drag && drag.kind === 'end' ? drag.time : dur() - view.cropEnd; }
  function tapTimes(){
    if (!drag || drag.kind !== 'tap') return view.taps;
    return view.taps.map((t, i) => (i === drag.index ? drag.time : t));
  }
  const inside = (t) => t >= cropStartT() && t < cropEndT();

  function hit(x){
    const tol = HIT_PX * scale();
    const taps = tapTimes();
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

  function redraw(){
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    if (!view){
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#f4f4f0'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = COLORS.label; ctx.font = '14px "JetBrains Mono", monospace';
      ctx.fillText('Load a recording on the left to see its crop and taps here.', 16, h / 2);
      canvas.dataset.tapCount = '0';
      delete canvas.dataset.cropStart;
      return;
    }
    drawWaveformOverview(canvas, view.audioBuffer, undefined, dur());

    const cs = cropStartT(), ce = cropEndT();
    const xs = toX(cs), xe = toX(ce);
    if (xs > 0){
      if (view.cropStartAuto && !(drag && drag.kind === 'start')) hatch(ctx, 0, xs, h);
      else { ctx.fillStyle = COLORS.crop; ctx.fillRect(0, 0, xs, h); }
    }
    if (xe < w){ ctx.fillStyle = COLORS.crop; ctx.fillRect(xe, 0, w - xe, h); }

    const taps = tapTimes();
    ctx.fillStyle = COLORS.window;
    taps.forEach((t) => {
      if (!inside(t)) return;
      const a = toX(t + WINDOW_OFFSET), b = toX(Math.min(ce, t + WINDOW_OFFSET + WINDOW_LENGTH));
      if (b > a) ctx.fillRect(a, 0, b - a, h);
    });
    taps.forEach((t, i) => {
      const x = toX(t);
      const on = inside(t);
      const active = (drag && drag.kind === 'tap' && drag.index === i) || (hover && hover.kind === 'tap' && hover.index === i);
      ctx.strokeStyle = on ? COLORS.tap : COLORS.tapOff;
      ctx.lineWidth = active ? 2.5 : 1.5;
      ctx.beginPath(); ctx.moveTo(x, 14); ctx.lineTo(x, h - 22); ctx.stroke();
      ctx.fillStyle = on ? COLORS.tap : COLORS.tapOff;
      ctx.beginPath(); ctx.arc(x, 12, active ? 7 : 5.5, 0, Math.PI * 2); ctx.fill();
    });

    edge(ctx, xs, h, (drag && drag.kind === 'start') || (hover && hover.kind === 'start'));
    edge(ctx, xe, h, (drag && drag.kind === 'end') || (hover && hover.kind === 'end'));

    ctx.font = '12px "JetBrains Mono", monospace';
    if (view.cropStartAuto && xs > 70 && !(drag && drag.kind === 'start')){
      ctx.fillStyle = COLORS.edge; ctx.fillText('auto crop', 8, 16);
    }
    if (view.pending || view.error){
      const msg = view.error ? `⚠ ${view.error}` : 'detecting taps…';
      ctx.fillStyle = view.error ? COLORS.edge : COLORS.label;
      ctx.fillText(msg, w - ctx.measureText(msg).width - 10, 16);
    }

    canvas.dataset.tapCount = String(view.taps.filter((t) => t >= view.cropStart && t < dur() - view.cropEnd).length);
    canvas.dataset.cropStart = view.cropStart.toFixed(3);
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (!view || e.button !== 0) return;
    const target = hit(eventX(e));
    if (!target) return;
    const time = target.kind === 'tap' ? view.taps[target.index] : target.kind === 'start' ? view.cropStart : dur() - view.cropEnd;
    drag = { ...target, time };
    canvas.setPointerCapture(e.pointerId);
    redraw();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!view) return;
    const x = eventX(e);
    if (drag){
      let t = toT(x);
      if (drag.kind === 'start') t = Math.min(t, cropEndT() - 0.01);
      if (drag.kind === 'end') t = Math.max(t, cropStartT() + 0.01);
      drag.time = t;
      redraw();
      return;
    }
    const h = hit(x);
    if ((h && h.kind) !== (hover && hover.kind) || (h && h.index) !== (hover && hover.index)){ hover = h; redraw(); }
    canvas.style.cursor = h ? 'ew-resize' : 'copy';
  });

  canvas.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    const round2 = (t) => Math.round(t * 100) / 100;
    if (d.kind === 'start') onCropChange({ cropStart: round2(d.time) });
    else if (d.kind === 'end') onCropChange({ cropEnd: round2(Math.max(0, dur() - d.time)) });
    else {
      const t = e.altKey ? d.time : snap(d.time);
      onTapsChange(view.taps.map((x, i) => (i === d.index ? t : x)).sort((a, b) => a - b));
    }
    redraw();
  });

  canvas.addEventListener('pointerleave', () => { if (hover && !drag){ hover = null; redraw(); } });

  canvas.addEventListener('dblclick', (e) => {
    if (!view || hit(eventX(e))) return;
    const t0 = toT(eventX(e));
    const t = e.altKey ? t0 : snap(t0);
    onTapsChange([...view.taps, t].sort((a, b) => a - b));
  });

  canvas.addEventListener('contextmenu', (e) => {
    if (!view) return;
    const target = hit(eventX(e));
    if (!target || target.kind !== 'tap') return;
    e.preventDefault();
    hover = null;
    onTapsChange(view.taps.filter((_, i) => i !== target.index));
  });

  return {
    show(next){ view = next; drag = null; redraw(); },
    redraw,
  };
}
