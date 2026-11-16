import { describe, it, expect } from 'vitest';
import { toMono } from '../../src/core/mono.js';
import { applyHann, findAttackNear, findLoudestPeakForward } from '../../src/core/spectrum.js';
import { fakeAudioBuffer, tapRecording } from '../helpers/signals.js';

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

describe('findAttackNear', () => {
  const SR = 8000;
  const rec = tapRecording({ sr: SR, duration: 2, onsets: [0.5, 1.2] }); // noise 0.002, taps peak ~0.6
  const buf = fakeAudioBuffer(rec, SR);

  it('finds the attack within the radius', () => {
    const t = findAttackNear(buf, 0.53, 0.05);
    expect(t).not.toBeNull();
    expect(Math.abs(t - 0.5)).toBeLessThan(0.005);
    expect(Math.abs(findAttackNear(buf, 1.17, 0.05) - 1.2)).toBeLessThan(0.005);
  });

  it('returns null for background noise, silence, or an attack outside the radius', () => {
    expect(findAttackNear(buf, 0.25, 0.05)).toBeNull();                       // noise only
    expect(findAttackNear(buf, 0.40, 0.05)).toBeNull();                       // tap at 0.5 is 0.1 s away
    expect(findAttackNear(fakeAudioBuffer(new Float32Array(SR), SR), 0.5, 0.05)).toBeNull();
  });

  it('downmixes channels (opposite-phase samples cancel)', () => {
    const l = new Float32Array(1000), r = new Float32Array(1000);
    l[500] = 1; r[500] = -1; l[510] = 0.5; r[510] = 0.5;
    expect(findAttackNear(fakeAudioBuffer([l, r], 1000), 0.5, 0.02)).toBeCloseTo(0.51, 12);
  });
});
