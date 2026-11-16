import { S } from '../state.js';
import { autoDbRange, octaveAverage } from '../../core/spectrum.js';
import { fftCanvas, screenBadge, screenStamp } from '../dom.js';
import { fmtHz } from '../format.js';

// Canvas x-position (0..w) for a given frequency, honouring the current scale mode.
export function freqToX(freq, w){
  const f = Math.max(S.FREQ_MIN, Math.min(S.FREQ_MAX, freq));
  if (S.freqScaleMode === 'log'){
    const lo = Math.log10(Math.max(1, S.FREQ_MIN));
    const hi = Math.log10(Math.max(lo + 0.0001, S.FREQ_MAX));
    return ((Math.log10(Math.max(1, f)) - lo) / (hi - lo)) * w;
  }
  return ((f - S.FREQ_MIN) / (S.FREQ_MAX - S.FREQ_MIN)) * w;
}

// Frequency for a given canvas x-position (0..w), honouring the current scale mode.
export function xToFreq(x, w){
  const frac = Math.min(1, Math.max(0, x / w));
  if (S.freqScaleMode === 'log'){
    const lo = Math.log10(Math.max(1, S.FREQ_MIN));
    const hi = Math.log10(Math.max(lo + 0.0001, S.FREQ_MAX));
    return Math.pow(10, lo + frac*(hi - lo));
  }
  return S.FREQ_MIN + frac*(S.FREQ_MAX - S.FREQ_MIN);
}

// Tick frequencies for the x-axis: evenly spaced for linear, 1-2-5 per
// decade for log (the conventional way to label a log frequency axis).
export function computeFreqTicks(){
  const ticks = [];
  if (S.freqScaleMode === 'log'){
    const lo = Math.max(1, S.FREQ_MIN), hi = S.FREQ_MAX;
    let mag = Math.pow(10, Math.floor(Math.log10(lo)));
    let guard = 0;
    while (mag <= hi && guard < 20){
      [1,2,5].forEach(m => {
        const v = mag*m;
        if (v >= lo && v <= hi) ticks.push(Math.round(v*100)/100);
      });
      mag *= 10;
      guard++;
    }
    if (ticks.length < 2) return [S.FREQ_MIN, S.FREQ_MAX];
    return ticks;
  }
  const n = 6;
  for (let i = 0; i <= n; i++){
    ticks.push(Math.round(S.FREQ_MIN + (i/n)*(S.FREQ_MAX - S.FREQ_MIN)));
  }
  return ticks;
}

// Smoothed dBFS level at an arbitrary frequency, for the draggable cursor
// and for per-pixel curve rendering (works for both linear and log axes).
export function getSmoothedDbAtFreq(capture, freq){
  const binHz = capture.sampleRate / capture.N;
  const idx = Math.max(0, Math.min(capture.mags.length - 1, Math.round(freq / binHz)));
  const avgMag = octaveAverage(capture.mags, binHz, idx, S.OCTAVE_FRACTION);
  return 20*Math.log10(avgMag + 1e-12);
}

export function drawGrid(ctx, w, h){
  ctx.strokeStyle = '#e2e2dc';
  ctx.lineWidth = 1;
  computeFreqTicks().forEach(f => {
    const x = freqToX(f, w);
    ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke();
    ctx.fillStyle = '#6b6b64';
    ctx.font = '14px "JetBrains Mono", monospace';
    const label = (f >= 1000 ? (f/1000).toFixed(f % 1000 === 0 ? 0 : 1) + 'k' : f) + ' Hz';
    const lx = Math.min(w - ctx.measureText(label).width - 4, Math.max(4, x + 5));
    ctx.fillText(label, lx, h - 8);
  });
  for (let i = 1; i < 6; i++){
    const y = (h/6)*i;
    ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke();
  }
}

export function liveDraw(){
  if (!S.isPlaying) return;
  const ctx = fftCanvas.getContext('2d');
  const w = fftCanvas.width, h = fftCanvas.height;
  const data = new Float32Array(S.analyser.frequencyBinCount);
  S.analyser.getFloatFrequencyData(data);

  ctx.clearRect(0,0,w,h);
  drawGrid(ctx, w, h);

  const sr = S.audioCtx.sampleRate;
  const fftSize = S.analyser.fftSize;
  const binHz = sr / fftSize;
  const minDb = S.analyser.minDecibels, maxDb = S.analyser.maxDecibels;

  ctx.beginPath();
  ctx.strokeStyle = '#0f8a4c';
  ctx.lineWidth = 2;
  ctx.shadowColor = 'rgba(15,138,76,0.35)';
  ctx.shadowBlur = 5;
  for (let x = 0; x < w; x++){
    const freq = xToFreq(x, w);
    const idx = Math.max(0, Math.min(data.length - 1, Math.round(freq/binHz)));
    const db = octaveAverage(data, binHz, idx, S.OCTAVE_FRACTION);
    const norm = Math.max(0, Math.min(1, (db - minDb)/(maxDb - minDb)));
    const y = h - norm*h;
    if (x === 0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;

  S.rafId = requestAnimationFrame(liveDraw);
}

export function drawFrozenSpectrum(capture){
  const ctx = fftCanvas.getContext('2d');
  const w = fftCanvas.width, h = fftCanvas.height;
  ctx.clearRect(0,0,w,h);
  drawGrid(ctx, w, h);

  const { normOffset } = capture;
  const curveVals = new Array(w);
  for (let x = 0; x < w; x++) curveVals[x] = getSmoothedDbAtFreq(capture, xToFreq(x, w));
  const { dbMin, dbMax } = autoDbRange(curveVals);

  // Left-side axis: relative dB (peak = 100 dB), derived from the same
  // dBFS gridlines drawGrid() already lays down horizontally.
  ctx.fillStyle = '#6b6b64';
  ctx.font = '13px "JetBrains Mono", monospace';
  for (let i = 0; i <= 6; i++){
    const dbfsAtLine = dbMax - (i/6)*(dbMax - dbMin);
    const relAtLine = dbfsAtLine + normOffset;
    const y = (h/6)*i;
    ctx.fillText(relAtLine.toFixed(0) + ' dB', 6, Math.max(13, y - 3));
  }

  ctx.beginPath();
  ctx.strokeStyle = '#b5690a';
  ctx.lineWidth = 2;
  ctx.shadowColor = 'rgba(181,105,10,0.3)';
  ctx.shadowBlur = 5;
  for (let x = 0; x < w; x++){
    const db = Math.max(dbMin, Math.min(dbMax, curveVals[x]));
    const norm = (db - dbMin)/(dbMax - dbMin);
    const y = h - norm*h;
    if (x === 0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;

  // mark strongest peak within the displayed frequency range
  const peaksInRange = capture.peaks.filter(p => p.freq >= S.FREQ_MIN && p.freq <= S.FREQ_MAX);
  if (peaksInRange.length){
    const top = peaksInRange[0];
    const x = freqToX(top.freq, w);
    ctx.strokeStyle = 'rgba(181,105,10,0.45)';
    ctx.setLineDash([3,3]);
    ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#b5690a';
    ctx.font = '15px "JetBrains Mono", monospace';
    const lx = Math.min(w-150, x+8);
    ctx.fillText(fmtHz(top.freq), lx, 18);
    ctx.font = '13px "JetBrains Mono", monospace';
    ctx.fillText(`${(top.db+normOffset).toFixed(1)} dB rel  /  ${top.db.toFixed(1)} dBFS`, lx, 33);
  }

  // draggable readout cursor (independent of the peak marker)
  if (S.cursorFreq != null && S.cursorFreq >= S.FREQ_MIN && S.cursorFreq <= S.FREQ_MAX){
    const cx = freqToX(S.cursorFreq, w);
    const dbfs = getSmoothedDbAtFreq(capture, S.cursorFreq);
    const clamped = Math.max(dbMin, Math.min(dbMax, dbfs));
    const cy = h - ((clamped - dbMin)/(dbMax - dbMin)) * h;

    ctx.strokeStyle = '#2f6fb0';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4,4]);
    ctx.beginPath(); ctx.moveTo(cx,0); ctx.lineTo(cx,h); ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#2f6fb0';
    ctx.beginPath(); ctx.arc(cx, cy, 4.5, 0, Math.PI*2); ctx.fill();

    const relDb = dbfs + normOffset;
    const labelY = h - 50;
    const clx = Math.min(w-155, Math.max(4, cx+8));
    ctx.font = '15px "JetBrains Mono", monospace';
    ctx.fillText(fmtHz(S.cursorFreq), clx, labelY);
    ctx.font = '13px "JetBrains Mono", monospace';
    ctx.fillText(`${relDb.toFixed(1)} dB rel  /  ${dbfs.toFixed(1)} dBFS`, clx, labelY+15);
  }
}

export function resetScreen(mode){
  screenBadge.className = 'screen-badge' + (mode === 'live' ? ' live' : mode === 'frozen' ? ' frozen' : '');
  screenBadge.textContent = mode === 'live' ? 'live' : mode === 'frozen' ? 'captured' : 'idle';
  if (mode === 'idle'){
    const ctx = fftCanvas.getContext('2d');
    ctx.clearRect(0,0,fftCanvas.width, fftCanvas.height);
    drawGrid(ctx, fftCanvas.width, fftCanvas.height);
    screenStamp.textContent = '';
  }
}
