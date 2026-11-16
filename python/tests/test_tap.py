"""The Python Tap Analyser against the JS implementation's frozen outputs
(tests/golden/tap-analysis-*.json), plus known-answer checks ported from
the JS unit tests."""
import math

import numpy as np
import pytest

from fixtures import SR, TAP_DEFAULTS, load_golden, recordings, tap_recording
from waveform_lab import tap


@pytest.mark.parametrize("metric", ["amplitude", "energy"])
def test_matches_js_golden(metric):
    golden = load_golden(f"tap-analysis-{metric}")
    opts = dict(TAP_DEFAULTS, useEnergy=metric == "energy")
    for name, samples in recordings():
        got = tap.analyse_tap_samples(samples, SR, {"skipStart": "", "skipEnd": ""}, opts)
        ref = golden[name]
        assert got["detectedEvents"] == ref["detectedEvents"], name
        assert got["eventCount"] == ref["eventCount"], name
        assert len(got["freqSummary"]) == len(ref["freqSummary"]), name
        for g, r in zip(got["freqSummary"], ref["freqSummary"]):
            assert g["appearances"] == r["appearances"], name
            for key in ("freq", "avgPct", "stdHz", "stdPct", "minPct", "maxPct", "minHz", "maxHz"):
                assert g[key] == pytest.approx(r[key], rel=1e-6, abs=1e-6), f"{name} {key}"


def test_js_round_and_parse_float():
    assert [tap.js_round(x) for x in (0.5, 1.5, 2.5, -0.5, 2.4)] == [1, 2, 3, 0, 2]
    assert tap.js_parse_float(" 1.5s") == 1.5
    assert math.isnan(tap.js_parse_float("abc"))


def test_smooth_moving_avg():
    assert tap.smooth_moving_avg(np.array([0, 0, 3, 0, 0.0]), 3).tolist() == [0, 1, 1, 1, 0]


@pytest.mark.parametrize("n", [1000, 1001])
def test_envelope_of_steady_sine_is_its_amplitude(n):
    sig = 0.7 * np.sin(2 * np.pi * 50 * np.arange(n) / 1000)
    env = tap.envelope(sig, 1)
    np.testing.assert_allclose(env[100:-100], 0.7, atol=5e-3)


def test_detect_tap_events_finds_planted_taps():
    onsets = [0.5, 1.2, 2.0, 2.9]
    rec = tap_recording(sr=SR, onsets=onsets, duration=3.5).astype(np.float64)
    idx = tap.detect_tap_events(rec, SR, 10, 0.3, 0)
    assert len(idx) == 4
    assert all(abs(p / SR - t) < 0.01 for p, t in zip(idx, onsets))
    assert len(tap.detect_tap_events(rec, SR, 2, 0.3, 0)) == 2
    with pytest.raises(tap.TapAnalysisError, match="not enough audio"):
        tap.detect_tap_events(rec, SR, 10, 0.3, 3.5)
    with pytest.raises(tap.TapAnalysisError, match="no tap/pluck"):
        tap.detect_tap_events(np.zeros(4000), SR, 10, 0.3, 0)


def test_auto_detect_skip_start_cuts_after_leading_noise():
    rec = tap_recording(sr=SR, onsets=(2.2, 2.8, 3.4), duration=4).astype(np.float64)
    rec[: int(0.6 * SR)] += 0.3 * np.sin(np.arange(int(0.6 * SR)) * 0.37)
    assert 0.6 < tap.auto_detect_skip_start(rec, SR) < 2.0


def test_peak_helpers():
    freqs = np.arange(7.0)
    assert tap.measure_peak_bandwidth_hz(np.array([0, 0, 0.5, 1, 0.5, 0, 0]), freqs, 3) == pytest.approx(2)
    f = tap.interpolate_peak_freq(np.array([0, 10, 20, 30.0]), np.array([0.1, 0.5, 1, 0.9]), 2)
    assert 20 < f < 30


def test_top_peaks_and_common_frequencies():
    sr = n = 2000
    t = np.arange(n) / sr
    sig = sum(a * np.sin(2 * np.pi * f * t) for f, a in [(150, 1), (400, 0.6), (700, 0.3)])
    freqs, mags = tap.fft_mag_exact(tap.apply_hann(sig), sr)
    for use_energy in (False, True):
        pct = tap.top_peaks_pct(freqs, mags, 3, 50, 1000, 3, use_energy)
        assert sum(p["pct"] for p in pct) == pytest.approx(100)
        assert round(pct[0]["freq"]) == 150

    events = [
        {"eventNum": 1, "peaks": [{"freq": 100, "pct": 60}, {"freq": 300, "pct": 40}]},
        {"eventNum": 2, "peaks": [{"freq": 101, "pct": 50}, {"freq": 300.5, "pct": 30}, {"freq": 500, "pct": 20}]},
        {"eventNum": 3, "peaks": [{"freq": 99, "pct": 70}, {"freq": 100.5, "pct": 10}]},
    ]
    res = tap.common_frequencies(events, 2, 10)
    assert [(round(r["freq"]), r["appearances"]) for r in res] == [(100, 3), (300, 2), (500, 1)]
    assert res[0]["avgPct"] == pytest.approx(60)


def test_crop_end_and_errors():
    opts = dict(TAP_DEFAULTS, useEnergy=False)
    rec = tap_recording(sr=SR, onsets=(0.5, 1.5, 2.5, 3.5), duration=5)
    assert tap.analyse_tap_samples(rec, SR, {"skipStart": "0", "skipEnd": "2"}, opts)["detectedEvents"] == 3
    with pytest.raises(tap.TapAnalysisError):
        tap.analyse_tap_samples(np.zeros(8000, np.float32), SR, {"skipStart": "0", "skipEnd": ""}, opts)


# ---------------- detection / analysis split (tap editor) ----------------

OPTS = dict(TAP_DEFAULTS, useEnergy=False)


def test_detect_then_analyse_equals_pipeline():
    for name, samples in recordings():
        crop = {"skipStart": "", "skipEnd": ""}
        found = tap.detect(samples, SR, crop, OPTS)
        assert found["cropStartAuto"] is True and found["cropEnd"] == 0
        via_split = tap.analyse_taps(samples, SR, found["taps"], OPTS, found["cropStart"], found["cropEnd"])
        assert via_split == tap.analyse_tap_samples(samples, SR, crop, OPTS), name


def test_detect_reports_manual_crop():
    _, samples = recordings()[0]
    found = tap.detect(samples, SR, {"skipStart": "1.0", "skipEnd": "0.5"}, OPTS)
    assert found["cropStartAuto"] is False
    assert found["cropStart"] == 1.0 and found["cropEnd"] == 0.5
    assert all(1.0 <= t < len(samples) / SR - 0.5 for t in found["taps"])


def test_analyse_taps_uses_exactly_the_given_taps():
    _, samples = recordings()[0]
    taps = tap.detect(samples, SR, {"skipStart": "0", "skipEnd": ""}, OPTS)["taps"]
    assert len(taps) == 5
    assert tap.analyse_taps(samples, SR, taps[:3], OPTS)["detectedEvents"] == 3
    # Outside the crop (before Crop Start / after the Crop End trim) is ignored.
    res = tap.analyse_taps(samples, SR, taps, OPTS, crop_start_sec=taps[1] - 0.01, crop_end_sec=len(samples) / SR - taps[3] + 0.01)  # keeps taps[1], taps[2]
    assert res["detectedEvents"] == 2
    with pytest.raises(tap.TapAnalysisError, match="no taps inside"):
        tap.analyse_taps(samples, SR, [100.0], OPTS)
