import { computeEnvelopeHilbert, peakProminence } from '../signal.js';

// Estimate where leading speech/noise ends: longest "quiet" run in the first
// half of the recording, cutting at its midpoint. Mirrors auto_detect_speech_end.
export function autoDetectSkipStart(samples, sr){
  const smoothSamples = Math.max(1, Math.round(sr*50/1000));
  const env = computeEnvelopeHilbert(samples, smoothSamples);
  const half = Math.floor(env.length/2);
  const firstHalf = env.subarray(0, half);
  const sorted = Float64Array.from(firstHalf).sort();
  const threshold = sorted.length ? sorted[Math.floor(0.25*(sorted.length-1))] : 0;
  let bestStart = 0, bestLen = 0, curStart = 0, curLen = 0;
  for (let i = 0; i < half; i++){
    if (firstHalf[i] < threshold){
      if (curLen === 0) curStart = i;
      curLen++;
      if (curLen > bestLen){ bestLen = curLen; bestStart = curStart; }
    } else curLen = 0;
  }
  const cutoffSample = bestStart + Math.floor(bestLen/2);
  return cutoffSample / sr;
}

// Detect tap/pluck onsets: envelope onset-strength peaks, keep the strongest
// `numEvents` by envelope value shortly after onset, then return in time order.
export function detectTapEvents(samples, sr, numEvents, minGapSec, skipStartSec){
  const skipSamples = Math.max(0, Math.round(skipStartSec*sr));
  const region = samples.subarray(Math.min(skipSamples, samples.length));
  if (region.length < 32) throw new Error('not enough audio after Crop Start');

  const smoothSamples = Math.max(1, Math.round(sr*5/1000));
  const env = computeEnvelopeHilbert(region, smoothSamples);
  const onset = new Float64Array(env.length);
  for (let i = 1; i < env.length; i++) onset[i] = Math.max(0, env[i] - env[i-1]);

  const minDistance = Math.max(1, Math.round(minGapSec*sr));
  let maxOnset = 0;
  for (let i = 0; i < onset.length; i++) if (onset[i] > maxOnset) maxOnset = onset[i];
  const prominenceThresh = maxOnset > 0 ? maxOnset*0.05 : 0;

  const rawCandidates = [];
  for (let i = 1; i < onset.length-1; i++){
    if (onset[i] > prominenceThresh && onset[i] >= onset[i-1] && onset[i] > onset[i+1]) rawCandidates.push(i);
  }

  // Filter by true topographic prominence, matching scipy's find_peaks(...,
  // prominence=...) rather than approximating it with a bare height check.
  // Safe to prefilter by height first: prominence <= height always, so this
  // never discards a candidate that would have passed the prominence test.
  const candidates = rawCandidates.filter(idx => peakProminence(onset, idx) >= prominenceThresh);
  if (!candidates.length) throw new Error('no tap/pluck transients detected — try adjusting Crop Start or Min Gap');

  const order = candidates.slice().sort((a,b) => onset[b]-onset[a]);
  const kept = [];
  for (const idx of order){
    if (kept.every(k => Math.abs(k-idx) >= minDistance)) kept.push(idx);
  }

  const lookAhead = Math.round(0.02*sr);
  const scored = kept.map(idx => ({ idx, score: env[Math.min(idx+lookAhead, env.length-1)] }));
  scored.sort((a,b) => b.score-a.score);
  const nTake = Math.min(numEvents, scored.length);
  const chosen = scored.slice(0, nTake).map(s => s.idx).sort((a,b) => a-b);

  const peakIndices = chosen.map(c => c + skipSamples);

  return peakIndices.map(p => {
    const lo = Math.max(0, p - Math.round(0.01*sr));
    const hi = Math.min(samples.length, p + Math.round(0.03*sr));
    let bestI = lo, bestV = -Infinity;
    for (let i = lo; i < hi; i++){
      const v = Math.abs(samples[i]);
      if (v > bestV){ bestV = v; bestI = i; }
    }
    return bestI;
  }).sort((a,b) => a-b);
}

export function extractEventWindow(samples, sr, peakIdx, offsetSec, durationSec){
  const startIdx = peakIdx + Math.round(offsetSec*sr);
  if (startIdx >= samples.length) throw new Error('offset window exceeds file length for this event');
  const endIdx = Math.min(startIdx + Math.round(durationSec*sr), samples.length);
  return samples.slice(startIdx, endIdx);
}
