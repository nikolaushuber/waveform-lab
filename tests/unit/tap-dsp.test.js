import { describe, it, expect } from 'vitest';
import { applyHann, computeEnvelopeHilbert, smoothMovingAvg } from '../../src/core/signal.js';
import { findLoudestPeakForward } from '../../src/core/spectrum.js';
import { analyseTapFile } from '../../src/core/tap/analyse.js';
import { autoDetectSkipStart, detectTapEvents, extractEventWindow } from '../../src/core/tap/detect.js';
import { sine, tapRecording, fakeAudioBuffer } from '../helpers/signals.js';

const SR = 8000;

describe('envelope helpers', () => {
  it('smoothMovingAvg is a centred box filter shrinking at the edges', () => {
    expect(Array.from(smoothMovingAvg([0, 0, 3, 0, 0], 3))).toEqual([0, 1, 1, 1, 0]);
    expect(Array.from(smoothMovingAvg([1, 2, 3], 1))).toEqual([1, 2, 3]);
  });

  it('computeEnvelopeHilbert of a steady sine is its amplitude (away from the edges)', () => {
    for (const n of [1000, 1001]) {
      const env = computeEnvelopeHilbert(sine(50, 1000, n, 0.7), 1);
      for (let i = 100; i < n - 100; i += 37) expect(env[i]).toBeCloseTo(0.7, 2);
    }
  });

  it('applyHann tapers to zero at both ends and leaves length-1 input alone', () => {
    const w = applyHann(new Float64Array(5).fill(1));
    expect(Array.from(w)).toEqual([0, 0.5, 1, 0.5, 0].map((v) => expect.closeTo(v, 12)));
    expect(Array.from(applyHann([3]))).toEqual([3]);
  });
});

describe('detectTapEvents', () => {
  const onsets = [0.5, 1.2, 2.0, 2.9];
  const rec = tapRecording({ sr: SR, onsets, duration: 3.5 });

  it('finds every planted tap, in time order, near its attack', () => {
    const idx = detectTapEvents(rec, SR, 10, 0.3, 0);
    expect(idx).toHaveLength(onsets.length);
    idx.forEach((p, i) => expect(Math.abs(p / SR - onsets[i])).toBeLessThan(0.01));
  });

  it('keeps only the N strongest when asked for fewer', () => {
    expect(detectTapEvents(rec, SR, 2, 0.3, 0)).toHaveLength(2);
  });

  it('ignores audio before Crop Start', () => {
    const idx = detectTapEvents(rec, SR, 10, 0.3, 1.0);
    expect(idx.map((p) => Math.round(p / SR * 10) / 10)).toEqual([1.2, 2.0, 2.9]);
  });

  it('throws on too-short or silent input', () => {
    expect(() => detectTapEvents(rec, SR, 10, 0.3, 3.5)).toThrow(/not enough audio/);
    expect(() => detectTapEvents(new Float32Array(4000), SR, 10, 0.3, 0)).toThrow(/no tap\/pluck/);
  });
});

describe('autoDetectSkipStart', () => {
  it('cuts inside the quiet stretch after leading noise', () => {
    const rec = tapRecording({ sr: SR, onsets: [2.2, 2.8, 3.4], duration: 4 });
    for (let i = 0; i < 0.6 * SR; i++) rec[i] += 0.3 * Math.sin(i * 0.37); // "speech" at the start
    const cut = autoDetectSkipStart(rec, SR);
    expect(cut).toBeGreaterThan(0.6);
    expect(cut).toBeLessThan(2.0);
  });
});

describe('extractEventWindow', () => {
  it('slices offset..offset+duration and throws past the end', () => {
    const s = Float32Array.from({ length: 100 }, (_, i) => i);
    expect(Array.from(extractEventWindow(s, 10, 20, 0.5, 1))).toEqual([25, 26, 27, 28, 29, 30, 31, 32, 33, 34]);
    expect(extractEventWindow(s, 10, 90, 0, 5)).toHaveLength(10);
    expect(() => extractEventWindow(s, 10, 99, 1, 1)).toThrow(/exceeds file length/);
  });
});

describe('findLoudestPeakForward', () => {
  it('returns the time of the largest |sample| in the window, downmixing channels', () => {
    const a = new Float32Array(100), b = new Float32Array(100);
    a[30] = 0.5; b[30] = 0.5; a[60] = 0.9; b[60] = -0.9; // ch-mean at 60 cancels out
    expect(findLoudestPeakForward(fakeAudioBuffer([a, b], 100), 0.1, 0.8)).toBeCloseTo(0.3, 12);
  });
});

describe('analyseTapFile', () => {
  const opts = { numEvents: 10, minGap: 0.3, minFreq: 50, maxFreq: 1000, topNBasis: 10, tolerance: 2, useEnergy: false };

  it('reports the planted partials as the most common frequencies', async () => {
    const rec = tapRecording({ sr: SR, onsets: [0.5, 1.5, 2.5, 3.5], duration: 5, partials: [{ freq: 196, amp: 1 }, { freq: 523, amp: 0.6 }] });
    const res = await analyseTapFile({ name: 'a.wav', audioBuffer: fakeAudioBuffer(rec, SR), skipStart: '0', skipEnd: '' }, opts);
    expect(res).toMatchObject({ label: 'a.wav', eventCount: 4, detectedEvents: 4 });
    const top = res.freqSummary.slice(0, 2).map((s) => Math.round(s.freq)).sort((x, y) => x - y);
    expect(top).toEqual([196, 523]);
    expect(res.freqSummary[0].appearances).toBe(4);
  });

  it('honours Crop End (seconds trimmed off the end)', async () => {
    const rec = tapRecording({ sr: SR, onsets: [0.5, 1.5, 2.5, 3.5], duration: 5 });
    const res = await analyseTapFile({ name: 'b.wav', audioBuffer: fakeAudioBuffer(rec, SR), skipStart: '0', skipEnd: '2' }, opts);
    expect(res.detectedEvents).toBe(3);
  });
});
