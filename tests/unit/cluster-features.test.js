import { describe, it, expect } from 'vitest';
import { detectTapsRF, estimateNoiseSpectrumRF, extractWindowRF, fftFeaturesRF, getBinEdgesRF, trimSignalRF } from '../../src/core/cluster/features.js';
import { tapRecording } from '../helpers/signals.js';

const SR = 8000;

describe('trimSignalRF', () => {
  it('truncates sr*sec like Python int(), and never inverts', () => {
    const s = Float32Array.from({ length: 10 }, (_, i) => i);
    expect(Array.from(trimSignalRF(s, 10, 0.19, 0.31))).toEqual([1, 2, 3, 4, 5, 6]);
    expect(trimSignalRF(s, 10, 0.8, 0.8)).toHaveLength(0);
  });
});

describe('detectTapsRF', () => {
  const onsets = [0.5, 1.0, 1.7, 2.4];
  const rec = tapRecording({ sr: SR, onsets, duration: 3 });

  it('finds the planted onsets', () => {
    const got = detectTapsRF(rec, SR, { minGapMs: 150 });
    expect(got).toHaveLength(onsets.length);
    got.forEach((p, i) => expect(Math.abs(p / SR - onsets[i])).toBeLessThan(0.01));
  });

  it('keeps only the loudest expectedTaps, in time order', () => {
    const got = detectTapsRF(rec, SR, { minGapMs: 150, expectedTaps: 2 });
    expect(got).toHaveLength(2);
    expect(got[0]).toBeLessThan(got[1]);
  });
});

describe('extractWindowRF', () => {
  it('starts pre_ms before the onset and zero-pads past the end', () => {
    const s = Float32Array.from({ length: 20 }, (_, i) => i + 1);
    expect(Array.from(extractWindowRF(s, 1000, 10, 5, 2))).toEqual([9, 10, 11, 12, 13]);
    expect(Array.from(extractWindowRF(s, 1000, 18, 5, 0))).toEqual([19, 20, 0, 0, 0]);
  });
});

describe('getBinEdgesRF', () => {
  it('is log-spaced from fmin to fmax with nBins+1 edges', () => {
    const e = getBinEdgesRF(8000, 4, 10, 1000);
    expect(Array.from(e)).toEqual([10, 10 ** 1.5, 100, 10 ** 2.5, 1000].map((v) => expect.closeTo(v, 9)));
    expect(getBinEdgesRF(8000)[64]).toBeCloseTo(4000, 9);
  });
});

describe('estimateNoiseSpectrumRF / fftFeaturesRF', () => {
  const rec = tapRecording({ sr: SR, onsets: [0.5, 1.2, 1.9], duration: 2.6, noise: 0.01 });
  const onsets = detectTapsRF(rec, SR, {});

  it('averages quiet gaps into an rfft-length profile, or null when there are none', () => {
    const noise = estimateNoiseSpectrumRF(rec, SR, onsets, 120);
    expect(noise).toHaveLength(Math.floor(0.12 * SR / 2) + 1);
    expect(estimateNoiseSpectrumRF(rec, SR, [10], 120)).toBeNull();
  });

  it('produces nBins log1p features that light up the planted partial', () => {
    const seg = extractWindowRF(rec, SR, onsets[0], 120, 5);
    const feat = fftFeaturesRF(seg, SR, { nBins: 64, fmin: 20, fmax: 1500 });
    expect(feat).toHaveLength(64);
    const edges = getBinEdgesRF(SR, 64, 20, 1500);
    const best = feat.indexOf(Math.max(...feat));
    expect(edges[best]).toBeLessThanOrEqual(220);
    expect(edges[best + 1]).toBeGreaterThan(220);
  });

  it('noise subtraction never increases a feature', () => {
    const seg = extractWindowRF(rec, SR, onsets[1], 120, 5);
    const noiseSpectrum = estimateNoiseSpectrumRF(rec, SR, onsets, 120);
    const raw = fftFeaturesRF(seg, SR, { fmax: 1500 });
    const den = fftFeaturesRF(seg, SR, { fmax: 1500, noiseSpectrum });
    den.forEach((v, i) => expect(v).toBeLessThanOrEqual(raw[i] + 1e-12));
  });
});
