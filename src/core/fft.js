// ---------------- FFT (radix-2 Cooley-Tukey, in place) ----------------
export function fftInPlace(re, im){
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++){
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j){
      [re[i],re[j]] = [re[j],re[i]];
      [im[i],im[j]] = [im[j],im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1){
    const ang = -2*Math.PI/len;
    const wr0 = Math.cos(ang), wi0 = Math.sin(ang);
    for (let i = 0; i < n; i += len){
      let curWr = 1, curWi = 0;
      for (let j = 0; j < len/2; j++){
        const ur = re[i+j], ui = im[i+j];
        const vr = re[i+j+len/2]*curWr - im[i+j+len/2]*curWi;
        const vi = re[i+j+len/2]*curWi + im[i+j+len/2]*curWr;
        re[i+j] = ur+vr; im[i+j] = ui+vi;
        re[i+j+len/2] = ur-vr; im[i+j+len/2] = ui-vi;
        const nwr = curWr*wr0 - curWi*wi0;
        const nwi = curWr*wi0 + curWi*wr0;
        curWr = nwr; curWi = nwi;
      }
    }
  }
}

export function nextPow2(n){ let p = 1; while (p < n) p <<= 1; return p; }

export function ifftInPlace(re, im){
  const n = re.length;
  for (let i = 0; i < n; i++) im[i] = -im[i];
  fftInPlace(re, im);
  for (let i = 0; i < n; i++){ re[i] = re[i]/n; im[i] = -im[i]/n; }
}

// Arbitrary-length DFT via Bluestein's algorithm (chirp z-transform), built
// on the power-of-2 fftInPlace/ifftInPlace above. Needed because the Hilbert
// transform (used for the envelope) is a broadband, all-pass phase operation
// tied to the *exact* signal length — unlike a plain magnitude spectrum,
// zero-padding it before the FFT changes the result almost everywhere, not
// just at the edges. scipy.signal.hilbert(x) uses N = len(x) exactly, so we
// need to do the same instead of rounding up to the next power of 2.
export function bluesteinDFT(reIn, imIn, inverse){
  const n = reIn.length;
  if ((n & (n-1)) === 0){
    // already a power of 2 (or 0/1) — use the fast path directly
    const re = Float64Array.from(reIn), im = Float64Array.from(imIn);
    if (n > 1){ if (inverse) ifftInPlace(re, im); else fftInPlace(re, im); }
    return { re, im };
  }

  const sign = inverse ? 1 : -1; // exp(sign * i*pi*k^2/n)
  const cosT = new Float64Array(n), sinT = new Float64Array(n);
  for (let k = 0; k < n; k++){
    const kk = (k*k) % (2*n); // keep the argument small for float precision
    const ang = sign * Math.PI * kk / n;
    cosT[k] = Math.cos(ang);
    sinT[k] = Math.sin(ang);
  }

  const M = nextPow2(2*n - 1);
  const aRe = new Float64Array(M), aIm = new Float64Array(M);
  for (let k = 0; k < n; k++){
    aRe[k] = reIn[k]*cosT[k] - imIn[k]*sinT[k];
    aIm[k] = reIn[k]*sinT[k] + imIn[k]*cosT[k];
  }

  const bRe = new Float64Array(M), bIm = new Float64Array(M);
  bRe[0] = cosT[0]; bIm[0] = -sinT[0];
  for (let k = 1; k < n; k++){
    bRe[k] = cosT[k]; bIm[k] = -sinT[k];
    bRe[M-k] = cosT[k]; bIm[M-k] = -sinT[k];
  }

  fftInPlace(aRe, aIm);
  fftInPlace(bRe, bIm);
  for (let k = 0; k < M; k++){
    const r = aRe[k]*bRe[k] - aIm[k]*bIm[k];
    const i = aRe[k]*bIm[k] + aIm[k]*bRe[k];
    aRe[k] = r; aIm[k] = i;
  }
  ifftInPlace(aRe, aIm);

  const outRe = new Float64Array(n), outIm = new Float64Array(n);
  for (let k = 0; k < n; k++){
    outRe[k] = aRe[k]*cosT[k] - aIm[k]*sinT[k];
    outIm[k] = aRe[k]*sinT[k] + aIm[k]*cosT[k];
  }
  if (inverse){
    for (let k = 0; k < n; k++){ outRe[k] /= n; outIm[k] /= n; }
  }
  return { re: outRe, im: outIm };
}

// ---------------- Clustering DSP/ML (client-side port of random_forest.py) ----------------
// Every function below was ported from random_forest.py and cross-checked
// numerically against the real Python (numpy/scipy/scikit-learn) pipeline
// before being wired in here — see the standalone validation scripts used
// during development for the exact diffs. Uses the fftInPlace/ifftInPlace/
// bluesteinDFT/nextPow2 already defined above.

// rfft magnitude spectrum matching np.fft.rfft(x) magnitude bin-for-bin
export function rfftMag(signal){
  const n = signal.length;
  const re = Float64Array.from(signal);
  const im = new Float64Array(n);
  const { re: outRe, im: outIm } = bluesteinDFT(re, im, false);
  const half = Math.floor(n/2) + 1;
  const mag = new Float64Array(half);
  for (let k = 0; k < half; k++) mag[k] = Math.hypot(outRe[k], outIm[k]);
  return mag;
}
