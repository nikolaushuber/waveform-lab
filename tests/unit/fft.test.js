import { describe, it, expect } from 'vitest';
import { bluesteinDFT, fftInPlace, ifftInPlace } from '../../src/core/fft.js';
import { computeFftMagExact } from '../../src/core/spectrum.js';
import { seededRandom, sine } from '../helpers/signals.js';


function naiveDft(re, im, inverse = false) {
  const n = re.length, sign = inverse ? 1 : -1;
  const outRe = new Float64Array(n), outIm = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    for (let t = 0; t < n; t++) {
      const a = sign * 2 * Math.PI * k * t / n;
      outRe[k] += re[t] * Math.cos(a) - im[t] * Math.sin(a);
      outIm[k] += re[t] * Math.sin(a) + im[t] * Math.cos(a);
    }
    if (inverse) { outRe[k] /= n; outIm[k] /= n; }
  }
  return { re: outRe, im: outIm };
}

function randomComplex(n, seed) {
  const r = seededRandom(seed);
  return { re: Float64Array.from({ length: n }, () => r() * 2 - 1), im: Float64Array.from({ length: n }, () => r() * 2 - 1) };
}

function expectClose(actual, expected, tol = 1e-9) {
  expect(actual.length).toBe(expected.length);
  let maxErr = 0;
  for (let i = 0; i < actual.length; i++) maxErr = Math.max(maxErr, Math.abs(actual[i] - expected[i]));
  expect(maxErr).toBeLessThan(tol);
}

describe('fftInPlace / ifftInPlace', () => {
  it.each([2, 8, 64, 256])('matches a naive DFT for n=%i', (n) => {
    const x = randomComplex(n, n);
    const want = naiveDft(x.re, x.im);
    const re = x.re.slice(), im = x.im.slice();
    fftInPlace(re, im);
    expectClose(re, want.re);
    expectClose(im, want.im);
  });

  it('ifft(fft(x)) returns x', () => {
    const x = randomComplex(512, 7);
    const re = x.re.slice(), im = x.im.slice();
    fftInPlace(re, im);
    ifftInPlace(re, im);
    expectClose(re, x.re);
    expectClose(im, x.im);
  });
});

describe('bluesteinDFT', () => {
  it.each([3, 5, 12, 100, 257])('matches a naive DFT for non-power-of-two n=%i', (n) => {
    const x = randomComplex(n, n);
    const got = bluesteinDFT(x.re, x.im, false);
    const want = naiveDft(x.re, x.im);
    expectClose(got.re, want.re, 1e-8);
    expectClose(got.im, want.im, 1e-8);
  });

  it.each([7, 64, 100])('inverse matches a naive inverse DFT for n=%i', (n) => {
    const x = randomComplex(n, n + 1);
    const got = bluesteinDFT(x.re, x.im, true);
    const want = naiveDft(x.re, x.im, true);
    expectClose(got.re, want.re, 1e-10);
    expectClose(got.im, want.im, 1e-10);
  });

  it('does not modify its inputs', () => {
    const x = randomComplex(10, 3);
    const copy = { re: x.re.slice(), im: x.im.slice() };
    bluesteinDFT(x.re, x.im, false);
    expect(x).toEqual(copy);
  });
});

describe('computeFftMagExact', () => {
  it('returns single-sided amplitudes on the np.fft.rfftfreq grid', () => {
    const sr = 1000, n = 1000;
    const { freqs, mags, M } = computeFftMagExact(sine(100, sr, n, 0.8), sr);
    expect(M).toBe(n);
    expect(freqs.length).toBe(501);
    expect(freqs[1]).toBeCloseTo(1, 12);
    expect(mags[100]).toBeCloseTo(0.8, 9); // unwindowed bin-centred sine: amplitude A
  });
});
