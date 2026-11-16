"""Tap Analyser: find each tap/pluck in a recording, FFT it, and report the
frequencies that recur most consistently across taps.

Port of the app's former JavaScript implementation (src/core/tap/*,
src/core/signal.js), itself a port of multi_variance.py / tap_scatter.py /
multi_energy.py. Outputs are checked against tests/golden/tap-analysis-*.json.

Rounding follows JavaScript's Math.round (half up), not Python's round().
"""
import math
import re
import warnings

import numpy as np
from scipy.signal import hilbert, peak_prominences


class TapAnalysisError(ValueError):
    """A problem with the input the UI should show as-is."""


def js_round(x):
    return math.floor(x + 0.5)


def js_parse_float(text):
    """JavaScript parseFloat(): leading number of a string, else NaN."""
    m = re.match(r"\s*[+-]?(\d+\.?\d*(e[+-]?\d+)?|\.\d+(e[+-]?\d+)?|Infinity)", text or "", re.I)
    return float(m.group(0)) if m else math.nan


# ---------------- envelope ----------------

def smooth_moving_avg(arr, win):
    """Centred box filter whose window shrinks at the edges."""
    win = max(1, int(win))
    n = len(arr)
    prefix = np.concatenate(([0.0], np.cumsum(arr)))
    i = np.arange(n)
    lo0 = i - win // 2
    hi = np.minimum(lo0 + win, n)
    lo = np.maximum(lo0, 0)
    return (prefix[hi] - prefix[lo]) / np.maximum(1, hi - lo)


def envelope(samples, smooth_samples):
    """Amplitude envelope (|analytic signal|, exact length like
    scipy.signal.hilbert), then smoothed."""
    return smooth_moving_avg(np.abs(hilbert(samples)), smooth_samples)


def auto_detect_skip_start(samples, sr):
    """Where leading speech/noise ends: midpoint of the longest quiet run
    in the first half of the recording (seconds)."""
    env = envelope(samples, max(1, js_round(sr * 50 / 1000)))
    first_half = env[: len(env) // 2]
    if not len(first_half):
        return 0.0
    threshold = np.sort(first_half)[math.floor(0.25 * (len(first_half) - 1))]
    quiet = np.concatenate(([False], first_half < threshold, [False])).astype(np.int8)
    edges = np.diff(quiet)
    starts, ends = np.flatnonzero(edges == 1), np.flatnonzero(edges == -1)
    if not len(starts):
        return 0.0
    lengths = ends - starts
    best = int(np.argmax(lengths))  # first of the longest runs
    return (starts[best] + lengths[best] // 2) / sr


# ---------------- event detection ----------------

def detect_tap_events(samples, sr, num_events, min_gap_sec, skip_start_sec):
    """Sample indices of the strongest `num_events` taps after Crop Start, in
    time order, each moved to its loudest sample within -10..+30 ms."""
    skip = max(0, js_round(skip_start_sec * sr))
    region = samples[min(skip, len(samples)):]
    if len(region) < 32:
        raise TapAnalysisError("not enough audio after Crop Start")

    env = envelope(region, max(1, js_round(sr * 5 / 1000)))
    onset = np.zeros(len(env))
    onset[1:] = np.maximum(0, np.diff(env))

    min_distance = max(1, js_round(min_gap_sec * sr))
    max_onset = onset.max(initial=0)
    thresh = max_onset * 0.05 if max_onset > 0 else 0

    mid = onset[1:-1]
    cand = np.flatnonzero((mid > thresh) & (mid >= onset[:-2]) & (mid > onset[2:])) + 1
    if len(cand):
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")  # PeakPropertyWarning for zero prominence
            prom = peak_prominences(onset, cand)[0]
        cand = cand[prom >= thresh]
    if not len(cand):
        raise TapAnalysisError("no tap/pluck transients detected — try adjusting Crop Start or Min Gap")

    kept = []
    for idx in sorted(cand.tolist(), key=lambda i: -onset[i]):
        if all(abs(k - idx) >= min_distance for k in kept):
            kept.append(idx)

    look = js_round(0.02 * sr)
    scored = sorted(kept, key=lambda i: -env[min(i + look, len(env) - 1)])
    chosen = sorted(scored[:min(num_events, len(scored))])

    before, after = js_round(0.01 * sr), js_round(0.03 * sr)
    out = []
    for c in chosen:
        p = c + skip
        lo, hi = max(0, p - before), min(len(samples), p + after)
        out.append(lo + int(np.argmax(np.abs(samples[lo:hi]))))
    return sorted(out)


# Each tap's analysis window: WINDOW_LENGTH seconds starting WINDOW_OFFSET
# after the tap (negative = before it, so the window encloses the attack).
WINDOW_OFFSET = 0.1
WINDOW_LENGTH = 1.0


def extract_event_window(samples, sr, peak_idx, offset_sec, duration_sec):
    start = max(0, peak_idx + js_round(offset_sec * sr))
    if start >= len(samples):
        raise TapAnalysisError("offset window exceeds file length for this event")
    return samples[start:min(start + js_round(duration_sec * sr), len(samples))]


def apply_hann(arr):
    n = len(arr)
    if n <= 1:
        return np.asarray(arr, dtype=np.float64).copy()
    return arr * (0.5 - 0.5 * np.cos(2 * np.pi * np.arange(n) / (n - 1)))


# ---------------- spectrum peaks ----------------

def fft_mag_exact(windowed, sr):
    """Single-sided amplitude spectrum on the np.fft.rfftfreq grid."""
    m = len(windowed)
    mags = np.abs(np.fft.rfft(windowed)) / m
    mags[1:-1] *= 2
    freqs = np.arange(len(mags)) * sr / m
    return freqs, mags


def interpolate_peak_freq(freqs, mags, i):
    """Parabolic interpolation of a peak on the dB curve, within ±1 bin."""
    n = len(mags)
    if i <= 0 or i >= n - 1:
        return float(freqs[i])
    db = lambda v: 20 * math.log10(max(v, 1e-12))
    a, b, c = db(mags[i - 1]), db(mags[i]), db(mags[i + 1])
    denom = a - 2 * b + c
    if abs(denom) < 1e-9:
        return float(freqs[i])
    p = min(1, max(-1, 0.5 * (a - c) / denom))
    return float(freqs[i] + p * (freqs[1] - freqs[0]))


def measure_peak_bandwidth_hz(energy, freqs, peak, min_bw_hz=0.5):
    """−3 dB (half-power) width of a peak, interpolated, at least min_bw_hz."""
    half = energy[peak] * 0.5
    n = len(energy)
    spacing = freqs[1] - freqs[0]

    left = peak
    while left > 0 and energy[left] >= half:
        left -= 1
    if left > 0 and energy[left + 1] > energy[left]:
        f_left = freqs[left] + (half - energy[left]) / (energy[left + 1] - energy[left]) * spacing
    else:
        f_left = freqs[left]

    right = peak
    while right < n - 1 and energy[right] >= half:
        right += 1
    if right < n - 1 and energy[right - 1] > energy[right]:
        f_right = freqs[right] - (half - energy[right]) / (energy[right - 1] - energy[right]) * spacing
    else:
        f_right = freqs[right]
    return max(f_right - f_left, min_bw_hz)


def find_top_n_peaks(freqs, mags, n_peaks, min_freq, max_freq, min_sep_bins, rank_by=None, select_by=None):
    """Top-N local maxima of `rank_by` (default mags) in [min_freq, max_freq],
    at least `min_sep_bins` apart; the final N and their order are decided by
    `select_by(idx)` (default rank_by[idx]). Frequencies refined from mags."""
    rank = mags if rank_by is None else rank_by
    select = select_by or (lambda i: rank[i])

    inside_lo = np.flatnonzero(freqs >= min_freq)
    inside_hi = np.flatnonzero(freqs <= max_freq)
    if not len(inside_lo) or not len(inside_hi) or inside_hi[-1] < inside_lo[0]:
        return []
    lo, hi = int(inside_lo[0]), int(inside_hi[-1])

    k = np.arange(lo + 1, hi)
    local_max = k[(rank[k] > rank[k - 1]) & (rank[k] >= rank[k + 1])].tolist() if hi - lo > 1 else []

    if not local_max:
        candidates = sorted(range(lo, hi + 1), key=lambda i: -rank[i])[:n_peaks]
    else:
        candidates = []
        for i in sorted(local_max, key=lambda i: -rank[i]):
            if all(abs(c - i) >= min_sep_bins for c in candidates):
                candidates.append(i)

    score = {i: select(i) for i in candidates}
    candidates = sorted(candidates, key=lambda i: -score[i])[:n_peaks]
    results = [{"freq": interpolate_peak_freq(freqs, mags, i), "mag": float(mags[i]), "score": float(score[i])}
               for i in candidates]
    return sorted(results, key=lambda r: -r["score"])


def top_peaks_pct(freqs, mags, top_n_basis, min_freq, max_freq, min_sep_bins, use_energy):
    """Top peaks as % of the sum of the top `top_n_basis`. With use_energy,
    peaks are found on energy = mag² and ranked by energy / −3 dB bandwidth."""
    rank_by = select_by = None
    if use_energy:
        energy = mags * mags
        rank_by = energy
        select_by = lambda i: energy[i] / measure_peak_bandwidth_hz(energy, freqs, i)
    top = find_top_n_peaks(freqs, mags, top_n_basis, min_freq, max_freq, min_sep_bins, rank_by, select_by)
    if not top:
        raise TapAnalysisError("no spectral peaks found to normalise against")
    basis = sum(p["score"] for p in top)
    if basis <= 0:
        raise TapAnalysisError("top peak normalised energies summed to zero" if use_energy
                               else "top peak magnitudes summed to zero")
    pct = [{"freq": p["freq"], "pct": p["score"] / basis * 100} for p in top]
    return sorted(pct, key=lambda p: -p["pct"])


def _mean(xs):
    return sum(xs) / len(xs)


def _std(xs):
    m = _mean(xs)
    return math.sqrt(_mean([(x - m) * (x - m) for x in xs]))


def common_frequencies(event_results, tolerance_hz, top_n):
    """Group peaks across events (within ±tolerance of a group's running
    mean), one per event per group, ranked by appearances then average %."""
    peaks = [(p["freq"], p["pct"], r["eventNum"]) for r in event_results for p in r["peaks"]]
    if not peaks:
        return []
    peaks.sort(key=lambda p: p[0])

    groups = []
    for pk in peaks:
        for g in groups:
            if abs(pk[0] - _mean([x[0] for x in g])) <= tolerance_hz:
                g.append(pk)
                break
        else:
            groups.append([pk])

    summaries = []
    for g in groups:
        by_event = {}
        for freq, pct, ev in g:
            if ev not in by_event or pct > by_event[ev][1]:
                by_event[ev] = (freq, pct)
        hz = [v[0] for v in by_event.values()]
        pcts = [v[1] for v in by_event.values()]
        summaries.append({
            "freq": _mean(hz), "appearances": len(by_event), "avgPct": _mean(pcts),
            "stdHz": _std(hz), "stdPct": _std(pcts),
            "minPct": min(pcts), "maxPct": max(pcts), "minHz": min(hz), "maxHz": max(hz),
        })
    summaries.sort(key=lambda s: (-s["appearances"], -s["avgPct"]))
    return summaries[:top_n]


# ---------------- pipeline ----------------

def _crop_end_sec(crop):
    """Crop End (seconds trimmed off the end) from the UI string; 0 = none."""
    text = (crop.get("skipEnd") or "").strip()
    sec = js_parse_float(text) if text else 0.0
    return sec if math.isfinite(sec) and sec > 0 else 0.0


def _trim_end(samples, sr, crop_end_sec):
    if crop_end_sec > 0:
        return samples[: max(1, len(samples) - js_round(crop_end_sec * sr))]
    return samples


def detect(samples, sr, crop, opts):
    """Where the analysis will look: the resolved crop and the detected taps.

    crop: {'skipStart', 'skipEnd'} as typed in the UI ('' = auto / none).
    opts: needs 'numEvents' and 'minGap'.
    Returns {'cropStart', 'cropStartAuto', 'cropEnd', 'taps'}, all in
    seconds from the start of the file (cropEnd = seconds cut off the end).
    """
    samples = np.asarray(samples, dtype=np.float64)
    crop_end = _crop_end_sec(crop)
    samples = _trim_end(samples, sr, crop_end)

    text = (crop.get("skipStart") or "").strip()
    auto = not text
    crop_start = auto_detect_skip_start(samples, sr) if auto else js_parse_float(text)
    if not math.isfinite(crop_start) or crop_start < 0:
        crop_start = 0.0

    peaks = detect_tap_events(samples, sr, opts["numEvents"], opts["minGap"], crop_start)
    return {
        "cropStart": float(crop_start),
        "cropStartAuto": auto,
        "cropEnd": float(crop_end),
        "taps": [p / sr for p in peaks],
    }


def analyse_taps(samples, sr, taps_sec, opts, crop_start_sec=0.0, crop_end_sec=0.0):
    """FFT each tap, normalise its peaks and group them across taps.

    taps_sec: tap positions in seconds (detected or hand-edited); taps
    before crop_start_sec or past the Crop End trim are ignored.
    opts: {'minFreq', 'maxFreq', 'topNBasis', 'tolerance', 'useEnergy'} and
          optionally 'windowOffset' (seconds after the tap, default 0.1).
    Returns {'freqSummary', 'eventCount', 'detectedEvents'}.
    """
    samples = _trim_end(np.asarray(samples, dtype=np.float64), sr, crop_end_sec)
    start = js_round(max(0.0, crop_start_sec) * sr)
    peaks = sorted(i for i in (js_round(t * sr) for t in taps_sec) if start <= i < len(samples))
    if not peaks:
        raise TapAnalysisError("no taps inside the cropped range")

    events = []
    for i, p in enumerate(peaks):
        try:
            window = extract_event_window(samples, sr, p, opts.get("windowOffset", WINDOW_OFFSET), WINDOW_LENGTH)
        except TapAnalysisError:
            continue
        if len(window) < 16:
            continue
        freqs, mags = fft_mag_exact(apply_hann(window), sr)
        try:
            pct = top_peaks_pct(freqs, mags, opts["topNBasis"], opts["minFreq"], opts["maxFreq"], 3,
                                bool(opts.get("useEnergy")))
        except TapAnalysisError:
            continue
        events.append({"eventNum": i + 1, "peaks": pct[:10]})

    if not events:
        raise TapAnalysisError("no events successfully processed")

    # Always the max we'd display (10), so "Show top" can re-slice without re-running.
    return {
        "freqSummary": common_frequencies(events, opts["tolerance"], 10),
        "eventCount": len(events),
        "detectedEvents": len(peaks),
    }


def analyse_tap_samples(samples, sr, crop, opts):
    """Full per-file pipeline on mono samples: detect, then analyse_taps.

    crop: {'skipStart', 'skipEnd'} as typed in the UI ('' = auto / none).
    opts: {'numEvents', 'minGap', 'minFreq', 'maxFreq', 'topNBasis',
           'tolerance', 'useEnergy'}.
    """
    found = detect(samples, sr, crop, opts)
    return analyse_taps(samples, sr, found["taps"], opts, found["cropStart"], found["cropEnd"])
