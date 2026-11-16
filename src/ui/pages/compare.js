import { S } from '../state.js';
import { autoDbRange, computeSpectrumAt, findLoudestPeakForward } from '../../core/spectrum.js';
import { clearCompareBtn, compareCanvas, compareCursorInfo, compareFileCount, compareLegend, compareRows, dropzoneCompare, fileInputCompare, previewCanvas, previewLabel } from '../dom.js';
import { fmtHz, fmtTime } from '../format.js';
import { addFiles } from './analyze.js';
import { drawGrid, freqToX, getSmoothedDbAtFreq, xToFreq } from '../views/spectrum.js';
import { drawWaveformOverview } from '../views/waveform.js';

// Compare page state
export const TRACE_COLOURS = ['#0f8a4c','#b5690a','#2f6fb0','#a02b9e','#c23b2e','#0a8a8a','#8a7a00','#555550'];

// ---------------- Compare page ----------------
export function renderCompareRows(){
  compareFileCount.textContent = `${S.library.length} loaded`;
  if (S.library.length === 0){
    compareRows.innerHTML = '<div class="empty-note">No files yet.</div>';
    return;
  }
  compareRows.innerHTML = '';
  S.library.forEach(entry => {
    if (entry.compareFrac === undefined) entry.compareFrac = 0;
    const dur = entry.audioBuffer ? entry.audioBuffer.duration : 0;

    const row = document.createElement('div');
    row.className = 'compare-row';

    const nameEl = document.createElement('div');
    nameEl.className = 'cr-name';
    nameEl.textContent = entry.name;

    const waveWrap = document.createElement('div');
    waveWrap.className = 'cr-wave-wrap';
    const waveCanvasRow = document.createElement('canvas');
    waveCanvasRow.className = 'cr-wave';
    waveCanvasRow.width = 1200;
    waveCanvasRow.height = 130;
    waveWrap.appendChild(waveCanvasRow);

    const controls = document.createElement('div');
    controls.className = 'cr-controls';

    const timeEl = document.createElement('span');
    timeEl.className = 'cr-time';
    timeEl.textContent = fmtTime(entry.compareFrac * dur);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'cr-slider';
    slider.min = 0; slider.max = 1000; slider.step = 1;
    slider.value = Math.round(entry.compareFrac * 1000);

    function setMoment(frac){
      entry.compareFrac = Math.min(1, Math.max(0, frac));
      slider.value = Math.round(entry.compareFrac * 1000);
      timeEl.textContent = fmtTime(entry.compareFrac * dur);
      if (entry.audioBuffer) drawWaveformOverview(waveCanvasRow, entry.audioBuffer, entry.compareFrac, dur);
      schedulePreview(entry, entry.compareFrac * dur);
    }

    slider.addEventListener('input', () => setMoment(slider.value/1000));

    let rowDragging = false;
    function seekFromRowEvent(clientX){
      const rect = waveCanvasRow.getBoundingClientRect();
      const frac = (clientX - rect.left) / rect.width;
      setMoment(frac);
    }
    waveCanvasRow.addEventListener('pointerdown', (e) => { rowDragging = true; seekFromRowEvent(e.clientX); });
    window.addEventListener('pointermove', (e) => { if (rowDragging) seekFromRowEvent(e.clientX); });
    window.addEventListener('pointerup', () => { rowDragging = false; });

    controls.appendChild(slider);
    controls.appendChild(timeEl);

    const actions = document.createElement('div');
    actions.className = 'cr-actions';

    const sampleWrap = document.createElement('div');
    sampleWrap.className = 'cr-sample';
    const offsetInput = document.createElement('input');
    offsetInput.type = 'number';
    offsetInput.min = '0'; offsetInput.step = '0.001';
    offsetInput.value = entry.crSampleOffset !== undefined ? entry.crSampleOffset : '0.01';
    offsetInput.title = 'Offset (seconds) after the loudest peak';
    const sampleBtnRow = document.createElement('button');
    sampleBtnRow.className = 'cr-sample-btn';
    sampleBtnRow.textContent = 'Sample';
    sampleBtnRow.title = "Drag the marker to just before a tap, then Sample jumps to its loudest point plus the offset";
    sampleBtnRow.addEventListener('click', () => {
      if (!entry.audioBuffer) return;
      entry.crSampleOffset = parseFloat(offsetInput.value) || 0;
      const offsetT = Math.max(0, entry.crSampleOffset);
      const peakTime = findLoudestPeakForward(entry.audioBuffer, entry.compareFrac * dur, 0.5);
      const sampleTime = Math.min(dur, peakTime + offsetT);
      setMoment(dur ? sampleTime/dur : 0);
    });
    sampleWrap.appendChild(offsetInput);
    sampleWrap.appendChild(sampleBtnRow);

    const addBtn = document.createElement('button');
    addBtn.className = 'cr-add';
    addBtn.textContent = 'Add Snapshot';
    addBtn.addEventListener('click', () => {
      addCompareTrace(entry, entry.compareFrac * dur);
    });

    actions.appendChild(sampleWrap);
    actions.appendChild(addBtn);

    row.appendChild(nameEl);
    row.appendChild(waveWrap);
    row.appendChild(controls);
    row.appendChild(actions);
    compareRows.appendChild(row);

    if (entry.audioBuffer) drawWaveformOverview(waveCanvasRow, entry.audioBuffer, entry.compareFrac, dur);
  });
}

export function addCompareTrace(entry, time){
  if (!entry.audioBuffer) return;
  const capture = computeSpectrumAt(entry.audioBuffer, time, 4096, 65536);
  const color = TRACE_COLOURS[S.compareIdSeq % TRACE_COLOURS.length];
  S.compareIdSeq++;
  S.compareTraces.push({ id: 'ct' + S.compareIdSeq, color, entryName: entry.name, time, capture, manualOffset: 0 });
  renderCompareLegend();
  drawCompareGraph();
}

export function removeCompareTrace(id){
  S.compareTraces = S.compareTraces.filter(t => t.id !== id);
  renderCompareLegend();
  drawCompareGraph();
}

export function renderCompareLegend(){
  if (S.compareTraces.length === 0){
    compareLegend.innerHTML = '<div class="empty-note">Nothing added yet — pick a moment on the left and click "Add Snapshot".</div>';
    return;
  }
  compareLegend.innerHTML = '';
  S.compareTraces.forEach(t => {
    const top = t.capture.peaks[0];
    const item = document.createElement('div');
    item.className = 'legend-item';

    const swatch = document.createElement('span');
    swatch.className = 'legend-swatch';
    swatch.style.background = t.color;

    const offsetTag = t.manualOffset !== 0
      ? ` · shifted ${t.manualOffset > 0 ? '+' : ''}${t.manualOffset.toFixed(1)} dB`
      : '';

    const info = document.createElement('div');
    info.className = 'legend-info';
    info.innerHTML = `<div class="li-name">${t.entryName} @ ${fmtTime(t.time)}</div>
        <div class="li-meta">${top ? `peak ${fmtHz(top.freq)} · ${top.db.toFixed(1)} dBFS` : 'no peak found'}${offsetTag}</div>`;

    if (t.manualOffset !== 0){
      const resetBtn = document.createElement('button');
      resetBtn.className = 'legend-remove';
      resetBtn.innerHTML = '&#8635;';
      resetBtn.title = 'Reset vertical shift';
      resetBtn.addEventListener('click', () => {
        t.manualOffset = 0;
        renderCompareLegend();
        drawCompareGraph();
      });
      item.appendChild(swatch);
      item.appendChild(info);
      item.appendChild(resetBtn);
    } else {
      item.appendChild(swatch);
      item.appendChild(info);
    }

    const removeBtn = document.createElement('button');
    removeBtn.className = 'legend-remove';
    removeBtn.innerHTML = '&times;';
    removeBtn.title = 'Remove this trace';
    removeBtn.addEventListener('click', () => removeCompareTrace(t.id));
    item.appendChild(removeBtn);
    compareLegend.appendChild(item);
  });
}

// ---------------- Live preview (while choosing a snapshot moment) ----------------
export function schedulePreview(entry, time){
  S.pendingPreviewEntry = entry;
  S.pendingPreviewTime = time;
  if (S.previewScheduled) return;
  S.previewScheduled = true;
  requestAnimationFrame(() => {
    S.previewScheduled = false;
    if (S.pendingPreviewEntry) renderPreview(S.pendingPreviewEntry, S.pendingPreviewTime);
  });
}

export function renderPreview(entry, time){
  if (!entry.audioBuffer) return;
  const capture = computeSpectrumAt(entry.audioBuffer, time, 4096, 65536);
  S.lastPreviewCapture = capture;
  previewLabel.textContent = `— ${entry.name} @ ${fmtTime(time)}`;
  drawPreviewSpectrum(capture);
}

export function drawPreviewSpectrum(capture){
  const ctx = previewCanvas.getContext('2d');
  const w = previewCanvas.width, h = previewCanvas.height;
  ctx.clearRect(0,0,w,h);
  drawGrid(ctx, w, h);

  const curveVals = new Array(w);
  for (let x = 0; x < w; x++) curveVals[x] = getSmoothedDbAtFreq(capture, xToFreq(x, w));
  const { dbMin, dbMax } = autoDbRange(curveVals);

  ctx.fillStyle = '#6b6b64';
  ctx.font = '13px "JetBrains Mono", monospace';
  for (let i = 0; i <= 6; i++){
    const dbAtLine = dbMax - (i/6)*(dbMax - dbMin);
    const y = (h/6)*i;
    ctx.fillText(dbAtLine.toFixed(0) + ' dB', 6, Math.max(13, y - 3));
  }

  ctx.beginPath();
  ctx.strokeStyle = '#2f6fb0';
  ctx.lineWidth = 2;
  ctx.shadowColor = 'rgba(47,111,176,0.3)';
  ctx.shadowBlur = 5;
  for (let x = 0; x < w; x++){
    const db = Math.max(dbMin, Math.min(dbMax, curveVals[x]));
    const norm = (db - dbMin)/(dbMax - dbMin);
    const y = h - norm*h;
    if (x === 0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;

  const peaksInRange = capture.peaks.filter(p => p.freq >= S.FREQ_MIN && p.freq <= S.FREQ_MAX);
  if (peaksInRange.length){
    const top = peaksInRange[0];
    const x = freqToX(top.freq, w);
    ctx.strokeStyle = 'rgba(47,111,176,0.45)';
    ctx.setLineDash([3,3]);
    ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#2f6fb0';
    ctx.font = '15px "JetBrains Mono", monospace';
    const lx = Math.min(w-150, x+8);
    ctx.fillText(fmtHz(top.freq), lx, 18);
    ctx.font = '13px "JetBrains Mono", monospace';
    ctx.fillText(`${top.db.toFixed(1)} dBFS`, lx, 33);
  }
}

export function resetPreview(){
  previewLabel.textContent = '— drag a waveform on the left to preview it here';
  const ctx = previewCanvas.getContext('2d');
  ctx.clearRect(0,0,previewCanvas.width, previewCanvas.height);
  drawGrid(ctx, previewCanvas.width, previewCanvas.height);
}

export function drawCompareGraph(){
  const ctx = compareCanvas.getContext('2d');
  const w = compareCanvas.width, h = compareCanvas.height;
  ctx.clearRect(0,0,w,h);
  drawGrid(ctx, w, h);

  // dBFS axis on the left (comparison uses raw levels, not peak-normalised,
  // so absolute loudness differences between files stay visible)
  const traceCurves = S.compareTraces.map(t => {
    const vals = new Array(w);
    for (let x = 0; x < w; x++) vals[x] = getSmoothedDbAtFreq(t.capture, xToFreq(x, w)) + t.manualOffset;
    return vals;
  });
  const allVals = traceCurves.length ? [].concat(...traceCurves) : [];
  const { dbMin, dbMax } = autoDbRange(allVals);
  S.compareDbMin = dbMin; S.compareDbMax = dbMax;

  ctx.fillStyle = '#6b6b64';
  ctx.font = '13px "JetBrains Mono", monospace';
  for (let i = 0; i <= 6; i++){
    const dbAtLine = dbMax - (i/6)*(dbMax - dbMin);
    const y = (h/6)*i;
    ctx.fillText(dbAtLine.toFixed(0) + ' dB', 6, Math.max(13, y - 3));
  }

  S.compareTraces.forEach((t, ti) => {
    ctx.beginPath();
    ctx.strokeStyle = t.color;
    ctx.lineWidth = (t.id === S.draggingTraceId) ? 3 : 2;
    for (let x = 0; x < w; x++){
      const db = Math.max(dbMin, Math.min(dbMax, traceCurves[ti][x]));
      const norm = (db - dbMin)/(dbMax - dbMin);
      const y = h - norm*h;
      if (x === 0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.stroke();
  });

  if (S.compareCursorFreq != null && S.compareCursorFreq >= S.FREQ_MIN && S.compareCursorFreq <= S.FREQ_MAX){
    const cx = freqToX(S.compareCursorFreq, w);
    ctx.strokeStyle = '#111111';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4,4]);
    ctx.beginPath(); ctx.moveTo(cx,0); ctx.lineTo(cx,h); ctx.stroke();
    ctx.setLineDash([]);
    updateCompareCursorInfo();
  }
}

// Canvas-pixel y-position of a trace's (offset-adjusted) curve at a given frequency
export function traceYAtFreq(trace, freq, w, h){
  const db = getSmoothedDbAtFreq(trace.capture, freq) + trace.manualOffset;
  const clamped = Math.max(S.compareDbMin, Math.min(S.compareDbMax, db));
  const norm = (clamped - S.compareDbMin)/(S.compareDbMax - S.compareDbMin);
  return h - norm*h;
}

export function updateCompareCursorInfo(){
  if (S.compareCursorFreq == null || S.compareTraces.length === 0){
    compareCursorInfo.innerHTML = 'Drag on the graph to read off levels at a chosen frequency across every trace — or grab a curve directly to slide it up/down and line up peaks.';
    return;
  }
  const rows = S.compareTraces.map(t => {
    const db = getSmoothedDbAtFreq(t.capture, S.compareCursorFreq) + t.manualOffset;
    const offsetTag = t.manualOffset !== 0 ? ` (shifted ${t.manualOffset>0?'+':''}${t.manualOffset.toFixed(1)} dB)` : '';
    return `<div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
        <span class="legend-swatch" style="background:${t.color};"></span>
        <span>${t.entryName} @ ${fmtTime(t.time)} — <b style="color:var(--text);">${db.toFixed(1)} dBFS</b>${offsetTag}</span>
      </div>`;
  }).join('');
  compareCursorInfo.innerHTML = `<div>Cursor: <b style="color:var(--text);">${fmtHz(S.compareCursorFreq)}</b></div>${rows}`;
}

export function updateCompareCursorFromEvent(clientX){
  const rect = compareCanvas.getBoundingClientRect();
  const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  S.compareCursorFreq = xToFreq(frac, 1);
  drawCompareGraph();
}

export const TRACE_PICK_THRESHOLD = 28; // canvas px — how close a click must be to a curve to grab it

// Wiring that ran at load time in the original script.js; main.js calls
// each module's init() in the original order.
export function init(){
  compareCanvas.addEventListener('pointerdown', (evt) => {
    const rect = compareCanvas.getBoundingClientRect();
    const w = compareCanvas.width, h = compareCanvas.height;
    const canvasX = (evt.clientX - rect.left) / rect.width * w;
    const canvasY = (evt.clientY - rect.top) / rect.height * h;
    const freq = xToFreq(canvasX, w);

    let nearest = null, nearestDist = Infinity;
    S.compareTraces.forEach(t => {
      const y = traceYAtFreq(t, freq, w, h);
      const dist = Math.abs(y - canvasY);
      if (dist < nearestDist){ nearestDist = dist; nearest = t; }
    });

    if (nearest && nearestDist <= TRACE_PICK_THRESHOLD){
      S.draggingTraceId = nearest.id;
      S.dragStartClientY = evt.clientY;
      S.dragStartOffset = nearest.manualOffset;
      drawCompareGraph();
    } else {
      S.draggingCompareCursor = true;
      updateCompareCursorFromEvent(evt.clientX);
    }
  });
  window.addEventListener('pointermove', (evt) => {
    if (S.draggingTraceId){
      const t = S.compareTraces.find(tr => tr.id === S.draggingTraceId);
      if (!t) return;
      const rect = compareCanvas.getBoundingClientRect();
      const scale = compareCanvas.height / rect.height;
      const deltaCanvasY = (evt.clientY - S.dragStartClientY) * scale;
      const deltaDb = -deltaCanvasY / compareCanvas.height * (S.compareDbMax - S.compareDbMin);
      t.manualOffset = S.dragStartOffset + deltaDb;
      drawCompareGraph();
      return;
    }
    if (S.draggingCompareCursor) updateCompareCursorFromEvent(evt.clientX);
  });
  window.addEventListener('pointerup', () => {
    if (S.draggingTraceId){ S.draggingTraceId = null; renderCompareLegend(); drawCompareGraph(); }
    S.draggingCompareCursor = false;
  });

  clearCompareBtn.addEventListener('click', () => {
    S.compareTraces = [];
    S.compareCursorFreq = null;
    renderCompareLegend();
    drawCompareGraph();
  });

  fileInputCompare.addEventListener('change', (e) => addFiles(e.target.files));
  ;['dragover','dragenter'].forEach(evtName => {
    dropzoneCompare.addEventListener(evtName, (e) => { e.preventDefault(); dropzoneCompare.classList.add('drag'); });
  });
  ;['dragleave','drop'].forEach(evtName => {
    dropzoneCompare.addEventListener(evtName, (e) => { e.preventDefault(); dropzoneCompare.classList.remove('drag'); });
  });
  dropzoneCompare.addEventListener('drop', (e) => {
    if (e.dataTransfer.files && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  });
}
