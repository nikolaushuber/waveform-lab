"""Frozen-output ("golden") files written by the Python tests.

Set UPDATE_GOLDEN=1 to (re)write them on purpose; otherwise results are
compared against the stored file with a small numeric tolerance (results can
differ in the last bits between native CPython and Pyodide/WebAssembly).
"""
import json
import math
import os

from fixtures import GOLDEN


def _round(v):
    if isinstance(v, float):
        return float(f"{v:.9g}") if math.isfinite(v) else str(v)
    if isinstance(v, dict):
        return {k: _round(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_round(x) for x in v]
    return v


def _close(a, b, path="$"):
    if isinstance(a, float) or isinstance(b, float):
        assert math.isclose(a, b, rel_tol=1e-7, abs_tol=1e-9), f"{path}: {a} != {b}"
    elif isinstance(a, dict):
        assert a.keys() == b.keys(), f"{path}: keys {sorted(a)} != {sorted(b)}"
        for k in a:
            _close(a[k], b[k], f"{path}.{k}")
    elif isinstance(a, list):
        assert len(a) == len(b), f"{path}: length {len(a)} != {len(b)}"
        for i, (x, y) in enumerate(zip(a, b)):
            _close(x, y, f"{path}[{i}]")
    else:
        assert a == b, f"{path}: {a!r} != {b!r}"


def match_golden(name, value):
    path = GOLDEN / f"{name}.json"
    value = _round(value)
    if os.environ.get("UPDATE_GOLDEN") or not path.exists():
        path.write_text(json.dumps(value, indent=1, ensure_ascii=False) + "\n")
        return
    _close(value, json.loads(path.read_text()))
