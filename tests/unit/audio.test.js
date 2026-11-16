import { describe, it, expect } from 'vitest';
import { toMono } from '../../src/core/mono.js';
import { applyHann, findLoudestPeakForward } from '../../src/core/spectrum.js';
import { fakeAudioBuffer } from '../helpers/signals.js';

describe('toMono', () => {
  it('averages channels and copies mono input', () => {
    const a = Float32Array.from([1, 2]), b = Float32Array.from([3, 6]);
    expect(Array.from(toMono(fakeAudioBuffer([a, b], 10)))).toEqual([2, 4]);
    const m = toMono(fakeAudioBuffer(a, 10));
    expect(Array.from(m)).toEqual([1, 2]);
    expect(m).not.toBe(a);
  });
});

describe('applyHann', () => {
  it('tapers to zero at both ends and leaves length-1 input alone', () => {
    const w = applyHann(new Float64Array(5).fill(1));
    expect(Array.from(w)).toEqual([0, 0.5, 1, 0.5, 0].map((v) => expect.closeTo(v, 12)));
    expect(Array.from(applyHann([3]))).toEqual([3]);
  });
});

describe('findLoudestPeakForward', () => {
  it('returns the time of the largest |sample| in the window, downmixing channels', () => {
    const a = new Float32Array(100), b = new Float32Array(100);
    a[30] = 0.5; b[30] = 0.5; a[60] = 0.9; b[60] = -0.9; // ch-mean at 60 cancels out
    expect(findLoudestPeakForward(fakeAudioBuffer([a, b], 100), 0.1, 0.8)).toBeCloseTo(0.3, 12);
  });
});
