// Tap Analyser DSP (client-side port of multi_variance.py / tap_scatter.py).
import { toMono } from '../mono.js';
import { applyHann } from '../signal.js';
import { autoDetectSkipStart, detectTapEvents, extractEventWindow } from './detect.js';
import { computeCommonFrequencies, computeFftMagExact, computeTopPeaksPct } from './peaks.js';
import { sleep0 } from '../util.js';

// Full per-file pipeline on mono samples: crop-end trim, crop-start (auto or
// manual), detect events, FFT + normalise each, cluster into the most common
// frequencies.
//   crop: { skipStart, skipEnd } — strings as typed in the UI ('' = auto / none)
//   opts: { numEvents, minGap, minFreq, maxFreq, topNBasis, tolerance, useEnergy }
export async function analyseTapSamples(samples, sr, crop, opts){
  // Crop End is seconds trimmed off the END of the file (same convention
  // as Clustering's trim_signal), not an absolute timestamp.
  const skipEndVal = (crop.skipEnd||'').trim();
  if (skipEndVal !== ''){
    const skipEndSec = parseFloat(skipEndVal);
    if (isFinite(skipEndSec) && skipEndSec > 0){
      const keepLen = Math.max(1, samples.length - Math.round(skipEndSec*sr));
      samples = samples.subarray(0, keepLen);
    }
  }
  await sleep0();

  const skipStartVal = (crop.skipStart||'').trim();
  const skipStartSec = skipStartVal !== '' ? parseFloat(skipStartVal) : autoDetectSkipStart(samples, sr);
  await sleep0();

  const peakIndices = detectTapEvents(samples, sr, opts.numEvents, opts.minGap, skipStartSec);
  await sleep0();

  const eventResults = [];
  for (let i = 0; i < peakIndices.length; i++){
    let windowData;
    try { windowData = extractEventWindow(samples, sr, peakIndices[i], 0.1, 1.0); }
    catch(e){ continue; }
    if (windowData.length < 16) continue;

    const windowed = applyHann(windowData);
    const { freqs, mags } = computeFftMagExact(windowed, sr);
    const minSepBins = 3; // matches scipy's find_peaks(mm, distance=3) directly, same bin grid as Python now

    let topPeaksPct;
    try { topPeaksPct = computeTopPeaksPct(freqs, mags, opts.topNBasis, opts.minFreq, opts.maxFreq, minSepBins, opts.useEnergy); }
    catch(e){ continue; }

    eventResults.push({ eventNum: i+1, peaks: topPeaksPct.slice(0, 10) });
    if (i % 3 === 2) await sleep0();
  }

  if (!eventResults.length) throw new Error('no events successfully processed');

  // Compute the max we'd ever display (10) regardless of the user's current
  // "Show top" selection, so changing that selector can just re-slice and
  // redraw instantly without re-running the whole analysis.
  const freqSummary = computeCommonFrequencies(eventResults, opts.tolerance, 10);
  return { freqSummary, eventCount: eventResults.length, detectedEvents: peakIndices.length };
}

// The same, for a library entry: { name, audioBuffer, skipStart, skipEnd }.
export async function analyseTapFile(entry, opts){
  const audioBuffer = entry.audioBuffer;
  const result = await analyseTapSamples(toMono(audioBuffer), audioBuffer.sampleRate, entry, opts);
  return { label: entry.name, ...result };
}
