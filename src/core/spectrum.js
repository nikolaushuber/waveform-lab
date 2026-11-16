import { bluesteinDFT, fftInPlace } from './fft.js';

// Search forward from `startTimeSec` for the sample of greatest absolute
// amplitude within the next `windowSec` seconds — the "loudest peak" for
// the Sample control. Used to jump from a rough manual marker (dropped
// somewhere before a tap) to that tap's actual attack.
export function findLoudestPeakForward(audioBuffer, startTimeSec, windowSec){
  const sr = audioBuffer.sampleRate;
  const nCh = audioBuffer.numberOfChannels;
  const chans = [];
  for (let c = 0; c < nCh; c++) chans.push(audioBuffer.getChannelData(c));
  const total = audioBuffer.length;
  const startIdx = Math.min(total-1, Math.max(0, Math.round(startTimeSec*sr)));
  const endIdx = Math.min(total, startIdx + Math.max(1, Math.round(windowSec*sr)));
  let bestI = startIdx, bestV = -Infinity;
  for (let i = startIdx; i < endIdx; i++){
    let sum = 0;
    for (let c = 0; c < nCh; c++) sum += chans[c][i];
    const v = Math.abs(sum/nCh);
    if (v > bestV){ bestV = v; bestI = i; }
  }
  return bestI / sr;
}

// Compute windowed FFT centred at `time` (seconds) on an AudioBuffer.
// `M` is the real analysis window (determines true frequency resolution).
// `N` is the zero-padded FFT size (denser frequency grid, for a smooth curve
// — this does not add real resolution, it just interpolates between the
// M-sample window's true frequency response so smoothing has enough points
// to average over, even down at 50 Hz).
export function computeSpectrumAt(audioBuffer, time, M, N){
  M = M || 4096;
  N = N || 65536;
  const sr = audioBuffer.sampleRate;
  const ch0 = audioBuffer.getChannelData(0);
  const nCh = audioBuffer.numberOfChannels;
  const centre = Math.round(time * sr);
  let start = centre - Math.floor(M/2);
  const re = new Float64Array(N);
  const im = new Float64Array(N);

  // mono downmix window extraction with zero padding at boundaries
  let sumSq = 0, count = 0;
  for (let i = 0; i < M; i++){
    const idx = start + i;
    let sample = 0;
    if (idx >= 0 && idx < audioBuffer.length){
      if (nCh === 1){
        sample = ch0[idx];
      } else {
        let sum = 0;
        for (let c = 0; c < nCh; c++) sum += audioBuffer.getChannelData(c)[idx];
        sample = sum / nCh;
      }
      sumSq += sample*sample; count++;
    }
    // Hann window over the real M-sample analysis window
    const w = 0.5 - 0.5*Math.cos(2*Math.PI*i/(M-1));
    re[i] = sample * w;
    im[i] = 0;
  }
  // remaining N-M samples stay zero (the zero-padding)
  const rms = count ? Math.sqrt(sumSq/count) : 0;

  fftInPlace(re, im);

  const half = N/2;
  const freqs = new Float64Array(half);
  const mags = new Float64Array(half);
  const dbs = new Float64Array(half);
  for (let k = 0; k < half; k++){
    const mag = Math.sqrt(re[k]*re[k] + im[k]*im[k]) / (M/2);
    freqs[k] = k * sr / N;
    mags[k] = mag;
    dbs[k] = 20*Math.log10(mag + 1e-12);
  }

  // peak picking: local maxima above noise floor
  const peaks = [];
  const floor = -90;
  for (let k = 2; k < half-2; k++){
    if (dbs[k] > floor && dbs[k] > dbs[k-1] && dbs[k] >= dbs[k+1]){
      peaks.push({freq: freqs[k], db: dbs[k], mag: mags[k]});
    }
  }
  peaks.sort((a,b) => b.db - a.db);
  // de-dup peaks within 40 Hz of a stronger peak already kept
  const kept = [];
  for (const p of peaks){
    if (kept.every(q => Math.abs(q.freq - p.freq) > 40)) kept.push(p);
    if (kept.length >= 10) break;
  }

  return { freqs, mags, dbs, peaks: kept, rms, sampleRate: sr, N, M, time };
}

// Auto-fit dB range: rather than a fixed -90..0 axis (which leaves most
// real recordings — quieter than 0 dBFS — squashed near the bottom), each
// graph picks a [dbMin, dbMax] that hugs its own curve with a little
// padding, so the shape actually fills the chart.
export function autoDbRange(values){
  let lo = Infinity, hi = -Infinity;
  for (const v of values){
    if (!isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!isFinite(lo) || !isFinite(hi)) return { dbMin: -90, dbMax: 0 };
  let dbMax = Math.min(6, Math.ceil((hi + 6) / 10) * 10);
  let dbMin = Math.max(-120, Math.floor((lo - 6) / 10) * 10);
  if (dbMax - dbMin < 20) dbMin = dbMax - 20; // guard against a near-flat curve
  return { dbMin, dbMax };
}

// Averages `values` across a fractional-octave window centred on bin `idx`
// (bins are assumed linearly spaced at `binHz` apart).
export function octaveAverage(values, binHz, idx, fraction){
  const f = idx * binHz;
  if (f <= 0) return values[idx];
  const factor = Math.pow(2, fraction/2);
  let lo = Math.max(0, Math.round((f/factor)/binHz));
  let hi = Math.min(values.length - 1, Math.round((f*factor)/binHz));
  if (hi < lo) hi = lo;
  let sum = 0;
  for (let j = lo; j <= hi; j++) sum += values[j];
  return sum / (hi - lo + 1);
}

// Hann window applied to a copy of `arr`.
export function applyHann(arr){
  const n = arr.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++){
    const w = n > 1 ? 0.5 - 0.5*Math.cos(2*Math.PI*i/(n-1)) : 1;
    out[i] = arr[i]*w;
  }
  return out;
}

// Exact (unpadded) FFT magnitude spectrum, matching np.fft.rfft(data) bin-
// for-bin. We used to zero-pad this to interpolate a smoother curve, but
// that was wrong here: padding reveals extra fine-grained window-sidelobe
// ripple between the coarser raw bins, which can register as *extra* local
// maxima that don't exist as distinct samples in Python's coarser grid —
// changing which peaks win the top-N-basis / top-5-common comparison.
// Built on bluesteinDFT so M doesn't need to be a power of 2.
export function computeFftMagExact(windowed, sr){
  const M = windowed.length;
  const zeros = new Float64Array(M);
  const { re, im } = bluesteinDFT(windowed, zeros, false);
  const half = Math.floor(M/2) + 1; // rfft length, same convention as np.fft.rfft
  const freqs = new Float64Array(half);
  const mags = new Float64Array(half);
  for (let k = 0; k < half; k++){
    freqs[k] = k*sr/M;
    let mag = Math.hypot(re[k], im[k]) / M;
    if (k > 0 && k < half-1) mag *= 2; // matches magnitude[1:-1] *= 2 in compute_fft_raw
    mags[k] = mag;
  }
  return { freqs, mags, M };
}

// A tap attack near `timeSec`, for snapping tap markers: the loudest
// (mono-mixed) sample within ±radiusSec — but only if it clearly stands out,
// i.e. is at least `ratio` times the median level of the ±contextSec around
// it. Returns its time in seconds, or null when there's nothing but
// background (so a marker dropped in a quiet stretch stays where it was put).
export function findAttackNear(audioBuffer, timeSec, radiusSec, { ratio = 8, contextSec = 0.25 } = {}){
  const sr = audioBuffer.sampleRate;
  const n = audioBuffer.length;
  const chans = [];
  for (let c = 0; c < audioBuffer.numberOfChannels; c++) chans.push(audioBuffer.getChannelData(c));
  const level = (i) => { let s = 0; for (const ch of chans) s += ch[i]; return Math.abs(s / chans.length); };

  const p = Math.min(n - 1, Math.max(0, Math.round(timeSec * sr)));
  const r = Math.max(1, Math.round(radiusSec * sr));
  let best = -1, bestV = 0;
  for (let i = Math.max(0, p - r), hi = Math.min(n, p + r + 1); i < hi; i++){
    const v = level(i);
    if (v > bestV){ bestV = v; best = i; }
  }
  if (best < 0) return null;

  const a = Math.max(0, p - Math.round(contextSec * sr)), b = Math.min(n, p + Math.round(contextSec * sr) + 1);
  const around = new Float32Array(b - a);
  for (let i = a; i < b; i++) around[i - a] = level(i);
  around.sort();
  const median = around[Math.floor(around.length / 2)];
  return bestV >= ratio * median ? best / sr : null;
}
