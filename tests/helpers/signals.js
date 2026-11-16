// Deterministic synthetic test signals. Nothing here depends on src/.

// mulberry32: small, fast, seedable PRNG returning floats in [0, 1).
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sine(freq, sr, n, amp = 1, phase = 0) {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin(2 * Math.PI * freq * i / sr + phase);
  return out;
}

// A recording of `onsets` (seconds) taps. Each tap is a sum of exponentially
// decaying sines at `partials` ([{freq, amp}]), on top of low-level noise.
export function tapRecording({
  sr = 8000,
  duration = 4,
  onsets = [0.5, 1.5, 2.5],
  partials = [{ freq: 220, amp: 1 }, { freq: 440, amp: 0.5 }],
  decay = 25,          // 1/s
  noise = 0.002,
  seed = 1,
} = {}) {
  const n = Math.round(sr * duration);
  const out = new Float32Array(n);
  const rnd = seededRandom(seed);
  for (let i = 0; i < n; i++) out[i] = noise * (rnd() * 2 - 1);
  for (const t0 of onsets) {
    const i0 = Math.round(t0 * sr);
    for (let i = i0; i < n; i++) {
      const t = (i - i0) / sr;
      const env = Math.exp(-decay * t);
      if (env < 1e-5) break;
      let v = 0;
      for (const p of partials) v += p.amp * Math.sin(2 * Math.PI * p.freq * t);
      out[i] += 0.4 * env * v;
    }
  }
  return out;
}

// Minimal stand-in for a Web Audio AudioBuffer.
export function fakeAudioBuffer(channels, sampleRate) {
  const chans = Array.isArray(channels) ? channels : [channels];
  return {
    sampleRate,
    numberOfChannels: chans.length,
    length: chans[0].length,
    duration: chans[0].length / sampleRate,
    getChannelData: (c) => chans[c],
  };
}

// Plain-JSON form of results: typed arrays become arrays, numbers are
// rounded so golden files survive harmless floating-point noise.
export function toGolden(value, digits = 9) {
  const round = (x) => (Number.isFinite(x) ? Number(x.toPrecision(digits)) : x === null ? null : String(x));
  const walk = (v) => {
    if (typeof v === 'number') return round(v);
    if (ArrayBuffer.isView(v)) return Array.from(v, round);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value);
}
