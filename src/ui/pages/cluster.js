import { S } from '../state.js';
import { toMono } from '../../core/mono.js';
import { callPython, waitForPython } from '../../engines/python.js';
import { clusterFileCount, clusterResultsBody, clusterRows, clusterStatus, dropzoneCluster, el, fileInputCluster, runClusterBtn } from '../dom.js';
import { syncEntryToFolder } from '../folder-store.js';
import { sortByName, uid } from '../format.js';
import { drawWaveformOverview } from '../views/waveform.js';

// ---------------- Clustering: file library (mirrors Tap Analyser's) ----------------
export function addClusterFiles(fileArr){
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
          cropStart:'', cropEnd:'', included:true,
          _rawBuffer: arrayBuffer.slice(0)
        };
        S.clusterLibrary.push(entry);
        sortByName(S.clusterLibrary);
        renderClusterRows();
        tmpCtx.close();
      }catch(err){
        console.error('Could not decode', file.name, err);
        alert(`Couldn't decode "${file.name}" as a WAV file.`);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

export function drawClusterRowWave(canvas, entry){
  drawWaveformOverview(canvas, entry.audioBuffer);
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const dur = entry.audioBuffer.duration || 1;
  const cs = parseFloat(entry.cropStart);
  const ce = parseFloat(entry.cropEnd);
  ctx.fillStyle = 'rgba(194,59,46,0.16)';
  if (isFinite(cs) && cs > 0) ctx.fillRect(0, 0, Math.min(w, (cs/dur)*w), h);
  if (isFinite(ce) && ce > 0){
    const ceStart = Math.max(0, dur-ce);
    ctx.fillRect(Math.max(0,(ceStart/dur)*w), 0, w - Math.max(0,(ceStart/dur)*w), h);
  }
}

export function renderClusterRows(){
  const selectedCount = S.clusterLibrary.filter(e => e.included !== false).length;
  clusterFileCount.textContent = S.clusterLibrary.length
    ? `${S.clusterLibrary.length} loaded · ${selectedCount} selected`
    : '0 loaded';
  if (!S.clusterLibrary.length){
    clusterRows.innerHTML = '<div class="empty-note">No files yet.</div>';
    return;
  }
  clusterRows.innerHTML = '';
  S.clusterLibrary.forEach(entry => {
    if (entry.included === undefined) entry.included = true;
    const row = document.createElement('div');
    row.className = 'tap-row' + (entry.included ? '' : ' excluded');

    const head = document.createElement('div');
    head.className = 'tr-head';

    const includeWrap = document.createElement('label');
    includeWrap.className = 'tr-include';
    includeWrap.title = 'Include this recording in the clustering run';
    const includeInput = document.createElement('input');
    includeInput.type = 'checkbox';
    includeInput.checked = entry.included;
    includeInput.addEventListener('change', () => {
      entry.included = includeInput.checked;
      row.classList.toggle('excluded', !entry.included);
      clusterFileCount.textContent = `${S.clusterLibrary.length} loaded · ${S.clusterLibrary.filter(e => e.included !== false).length} selected`;
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
      S.clusterLibrary = S.clusterLibrary.filter(f => f.id !== entry.id);
      renderClusterRows();
    });
    head.appendChild(includeWrap);
    head.appendChild(nameEl);
    head.appendChild(removeBtn);

    const canvas = document.createElement('canvas');
    canvas.className = 'tr-wave';
    canvas.width = 1200; canvas.height = 70;

    const fields = document.createElement('div');
    fields.className = 'tr-fields';

    const csField = document.createElement('div');
    csField.className = 'tap-field';
    csField.innerHTML = '<label>Crop Start (s)</label>';
    const csInput = document.createElement('input');
    csInput.type = 'number'; csInput.min = '0'; csInput.step = '0.1'; csInput.placeholder = '0';
    csInput.value = entry.cropStart;
    csInput.addEventListener('change', () => { entry.cropStart = csInput.value; drawClusterRowWave(canvas, entry); syncEntryToFolder(entry, 'cropStart', 'cropEnd'); });
    csField.appendChild(csInput);

    const ceField = document.createElement('div');
    ceField.className = 'tap-field';
    ceField.innerHTML = '<label>Crop End (s)</label>';
    const ceInput = document.createElement('input');
    ceInput.type = 'number'; ceInput.min = '0'; ceInput.step = '0.1'; ceInput.placeholder = '0';
    ceInput.value = entry.cropEnd;
    ceInput.addEventListener('change', () => { entry.cropEnd = ceInput.value; drawClusterRowWave(canvas, entry); syncEntryToFolder(entry, 'cropStart', 'cropEnd'); });
    ceField.appendChild(ceInput);

    fields.appendChild(csField);
    fields.appendChild(ceField);

    row.appendChild(head);
    row.appendChild(canvas);
    row.appendChild(fields);
    clusterRows.appendChild(row);

    drawClusterRowWave(canvas, entry);
  });
}

// ---------------- Clustering: run pipeline ----------------
// Runs python/waveform_lab/clustering.py in the Python worker: detect taps per
// file -> FFT-feature each tap (fmax adjustable, default 1500 Hz; 64 bins)
// -> KMeans/silhouette picks k -> RF proximity clustering at that k ->
// adjusted Rand index vs. KMeans.
// Defaults match extract_window()'s pre_ms=5 and fft_features()/get_bin_edges()'s
// implicit fmax=1500 usage from when this pipeline was first built — both are
// now user-adjustable in Advanced settings, with a button to reset back to these.
export const CLUSTER_OFFSET_DEFAULT = 0.005, CLUSTER_FMAX_DEFAULT = 1500;

// Reads the Offset (s) / Fmax (Hz) advanced fields, falling back to the
// defaults above for blank/invalid input.
export function getClusterOffsetFmax(){
  const offsetSec = parseFloat(el('clusterOffset').value);
  const fmax = parseFloat(el('clusterFmax').value);
  return {
    // Negative offsets are valid: they start the FFT window that far
    // *after* the tap's onset instead of before it, cutting off the very
    // start of the tap (e.g. to skip a click/thump and analyse only the
    // settled resonance).
    offsetSec: isFinite(offsetSec) ? offsetSec : CLUSTER_OFFSET_DEFAULT,
    fmax: isFinite(fmax) && fmax > 0 ? fmax : CLUSTER_FMAX_DEFAULT,
  };
}

// Crop Start / Crop End as typed ('' = none) -> seconds >= 0.
function cropSeconds(val){
  const v = (val||'').trim();
  const sec = v !== '' ? Math.max(0, parseFloat(v)) : 0;
  return isFinite(sec) ? sec : 0;
}

export async function runClustering(){
  if (S.clusterRunning) return;
  if (!S.clusterLibrary.length){
    clusterStatus.textContent = 'Load at least one .wav file first.';
    clusterStatus.classList.add('err');
    return;
  }
  const activeEntries = S.clusterLibrary.filter(e => e.included !== false);
  if (!activeEntries.length){
    clusterStatus.textContent = 'Tick at least one recording to analyse.';
    clusterStatus.classList.add('err');
    return;
  }
  S.clusterRunning = true;
  runClusterBtn.disabled = true;
  clusterStatus.classList.remove('err');

  const windowMs = parseInt(el('clusterWindowMs').value, 10) || 120;
  const nEstimators = Math.max(10, parseInt(el('clusterNTrees').value, 10) || 500);
  const minGapMs = (parseFloat(el('clusterMinGap').value) || 0.15) * 1000;
  const forceKRaw = el('clusterForceK').value.trim();
  const forceK = forceKRaw !== '' ? Math.max(2, parseInt(forceKRaw, 10)) : null;
  const { offsetSec, fmax } = getClusterOffsetFmax();
  const offsetMs = offsetSec * 1000;

  const finish = (message, isError) => {
    S.clusterRunning = false;
    runClusterBtn.disabled = false;
    clusterStatus.textContent = message;
    clusterStatus.classList.toggle('err', !!isError);
  };

  try{
    await waitForPython((msg) => { clusterStatus.textContent = msg; });
  }catch(err){
    console.error('Python failed to load', err);
    finish(`Couldn't load the Python analysis engine (${err.message}). It needs an internet connection the first time.`, true);
    return;
  }

  clusterStatus.textContent = `Clustering taps in ${activeEntries.length} file(s) (${nEstimators} trees)…`;
  let result;
  try{
    const files = activeEntries.map(e => ({
      name: e.name, sr: e.audioBuffer.sampleRate,
      cropStart: cropSeconds(e.cropStart), cropEnd: cropSeconds(e.cropEnd),
    }));
    result = await callPython('run_clustering',
      { files, windowMs, nEstimators, forceK, minGapMs, offsetMs, fmax },
      activeEntries.map(e => toMono(e.audioBuffer)));
  }catch(err){
    console.error('Clustering failed', err);
    finish(`Clustering failed: ${err.message}`, true);
    return;
  }

  if (result.error){
    finish(result.error, true);
    return;
  }

  const { k, agreement, warnings } = result;
  finish(warnings.length
    ? `Done — ${result.nTaps} taps, k=${k}, agreement=${agreement.toFixed(3)}. Notes: ${warnings.join(' · ')}`
    : `Done — ${result.nTaps} taps across ${activeEntries.length} file(s), k=${k}, agreement (adjusted Rand vs. KMeans)=${agreement.toFixed(3)}.`);

  renderClusterResults({ meta: result.meta, rfLabels: result.rfLabels, importances: result.importances, edges: result.edges, k, agreement, fmax });
}

export function renderClusterResults(res){
  const { meta, rfLabels, importances, edges, k, agreement, fmax } = res;
  const fmaxLabel = fmax != null ? `${fmax} Hz` : 'your chosen Fmax';
  el('clusterFreqRangeLabel').textContent = `(RF-proximity clustering, FFT features up to ${fmaxLabel})`;

  // --- Table 1: RF-proximity cluster sizes ---
  const sizeCounts = {};
  rfLabels.forEach(c => { sizeCounts[c] = (sizeCounts[c]||0) + 1; });
  const sizeClusters = Object.keys(sizeCounts).map(Number).sort((a,b) => a-b);
  const sizeRows = sizeClusters.map(c => `
      <tr><td>Cluster ${c}</td><td>${sizeCounts[c]} taps</td></tr>`).join('');

  // --- Table 2: Per-file cluster breakdown (RF-proximity), as a file x
  // cluster matrix — one column per cluster, blank cells where the count
  // is 0, plus a Total column so the per-file tap count is still visible.
  const files = [...new Set(meta.map(m => m.file))].sort((a,b) => a.localeCompare(b, undefined, {numeric:true, sensitivity:'base'}));
  const matrixClusters = sizeClusters; // reuse the same sorted cluster-id list as Table 1
  const matrixHeaderCells = matrixClusters.map(c => `<th style="text-align:center;">${c}</th>`).join('') + `<th style="text-align:center;">Total</th>`;
  const fileRows = files.map(fname => {
    const idxs = meta.map((m,i) => m.file === fname ? i : -1).filter(i => i >= 0);
    const counts = {};
    idxs.forEach(i => { const c = rfLabels[i]; counts[c] = (counts[c]||0) + 1; });
    const cells = matrixClusters.map(c => `<td style="text-align:center;">${counts[c] || ''}</td>`).join('');
    return `<tr><td>${fname}</td>${cells}<td style="text-align:center;font-weight:600;">${idxs.length}</td></tr>`;
  }).join('');

  // --- Table 3: Top 10 frequency bins the Random Forest found most informative ---
  const topBins = importances.map((v,i) => ({i, v}))
    .sort((a,b) => b.v - a.v)
    .slice(0, 10);
  const binRows = topBins.map(({i,v}) => `
      <tr><td class="freq">Bin ${i}</td><td>${edges[i].toFixed(1)}–${edges[i+1].toFixed(1)} Hz</td><td>${v.toFixed(4)}</td></tr>`).join('');

  let agreementNote;
  if (agreement > 0.5) agreementNote = 'Two independent methods largely agree — reasonable confidence the groups are real.';
  else if (agreement > 0.2) agreementNote = 'Partial agreement — treat the grouping as a rough starting point, not a firm answer.';
  else agreementNote = 'Low agreement — these clusters are not stable; try more taps, a different window, or listen to samples from each cluster before trusting the grouping.';

  clusterResultsBody.innerHTML = `
      <div class="variance-block">
        <div class="vb-title">Chosen k = ${k} · Agreement vs. KMeans (adjusted Rand index) = ${agreement.toFixed(3)}</div>
        <div class="empty-note" style="margin-bottom:14px;">${agreementNote}</div>
      </div>
      <div class="variance-block">
        <div class="vb-title">RF-proximity cluster sizes</div>
        <table class="variance">
          <thead><tr><th>Cluster</th><th>Size</th></tr></thead>
          <tbody>${sizeRows || '<tr><td colspan="2" style="color:var(--text-faint);">No clusters.</td></tr>'}</tbody>
        </table>
      </div>
      <div class="variance-block">
        <div class="vb-title">Per-file cluster breakdown (RF-proximity)</div>
        <table class="variance">
          <thead><tr><th>File</th>${matrixHeaderCells}</tr></thead>
          <tbody>${fileRows || `<tr><td colspan="${matrixClusters.length+2}" style="color:var(--text-faint);">No files.</td></tr>`}</tbody>
        </table>
      </div>
      <div class="variance-block">
        <div class="vb-title">Top 10 frequency bins the Random Forest found most informative (fmax ${fmaxLabel})</div>
        <table class="variance">
          <thead><tr><th>Bin</th><th>Range</th><th>Importance</th></tr></thead>
          <tbody>${binRows || '<tr><td colspan="3" style="color:var(--text-faint);">No importances.</td></tr>'}</tbody>
        </table>
      </div>`;
}

// Event wiring, run once at startup (main.js calls each module's init()).
export function init(){
  fileInputCluster.addEventListener('change', (e) => addClusterFiles(e.target.files));
  ;['dragover','dragenter'].forEach(evtName => {
    dropzoneCluster.addEventListener(evtName, (e) => { e.preventDefault(); dropzoneCluster.classList.add('drag'); });
  });
  ;['dragleave','drop'].forEach(evtName => {
    dropzoneCluster.addEventListener(evtName, (e) => { e.preventDefault(); dropzoneCluster.classList.remove('drag'); });
  });
  dropzoneCluster.addEventListener('drop', (e) => {
    if (e.dataTransfer.files && e.dataTransfer.files.length) addClusterFiles(e.dataTransfer.files);
  });

  el('clusterResetOffsetFmax').addEventListener('click', () => {
    el('clusterOffset').value = CLUSTER_OFFSET_DEFAULT;
    el('clusterFmax').value = CLUSTER_FMAX_DEFAULT;
  });

  runClusterBtn.addEventListener('click', runClustering);
}
