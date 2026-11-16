"""Entry points called from the browser (src/engines/python-worker.js).

Every function takes (payload_json, sample_arrays): settings as one JSON
string (unambiguous null/None across the FFI) and a list of Float32Arrays
(JsProxy in Pyodide, any array-likes natively).
Results go back as JSON strings. Problems the user should see are returned
as {"error": message}; anything else raises.
"""
import json

import numpy as np

from . import clustering, tap


def _array(x):
    if hasattr(x, "to_py"):  # Pyodide JsProxy of a typed array -> memoryview
        x = x.to_py()
    return np.asarray(x, dtype=np.float32)


def run_tap_detection(payload_json, sample_arrays):
    """payload: {sr, skipStart, skipEnd, opts: {numEvents, minGap}} ->
    {cropStart, cropStartAuto, cropEnd, taps} (seconds)."""
    p = json.loads(payload_json)
    crop = {"skipStart": p.get("skipStart", ""), "skipEnd": p.get("skipEnd", "")}
    try:
        result = tap.detect(_array(sample_arrays[0]), p["sr"], crop, p["opts"])
    except tap.TapAnalysisError as e:
        result = {"error": str(e)}
    return json.dumps(result)


def run_tap_analysis(payload_json, sample_arrays):
    """payload: {sr, skipStart, skipEnd, opts: {numEvents, minGap, minFreq,
    maxFreq, topNBasis, tolerance, useEnergy}} plus optionally
    {taps, cropStart, cropEnd} (seconds) to analyse exactly those taps
    instead of detecting them; sample_arrays: [mono Float32Array]"""
    p = json.loads(payload_json)
    samples = _array(sample_arrays[0])
    try:
        if p.get("taps") is not None:
            result = tap.analyse_taps(samples, p["sr"], p["taps"], p["opts"],
                                      p.get("cropStart") or 0.0, p.get("cropEnd") or 0.0)
        else:
            crop = {"skipStart": p.get("skipStart", ""), "skipEnd": p.get("skipEnd", "")}
            result = tap.analyse_tap_samples(samples, p["sr"], crop, p["opts"])
    except tap.TapAnalysisError as e:
        result = {"error": str(e)}
    return json.dumps(result)


def run_clustering(payload_json, sample_arrays):
    """payload: {files: [{name, sr, cropStart, cropEnd}], windowMs,
    nEstimators, forceK, minGapMs, offsetMs, fmax}; sample_arrays: one
    mono Float32Array per file, same order."""
    p = json.loads(payload_json)
    files = [dict(f, samples=_array(s)) for f, s in zip(p["files"], sample_arrays)]
    result = clustering.run_clustering(
        files, window_ms=p["windowMs"], n_estimators=p["nEstimators"], force_k=p.get("forceK"),
        min_gap_ms=p["minGapMs"], offset_ms=p["offsetMs"], fmax=p["fmax"])
    return json.dumps(result)
