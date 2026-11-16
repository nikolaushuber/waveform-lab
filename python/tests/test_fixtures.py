import numpy as np

from fixtures import load_golden, recordings, seeded_random


def test_prng_matches_js():
    g = load_golden("fixtures")
    rnd = seeded_random(42)
    assert [rnd() for _ in range(5)] == g["prng42"]


def test_recordings_match_js():
    g = load_golden("fixtures")["recordings"]
    for name, samples in recordings():
        ref = g[name]
        assert len(samples) == ref["length"]
        idx = np.arange(0, len(samples), 997)
        np.testing.assert_allclose(samples[idx], ref["every997"], rtol=0, atol=1e-7)
        assert abs(float(np.sum(samples, dtype=np.float64)) - ref["sum"]) < 1e-6
