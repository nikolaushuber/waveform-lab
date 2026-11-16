// Golden (characterisation) tests: the full outputs of the main pipelines on
// fixed synthetic input, frozen as JSON under tests/golden/. The original
// Python scripts are lost, so these files are the reference behaviour, and
// any future Python port should reproduce them.
//
// Regenerate deliberately with:  npm test -- -u
import { describe, it, expect } from 'vitest';
import { detectTapsRF, estimateNoiseSpectrumRF, getBinEdgesRF } from '../../src/core/cluster/features.js';
import { extractTapFeatures } from '../../src/core/cluster/pipeline.js';
import { rfProximityClustering } from '../../src/core/ml/forest.js';
import { kmeansClusterAutoK } from '../../src/core/ml/kmeans.js';
import { adjustedRandScore } from '../../src/core/ml/metrics.js';
import { computeSpectrumAt } from '../../src/core/spectrum.js';
import { analyseTapFile } from '../../src/core/tap/analyse.js';
import { fakeAudioBuffer, seededRandom, toGolden } from '../helpers/signals.js';
import { SR, recordings, TAP_DEFAULTS, CLUSTER_DEFAULTS, chord } from '../helpers/fixtures.js';

const golden = (name) => `../golden/${name}.json`;
const asJson = (v) => JSON.stringify(toGolden(v), null, 1) + '\n';

describe('golden: fixtures', () => {
  // Lets the Python tests (python/tests/test_fixtures.py) prove they generate
  // the same synthetic recordings.
  it('fixture signals', async () => {
    const rnd = seededRandom(42);
    const out = { prng42: Array.from({ length: 5 }, rnd), recordings: {} };
    for (const r of recordings) {
      const every997 = [];
      for (let i = 0; i < r.samples.length; i += 997) every997.push(r.samples[i]);
      out.recordings[r.name] = { length: r.samples.length, sum: r.samples.reduce((s, v) => s + v, 0), every997 };
    }
    await expect(JSON.stringify(out, null, 1) + '\n').toMatchFileSnapshot(golden('fixtures'));
  });
});

describe('golden: Tap Analyser', () => {
  it.each(['amplitude', 'energy'])('analyseTapFile per recording (%s metric)', async (metric) => {
    const out = {};
    for (const r of recordings) {
      const entry = { name: r.name, audioBuffer: fakeAudioBuffer(r.samples, SR), skipStart: '', skipEnd: '' };
      out[r.name] = await analyseTapFile(entry, { ...TAP_DEFAULTS, useEnergy: metric === 'energy' });
    }
    await expect(asJson(out)).toMatchFileSnapshot(golden(`tap-analysis-${metric}`));
  });
});

// The JavaScript clustering engine (runClusteringJS in src/ui/pages/cluster.js)
// minus the DOM, plus the per-file onsets/noise profiles for easier debugging.
async function clusterPipeline(files, o = CLUSTER_DEFAULTS) {
  const perFile = {};
  for (const f of files) {
    const onsets = detectTapsRF(f.samples, SR, { minGapMs: o.minGapMs });
    perFile[f.name] = { onsets, noiseSpectrum: estimateNoiseSpectrumRF(f.samples, SR, onsets, o.windowMs) };
  }
  const entries = files.map((f) => ({ name: f.name, audioBuffer: fakeAudioBuffer(f.samples, SR), cropStart: '', cropEnd: '' }));
  const { X, meta } = await extractTapFeatures(entries,
    { windowMs: o.windowMs, minGapMs: o.minGapMs, offsetMs: o.offsetSec * 1000, fmax: o.fmax, nBins: o.nBins, fmin: o.fmin });
  const km = kmeansClusterAutoK(X, { kRange: [2, 3, 4, 5, 6, 7, 8] });
  const rf = rfProximityClustering(X, km.k, { nEstimators: o.nEstimators, randomState: 42 });
  return {
    perFile, X, meta,
    kmeans: { k: km.k, labels: km.labels, scores: km.scores },
    rf: { labels: rf.labels, importances: rf.importances, proximity: rf.proximity },
    agreement: adjustedRandScore(km.labels, rf.labels),
    edges: getBinEdgesRF(SR, o.nBins, o.fmin, o.fmax),
  };
}

describe('golden: Clustering', async () => {
  const res = await clusterPipeline(recordings);

  it('separates the two materials (sanity check on the golden input)', () => {
    const byFile = (labels) => Object.fromEntries(recordings.map((r) => [r.name, new Set(labels.filter((_, i) => res.meta[i].file === r.name))]));
    const rf = byFile(res.rf.labels);
    expect(res.kmeans.k).toBe(2);
    expect([...rf['a1.wav']]).toEqual([...rf['a2.wav']]);
    expect([...rf['b1.wav']]).toEqual([...rf['b2.wav']]);
    expect([...rf['a1.wav']]).not.toEqual([...rf['b1.wav']]);
  });

  it('full pipeline output', async () => {
    await expect(asJson(res)).toMatchFileSnapshot(golden('clustering'));
  });
});

describe('golden: Waveform snapshot spectrum', () => {
  it('computeSpectrumAt on a four-tone chord', async () => {
    const cap = computeSpectrumAt(fakeAudioBuffer(chord(), 44100), 0.5);
    const every = 256;
    const out = {
      peaks: cap.peaks, rms: cap.rms, N: cap.N, M: cap.M,
      dbsEvery256: Array.from(cap.dbs).filter((_, i) => i % every === 0),
    };
    await expect(asJson(out)).toMatchFileSnapshot(golden('spectrum-chord'));
  });
});
