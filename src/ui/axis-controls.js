import { S } from './state.js';
import { fftCanvas } from './dom.js';
import { drawCompareGraph, drawPreviewSpectrum, resetPreview } from './pages/compare.js';
import { drawFrozenSpectrum, drawGrid } from './views/spectrum.js';

// ---------------- Axis controls (scale + range) ----------------
export function smoothingLabelText(){
  if (S.OCTAVE_FRACTION <= 0) return 'unsmoothed';
  const n = Math.round(1/S.OCTAVE_FRACTION);
  return `1/${n}-oct smoothed`;
}

export function updateFreqRangeLabels(){
  const smoothTxt = smoothingLabelText();
  document.querySelectorAll('.freq-range-label').forEach(el => {
    const suffix = el.dataset.suffix || '';
    const scaleTxt = S.freqScaleMode === 'log' ? ', log' : '';
    const minTxt = S.FREQ_MIN >= 1000 ? (S.FREQ_MIN/1000).toFixed(1).replace(/\.0$/,'') + 'k' : Math.round(S.FREQ_MIN);
    const maxTxt = S.FREQ_MAX >= 1000 ? (S.FREQ_MAX/1000).toFixed(1).replace(/\.0$/,'') + 'k' : Math.round(S.FREQ_MAX);
    const parts = [`${minTxt}–${maxTxt} Hz${scaleTxt}`];
    if (suffix) parts.push(suffix);
    parts.push(smoothTxt);
    el.textContent = `(${parts.join(', ')})`;
  });
}

export function redrawAllGraphs(){
  if (S.lastCapture){
    drawFrozenSpectrum(S.lastCapture);
  } else {
    const ctx = fftCanvas.getContext('2d');
    ctx.clearRect(0,0,fftCanvas.width, fftCanvas.height);
    drawGrid(ctx, fftCanvas.width, fftCanvas.height);
  }
  if (S.lastPreviewCapture) drawPreviewSpectrum(S.lastPreviewCapture);
  else resetPreview();
  drawCompareGraph();
}

export function setScaleMode(mode){
  S.freqScaleMode = mode;
  document.querySelectorAll('.scale-btn').forEach(b => b.classList.toggle('active', b.dataset.scale === mode));
  updateFreqRangeLabels();
  redrawAllGraphs();
}

export function setFreqRange(min, max){
  if (!(min > 0) || !(max > min)) return;
  S.FREQ_MIN = min;
  S.FREQ_MAX = max;
  document.querySelectorAll('.freq-min-input').forEach(i => i.value = min);
  document.querySelectorAll('.freq-max-input').forEach(i => i.value = max);
  updateFreqRangeLabels();
  redrawAllGraphs();
}

export function setSmoothing(val){
  S.OCTAVE_FRACTION = (val === 'off') ? 0 : 1/parseInt(val, 10);
  document.querySelectorAll('.smoothing-select').forEach(s => s.value = val);
  updateFreqRangeLabels();
  redrawAllGraphs();
}

// Event wiring, run once at startup (main.js calls each module's init()).
export function init(){
  document.querySelectorAll('.axis-bar').forEach(bar => {
    const minInput = bar.querySelector('.freq-min-input');
    const maxInput = bar.querySelector('.freq-max-input');
    function applyRange(){
      let min = parseFloat(minInput.value);
      let max = parseFloat(maxInput.value);
      if (!isFinite(min) || min < 1) min = 1;
      if (!isFinite(max) || max <= min) max = min + 1;
      setFreqRange(min, max);
    }
    if (minInput && maxInput){
      minInput.addEventListener('change', applyRange);
      maxInput.addEventListener('change', applyRange);
      minInput.addEventListener('keydown', e => { if (e.key === 'Enter') applyRange(); });
      maxInput.addEventListener('keydown', e => { if (e.key === 'Enter') applyRange(); });
    }
    bar.querySelectorAll('.scale-btn').forEach(btn => {
      btn.addEventListener('click', () => setScaleMode(btn.dataset.scale));
    });
    const smoothingSelect = bar.querySelector('.smoothing-select');
    if (smoothingSelect){
      smoothingSelect.addEventListener('change', () => setSmoothing(smoothingSelect.value));
    }
  });
}
