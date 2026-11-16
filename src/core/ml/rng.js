// ---- ML utilities shared by KMeans + Random Forest below ----

// Deterministic, seedable PRNG (mulberry32). Not bit-compatible with numpy's
// Mersenne Twister — sklearn's exact random_state sequence can't be
// reproduced from JS — but fully reproducible run-to-run, which is what
// matters for a stable UI.
export function makeRng(seed){
  let a = seed >>> 0;
  return function(){
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
