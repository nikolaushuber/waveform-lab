// Golden (characterisation) files under tests/golden/.
//
// - tap-analysis-*.json and clustering.json were produced by the former
//   JavaScript pipelines and are now frozen references for the Python port
//   (python/tests/), which also writes clustering-py.json.
// - fixtures.json lets the Python tests prove they generate the same
//   synthetic recordings as tests/helpers/fixtures.js.
// - spectrum-chord.json covers the snapshot spectrum that stays in JS.
//
// Regenerate the files written here deliberately with:  npm test -- -u
import { describe, it, expect } from 'vitest';
import { computeSpectrumAt } from '../../src/core/spectrum.js';
import { fakeAudioBuffer, seededRandom, toGolden } from '../helpers/signals.js';
import { recordings, chord } from '../helpers/fixtures.js';

const golden = (name) => `../golden/${name}.json`;
const asJson = (v) => JSON.stringify(toGolden(v), null, 1) + '\n';

describe('golden: fixtures', () => {
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

describe('golden: Waveform snapshot spectrum', () => {
  it('computeSpectrumAt on a four-tone chord', async () => {
    const cap = computeSpectrumAt(fakeAudioBuffer(chord(), 44100), 0.5);
    const out = {
      peaks: cap.peaks, rms: cap.rms, N: cap.N, M: cap.M,
      dbsEvery256: Array.from(cap.dbs).filter((_, i) => i % 256 === 0),
    };
    await expect(asJson(out)).toMatchFileSnapshot(golden('spectrum-chord'));
  });
});
