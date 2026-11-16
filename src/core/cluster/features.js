import { rfftMag } from '../fft.js';
import { findPeaksHeightDistance } from '../signal.js';

// Matches Python's int(sr*sec) truncation (not round) exactly.
export function trimSignalRF(signal, sr, skipStartSec, skipEndSec){
  const startIdx = Math.floor(sr * skipStartSec);
  let endIdx = signal.length - Math.floor(sr * skipEndSec);
  endIdx = Math.max(startIdx, endIdx);
  return signal.slice(startIdx, endIdx);
}

// moving-average energy envelope (mode="same" convolution of x^2 with a
// box filter), then find_peaks(height=rel*max, distance) -> onset sample
// indices, optionally thinned to the N loudest if expectedTaps is given.
export function detectTapsRF(signal, sr, opts){
  opts = opts || {};
  const minGapMs = opts.minGapMs != null ? opts.minGapMs : 150;
  const energyWinMs = opts.energyWinMs != null ? opts.energyWinMs : 10;
  const relThreshold = opts.relThreshold != null ? opts.relThreshold : 0.15;
  const expectedTaps = opts.expectedTaps != null ? opts.expectedTaps : null;

  const win = Math.max(1, Math.floor(sr * energyWinMs / 1000));
  const n = signal.length;
  const sq = new Float64Array(n);
  for (let i = 0; i < n; i++) sq[i] = signal[i]*signal[i];

  const energy = new Float64Array(n);
  // Matches numpy's convolve(..., mode="same") alignment exactly: for a
  // kernel of length `win`, output[k] sums signal[k+kStart .. k+kEnd] where
  // s0 = floor((win-1)/2), kStart = s0-win+1, kEnd = s0.
  const s0 = Math.floor((win-1)/2);
  const kStart = s0 - win + 1;
  const kEnd = s0;
  for (let i = 0; i < n; i++){
    let sum = 0;
    const lo = Math.max(0, i + kStart), hi = Math.min(n-1, i + kEnd);
    for (let j = lo; j <= hi; j++) sum += sq[j];
    energy[i] = sum / win;
  }

  const minDistance = Math.floor(sr * minGapMs / 1000);
  let maxE = -Infinity;
  for (let i = 0; i < n; i++) if (energy[i] > maxE) maxE = energy[i];
  const height = relThreshold * maxE;

  let peaks = findPeaksHeightDistance(energy, height, minDistance);

  if (expectedTaps != null && peaks.length > expectedTaps){
    const withE = peaks.map(p => ({ p, e: energy[p] }));
    withE.sort((a,b) => b.e - a.e);
    peaks = withE.slice(0, expectedTaps).map(o => o.p).sort((a,b) => a-b);
  }
  return peaks;
}

export function extractWindowRF(signal, sr, onsetIdx, windowMs, preMs){
  windowMs = windowMs != null ? windowMs : 500;
  preMs = preMs != null ? preMs : 5;
  const pre = Math.floor(sr * preMs / 1000);
  const length = Math.floor(sr * windowMs / 1000);
  const start = Math.max(0, onsetIdx - pre);
  const segment = new Float64Array(length);
  const n = signal.length;
  for (let i = 0; i < length; i++){
    const si = start + i;
    segment[i] = si < n ? signal[si] : 0;
  }
  return segment;
}

// Average FFT magnitude of quiet gaps between taps (plus the lead-in before
// the first tap, if there's room) -> a background-noise profile to subtract
// from each tap's own spectrum in fftFeaturesRF.
export function estimateNoiseSpectrumRF(signal, sr, onsets, windowMs, tailMarginMs){
  windowMs = windowMs != null ? windowMs : 120;
  tailMarginMs = tailMarginMs != null ? tailMarginMs : 300;
  const length = Math.floor(sr * windowMs / 1000);
  const margin = Math.floor(sr * tailMarginMs / 1000);
  const segments = [];

  if (onsets.length > 0 && onsets[0] - length > 0){
    segments.push(signal.slice(0, length));
  }
  for (let k = 0; k < onsets.length - 1; k++){
    const a = onsets[k], b = onsets[k+1];
    const start = a + margin, end = start + length;
    if (end < b) segments.push(signal.slice(start, end));
  }
  if (!segments.length) return null;

  const hann = new Float64Array(length);
  for (let i = 0; i < length; i++) hann[i] = 0.5 - 0.5*Math.cos(2*Math.PI*i/(length-1));

  let sumSpec = null;
  for (const seg of segments){
    const windowed = new Float64Array(length);
    for (let i = 0; i < length; i++) windowed[i] = seg[i] * hann[i];
    const mag = rfftMag(windowed);
    if (!sumSpec) sumSpec = new Float64Array(mag.length);
    for (let i = 0; i < mag.length; i++) sumSpec[i] += mag[i];
  }
  for (let i = 0; i < sumSpec.length; i++) sumSpec[i] /= segments.length;
  return sumSpec;
}

export function getBinEdgesRF(sr, nBins, fmin, fmax){
  nBins = nBins != null ? nBins : 64;
  fmin = fmin != null ? fmin : 20;
  fmax = fmax != null ? fmax : sr/2;
  const edges = new Float64Array(nBins + 1);
  const logMin = Math.log10(fmin), logMax = Math.log10(fmax);
  for (let i = 0; i <= nBins; i++){
    edges[i] = Math.pow(10, logMin + (logMax - logMin) * (i / nBins));
  }
  return edges;
}

export function fftFeaturesRF(segment, sr, opts){
  opts = opts || {};
  const nBins = opts.nBins != null ? opts.nBins : 64;
  const fmin = opts.fmin != null ? opts.fmin : 20;
  const fmax = opts.fmax != null ? opts.fmax : sr/2;
  const noiseSpectrum = opts.noiseSpectrum || null;

  const length = segment.length;
  const hann = new Float64Array(length);
  for (let i = 0; i < length; i++) hann[i] = 0.5 - 0.5*Math.cos(2*Math.PI*i/(length-1));
  const windowed = new Float64Array(length);
  for (let i = 0; i < length; i++) windowed[i] = segment[i] * hann[i];

  let spectrum = rfftMag(windowed);
  if (noiseSpectrum){
    spectrum = spectrum.map((v,i) => Math.max(0, v - (noiseSpectrum[i]||0)));
  }

  const freqs = new Float64Array(spectrum.length);
  for (let k = 0; k < spectrum.length; k++) freqs[k] = k * sr / length;

  const edges = getBinEdgesRF(sr, nBins, fmin, fmax);
  const features = new Float64Array(nBins);
  for (let i = 0; i < nBins; i++){
    let sum = 0, count = 0;
    for (let k = 0; k < freqs.length; k++){
      if (freqs[k] >= edges[i] && freqs[k] < edges[i+1]){ sum += spectrum[k]; count++; }
    }
    features[i] = count > 0 ? sum / count : 0;
  }
  for (let i = 0; i < nBins; i++) features[i] = Math.log1p(features[i]);
  return features;
}
