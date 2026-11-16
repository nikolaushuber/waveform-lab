import { bluesteinDFT } from './fft.js';

// scipy.signal.find_peaks(x, height, distance) equivalent: local maxima
// (plateaus resolved to their midpoint, matching scipy's convention), then
// filtered by minimum height, then thinned so no two survivors are closer
// than `distance` samples — processed in descending-height priority order,
// exactly matching scipy's `_select_by_peak_distance`.
export function findPeaksHeightDistance(x, height, distance){
  const n = x.length;
  const rawPeaks = [];
  let i = 1;
  while (i < n - 1){
    if (x[i-1] < x[i]){
      let iAhead = i + 1;
      while (iAhead < n - 1 && x[iAhead] === x[i]) iAhead++;
      if (x[iAhead] < x[i]){
        const leftEdge = i, rightEdge = iAhead - 1;
        rawPeaks.push(Math.floor((leftEdge + rightEdge) / 2));
        i = iAhead;
        continue;
      }
    }
    i++;
  }
  let peaks = height == null ? rawPeaks : rawPeaks.filter(p => x[p] >= height);
  if (distance != null && distance >= 1 && peaks.length > 1){
    const order = peaks.slice().sort((a,b) => x[b] - x[a]);
    const keep = new Set(peaks);
    for (const p of order){
      if (!keep.has(p)) continue;
      for (const q of peaks){
        if (q !== p && keep.has(q) && Math.abs(q - p) < distance) keep.delete(q);
      }
    }
    peaks = peaks.filter(p => keep.has(p));
  }
  peaks.sort((a,b) => a - b);
  return peaks;
}

export function smoothMovingAvg(arr, winSamples){
  winSamples = Math.max(1, winSamples|0);
  const n = arr.length;
  const out = new Float64Array(n);
  const prefix = new Float64Array(n+1);
  for (let i = 0; i < n; i++) prefix[i+1] = prefix[i] + arr[i];
  const half = Math.floor(winSamples/2);
  for (let i = 0; i < n; i++){
    let lo = i - half, hi = lo + winSamples;
    if (lo < 0) lo = 0;
    if (hi > n) hi = n;
    out[i] = (prefix[hi] - prefix[lo]) / Math.max(1, (hi - lo));
  }
  return out;
}

// Amplitude envelope via FFT-based Hilbert transform (analytic signal),
// computed at the exact sample count (see bluesteinDFT above) to match
// scipy.signal.hilbert(data).
export function computeEnvelopeHilbert(samples, smoothSamples){
  const n = samples.length;
  const zeros = new Float64Array(n);
  const { re, im } = bluesteinDFT(samples, zeros, false);
  const half = Math.floor(n/2);
  // Analytic-signal mask: double the positive frequencies, zero the negative
  // ones, leave DC (and the Nyquist bin, if n is even) untouched — same
  // recipe as scipy.signal.hilbert. For even n the Nyquist bin is index
  // `half` (left at ×1); for odd n there is no separate Nyquist bin, so the
  // doubled range extends one bin further, through index `half`.
  const doubleUpTo = (n % 2 === 0) ? half - 1 : half; // inclusive
  for (let k = 1; k <= doubleUpTo; k++){ re[k] *= 2; im[k] *= 2; }
  for (let k = half+1; k < n; k++){ re[k] = 0; im[k] = 0; }
  const { re: outRe, im: outIm } = bluesteinDFT(re, im, true);
  const env = new Float64Array(n);
  for (let i = 0; i < n; i++) env[i] = Math.hypot(outRe[i], outIm[i]);
  return smoothMovingAvg(env, smoothSamples);
}

// Topographic prominence of a local maximum at `idx`: scan outward until a
// taller point or the array edge, tracking the lowest value seen on each
// side; prominence = height - the higher (shallower) of the two floors.
// Mirrors scipy.signal.peak_prominences with no wlen limit.
export function peakProminence(arr, idx){
  const height = arr[idx];
  let leftMin = height;
  for (let i = idx-1; i >= 0; i--){
    if (arr[i] > height) break;
    if (arr[i] < leftMin) leftMin = arr[i];
  }
  let rightMin = height;
  for (let i = idx+1; i < arr.length; i++){
    if (arr[i] > height) break;
    if (arr[i] < rightMin) rightMin = arr[i];
  }
  return height - Math.max(leftMin, rightMin);
}

export function applyHann(arr){
  const n = arr.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++){
    const w = n > 1 ? 0.5 - 0.5*Math.cos(2*Math.PI*i/(n-1)) : 1;
    out[i] = arr[i]*w;
  }
  return out;
}
