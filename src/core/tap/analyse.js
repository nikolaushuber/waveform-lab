import { applyHann } from '../signal.js';
import { autoDetectSkipStart, detectTapEvents, extractEventWindow } from './detect.js';
import { computeCommonFrequencies, computeFftMagExact, computeTopPeaksPct } from './peaks.js';
import { sleep0 } from '../util.js';

// Full per-file pipeline: crop-end trim, crop-start (auto or manual), detect
// events, FFT + normalise each, cluster into top-5 common frequencies.
export async function analyseTapFile(entry, opts){
  const audioBuffer = entry.audioBuffer;
  const sr = audioBuffer.sampleRate;
  const nCh = audioBuffer.numberOfChannels;
  let samples;
  if (nCh === 1){
    samples = audioBuffer.getChannelData(0).slice();
  } else {
    const n = audioBuffer.length;
    samples = new Float32Array(n);
    for (let c = 0; c < nCh; c++){
      const ch = audioBuffer.getChannelData(c);
      for (let i = 0; i < n; i++) samples[i] += ch[i]/nCh;
    }
  }
  let durationTotal = samples.length/sr;

  // Crop End is seconds trimmed off the END of the file (same convention
  // as Clustering's trim_signal), not an absolute timestamp.
  const skipEndVal = (entry.skipEnd||'').trim();
  if (skipEndVal !== ''){
    const skipEndSec = parseFloat(skipEndVal);
    if (isFinite(skipEndSec) && skipEndSec > 0){
      const keepLen = Math.max(1, samples.length - Math.round(skipEndSec*sr));
      samples = samples.subarray(0, keepLen);
      durationTotal = samples.length/sr;
    }
  }
  await sleep0();

  const skipStartVal = (entry.skipStart||'').trim();
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
  return { label: entry.name, freqSummary, eventCount: eventResults.length, detectedEvents: peakIndices.length };
}
