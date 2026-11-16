import { describe, it, expect } from 'vitest';
import { applyHann, findPeaksHeightDistance, peakProminence } from '../../src/core/signal.js';
import { computeCommonFrequencies, computeFftMagExact, computeTopPeaksPct, findTopNPeaksLinear, interpolatePeakFreq, measurePeakBandwidthHz } from '../../src/core/tap/peaks.js';
import { sine } from '../helpers/signals.js';


describe('findPeaksHeightDistance (scipy find_peaks)', () => {
  it('finds strict local maxima, never the endpoints', () => {
    expect(findPeaksHeightDistance([5, 1, 3, 1, 4, 2, 9], null, null)).toEqual([2, 4]);
  });

  it('resolves a plateau to its (floored) midpoint', () => {
    expect(findPeaksHeightDistance([0, 2, 2, 2, 2, 0], null, null)).toEqual([2]);
  });

  it('drops peaks below height', () => {
    expect(findPeaksHeightDistance([0, 1, 0, 5, 0, 2, 0], 2, null)).toEqual([3, 5]);
  });

  it('thins by distance, keeping the taller peak', () => {
    expect(findPeaksHeightDistance([0, 3, 0, 5, 0, 0, 0, 0, 4, 0], null, 3)).toEqual([3, 8]);
  });
});

describe('peakProminence', () => {
  it('is height minus the higher of the two surrounding floors', () => {
    const arr = [0, 2, 1, 6, 3, 4, 0];
    expect(peakProminence(arr, 3)).toBe(6);   // tallest: both floors reach 0
    expect(peakProminence(arr, 5)).toBe(1);   // left floor 3 (stops at 6), right floor 0
    expect(peakProminence(arr, 1)).toBe(1);   // left floor 0, right floor 1
  });
});

describe('interpolatePeakFreq', () => {
  it('returns the bin frequency at the edges or for a flat top', () => {
    const freqs = [0, 10, 20, 30];
    expect(interpolatePeakFreq(freqs, [1, 2, 3, 4], 0)).toBe(0);
    expect(interpolatePeakFreq(freqs, [1, 2, 3, 4], 3)).toBe(30);
    expect(interpolatePeakFreq(freqs, [1, 1, 1, 1], 1)).toBe(10);
  });

  it('shifts towards the larger neighbour, by at most one bin', () => {
    const freqs = [0, 10, 20, 30];
    const f = interpolatePeakFreq(freqs, [0.1, 0.5, 1, 0.9], 2);
    expect(f).toBeGreaterThan(20);
    expect(f).toBeLessThan(30);
  });

  it('refines an off-bin sine to within a fraction of a bin', () => {
    const sr = 1000, n = 1000;
    const { freqs, mags } = computeFftMagExact(applyHann(sine(123.3, sr, n)), sr);
    expect(interpolatePeakFreq(freqs, mags, 123)).toBeCloseTo(123.3, 1);
  });
});

describe('measurePeakBandwidthHz', () => {
  it('measures the half-power width with interpolation and a 0.5 Hz floor', () => {
    const freqs = [0, 1, 2, 3, 4, 5, 6];
    const energy = [0, 0, 0.5, 1, 0.5, 0, 0];
    expect(measurePeakBandwidthHz(energy, freqs, 3)).toBeCloseTo(2, 12);
    expect(measurePeakBandwidthHz([0, 1, 0], [0, 0.1, 0.2], 1)).toBe(0.5);
  });
});

describe('findTopNPeaksLinear / computeTopPeaksPct', () => {
  const sr = 2000, n = 2000;
  const sig = new Float64Array(n);
  [[150, 1], [400, 0.6], [700, 0.3]].forEach(([f, a]) => sine(f, sr, n, a).forEach((v, i) => { sig[i] += v; }));
  const { freqs, mags } = computeFftMagExact(applyHann(sig), sr);

  it('ranks the planted partials by magnitude', () => {
    const peaks = findTopNPeaksLinear(freqs, mags, 3, 50, 1000, 3);
    expect(peaks.map((p) => Math.round(p.freq))).toEqual([150, 400, 700]);
  });

  it('respects the frequency window', () => {
    const peaks = findTopNPeaksLinear(freqs, mags, 3, 300, 1000, 3);
    expect(Math.round(peaks[0].freq)).toBe(400);
    expect(findTopNPeaksLinear(freqs, mags, 3, 5000, 6000, 3)).toEqual([]);
  });

  it.each([false, true])('percentages sum to 100 (useEnergy=%s)', (useEnergy) => {
    const pct = computeTopPeaksPct(freqs, mags, 3, 50, 1000, 3, useEnergy);
    expect(pct.reduce((s, p) => s + p.pct, 0)).toBeCloseTo(100, 9);
    expect(Math.round(pct[0].freq)).toBe(150);
  });

  it('throws when there is nothing to normalise against', () => {
    expect(() => computeTopPeaksPct(freqs, mags, 3, 5000, 6000, 3, false)).toThrow(/no spectral peaks/);
  });
});

describe('computeCommonFrequencies', () => {
  const events = [
    { eventNum: 1, peaks: [{ freq: 100, pct: 60 }, { freq: 300, pct: 40 }] },
    { eventNum: 2, peaks: [{ freq: 101, pct: 50 }, { freq: 300.5, pct: 30 }, { freq: 500, pct: 20 }] },
    { eventNum: 3, peaks: [{ freq: 99, pct: 70 }, { freq: 100.5, pct: 10 }] },
  ];

  it('groups peaks within tolerance and ranks by appearances, then avg %', () => {
    const res = computeCommonFrequencies(events, 2, 10);
    expect(res.map((r) => [Math.round(r.freq), r.appearances])).toEqual([[100, 3], [300, 2], [500, 1]]);
    // event 3 contributes only its stronger peak to the 100 Hz group
    expect(res[0].avgPct).toBeCloseTo(60, 12);
    expect(res[0].minHz).toBe(99);
    expect(res[0].maxHz).toBe(101);
  });

  it('honours topN and handles no peaks', () => {
    expect(computeCommonFrequencies(events, 2, 1)).toHaveLength(1);
    expect(computeCommonFrequencies([{ eventNum: 1, peaks: [] }], 2, 5)).toEqual([]);
  });
});
