// Clustering feature extraction (build_dataset_unlabeled() in random_forest.py):
// for each recording, crop -> detect taps -> estimate background noise from
// the gaps -> one log-binned, noise-subtracted FFT feature row per tap.
import { toMono } from '../mono.js';
import { sleep0 } from '../util.js';
import { detectTapsRF, estimateNoiseSpectrumRF, extractWindowRF, fftFeaturesRF, trimSignalRF } from './features.js';

//   entries: [{ name, audioBuffer, cropStart, cropEnd }]  (crop values are UI strings, '' = none)
//   opts:    { windowMs, minGapMs, offsetMs, fmax, nBins, fmin }
//   onProgress(message) is called before each file.
// Returns { X, meta, warnings, srUsed }: one feature row in X and one
// { file, tapIndex } in meta per detected tap.
export async function extractTapFeatures(entries, opts, onProgress = () => {}){
  const { windowMs, minGapMs, offsetMs, fmax, nBins, fmin } = opts;
  const X = [], meta = [];
  const warnings = [];
  let srUsed = null;
  const sampleRates = new Set();

  for (let fi = 0; fi < entries.length; fi++){
    const entry = entries[fi];
    onProgress(`Detecting taps ${fi+1}/${entries.length}: ${entry.name}…`);
    await sleep0();

    const audioBuffer = entry.audioBuffer;
    const sr = audioBuffer.sampleRate;
    sampleRates.add(sr);
    let samples = toMono(audioBuffer);

    const cropStartVal = (entry.cropStart||'').trim();
    const cropEndVal = (entry.cropEnd||'').trim();
    const cropStartSec = cropStartVal !== '' ? Math.max(0, parseFloat(cropStartVal)) : 0;
    const cropEndSec = cropEndVal !== '' ? Math.max(0, parseFloat(cropEndVal)) : 0;
    samples = trimSignalRF(samples, sr, isFinite(cropStartSec) ? cropStartSec : 0, isFinite(cropEndSec) ? cropEndSec : 0);
    await sleep0();

    const onsets = detectTapsRF(samples, sr, { minGapMs });
    if (!onsets.length){
      warnings.push(`${entry.name}: no taps detected, skipped`);
      continue;
    }
    await sleep0();

    const noiseSpectrum = estimateNoiseSpectrumRF(samples, sr, onsets, windowMs);
    if (!noiseSpectrum) warnings.push(`${entry.name}: no quiet gap found, denoising skipped for this file`);
    await sleep0();

    for (let i = 0; i < onsets.length; i++){
      const segment = extractWindowRF(samples, sr, onsets[i], windowMs, offsetMs);
      const feat = fftFeaturesRF(segment, sr, { nBins, fmin, fmax, noiseSpectrum });
      X.push(Array.from(feat));
      meta.push({ file: entry.name, tapIndex: i });
      if (i % 5 === 4) await sleep0();
    }
    if (srUsed === null) srUsed = sr;
  }

  if (sampleRates.size > 1){
    warnings.push(`files have different sample rates (${[...sampleRates].join(', ')}) — bin Hz ranges shown assume ${srUsed} Hz`);
  }
  return { X, meta, warnings, srUsed };
}
