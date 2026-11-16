import { S } from '../state.js';
import { toMono } from '../../core/mono.js';
import { callPython, waitForPython } from '../../engines/python.js';
import { dropzoneTap, el, fileInputTap, runTapBtn, scatterCanvas, scatterLegend, scatterTooltip, tapFileCount, tapFreqRangeLabel, tapMetricNote, tapMetricSelect, tapResultsBody, tapRows, tapStatus, tapTopNSelect } from '../dom.js';
import { sortByName, uid } from '../format.js';
import { refreshTapEditor, requestDetection, selectTapEntry, tapRowSummary, tapsForAnalysis, windowOffset } from './tap-recording.js';
export const TAP_METRIC_NOTES = {
  magnitude: 'Peaks are found and normalised by linear FFT magnitude — the original behaviour.',
  energy: 'Peaks are ranked by normalised energy (energy ÷ −3dB bandwidth) — rewards sharp, well-defined resonances over broad, diffuse ones of equal energy (multi_energy.py).',
};
let tapRunning = false;
let lastTapFileSummaries = null; // cached results, so "Show top" can re-slice without re-running analysis
let scatterPoints = [];   // {cx, cy, color, label, freq, avgPct, ...} — hit-testable dots on the scatter graph
let tapHiddenLabels = new Set(); // file labels toggled off (click a legend name) — hidden from the scatter graph only

// ---------------- Tap Analyser page ----------------
export const TAP_COLOURS = ['#0f8a4c','#b5690a','#2f6fb0','#a02b9e','#c23b2e','#0a8a8a','#8a7a00','#555550'];

export function addTapFiles(fileArr){
  [...fileArr].forEach(file => {
    if (!/\.wav$/i.test(file.name) && file.type !== 'audio/wav' && file.type !== 'audio/x-wav') return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      const arrayBuffer = e.target.result;
      try{
        const tmpCtx = new (window.AudioContext||window.webkitAudioContext)();
        const audioBuffer = await tmpCtx.decodeAudioData(arrayBuffer.slice(0));
        const entry = {
          id: uid(), name: file.name, size: file.size, audioBuffer,
          skipStart:'', skipEnd:'', taps:null, included:true,
          _rawBuffer: arrayBuffer.slice(0)
        };
        S.tapLibrary.push(entry);
        sortByName(S.tapLibrary);
        renderTapRows();
        tmpCtx.close();
      }catch(err){
        console.error('Could not decode', file.name, err);
        alert(`Couldn't decode "${file.name}" as a WAV file.`);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}


export function renderTapRows(){
  const selectedCount = S.tapLibrary.filter(e => e.included !== false).length;
  tapFileCount.textContent = S.tapLibrary.length
    ? `${S.tapLibrary.length} loaded · ${selectedCount} selected`
    : '0 loaded';
  if (!S.tapLibrary.length){
    tapRows.innerHTML = '<div class="empty-note">No files yet.</div>';
    refreshTapEditor();
    return;
  }
  if (!S.tapLibrary.some(e => e.id === S.tapSelectedId)) S.tapSelectedId = S.tapLibrary[0].id;
  const scrollTop = tapRows.scrollTop;
  tapRows.innerHTML = '';
  S.tapLibrary.forEach(entry => {
    if (entry.included === undefined) entry.included = true;
    if (entry.taps === undefined) entry.taps = null;
    if (!entry.detection && !entry._detecting) requestDetection(entry, 0);
    const row = document.createElement('div');
    row.className = 'tap-row' + (entry.included ? '' : ' excluded') + (entry.id === S.tapSelectedId ? ' selected' : '');
    row.addEventListener('click', (e) => {
      if (e.target.closest('input, button, label') || entry.id === S.tapSelectedId) return;
      selectTapEntry(entry.id);
    });

    const head = document.createElement('div');
    head.className = 'tr-head';

    const includeWrap = document.createElement('label');
    includeWrap.className = 'tr-include';
    includeWrap.title = 'Include this recording in the analysis and scatter graph';
    const includeInput = document.createElement('input');
    includeInput.type = 'checkbox';
    includeInput.checked = entry.included;
    includeInput.addEventListener('change', () => {
      entry.included = includeInput.checked;
      row.classList.toggle('excluded', !entry.included);
      tapFileCount.textContent = `${S.tapLibrary.length} loaded · ${S.tapLibrary.filter(e => e.included !== false).length} selected`;
    });
    includeWrap.appendChild(includeInput);

    const nameEl = document.createElement('div');
    nameEl.className = 'tr-name';
    nameEl.textContent = entry.name;
    const removeBtn = document.createElement('button');
    removeBtn.className = 'tr-remove';
    removeBtn.innerHTML = '&times;';
    removeBtn.title = 'Remove this file';
    removeBtn.addEventListener('click', () => {
      S.tapLibrary = S.tapLibrary.filter(f => f.id !== entry.id);
      if (S.tapSelectedId === entry.id) S.tapSelectedId = null;
      renderTapRows();
    });
    head.appendChild(includeWrap);
    head.appendChild(nameEl);
    head.appendChild(removeBtn);

    const meta = document.createElement('div');
    meta.className = 'tr-meta';
    meta.textContent = tapRowSummary(entry);

    row.appendChild(head);
    row.appendChild(meta);
    tapRows.appendChild(row);
  });
  tapRows.scrollTop = scrollTop;
  refreshTapEditor();
}


export async function runTapAnalysis(){
  if (tapRunning) return;
  if (!S.tapLibrary.length){
    tapStatus.textContent = 'Load at least one .wav file first.';
    tapStatus.classList.add('err');
    return;
  }
  const activeEntries = S.tapLibrary.filter(e => e.included !== false);
  if (!activeEntries.length){
    tapStatus.textContent = 'Tick at least one recording to analyse.';
    tapStatus.classList.add('err');
    return;
  }
  tapRunning = true;
  runTapBtn.disabled = true;
  tapStatus.classList.remove('err');

  const opts = {
    numEvents:  parseInt(el('advNumEvents').value, 10) || 10,
    minGap:     parseFloat(el('advMinGap').value) || 0.3,
    minFreq:    parseFloat(el('advMinFreq').value) || 50,
    maxFreq:    parseFloat(el('advMaxFreq').value) || 1000,
    topNBasis:  parseInt(el('advTopNBasis').value, 10) || 10,
    tolerance:  parseFloat(el('advTolerance').value) || 2,
    useEnergy:  el('tapMetric').value === 'energy',
    windowOffset: windowOffset(),
  };

  try{
    await waitForPython((msg) => { tapStatus.textContent = msg; });
  }catch(err){
    console.error('Python failed to load', err);
    tapRunning = false;
    runTapBtn.disabled = false;
    tapStatus.textContent = `Couldn't load the Python analysis engine (${err.message}). It needs an internet connection the first time.`;
    tapStatus.classList.add('err');
    return;
  }

  const fileSummaries = [];
  const errors = [];
  for (let i = 0; i < activeEntries.length; i++){
    const entry = activeEntries[i];
    tapStatus.textContent = `Analysing ${i+1}/${activeEntries.length}: ${entry.name}…`;
    try{
      const { audioBuffer } = entry;
      const res = await callPython('run_tap_analysis',
        { sr: audioBuffer.sampleRate, skipStart: entry.skipStart || '', skipEnd: entry.skipEnd || '', opts, ...tapsForAnalysis(entry) },
        [toMono(audioBuffer)]);
      if (res.error) errors.push(`${entry.name} (${res.error})`);
      else fileSummaries.push({ label: entry.name, ...res });
    }catch(err){
      console.error(err);
      errors.push(`${entry.name} (${err.message})`);
    }
  }

  tapRunning = false;
  runTapBtn.disabled = false;

  if (!fileSummaries.length){
    tapStatus.textContent = errors.length ? `Failed: ${errors.join(' · ')}` : 'No files processed successfully.';
    tapStatus.classList.add('err');
    return;
  }

  tapStatus.textContent = errors.length
    ? `Done, with ${errors.length} skipped: ${errors.join(' · ')}`
    : `Done — analysed ${fileSummaries.length} file(s).`;
  if (errors.length) tapStatus.classList.add('err');

  lastTapFileSummaries = fileSummaries;
  tapHiddenLabels = new Set(); // fresh run — show every file by default
  renderScatter(fileSummaries);
  renderVarianceTables(fileSummaries);
}

export function getTapTopN(){
  const n = parseInt(tapTopNSelect.value, 10);
  return Math.min(10, Math.max(1, n || 5));
}

export function renderScatter(fileSummaries){
  const topN = getTapTopN();
  // Colour is assigned from each file's position in the *full* (unfiltered)
  // list, so a file's colour never shifts when other files get hidden —
  // and stays consistent with the same file's row in the variance tables
  // below, which index off this same full list independently.
  const allSummaries = fileSummaries.map((fs, fi) => ({
    ...fs,
    freqSummary: fs.freqSummary.slice(0, topN),
    color: TAP_COLOURS[fi % TAP_COLOURS.length],
  }));
  const visibleSummaries = allSummaries.filter(fs => !tapHiddenLabels.has(fs.label));

  const ctx = scatterCanvas.getContext('2d');
  const w = scatterCanvas.width, h = scatterCanvas.height;
  ctx.clearRect(0,0,w,h);
  ctx.fillStyle = '#fbfbf9';
  ctx.fillRect(0,0,w,h);

  const allFreqs = [], allPcts = [];
  visibleSummaries.forEach(fs => fs.freqSummary.forEach(e => { allFreqs.push(e.freq); allPcts.push(e.avgPct); }));

  if (!allFreqs.length){
    ctx.fillStyle = '#83837c';
    ctx.font = '15px "JetBrains Mono", monospace';
    ctx.fillText(allSummaries.length ? 'All files are hidden — click a name below to show it.' : 'No frequency data to plot.', 20, h/2);
    scatterPoints = [];
    scatterTooltip.classList.remove('visible');
    renderScatterLegend(allSummaries);
    return;
  }

  const fMin = Math.min(...allFreqs), fMax = Math.max(...allFreqs);
  const pMin = 0, pMax = Math.max(...allPcts);
  const freqRange = Math.max(fMax - fMin, 1);
  const xPad = Math.max(freqRange*0.18, 20);
  const yPad = Math.max(pMax*0.18, 2);
  const xLo = fMin - xPad, xHi = fMax + xPad;
  const yLo = 0, yHi = pMax + yPad;

  const marginL = 54, marginB = 26, marginT = 12, marginR = 14;
  const plotW = w - marginL - marginR, plotH = h - marginT - marginB;
  const toX = f => marginL + ((f-xLo)/(xHi-xLo))*plotW;
  const toY = p => marginT + plotH - ((p-yLo)/(yHi-yLo))*plotH;

  // grid + axes
  ctx.strokeStyle = '#e2e2dc';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#6b6b64';
  ctx.font = '13px "JetBrains Mono", monospace';
  for (let i = 0; i <= 5; i++){
    const p = yLo + (i/5)*(yHi-yLo);
    const y = toY(p);
    ctx.beginPath(); ctx.moveTo(marginL, y); ctx.lineTo(w-marginR, y); ctx.stroke();
    ctx.fillText(p.toFixed(1)+'%', 4, y+3);
  }
  const nXTicks = 6;
  for (let i = 0; i <= nXTicks; i++){
    const f = xLo + (i/nXTicks)*(xHi-xLo);
    const x = toX(f);
    ctx.beginPath(); ctx.moveTo(x, marginT); ctx.lineTo(x, h-marginB); ctx.stroke();
    const label = f.toFixed(0)+' Hz';
    ctx.fillText(label, Math.min(w-marginR-ctx.measureText(label).width, Math.max(marginL, x-16)), h-8);
  }

  const dotR = 5.5;

  // Draw a filled, coloured dot marker for every frequency point, and
  // remember each one's canvas position + underlying data so a click on
  // the graph can look up which point was hit.
  scatterPoints = [];
  visibleSummaries.forEach(fs => {
    fs.freqSummary.forEach(entry => {
      const cx = toX(entry.freq), cy = toY(entry.avgPct);
      ctx.beginPath();
      ctx.arc(cx, cy, dotR, 0, Math.PI*2);
      ctx.fillStyle = fs.color;
      ctx.fill();
      ctx.strokeStyle = '#fbfbf9';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      scatterPoints.push({
        cx, cy, color: fs.color, label: fs.label,
        freq: entry.freq, avgPct: entry.avgPct, appearances: entry.appearances,
        eventCount: fs.eventCount, stdPct: entry.stdPct,
        minPct: entry.minPct, maxPct: entry.maxPct, stdHz: entry.stdHz
      });
    });
  });
  scatterTooltip.classList.remove('visible');

  renderScatterLegend(allSummaries);
}

// Legend under the scatter graph: one clickable entry per file. Clicking a
// name toggles that file's points on/off the graph above (the variance
// tables below are unaffected — this only controls what's plotted).
export function renderScatterLegend(allSummaries){
  scatterLegend.innerHTML = '';
  allSummaries.forEach(fs => {
    const hidden = tapHiddenLabels.has(fs.label);
    const item = document.createElement('div');
    item.className = 'sl-item' + (hidden ? ' hidden' : '');
    item.title = hidden ? 'Click to show this file on the graph' : 'Click to hide this file from the graph';
    const swatch = document.createElement('span');
    swatch.className = 'sl-swatch';
    swatch.style.background = fs.color;
    item.appendChild(swatch);
    item.appendChild(document.createTextNode(`${fs.label} (${fs.eventCount}/${fs.detectedEvents} events)`));
    item.addEventListener('click', () => {
      if (tapHiddenLabels.has(fs.label)) tapHiddenLabels.delete(fs.label);
      else tapHiddenLabels.add(fs.label);
      if (lastTapFileSummaries) renderScatter(lastTapFileSummaries);
    });
    scatterLegend.appendChild(item);
  });
}

export function renderVarianceTables(fileSummaries){
  const topN = getTapTopN();
  fileSummaries = fileSummaries.map(fs => ({ ...fs, freqSummary: fs.freqSummary.slice(0, topN) }));
  tapResultsBody.innerHTML = fileSummaries.map((fs, fi) => {
    const color = TAP_COLOURS[fi % TAP_COLOURS.length];
    const rows = fs.freqSummary.map(e => `
        <tr>
          <td class="freq">${e.freq.toFixed(1)} Hz</td>
          <td>${e.appearances}/${fs.eventCount}</td>
          <td>${e.avgPct.toFixed(1)}%</td>
          <td>±${e.stdPct.toFixed(2)}%</td>
          <td>${e.minPct.toFixed(1)}–${e.maxPct.toFixed(1)}%</td>
          <td>±${e.stdHz.toFixed(3)} Hz</td>
        </tr>`).join('');
    return `
        <div class="variance-block">
          <div class="vb-title"><span class="swatch" style="background:${color};"></span>${fs.label} — ${fs.eventCount} of ${fs.detectedEvents} events analysed</div>
          <table class="variance">
            <thead><tr><th>Freq</th><th>Appears</th><th>Avg %</th><th>Std % (energy variance)</th><th>Range %</th><th>Drift (freq variance)</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="6" style="color:var(--text-faint);">No consistent peaks found.</td></tr>'}</tbody>
          </table>
        </div>`;
  }).join('');
}

// ---------------- Scatter graph: click a dot to see its data ----------------
export function getScatterCanvasPos(clientX, clientY){
  const rect = scatterCanvas.getBoundingClientRect();
  const scaleX = scatterCanvas.width / rect.width;
  const scaleY = scatterCanvas.height / rect.height;
  return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
}

export function findScatterPointAt(clientX, clientY){
  const { x, y } = getScatterCanvasPos(clientX, clientY);
  const hitR = 10; // a little bigger than the dot itself, forgiving to click
  let best = null, bestDist = Infinity;
  for (const pt of scatterPoints){
    const d = Math.hypot(pt.cx - x, pt.cy - y);
    if (d <= hitR && d < bestDist){ best = pt; bestDist = d; }
  }
  return best;
}

// Two or more points can sit close enough together that their dots
// visually touch or overlap — a single click there is ambiguous about
// which one the user meant. So: find the closest point to the click, then
// gather every other point clustered right on top of *that* one (not just
// whatever else happens to be near the click itself) and return them all,
// closest first, so the tooltip can list every dataset under the cursor.
export function findScatterClusterAt(clientX, clientY){
  const anchor = findScatterPointAt(clientX, clientY);
  if (!anchor) return [];
  const clusterR = 13; // a little larger than two touching dot radii (5.5px each)
  return scatterPoints
    .map(pt => ({ pt, d: Math.hypot(pt.cx - anchor.cx, pt.cy - anchor.cy) }))
    .filter(o => o.d <= clusterR)
    .sort((a,b) => a.d - b.d)
    .map(o => o.pt);
}

export function scatterStatBlock(pt){
  return `
      <div class="tt-entry">
        <div class="tt-title"><span class="tt-swatch" style="background:${pt.color};"></span>${pt.label}</div>
        <div class="tt-grid">
          <div class="tt-stat"><b>${pt.freq.toFixed(1)} Hz</b><span>Frequency</span></div>
          <div class="tt-stat"><b>${pt.avgPct.toFixed(1)}%</b><span>Avg level</span></div>
          <div class="tt-stat"><b>${pt.appearances}/${pt.eventCount}</b><span>Appears in</span></div>
          <div class="tt-stat"><b>${pt.minPct.toFixed(1)}–${pt.maxPct.toFixed(1)}%</b><span>Range</span></div>
          <div class="tt-stat"><b>±${pt.stdPct.toFixed(2)}%</b><span>Std (energy)</span></div>
          <div class="tt-stat"><b>±${pt.stdHz.toFixed(3)} Hz</b><span>Drift</span></div>
        </div>
      </div>`;
}

export function showScatterTooltip(pts){
  const multi = pts.length > 1;
  scatterTooltip.classList.toggle('multi', multi);
  scatterTooltip.innerHTML =
    (multi ? `<div class="tt-multi-note">${pts.length} overlapping points — closest first</div>` : '') +
    pts.map(scatterStatBlock).join('');
  scatterTooltip.classList.add('visible');

  // Position the tooltip right beside the (closest) dot that was clicked,
  // in the canvas's on-screen CSS pixel space, not its internal
  // drawing-buffer space — flipping to the other side / clamping so it
  // never spills outside the bordered "screen" box the canvas sits in.
  const pt = pts[0];
  const rect = scatterCanvas.getBoundingClientRect();
  const scaleX = scatterCanvas.width / rect.width;
  const scaleY = scatterCanvas.height / rect.height;
  const cssX = pt.cx / scaleX;
  const cssY = pt.cy / scaleY;

  const container = scatterCanvas.parentElement;
  const containerW = container.clientWidth;
  const containerH = container.clientHeight;
  const tw = scatterTooltip.offsetWidth;
  const th = scatterTooltip.offsetHeight;

  let left = scatterCanvas.offsetLeft + cssX + 14;
  if (left + tw > containerW - 4) left = scatterCanvas.offsetLeft + cssX - tw - 14;
  left = Math.max(4, left);

  let top = scatterCanvas.offsetTop + cssY - th / 2;
  top = Math.max(4, Math.min(top, containerH - th - 4));

  scatterTooltip.style.left = left + 'px';
  scatterTooltip.style.top = top + 'px';
}

// Event wiring, run once at startup (main.js calls each module's init()).
export function init(){
  tapMetricSelect.addEventListener('change', () => {
    tapMetricNote.textContent = TAP_METRIC_NOTES[tapMetricSelect.value] || '';
  });

  fileInputTap.addEventListener('change', (e) => addTapFiles(e.target.files));
  ;['dragover','dragenter'].forEach(evtName => {
    dropzoneTap.addEventListener(evtName, (e) => { e.preventDefault(); dropzoneTap.classList.add('drag'); });
  });
  ;['dragleave','drop'].forEach(evtName => {
    dropzoneTap.addEventListener(evtName, (e) => { e.preventDefault(); dropzoneTap.classList.remove('drag'); });
  });
  dropzoneTap.addEventListener('drop', (e) => {
    if (e.dataTransfer.files && e.dataTransfer.files.length) addTapFiles(e.dataTransfer.files);
  });

  runTapBtn.addEventListener('click', runTapAnalysis);

  tapTopNSelect.addEventListener('change', () => {
    const n = getTapTopN();
    tapFreqRangeLabel.textContent = `(top ${n} most common frequenc${n === 1 ? 'y' : 'ies'} per file, average % vs. Hz)`;
    if (lastTapFileSummaries) {
      renderScatter(lastTapFileSummaries);
      renderVarianceTables(lastTapFileSummaries);
    }
  });

  scatterCanvas.addEventListener('click', (e) => {
    const pts = findScatterClusterAt(e.clientX, e.clientY);
    if (pts.length) showScatterTooltip(pts);
    else scatterTooltip.classList.remove('visible');
  });
  scatterCanvas.addEventListener('mousemove', (e) => {
    const pt = findScatterPointAt(e.clientX, e.clientY);
    scatterCanvas.style.cursor = pt ? 'pointer' : 'default';
  });
}
