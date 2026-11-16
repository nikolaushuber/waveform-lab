"""The Python clustering against the JS engine's frozen outputs
(tests/golden/clustering.json) and its own frozen reference
(tests/golden/clustering-py.json)."""
import numpy as np
import pytest
from sklearn.metrics import adjusted_rand_score

from fixtures import CLUSTER_DEFAULTS as C, SR, load_golden, recordings
from snapshot import match_golden
from waveform_lab import clustering as cl

FILES = [{"name": n, "sr": SR, "samples": s, "cropStart": 0, "cropEnd": 0} for n, s in recordings()]
JS = load_golden("clustering")


@pytest.fixture(scope="module")
def features():
    return cl.extract_tap_features(FILES, window_ms=C["windowMs"], min_gap_ms=C["minGapMs"],
                                   offset_ms=C["offsetSec"] * 1000, fmax=C["fmax"])


def test_onsets_and_noise_match_js():
    for f in FILES:
        sig = np.asarray(f["samples"], dtype=np.float64)
        onsets = cl.detect_taps(sig, SR, min_gap_ms=C["minGapMs"])
        ref = JS["perFile"][f["name"]]
        assert onsets.tolist() == ref["onsets"]
        noise = cl.estimate_noise_spectrum(sig, SR, onsets, window_ms=C["windowMs"])
        np.testing.assert_allclose(noise, ref["noiseSpectrum"], rtol=1e-6, atol=1e-9)


def test_features_match_js(features):
    X, meta, warnings, sr_used = features
    assert meta == JS["meta"]
    assert warnings == [] and sr_used == SR
    np.testing.assert_allclose(X, JS["X"], rtol=1e-6, atol=1e-9)
    np.testing.assert_allclose(cl.get_bin_edges(SR, fmax=C["fmax"]), JS["edges"], rtol=1e-8)  # goldens keep 9 digits


def test_kmeans_matches_js(features):
    X = features[0]
    labels, k, scores = cl.kmeans_cluster(X)
    assert k == JS["kmeans"]["k"]
    assert adjusted_rand_score(labels, JS["kmeans"]["labels"]) == 1.0
    # Same silhouette for the chosen k. Scores for other k depend on which local
    # optimum each k-means run lands in, which legitimately differs from the JS port.
    best = dict(scores)[k]
    assert best == pytest.approx(max(s["score"] for s in JS["kmeans"]["scores"]), rel=1e-6)
    assert best == max(dict(scores).values())


def test_rf_separates_materials_like_js(features):
    X, meta = features[0], features[1]
    labels, importances = cl.rf_proximity_clustering(X, k=2, n_estimators=C["nEstimators"])
    # Different RNG from the JS port, so compare the partition, not the labels.
    assert adjusted_rand_score(labels, JS["rf"]["labels"]) == 1.0
    assert abs(importances.sum() - 1) < 1e-9


def test_run_clustering_golden():
    res = cl.run_clustering(FILES, window_ms=C["windowMs"], n_estimators=C["nEstimators"],
                            min_gap_ms=C["minGapMs"], offset_ms=C["offsetSec"] * 1000, fmax=C["fmax"])
    assert res["k"] == 2 and res["agreement"] == 1.0 and res["nTaps"] == len(JS["meta"])
    match_golden("clustering-py", res)


def test_run_clustering_errors():
    few = [dict(FILES[0], samples=FILES[0]["samples"][: SR * 2])]
    assert "Need at least 6" in cl.run_clustering(few)["error"]


def test_negative_offset_floors_like_js():
    sig = np.arange(100.0)
    # pre = floor(1000 * -2.5 / 1000) = -3 -> window starts 3 samples after the onset
    assert cl.extract_window(sig, 1000, 10, window_ms=4, pre_ms=-2.5).tolist() == [13, 14, 15, 16]
