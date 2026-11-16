"""Unsupervised clustering of taps by their frequency signature.

Derived from the original random_forest.py (previously embedded in the app
as src/engines/random_forest.py). Pipeline: per recording, crop -> detect taps
-> estimate background noise from the gaps -> one log-binned, noise-subtracted
FFT feature row per tap; then KMeans + silhouette picks k, and a Random Forest
trained to tell real rows from column-shuffled ones gives a proximity matrix
that is clustered hierarchically (Shi & Horvath 2006).

Differences from random_forest.py, all to match the JavaScript engine the app
used before (whose outputs are frozen in tests/golden/clustering.json):
  - no per-file rescale to peak 1.0
  - samples are processed in float64
  - offsets/crops use floor(), bins use k*sr/n and an explicit log spacing
"""
import math

import numpy as np
from scipy.cluster.hierarchy import fcluster, linkage
from scipy.signal import find_peaks
from scipy.spatial.distance import squareform
from sklearn.cluster import KMeans
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import adjusted_rand_score, silhouette_score
from sklearn.preprocessing import StandardScaler

N_BINS = 64
FMIN = 20


def trim_signal(signal, sr, skip_start_sec=0.0, skip_end_sec=0.0):
    start_idx = math.floor(sr * skip_start_sec)
    end_idx = len(signal) - math.floor(sr * skip_end_sec)
    end_idx = max(start_idx, end_idx)
    return signal[start_idx:end_idx]


def detect_taps(signal, sr, min_gap_ms=150, energy_win_ms=10, rel_threshold=0.15, expected_taps=None):
    """Onset sample indices: peaks of a moving-average energy envelope."""
    win = max(1, math.floor(sr * energy_win_ms / 1000))
    energy = np.convolve(signal ** 2, np.ones(win) / win, mode="same")
    min_distance = math.floor(sr * min_gap_ms / 1000)
    height = rel_threshold * energy.max()
    peaks, _ = find_peaks(energy, height=height, distance=max(1, min_distance))

    if expected_taps is not None and len(peaks) > expected_taps:
        top = np.argsort(energy[peaks])[::-1][:expected_taps]
        peaks = np.sort(peaks[top])
    return peaks


def extract_window(signal, sr, onset_idx, window_ms=500, pre_ms=5):
    """window_ms of audio starting pre_ms before the onset (negative pre_ms
    starts after it), zero-padded past the end."""
    pre = math.floor(sr * pre_ms / 1000)
    length = math.floor(sr * window_ms / 1000)
    start = max(0, onset_idx - pre)
    segment = signal[start:start + length]
    if len(segment) < length:
        segment = np.pad(segment, (0, length - len(segment)))
    return segment


def estimate_noise_spectrum(signal, sr, onsets, window_ms=120, tail_margin_ms=300):
    """Average magnitude spectrum of the quiet gaps between taps (plus the
    lead-in before the first one), or None if there is no gap."""
    length = math.floor(sr * window_ms / 1000)
    margin = math.floor(sr * tail_margin_ms / 1000)
    segments = []

    if len(onsets) > 0 and onsets[0] - length > 0:
        segments.append(signal[0:length])
    for a, b in zip(onsets[:-1], onsets[1:]):
        start = a + margin
        end = start + length
        if end < b:
            segments.append(signal[start:end])
    if not segments:
        return None

    window = np.hanning(length)
    spectra = [np.abs(np.fft.rfft(s * window)) for s in segments]
    return np.mean(spectra, axis=0)


def get_bin_edges(sr, n_bins=N_BINS, fmin=FMIN, fmax=None):
    if fmax is None:
        fmax = sr / 2
    log_min, log_max = math.log10(fmin), math.log10(fmax)
    return 10.0 ** (log_min + (log_max - log_min) * (np.arange(n_bins + 1) / n_bins))


def fft_features(segment, sr, n_bins=N_BINS, fmin=FMIN, fmax=None, noise_spectrum=None):
    """log1p of the mean (noise-subtracted) spectrum in each log-spaced bin."""
    if fmax is None:
        fmax = sr / 2
    n = len(segment)
    spectrum = np.abs(np.fft.rfft(segment * np.hanning(n)))
    if noise_spectrum is not None:
        spectrum = np.maximum(spectrum - noise_spectrum, 0)

    freqs = np.arange(len(spectrum)) * sr / n
    edges = get_bin_edges(sr, n_bins, fmin, fmax)
    features = np.zeros(n_bins)
    for i in range(n_bins):
        mask = (freqs >= edges[i]) & (freqs < edges[i + 1])
        if mask.any():
            features[i] = spectrum[mask].mean()
    return np.log1p(features)


def extract_tap_features(files, window_ms=120, min_gap_ms=150, offset_ms=5, fmax=1500,
                         n_bins=N_BINS, fmin=FMIN):
    """files: [{'name', 'sr', 'samples' (mono), 'cropStart', 'cropEnd' (seconds)}].

    Returns (X, meta, warnings, sr_used): one feature row and one
    {'file', 'tapIndex'} per detected tap.
    """
    X, meta, warnings = [], [], []
    sample_rates = {}  # insertion-ordered set
    sr_used = None

    for f in files:
        name, sr = f["name"], f["sr"]
        sample_rates[sr] = None
        signal = np.asarray(f["samples"], dtype=np.float64)
        signal = trim_signal(signal, sr, f.get("cropStart") or 0.0, f.get("cropEnd") or 0.0)

        onsets = detect_taps(signal, sr, min_gap_ms=min_gap_ms)
        if len(onsets) == 0:
            warnings.append(f"{name}: no taps detected, skipped")
            continue

        noise_spectrum = estimate_noise_spectrum(signal, sr, onsets, window_ms=window_ms)
        if noise_spectrum is None:
            warnings.append(f"{name}: no quiet gap found, denoising skipped for this file")

        for i, onset in enumerate(onsets):
            segment = extract_window(signal, sr, int(onset), window_ms=window_ms, pre_ms=offset_ms)
            X.append(fft_features(segment, sr, n_bins=n_bins, fmin=fmin, fmax=fmax, noise_spectrum=noise_spectrum))
            meta.append({"file": name, "tapIndex": i})
        if sr_used is None:
            sr_used = sr

    if len(sample_rates) > 1:
        rates = ", ".join(str(r) for r in sample_rates)
        warnings.append(f"files have different sample rates ({rates}) — bin Hz ranges shown assume {sr_used} Hz")
    return np.array(X), meta, warnings, sr_used


def kmeans_cluster(X, k=None, k_range=range(2, 9), random_state=42):
    """KMeans on standardised features; picks k by silhouette unless given.
    Returns (labels, k, scores) — scores is [(k, silhouette)] or None."""
    Xs = StandardScaler().fit_transform(X)
    n_samples = X.shape[0]

    if k is not None:
        labels = KMeans(n_clusters=k, n_init=10, random_state=random_state).fit_predict(Xs)
        return labels, k, None

    best_k, best_score, best_labels = None, -np.inf, None
    scores = []
    for k_try in k_range:
        if k_try >= n_samples:
            break
        labels_try = KMeans(n_clusters=k_try, n_init=10, random_state=random_state).fit_predict(Xs)
        score = silhouette_score(Xs, labels_try)
        scores.append((k_try, float(score)))
        if score > best_score:
            best_k, best_score, best_labels = k_try, score, labels_try
    return best_labels, best_k, scores


def rf_proximity_clustering(X, k, n_estimators=500, random_state=42):
    """Random Forest real-vs-shuffled proximity, then average-linkage
    clustering cut at k. Returns (labels 1..k, feature_importances)."""
    rng = np.random.default_rng(random_state)
    X_synth = np.column_stack([rng.permutation(X[:, j]) for j in range(X.shape[1])])
    X_combined = np.vstack([X, X_synth])
    y_combined = np.array([1] * len(X) + [0] * len(X_synth))

    clf = RandomForestClassifier(
        n_estimators=n_estimators,
        min_samples_leaf=3,
        max_features="sqrt",
        random_state=random_state,
        n_jobs=-1,
    )
    clf.fit(X_combined, y_combined)

    leaves = clf.apply(X)
    n = X.shape[0]
    prox = np.zeros((n, n), dtype=np.float64)
    for t in range(leaves.shape[1]):
        col = leaves[:, t]
        prox += col[:, None] == col[None, :]
    prox /= leaves.shape[1]

    distance = 1 - prox
    np.fill_diagonal(distance, 0)
    Z = linkage(squareform(distance, checks=False), method="average")
    labels = fcluster(Z, t=k, criterion="maxclust")
    return labels, clf.feature_importances_


def run_clustering(files, window_ms=120, n_estimators=500, force_k=None, min_gap_ms=150,
                   offset_ms=5, fmax=1500, random_state=42):
    """Whole pipeline, returning what the Clustering page renders.

    On a problem the UI should report, returns {'error': message}.
    """
    X, meta, warnings, sr_used = extract_tap_features(
        files, window_ms=window_ms, min_gap_ms=min_gap_ms, offset_ms=offset_ms, fmax=fmax)

    if len(X) < 6:
        return {"error": f"Need at least 6 detected taps total to cluster meaningfully (got {len(X)})."}

    km_labels, k, _ = kmeans_cluster(X, k=force_k, random_state=random_state)
    if k is None:
        return {"error": "Could not determine a cluster count — try more taps or force a k."}

    rf_labels, importances = rf_proximity_clustering(X, k=k, n_estimators=n_estimators, random_state=random_state)
    return {
        "meta": meta,
        "rfLabels": [int(x) for x in rf_labels],
        "importances": [float(x) for x in importances],
        "edges": [float(x) for x in get_bin_edges(sr_used, N_BINS, FMIN, fmax)],
        "k": int(k),
        "agreement": float(adjusted_rand_score(km_labels, rf_labels)),
        "nTaps": len(X),
        "warnings": warnings,
    }
