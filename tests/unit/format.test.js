import { describe, it, expect } from 'vitest';
import { nextPow2 } from '../../src/core/fft.js';
import { parseWavHeader } from '../../src/core/wav.js';
import { fmtBytes, fmtHz, fmtTime, sortByName } from '../../src/ui/format.js';
import { encodeWav } from '../helpers/wav.js';


describe('formatting helpers', () => {
  it('fmtTime renders m:ss.mmm and clamps bad input to zero', () => {
    expect(fmtTime(0)).toBe('0:00.000');
    expect(fmtTime(61.5)).toBe('1:01.500');
    expect(fmtTime(-3)).toBe('0:00.000');
    expect(fmtTime(NaN)).toBe('0:00.000');
  });

  it('fmtBytes picks B / KB / MB', () => {
    expect(fmtBytes(512)).toBe('512 B');
    expect(fmtBytes(2048)).toBe('2.0 KB');
    expect(fmtBytes(3 * 1024 * 1024)).toBe('3.00 MB');
  });

  it('fmtHz switches to kHz at 1000', () => {
    expect(fmtHz(440)).toBe('440.0 Hz');
    expect(fmtHz(1500)).toBe('1.50 kHz');
  });

  it('sortByName sorts naturally and case-insensitively', () => {
    const arr = [{ name: 'tap10' }, { name: 'Tap2' }, { name: 'tap1' }];
    sortByName(arr);
    expect(arr.map((x) => x.name)).toEqual(['tap1', 'Tap2', 'tap10']);
  });

  it('nextPow2', () => {
    expect([1, 2, 3, 1000, 1024, 1025].map(nextPow2)).toEqual([1, 2, 4, 1024, 1024, 2048]);
  });
});

describe('parseWavHeader', () => {
  it('reads the fmt chunk of a mono file', () => {
    const fmt = parseWavHeader(encodeWav(new Float32Array(10), 44100));
    expect(fmt).toEqual({ audioFormat: 1, numChannels: 1, sampleRate: 44100, byteRate: 88200, blockAlign: 2, bitsPerSample: 16 });
  });

  it('skips chunks before fmt (including odd-sized padding)', () => {
    const buf = encodeWav([new Float32Array(4), new Float32Array(4)], 48000, { extraChunk: { id: 'LIST', data: [1, 2, 3] } });
    expect(parseWavHeader(buf)).toMatchObject({ numChannels: 2, sampleRate: 48000, blockAlign: 4 });
  });

  it('returns null for non-RIFF data and for truncated buffers', () => {
    expect(parseWavHeader(new ArrayBuffer(64))).toBeNull();
    expect(parseWavHeader(new ArrayBuffer(2))).toBeNull();
  });
});
