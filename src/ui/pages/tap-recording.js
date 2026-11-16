// The Tap Analyser's recording editor: which file is selected, running tap
// detection in Python for each file, and feeding crop/tap edits back into
// the file's entry (and from there into the analysis and the File Folder).
//
// Per entry:
//   skipStart / skipEnd  crop as typed ('' = auto / none), shared with the row inputs
//   taps                 null = use detection, or hand-edited tap times (seconds)
//   detection            last run_tap_detection result {cropStart, cropStartAuto, cropEnd, taps} or {error}
import { S } from '../state.js';
import { toMono } from '../../core/mono.js';
import { snapToAttack } from '../../core/spectrum.js';
import { callPython } from '../../engines/python.js';
import { el } from '../dom.js';
import { syncEntryToFolder } from '../folder-store.js';
import { createTapEditor } from '../views/tap-editor.js';
import { renderTapRows } from './tap.js';

let editor = null;
const timers = new WeakMap();
const versions = new WeakMap();

const num = (v) => { const x = parseFloat(v); return isFinite(x) && x > 0 ? x : 0; };

export function selectedTapEntry(){
  return S.tapLibrary.find((e) => e.id === S.tapSelectedId) || null;
}

export function selectTapEntry(id){
  S.tapSelectedId = id;
  renderTapRows();
}

// The crop and taps the editor shows — and therefore what gets analysed.
export function tapView(entry){
  const det = entry.detection && !entry.detection.error ? entry.detection : null;
  const auto = (entry.skipStart || '').trim() === '';
  return {
    audioBuffer: entry.audioBuffer,
    cropStart: auto ? (det ? det.cropStart : 0) : num(entry.skipStart),
    cropStartAuto: auto,
    cropEnd: num(entry.skipEnd),
    taps: entry.taps || (det ? det.taps : []),
    edited: entry.taps != null,
    pending: !!entry._detecting || !entry.detection,
    error: entry.detection && entry.detection.error,
  };
}

// Extra payload for run_tap_analysis: the taps on screen, or nothing (Python
// then detects them itself) if detection hasn't finished yet.
export function tapsForAnalysis(entry){
  const v = tapView(entry);
  if (!entry.taps && !(entry.detection && entry.detection.taps)) return {};
  return { taps: v.taps, cropStart: v.cropStart, cropEnd: v.cropEnd };
}

function detectionOpts(){
  return {
    numEvents: parseInt(el('advNumEvents').value, 10) || 10,
    minGap: parseFloat(el('advMinGap').value) || 0.3,
  };
}

export function requestDetection(entry, delay = 150){
  clearTimeout(timers.get(entry));
  entry._detecting = true;
  timers.set(entry, setTimeout(async () => {
    const version = (versions.get(entry) || 0) + 1;
    versions.set(entry, version);
    let result;
    try{
      result = await callPython('run_tap_detection',
        { sr: entry.audioBuffer.sampleRate, skipStart: entry.skipStart || '', skipEnd: entry.skipEnd || '', opts: detectionOpts() },
        [toMono(entry.audioBuffer)]);
    }catch(err){
      result = { error: err.message };
    }
    if (versions.get(entry) !== version || !S.tapLibrary.includes(entry)) return; // superseded or removed
    entry.detection = result;
    entry._detecting = false;
    renderTapRows();
  }, delay));
}

function summary(entry){
  const v = tapView(entry);
  if (v.error) return `Detection failed: ${v.error}`;
  const start = v.cropStartAuto
    ? (entry.detection ? `auto → ${v.cropStart.toFixed(2)} s` : 'auto (detecting…)')
    : `${v.cropStart.toFixed(2)} s`;
  const dur = entry.audioBuffer.duration;
  const active = v.taps.filter((t) => t >= v.cropStart && t < dur - v.cropEnd).length;
  const parts = [`Crop start: ${start}`];
  if (v.cropEnd > 0) parts.push(`crop end: ${v.cropEnd.toFixed(2)} s`);
  parts.push(v.pending && !v.edited ? 'detecting taps…' : `${active} tap${active === 1 ? '' : 's'}${v.edited ? ' (edited)' : ''}`);
  return parts.join(' · ');
}

// Called by renderTapRows after every change: keeps the dropdown, summary
// and editor in sync with the selected entry.
export function refreshTapEditor(){
  if (!editor) return;
  if (!selectedTapEntry() && S.tapLibrary.length) S.tapSelectedId = S.tapLibrary[0].id;
  const entry = selectedTapEntry();

  const select = el('tapEditorSelect');
  select.innerHTML = '';
  S.tapLibrary.forEach((e) => {
    const opt = document.createElement('option');
    opt.value = e.id; opt.textContent = e.name;
    select.appendChild(opt);
  });
  select.disabled = !entry;
  if (entry) select.value = entry.id;

  el('tapEditorSummary').textContent = entry ? summary(entry) : 'Load a recording on the left.';
  el('tapEditorResetCrop').disabled = !entry || ((entry.skipStart || '') === '' && (entry.skipEnd || '') === '');
  el('tapEditorResetTaps').disabled = !entry || entry.taps == null;
  editor.show(entry ? tapView(entry) : null);
}

function changed(entry, redetect){
  syncEntryToFolder(entry, 'skipStart', 'skipEnd');
  if (redetect && entry.taps == null) requestDetection(entry);
  renderTapRows();
}

export function init(){
  editor = createTapEditor(el('tapEditorCanvas'), {
    onCropChange: ({ cropStart, cropEnd }) => {
      const entry = selectedTapEntry();
      if (!entry) return;
      if (cropStart !== undefined) entry.skipStart = String(cropStart);
      if (cropEnd !== undefined) entry.skipEnd = cropEnd > 0 ? String(cropEnd) : '';
      changed(entry, true);
    },
    onTapsChange: (taps) => {
      const entry = selectedTapEntry();
      if (!entry) return;
      entry.taps = taps;
      changed(entry, false);
    },
    snap: (t) => {
      const entry = selectedTapEntry();
      return entry ? snapToAttack(entry.audioBuffer, t) : t;
    },
  });

  el('tapEditorSelect').addEventListener('change', (e) => selectTapEntry(e.target.value));
  el('tapEditorResetCrop').addEventListener('click', () => {
    const entry = selectedTapEntry();
    if (!entry) return;
    entry.skipStart = ''; entry.skipEnd = '';
    changed(entry, true);
  });
  el('tapEditorResetTaps').addEventListener('click', () => {
    const entry = selectedTapEntry();
    if (!entry) return;
    entry.taps = null;
    requestDetection(entry, 0);
    changed(entry, false);
  });
  // Detection settings changed: re-detect every file that uses detected taps.
  ['advNumEvents', 'advMinGap'].forEach((id) => el(id).addEventListener('change', () => {
    S.tapLibrary.forEach((e) => { if (e.taps == null) requestDetection(e); });
    renderTapRows();
  }));
  refreshTapEditor();
}
