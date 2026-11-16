import { describe, it, expect } from 'vitest';
import { loadLegacy } from '../helpers/load-legacy.js';
import { sine, fakeAudioBuffer } from '../helpers/signals.js';

const wl = loadLegacy();

describe('computeSpectrumAt', () => {
  const sr = 44100;
  const tone = Float32Array.from(sine(440, sr, sr, 0.5));

  it('peaks at the tone, with Hann-windowed amplitude and correct rms', () => {
    const cap = wl.computeSpectrumAt(fakeAudioBuffer(tone, sr), 0.5);
    expect(cap).toMatchObject({ N: 65536, M: 4096, sampleRate: sr, time: 0.5 });
    expect(cap.freqs).toHaveLength(32768);
    expect(Math.abs(cap.peaks[0].freq - 440)).toBeLessThan(sr / 65536);
    expect(cap.peaks[0].mag).toBeCloseTo(0.25, 2); // A * Hann coherent gain (0.5)
    expect(cap.rms).toBeCloseTo(0.5 / Math.SQRT2, 2);
  });

  it('downmixes stereo and zero-pads beyond the file edges', () => {
    const cap = wl.computeSpectrumAt(fakeAudioBuffer([tone, new Float32Array(sr)], sr), 0);
    expect(Math.abs(cap.peaks[0].freq - 440)).toBeLessThan(2);
    expect(cap.rms).toBeCloseTo(0.25 / Math.SQRT2, 2);
  });
});

describe('graph helpers', () => {
  it('autoDbRange hugs the data and never collapses below 20 dB', () => {
    expect(wl.autoDbRange([-50, -20])).toEqual({ dbMin: -60, dbMax: -10 });
    expect(wl.autoDbRange([-30, -29])).toEqual({ dbMin: -40, dbMax: -20 });
    expect(wl.autoDbRange([NaN, -Infinity])).toEqual({ dbMin: -90, dbMax: 0 });
    expect(wl.autoDbRange([-200, 30])).toEqual({ dbMin: -120, dbMax: 6 });
  });

  it('octaveAverage averages over a fractional-octave window', () => {
    const v = Float64Array.from({ length: 100 }, (_, i) => i);
    expect(wl.octaveAverage(v, 1, 0, 1)).toBe(0);
    expect(wl.octaveAverage(v, 1, 40, 1)).toBeCloseTo((28 + 57) / 2, 12); // 40/√2..40·√2 → 28..57
  });

  it('freqToX / xToFreq are inverses on linear and log axes, and ticks follow the mode', () => {
    for (const mode of ['linear', 'log']) {
      wl.setScaleMode(mode);
      wl.setFreqRange(50, 1000);
      for (const f of [50, 123, 700, 1000]) expect(wl.xToFreq(wl.freqToX(f, 800), 800)).toBeCloseTo(f, 9);
      expect(wl.freqToX(10, 800)).toBe(0);
      expect(wl.freqToX(5000, 800)).toBeCloseTo(800, 9);
    }
    expect(wl.computeFreqTicks()).toEqual([50, 100, 200, 500, 1000]);
    wl.setScaleMode('linear');
    expect(wl.computeFreqTicks()).toEqual([50, 208, 367, 525, 683, 842, 1000]);
  });
});
