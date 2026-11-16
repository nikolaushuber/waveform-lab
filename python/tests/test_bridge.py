import json

from sklearn.metrics import adjusted_rand_score

from fixtures import CLUSTER_DEFAULTS as C, SR, TAP_DEFAULTS, load_golden, recordings
from waveform_lab import bridge


def test_run_tap_analysis_round_trip():
    name, samples = recordings()[0]
    payload = {"sr": SR, "skipStart": "", "skipEnd": "", "opts": dict(TAP_DEFAULTS, useEnergy=False)}
    res = json.loads(bridge.run_tap_analysis(json.dumps(payload), [samples]))
    assert res["detectedEvents"] == load_golden("tap-analysis-amplitude")[name]["detectedEvents"]


def test_run_tap_analysis_reports_user_errors():
    payload = {"sr": SR, "skipStart": "0", "skipEnd": "", "opts": dict(TAP_DEFAULTS, useEnergy=False)}
    res = json.loads(bridge.run_tap_analysis(json.dumps(payload), [[0.0] * 8000]))
    assert "error" in res


def test_run_clustering_round_trip():
    recs = recordings()
    payload = {"files": [{"name": n, "sr": SR, "cropStart": 0, "cropEnd": 0} for n, _ in recs],
               "windowMs": C["windowMs"], "nEstimators": C["nEstimators"], "forceK": None,
               "minGapMs": C["minGapMs"], "offsetMs": C["offsetSec"] * 1000, "fmax": C["fmax"]}
    res = json.loads(bridge.run_clustering(json.dumps(payload), [s for _, s in recs]))
    assert res["k"] == 2
    assert adjusted_rand_score(res["rfLabels"], load_golden("clustering-py")["rfLabels"]) == 1.0
