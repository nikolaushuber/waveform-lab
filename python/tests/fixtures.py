"""Python port of tests/helpers/signals.js + fixtures.js.

Generates the same synthetic recordings as the JS tests (same PRNG, same
float32 rounding, same operation order), so the golden files under
tests/golden/ apply to both. test_fixtures.py checks this.
"""
import json
import math
from pathlib import Path

import numpy as np

GOLDEN = Path(__file__).resolve().parents[2] / "tests" / "golden"
SR = 8000

MATERIAL_A = [(196, 1.0), (523, 0.5), (880, 0.2)]
MATERIAL_B = [(311, 1.0), (740, 0.6)]

TAP_DEFAULTS = dict(numEvents=10, minGap=0.3, minFreq=50, maxFreq=1000, topNBasis=10, tolerance=2)
CLUSTER_DEFAULTS = dict(windowMs=120, nEstimators=500, minGapMs=150, offsetSec=0.005, fmax=1500, nBins=64, fmin=20)


def seeded_random(seed):
    """mulberry32, bit-identical to the JS version (uint32 arithmetic)."""
    a = seed & 0xFFFFFFFF
    M = 0xFFFFFFFF

    def imul(x, y):
        return (x * y) & M

    def rnd():
        nonlocal a
        a = (a + 0x6D2B79F5) & M
        t = imul(a ^ (a >> 15), 1 | a)
        t = ((t + imul(t ^ (t >> 7), 61 | t)) & M) ^ t
        return ((t ^ (t >> 14)) & M) / 4294967296

    return rnd


def tap_recording(sr=8000, duration=4, onsets=(0.5, 1.5, 2.5),
                  partials=((220, 1.0), (440, 0.5)), decay=25, noise=0.002, seed=1):
    n = round(sr * duration)
    rnd = seeded_random(seed)
    out = np.array([noise * (rnd() * 2 - 1) for _ in range(n)], dtype=np.float32)
    for t0 in onsets:
        i0 = round(t0 * sr)
        t = (np.arange(i0, n) - i0) / sr
        env = np.exp(-decay * t)
        keep = int(np.argmax(env < 1e-5)) if (env < 1e-5).any() else len(env)
        t, env = t[:keep], env[:keep]
        v = np.zeros_like(t)
        for freq, amp in partials:
            v = v + amp * np.sin(2 * math.pi * freq * t)
        seg = out[i0:i0 + keep].astype(np.float64) + 0.4 * env * v
        out[i0:i0 + keep] = seg.astype(np.float32)
    return out


RECORDINGS = [
    ("a1.wav", dict(duration=5, onsets=(0.6, 1.4, 2.3, 3.1, 4.0), partials=MATERIAL_A, seed=11)),
    ("a2.wav", dict(duration=4, onsets=(0.5, 1.3, 2.2, 3.0), partials=MATERIAL_A, decay=18, seed=12)),
    ("b1.wav", dict(duration=5, onsets=(0.7, 1.5, 2.4, 3.3, 4.1), partials=MATERIAL_B, seed=13)),
    ("b2.wav", dict(duration=4, onsets=(0.4, 1.2, 2.1, 2.9), partials=MATERIAL_B, decay=30, seed=14)),
]


def recordings():
    return [(name, tap_recording(sr=SR, **kw)) for name, kw in RECORDINGS]


def load_golden(name):
    return json.loads((GOLDEN / f"{name}.json").read_text())
