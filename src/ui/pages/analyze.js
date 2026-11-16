import { S } from '../state.js';
import { computeSpectrumAt, findLoudestPeakForward } from '../../core/spectrum.js';
import { parseWavHeader } from '../../core/wav.js';
import { curTimeEl, dropzone, durTimeEl, exportBtn, fftCanvas, fileCount, fileInput, fileList, nowPlayingLabel, playBtn, sampleBtn, sampleOffsetInput, screenStamp, scrub, sheetBody, sheetSub, stopBtn, waveCanvas } from '../dom.js';
import { fmtBytes, fmtHz, fmtTime, sortByName, uid } from '../format.js';
import { renderCompareRows } from './compare.js';
import { drawFrozenSpectrum, liveDraw, resetScreen, xToFreq } from '../views/spectrum.js';
import { drawWaveformOverview } from '../views/waveform.js';
let audioEl = null;
let sourceNode = null;
let draggingCursor = false;
let waveDragging = false;
let captureScheduled = false;
let pendingCaptureEntry = null;
let pendingCaptureTime = null;

// ---------------- Library management ----------------
export function addFiles(fileArr){
  [...fileArr].forEach(file => {
    if (!/\.wav$/i.test(file.name) && file.type !== 'audio/wav' && file.type !== 'audio/x-wav') return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      const arrayBuffer = e.target.result;
      const wavInfo = parseWavHeader(arrayBuffer.slice(0));
      try{
        const tmpCtx = new (window.AudioContext||window.webkitAudioContext)();
        const audioBuffer = await tmpCtx.decodeAudioData(arrayBuffer.slice(0));
        const blob = new Blob([arrayBuffer], {type:'audio/wav'});
        const url = URL.createObjectURL(blob);
        const entry = {
          id: uid(), name: file.name, size: file.size,
          url, audioBuffer, wavInfo
        };
        S.library.push(entry);
        sortByName(S.library);
        renderFileList();
        renderCompareRows();
        if (S.activeId === null) selectFile(entry.id);
        tmpCtx.close();
      }catch(err){
        console.error('Could not decode', file.name, err);
        alert(`Couldn't decode "${file.name}" as a WAV file.`);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

export function renderFileList(){
  fileCount.textContent = `${S.library.length} loaded`;
  if (S.library.length === 0){
    fileList.innerHTML = '<div class="empty-note">No files yet. Drop or select .wav files above, or load some from your local folder — files picked from your computer here are session-only.</div>';
    return;
  }
  fileList.innerHTML = '';
  S.library.forEach(entry => {
    const div = document.createElement('div');
    div.className = 'file-item' + (entry.id === S.activeId ? ' active' : '');
    const dur = entry.audioBuffer ? fmtTime(entry.audioBuffer.duration) : '--';

    const row = document.createElement('div');
    row.className = 'fi-row';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'fname';
    nameSpan.textContent = entry.name;
    const removeBtn = document.createElement('button');
    removeBtn.className = 'fi-remove';
    removeBtn.innerHTML = '&times;';
    removeBtn.title = 'Remove this file';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFile(entry.id);
    });
    row.appendChild(nameSpan);
    row.appendChild(removeBtn);

    const metaSpan = document.createElement('span');
    metaSpan.className = 'fmeta';
    metaSpan.textContent = `${dur} · ${fmtBytes(entry.size)}`;

    div.appendChild(row);
    div.appendChild(metaSpan);
    div.addEventListener('click', () => selectFile(entry.id));
    fileList.appendChild(div);
  });
}

export function removeFile(id){
  const idx = S.library.findIndex(f => f.id === id);
  if (idx === -1) return;
  const entry = S.library[idx];
  const wasActive = S.activeId === entry.id;
  S.library.splice(idx, 1);
  if (entry.url) URL.revokeObjectURL(entry.url);

  if (wasActive){
    stopPlaybackInternal();
    if (audioEl){ audioEl.pause(); audioEl.src = ''; audioEl = null; }
    S.activeId = null;
    if (S.library.length){
      selectFile(S.library[0].id);
    } else {
      nowPlayingLabel.textContent = 'No file selected';
      curTimeEl.textContent = '0:00.000';
      durTimeEl.textContent = '0:00.000';
      scrub.value = 0;
      scrub.disabled = true;
      playBtn.disabled = true;
      stopBtn.disabled = true;
      sampleBtn.disabled = true;
      resetSheet();
      resetScreen('idle');
    }
  }
  renderFileList();
  renderCompareRows();
}

// ---------------- Selection & playback wiring ----------------
export function selectFile(id){
  stopPlaybackInternal();
  S.activeId = id;
  S.cursorFreq = null;
  const entry = S.library.find(f => f.id === id);
  renderFileList();
  if (!entry) return;

  nowPlayingLabel.textContent = entry.name;
  if (audioEl){
    audioEl.pause();
    audioEl.src = '';
  }
  audioEl = new Audio(entry.url);
  audioEl.preload = 'auto';

  audioEl.addEventListener('loadedmetadata', () => {
    durTimeEl.textContent = fmtTime(entry.audioBuffer.duration);
    scrub.disabled = false;
    playBtn.disabled = false;
    stopBtn.disabled = false;
    sampleBtn.disabled = false;
    drawWaveformOverview(waveCanvas, entry.audioBuffer);
  });
  audioEl.addEventListener('timeupdate', () => {
    if (!S.isPlaying) return;
    curTimeEl.textContent = fmtTime(audioEl.currentTime);
    const dur = entry.audioBuffer.duration || 1;
    scrub.value = Math.round((audioEl.currentTime/dur)*1000);
    drawWaveformOverview(waveCanvas, entry.audioBuffer, audioEl.currentTime/dur);
  });
  audioEl.addEventListener('ended', () => {
    captureSpectrum(entry, audioEl.duration);
    resetTransportUI();
  });

  resetSheet();
  resetScreen('idle');
  curTimeEl.textContent = '0:00.000';
  durTimeEl.textContent = '0:00.000';
  scrub.value = 0;
}

export function ensureAudioGraph(entry){
  if (!S.audioCtx) S.audioCtx = new (window.AudioContext||window.webkitAudioContext)();
  if (S.audioCtx.state === 'suspended') S.audioCtx.resume();
  if (sourceNode) { try{ sourceNode.disconnect(); }catch(e){} sourceNode = null; }
  sourceNode = S.audioCtx.createMediaElementSource(audioEl);
  S.analyser = S.audioCtx.createAnalyser();
  S.analyser.fftSize = 32768;
  S.analyser.smoothingTimeConstant = 0.55;
  sourceNode.connect(S.analyser);
  S.analyser.connect(S.audioCtx.destination);
}

export function scheduleCaptureAt(entry, t){
  pendingCaptureEntry = entry;
  pendingCaptureTime = t;
  if (captureScheduled) return;
  captureScheduled = true;
  requestAnimationFrame(() => {
    captureScheduled = false;
    if (pendingCaptureEntry) captureSpectrum(pendingCaptureEntry, pendingCaptureTime);
  });
}

export function seekFromWaveEvent(clientX){
  const entry = S.library.find(f => f.id === S.activeId);
  if (!entry || !audioEl) return;
  const rect = waveCanvas.getBoundingClientRect();
  const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  const dur = entry.audioBuffer.duration || 1;
  const t = frac*dur;
  audioEl.currentTime = t;
  curTimeEl.textContent = fmtTime(t);
  scrub.value = Math.round(frac*1000);
  drawWaveformOverview(waveCanvas, entry.audioBuffer, frac);
  if (!S.isPlaying) scheduleCaptureAt(entry, t);
}

// Draggable frequency/dB readout cursor on the captured spectrum graph
export function updateCursorFromEvent(clientX){
  const rect = fftCanvas.getBoundingClientRect();
  const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  S.cursorFreq = xToFreq(frac, 1);
  if (S.lastCapture) drawFrozenSpectrum(S.lastCapture);
}

export function stopPlaybackInternal(){
  if (audioEl){ audioEl.pause(); }
  S.isPlaying = false;
  cancelAnimationFrame(S.rafId);
  playBtn.innerHTML = '&#9658;';
}

export function resetTransportUI(){
  S.isPlaying = false;
  playBtn.innerHTML = '&#9658;';
  curTimeEl.textContent = '0:00.000';
  scrub.value = 0;
  const entry = S.library.find(f => f.id === S.activeId);
  if (entry) drawWaveformOverview(waveCanvas, entry.audioBuffer, 0);
}

export function hideSheetPlaceholderDuringPlay(){
  // leave prior sheet visible until a new capture happens
}

// ---------------- Capture + data sheet ----------------
export const PEAK_TARGET_DB = 100;

export function captureSpectrum(entry, time){
  const capture = computeSpectrumAt(entry.audioBuffer, time, 4096, 65536);
  // Normalise so the strongest peak reads as 100 dB (relative scale),
  // everything else scaled down by the same fixed offset.
  capture.normOffset = capture.peaks.length ? (PEAK_TARGET_DB - capture.peaks[0].db) : 0;
  S.lastCapture = capture;
  resetScreen('frozen');
  drawFrozenSpectrum(capture);
  screenStamp.textContent = `CAPTURED @ ${fmtTime(time)}`;
  renderSheet(entry, capture);
}

export function resetSheet(){
  sheetSub.textContent = '';
  sheetBody.innerHTML = '<div class="placeholder">Press play, then press stop at any moment — a spectrum snapshot and data sheet will be captured at that exact point in the recording.</div>';
  exportBtn.disabled = true;
}

export function renderSheet(entry, capture){
  sheetSub.textContent = `— ${entry.name} @ ${fmtTime(capture.time)}`;
  const top = capture.peaks[0];
  const info = entry.wavInfo;
  const off = capture.normOffset;

  const statsHtml = `
      <div class="stat-grid">
        <div class="stat"><div class="k">Peak Frequency</div><div class="v accent">${top ? fmtHz(top.freq) : '—'}</div></div>
        <div class="stat"><div class="k">Peak Level (rel)</div><div class="v accent">${top ? (top.db+off).toFixed(1)+' dB' : '—'}</div></div>
        <div class="stat"><div class="k">Peak Level (dBFS)</div><div class="v">${top ? top.db.toFixed(1)+' dB' : '—'}</div></div>
        <div class="stat"><div class="k">Window RMS</div><div class="v">${capture.rms.toFixed(4)}</div></div>
        <div class="stat"><div class="k">Analysis Window</div><div class="v">${capture.M} smp</div></div>
        <div class="stat"><div class="k">FFT Size (padded)</div><div class="v">${capture.N}</div></div>
        <div class="stat"><div class="k">Sample Rate</div><div class="v">${capture.sampleRate.toLocaleString()} Hz</div></div>
        <div class="stat"><div class="k">Channels</div><div class="v">${info ? info.numChannels : entry.audioBuffer.numberOfChannels}</div></div>
        <div class="stat"><div class="k">Bit Depth</div><div class="v">${info ? info.bitsPerSample+'-bit' : '—'}</div></div>
        <div class="stat"><div class="k">Duration</div><div class="v">${fmtTime(entry.audioBuffer.duration)}</div></div>
      </div>
      <div class="placeholder" style="text-align:left;padding:0 2px 18px;">
        "Rel" is a normalised scale where the strongest peak in this capture is set to 100 dB and everything else is scaled down by the same fixed amount — it is not calibrated acoustic SPL. "dBFS" is the raw, uncalibrated digital level (0 dB = loudest a sample can be; negative is normal).
      </div>
    `;

  const rows = capture.peaks.length ? capture.peaks.map((p,i) => `
      <tr>
        <td class="rank">${i+1}</td>
        <td class="freq">${fmtHz(p.freq)}</td>
        <td>${(p.db+off).toFixed(1)} dB</td>
        <td>${p.db.toFixed(1)} dBFS</td>
        <td>${p.mag.toExponential(2)}</td>
      </tr>`).join('') : `<tr><td colspan="5" style="color:var(--text-faint);">No distinct peaks above the noise floor at this instant.</td></tr>`;

  const tableHtml = `
      <table class="peaks">
        <thead><tr><th>#</th><th>Frequency</th><th>Level (rel)</th><th>Level (dBFS)</th><th>Magnitude</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;

  sheetBody.innerHTML = statsHtml + tableHtml;
  exportBtn.disabled = false;
}

// Wiring that ran at load time in the original script.js; main.js calls
// each module's init() in the original order.
export function init(){
  playBtn.addEventListener('click', () => {
    const entry = S.library.find(f => f.id === S.activeId);
    if (!entry) return;
    if (S.isPlaying){
      audioEl.pause();
      S.isPlaying = false;
      playBtn.innerHTML = '&#9658;';
      cancelAnimationFrame(S.rafId);
      captureSpectrum(entry, audioEl.currentTime);
    } else {
      if (!sourceNode) ensureAudioGraph(entry);
      audioEl.play();
      S.isPlaying = true;
      playBtn.innerHTML = '&#10073;&#10073;';
      resetScreen('live');
      hideSheetPlaceholderDuringPlay();
      liveDraw();
    }
  });

  stopBtn.addEventListener('click', () => {
    const entry = S.library.find(f => f.id === S.activeId);
    if (!entry || !audioEl) return;
    const stopTime = audioEl.currentTime;
    audioEl.pause();
    cancelAnimationFrame(S.rafId);
    captureSpectrum(entry, stopTime);
    audioEl.currentTime = 0;
    resetTransportUI();
  });

  sampleBtn.addEventListener('click', () => {
    const entry = S.library.find(f => f.id === S.activeId);
    if (!entry || !audioEl) return;
    if (S.isPlaying){
      audioEl.pause();
      S.isPlaying = false;
      playBtn.innerHTML = '&#9658;';
      cancelAnimationFrame(S.rafId);
    }
    const dur = entry.audioBuffer.duration || 1;
    const offsetT = Math.max(0, parseFloat(sampleOffsetInput.value) || 0);
    const peakTime = findLoudestPeakForward(entry.audioBuffer, audioEl.currentTime, 0.5);
    const sampleTime = Math.min(dur, peakTime + offsetT);
    audioEl.currentTime = sampleTime;
    curTimeEl.textContent = fmtTime(sampleTime);
    scrub.value = Math.round((sampleTime/dur)*1000);
    drawWaveformOverview(waveCanvas, entry.audioBuffer, sampleTime/dur);
    captureSpectrum(entry, sampleTime);
  });

  scrub.addEventListener('input', () => {
    const entry = S.library.find(f => f.id === S.activeId);
    if (!entry || !audioEl) return;
    const dur = entry.audioBuffer.duration || 1;
    const t = (scrub.value/1000)*dur;
    audioEl.currentTime = t;
    curTimeEl.textContent = fmtTime(t);
    drawWaveformOverview(waveCanvas, entry.audioBuffer, t/dur);
    if (!S.isPlaying) scheduleCaptureAt(entry, t);
  });

  waveCanvas.addEventListener('pointerdown', (evt) => {
    if (!audioEl) return;
    waveDragging = true;
    seekFromWaveEvent(evt.clientX);
  });
  window.addEventListener('pointermove', (evt) => {
    if (!waveDragging) return;
    seekFromWaveEvent(evt.clientX);
  });
  window.addEventListener('pointerup', () => { waveDragging = false; });
  fftCanvas.addEventListener('pointerdown', (evt) => {
    if (!S.lastCapture || S.isPlaying) return;
    draggingCursor = true;
    updateCursorFromEvent(evt.clientX);
  });
  window.addEventListener('pointermove', (evt) => {
    if (!draggingCursor) return;
    updateCursorFromEvent(evt.clientX);
  });
  window.addEventListener('pointerup', () => { draggingCursor = false; });

  exportBtn.addEventListener('click', () => {
    if (!S.lastCapture) return;
    const entry = S.library.find(f => f.id === S.activeId);
    const capture = S.lastCapture;
    const off = capture.normOffset;
    let csv = 'Waveform Lab — Spectrum Data Sheet\n';
    csv += `File,${entry ? entry.name : ''}\n`;
    csv += `Capture Time (s),${capture.time.toFixed(6)}\n`;
    csv += `Sample Rate (Hz),${capture.sampleRate}\n`;
    csv += `Analysis Window (samples),${capture.M}\n`;
    csv += `FFT Size (zero-padded),${capture.N}\n`;
    csv += `Window RMS,${capture.rms.toFixed(6)}\n`;
    csv += `Normalisation,Peak set to ${PEAK_TARGET_DB} dB (rel), offset ${off.toFixed(2)} dB applied to dBFS\n\n`;
    csv += 'Top Peaks\nRank,Frequency (Hz),Level (rel dB),Level (dBFS),Magnitude\n';
    capture.peaks.forEach((p,i) => {
      csv += `${i+1},${p.freq.toFixed(2)},${(p.db+off).toFixed(2)},${p.db.toFixed(2)},${p.mag.toExponential(4)}\n`;
    });
    csv += '\nFull Spectrum\nFrequency (Hz),Level (rel dB),Level (dBFS),Magnitude\n';
    for (let k = 0; k < capture.freqs.length; k++){
      csv += `${capture.freqs[k].toFixed(2)},${(capture.dbs[k]+off).toFixed(2)},${capture.dbs[k].toFixed(2)},${capture.mags[k].toExponential(4)}\n`;
    }
    const blob = new Blob([csv], {type:'text/csv'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const base = entry ? entry.name.replace(/\.wav$/i,'') : 'capture';
    a.download = `${base}_spectrum_${capture.time.toFixed(2)}s.csv`;
    a.click();
  });

  // ---------------- File input wiring ----------------
  fileInput.addEventListener('change', (e) => addFiles(e.target.files));
  ;['dragover','dragenter'].forEach(evtName => {
    dropzone.addEventListener(evtName, (e) => { e.preventDefault(); dropzone.classList.add('drag'); });
  });
  ;['dragleave','drop'].forEach(evtName => {
    dropzone.addEventListener(evtName, (e) => { e.preventDefault(); dropzone.classList.remove('drag'); });
  });
  dropzone.addEventListener('drop', (e) => {
    if (e.dataTransfer.files && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  });
}
