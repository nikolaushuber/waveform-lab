import { bluesteinDFT } from '../fft.js';

// Zero-padded FFT magnitude spectrum (same M-real/N-padded convention as
// computeSpectrumAt above: padding only interpolates, it doesn't add resolution).
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

export function interpolatePeakFreq(freqs, mags, binIdx){
  const n = mags.length;
  if (binIdx <= 0 || binIdx >= n-1) return freqs[binIdx];
  const toDb = v => 20*Math.log10(Math.max(v, 1e-12));
  const alpha = toDb(mags[binIdx-1]), beta = toDb(mags[binIdx]), gamma = toDb(mags[binIdx+1]);
  const denom = alpha - 2*beta + gamma;
  if (Math.abs(denom) < 1e-9) return freqs[binIdx];
  let p = 0.5*(alpha-gamma)/denom;
  p = Math.max(-1, Math.min(1, p));
  const binSpacing = freqs[1]-freqs[0];
  return freqs[binIdx] + p*binSpacing;
}

// −3dB (half-power) bandwidth of a peak in Hz: walks outward from `peakIdx`
// on the full (unmasked) energy spectrum in both directions until energy
// drops below 50% of the peak's energy, interpolating each crossing for
// sub-bin accuracy. Ports measure_peak_bandwidth from multi_energy.py
// exactly (same walk direction, same interpolation, same 0.5Hz floor).
export function measurePeakBandwidthHz(energy, freqs, peakIdx, minBwHz){
  minBwHz = minBwHz == null ? 0.5 : minBwHz;
  const peakEnergy = energy[peakIdx];
  const halfPower = peakEnergy * 0.5;
  const n = energy.length;
  const binSpacing = freqs[1]-freqs[0];

  let left = peakIdx;
  while (left > 0 && energy[left] >= halfPower) left--;
  let fLeft;
  if (left > 0 && energy[left+1] > energy[left]){
    const fracL = (halfPower - energy[left]) / (energy[left+1] - energy[left]);
    fLeft = freqs[left] + fracL*binSpacing;
  } else {
    fLeft = freqs[left];
  }

  let right = peakIdx;
  while (right < n-1 && energy[right] >= halfPower) right++;
  let fRight;
  if (right < n-1 && energy[right-1] > energy[right]){
    const fracR = (halfPower - energy[right]) / (energy[right-1] - energy[right]);
    fRight = freqs[right] - fracR*binSpacing;
  } else {
    fRight = freqs[right];
  }

  return Math.max(fRight - fLeft, minBwHz);
}

// Top-N local-maxima peaks within [minFreq,maxFreq]. Local maxima are found
// and de-duplicated (min separation `minSepBins`) using `rankBy` (defaults
// to `mags` — plain magnitude), matching scipy's find_peaks(..., distance=3)
// on that same curve. Which of the surviving candidates are finally kept
// (top `nPeaks`) and in what order is decided by `selectByFn(idx)` (defaults
// to `rankBy[idx]`) — this split matters for multi_energy.py's current
// algorithm, where peaks are FOUND on the energy curve but SELECTED/ranked
// by normalised energy (energy / −3dB bandwidth), so the two curves differ.
// Frequency is always refined from `mags` in dB, matching
// interpolate_peak_frequency(freqs, magnitude, ...) being called with
// `magnitude` regardless of mode.
export function findTopNPeaksLinear(freqs, mags, nPeaks, minFreq, maxFreq, minSepBins, rankBy, selectByFn){
  rankBy = rankBy || mags;
  const selectVal = selectByFn || (idx => rankBy[idx]);
  let loIdx = -1, hiIdx = -1;
  for (let k = 0; k < freqs.length; k++){
    if (loIdx < 0 && freqs[k] >= minFreq) loIdx = k;
    if (freqs[k] <= maxFreq) hiIdx = k;
  }
  if (loIdx < 0 || hiIdx < loIdx) return [];

  const localMaxima = [];
  for (let k = loIdx+1; k < hiIdx; k++){
    if (rankBy[k] > rankBy[k-1] && rankBy[k] >= rankBy[k+1]) localMaxima.push(k);
  }

  let candidates;
  if (!localMaxima.length){
    const idxs = [];
    for (let k = loIdx; k <= hiIdx; k++) idxs.push(k);
    idxs.sort((a,b) => rankBy[b]-rankBy[a]);
    candidates = idxs.slice(0, nPeaks);
  } else {
    const sorted = localMaxima.slice().sort((a,b) => rankBy[b]-rankBy[a]);
    const kept = [];
    for (const idx of sorted){
      if (kept.every(k => Math.abs(k-idx) >= minSepBins)) kept.push(idx);
    }
    candidates = kept;
  }

  // Truncate to the final top-N (and decide their order) by `selectVal`,
  // not `rankBy` — for the energy-mode case this is where a peak found on
  // the raw energy curve can lose out to a sharper/narrower one once
  // bandwidth-normalised, exactly as in find_top_n_peaks_linear.
  const scoreMap = new Map(candidates.map(idx => [idx, selectVal(idx)]));
  candidates = candidates.slice().sort((a,b) => scoreMap.get(b)-scoreMap.get(a)).slice(0, nPeaks);
  const results = candidates.map(idx => ({ freq: interpolatePeakFreq(freqs, mags, idx), mag: mags[idx], score: scoreMap.get(idx) }));
  results.sort((a,b) => b.score-a.score);
  return results;
}

// Normalise: top `topNBasis` peaks sum to 100%, every reported peak
// expressed as % of that sum. useEnergy=true mirrors multi_energy.py's
// current algorithm: peaks are found on the energy curve but selected and
// ranked by NORMALISED ENERGY = energy / −3dB bandwidth_Hz (rewards sharp,
// well-defined resonances over broad/diffuse ones of equal total energy),
// and the 100% basis is the sum of those peaks' normalised energies.
export function computeTopPeaksPct(freqs, mags, topNBasis, minFreq, maxFreq, minSepBins, useEnergy){
  let rankBy = null, selectByFn = null;
  if (useEnergy){
    const energy = mags.map(m => m*m);
    rankBy = energy;
    selectByFn = idx => energy[idx] / measurePeakBandwidthHz(energy, freqs, idx);
  }
  const topLinear = findTopNPeaksLinear(freqs, mags, topNBasis, minFreq, maxFreq, minSepBins, rankBy, selectByFn);
  if (!topLinear.length) throw new Error('no spectral peaks found to normalise against');
  const basisSum = topLinear.reduce((s,p) => s+p.score, 0);
  if (basisSum <= 0) throw new Error(useEnergy ? 'top peak normalised energies summed to zero' : 'top peak magnitudes summed to zero');
  const pct = topLinear.map(p => ({ freq: p.freq, pct: (p.score/basisSum)*100 }));
  pct.sort((a,b) => b.pct-a.pct);
  return pct;
}

// Cluster peaks across events (within ±toleranceHz) and rank by appearances then avg %.
// Mirrors compute_common_frequencies in multi_variance.py.
export function computeCommonFrequencies(eventResults, toleranceHz, topN){
  const allPeaks = [];
  eventResults.forEach(r => r.peaks.forEach(p => allPeaks.push({freq:p.freq, pct:p.pct, ev:r.eventNum})));
  if (!allPeaks.length) return [];
  allPeaks.sort((a,b) => a.freq-b.freq);

  const clusters = [];
  for (const pk of allPeaks){
    let merged = false;
    for (const c of clusters){
      const mean = c.reduce((s,x) => s+x.freq, 0)/c.length;
      if (Math.abs(pk.freq-mean) <= toleranceHz){ c.push(pk); merged = true; break; }
    }
    if (!merged) clusters.push([pk]);
  }

  const mean = arr => arr.reduce((s,x) => s+x, 0)/arr.length;
  const std = arr => { const m = mean(arr); return Math.sqrt(mean(arr.map(x => (x-m)*(x-m)))); };

  const summaries = clusters.map(cluster => {
    const byEvent = new Map();
    cluster.forEach(({freq,pct,ev}) => {
      const cur = byEvent.get(ev);
      if (!cur || pct > cur.pct) byEvent.set(ev, {freq,pct});
    });
    const vals = [...byEvent.values()];
    const hz = vals.map(v => v.freq), pcts = vals.map(v => v.pct);
    return {
      freq: mean(hz), appearances: vals.length, avgPct: mean(pcts),
      stdHz: std(hz), stdPct: std(pcts),
      minPct: Math.min(...pcts), maxPct: Math.max(...pcts),
      minHz: Math.min(...hz), maxHz: Math.max(...hz),
    };
  });

  summaries.sort((a,b) => (b.appearances-a.appearances) || (b.avgPct-a.avgPct));
  return summaries.slice(0, topN);
}
