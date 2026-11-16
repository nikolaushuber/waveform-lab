// The fixed synthetic "recordings" behind the golden files. Changing anything
// here changes the goldens, so treat these as frozen.
import { tapRecording, sine } from './signals.js';

export const SR = 8000;

// Two "materials" with different resonances, a few recordings each.
export const MATERIAL_A = [{ freq: 196, amp: 1 }, { freq: 523, amp: 0.5 }, { freq: 880, amp: 0.2 }];
export const MATERIAL_B = [{ freq: 311, amp: 1 }, { freq: 740, amp: 0.6 }];

export const recordings = [
  { name: 'a1.wav', samples: tapRecording({ sr: SR, duration: 5, onsets: [0.6, 1.4, 2.3, 3.1, 4.0], partials: MATERIAL_A, seed: 11 }) },
  { name: 'a2.wav', samples: tapRecording({ sr: SR, duration: 4, onsets: [0.5, 1.3, 2.2, 3.0], partials: MATERIAL_A, decay: 18, seed: 12 }) },
  { name: 'b1.wav', samples: tapRecording({ sr: SR, duration: 5, onsets: [0.7, 1.5, 2.4, 3.3, 4.1], partials: MATERIAL_B, seed: 13 }) },
  { name: 'b2.wav', samples: tapRecording({ sr: SR, duration: 4, onsets: [0.4, 1.2, 2.1, 2.9], partials: MATERIAL_B, decay: 30, seed: 14 }) },
];

// The defaults from the Tap Analyser's Advanced settings in index.html.
export const TAP_DEFAULTS = { numEvents: 10, minGap: 0.3, minFreq: 50, maxFreq: 1000, topNBasis: 10, tolerance: 2 };

// The defaults from the Clustering tab in index.html.
export const CLUSTER_DEFAULTS = { windowMs: 120, nEstimators: 500, minGapMs: 150, offsetSec: 0.005, fmax: 1500, nBins: 64, fmin: 20 };

export function chord(sr = 44100, seconds = 1) {
  const n = sr * seconds, out = new Float32Array(n);
  [[110, 0.5], [440, 0.25], [1250, 0.1], [3000, 0.02]].forEach(([f, a]) => sine(f, sr, n, a).forEach((v, i) => { out[i] += v; }));
  return out;
}
