
import json
import numpy as np
from scipy.signal import find_peaks
from scipy.cluster.hierarchy import linkage, fcluster
from scipy.spatial.distance import squareform
from sklearn.ensemble import RandomForestClassifier
from sklearn.cluster import KMeans
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import silhouette_score, adjusted_rand_score

# ============ verbatim from random_forest.py ============

def trim_signal(signal, sr, skip_start_sec=0.0, skip_end_sec=0.0):
    start_idx = int(sr * skip_start_sec)
    end_idx = len(signal) - int(sr * skip_end_sec)
    end_idx = max(start_idx, end_idx)
    return signal[start_idx:end_idx]


def detect_taps(signal, sr, min_gap_ms=150, energy_win_ms=10, rel_threshold=0.15, expected_taps=None):
    win = max(1, int(sr * energy_win_ms / 1000))
    energy = np.convolve(signal ** 2, np.ones(win) / win, mode="same")
    min_distance = int(sr * min_gap_ms / 1000)
    height = rel_threshold * energy.max()
    peaks, _ = find_peaks(energy, height=height, distance=min_distance)

    if expected_taps is not None and len(peaks) > expected_taps:
        peak_energies = energy[peaks]
        top = np.argsort(peak_energies)[::-1][:expected_taps]
        peaks = np.sort(peaks[top])

    return peaks


def extract_window(signal, sr, onset_idx, window_ms=500, pre_ms=5):
    pre = int(sr * pre_ms / 1000)
    length = int(sr * window_ms / 1000)
    start = max(0, onset_idx - pre)
    end = start + length
    segment = signal[start:end]
    if len(segment) < length:
        segment = np.pad(segment, (0, length - len(segment)))
    return segment


def estimate_noise_spectrum(signal, sr, onsets, window_ms=120, tail_margin_ms=300):
    length = int(sr * window_ms / 1000)
    margin = int(sr * tail_margin_ms / 1000)
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


def fft_features(segment, sr, n_bins=64, fmin=20, fmax=None, noise_spectrum=None):
    if fmax is None:
        fmax = sr / 2
    window = np.hanning(len(segment))
    spectrum = np.abs(np.fft.rfft(segment * window))

    if noise_spectrum is not None:
        spectrum = np.maximum(spectrum - noise_spectrum, 0)

    freqs = np.fft.rfftfreq(len(segment), d=1 / sr)
    bin_edges = np.logspace(np.log10(fmin), np.log10(fmax), n_bins + 1)
    features = np.zeros(n_bins)
    for i in range(n_bins):
        mask = (freqs >= bin_edges[i]) & (freqs < bin_edges[i + 1])
        if mask.any():
            features[i] = spectrum[mask].mean()
    return np.log1p(features)


def get_bin_edges(sr, n_bins=64, fmin=20, fmax=None):
    if fmax is None:
        fmax = sr / 2
    return np.logspace(np.log10(fmin), np.log10(fmax), n_bins + 1)


def kmeans_cluster(X, k=None, k_range=range(2, 9), random_state=42):
    Xs = StandardScaler().fit_transform(X)
    n_samples = X.shape[0]

    if k is not None:
        labels = KMeans(n_clusters=k, n_init=10, random_state=random_state).fit_predict(Xs)
        return labels, k, Xs

    best_k, best_score, best_labels = None, -1, None
    for k_try in k_range:
        if k_try >= n_samples:
            break
        labels_try = KMeans(n_clusters=k_try, n_init=10, random_state=random_state).fit_predict(Xs)
        score = silhouette_score(Xs, labels_try)
        if score > best_score:
            best_k, best_score, best_labels = k_try, score, labels_try

    return best_labels, best_k, Xs


def rf_proximity_clustering(X, k, n_estimators=500, random_state=42):
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
    prox = np.zeros((n, n), dtype=np.float32)
    for t in range(leaves.shape[1]):
        col = leaves[:, t]
        prox += (col[:, None] == col[None, :])
    prox /= leaves.shape[1]

    distance = 1 - prox
    np.fill_diagonal(distance, 0)
    Z = linkage(squareform(distance, checks=False), method="average")
    labels = fcluster(Z, t=k, criterion="maxclust")

    return labels, clf.feature_importances_

# ============ end verbatim ============

# Thin bridge: takes JSON describing each loaded/decoded file (already mono,
# already peak-normalized the same way load_wav_mono() does) plus the run
# parameters, runs the exact pipeline above, and returns JSON the JS side
# renders with the same renderClusterResults() used by the JS engine.
def run_clustering_bridge(payload_json):
    # Everything comes in through one JSON string (rather than separate
    # positional arguments) so there's no ambiguity between JS's null/
    # undefined and Python's None when crossing the pyodide FFI boundary --
    # json.loads() maps JSON null to Python None unambiguously.
    payload = json.loads(payload_json)
    files_data = payload['files']
    window_ms = payload['windowMs']
    n_estimators = payload['nEstimators']
    force_k = payload.get('forceK')
    min_gap_ms = payload['minGapMs']
    random_state = payload['randomState']
    offset_ms = payload.get('offsetMs')
    if offset_ms is None:
        offset_ms = 5
    fmax = payload.get('fmax')
    if fmax is None:
        fmax = 1500

    X, meta = [], []
    sample_rates = set()
    sr_used = None
    warnings = []

    for f in files_data:
        name = f['name']
        sr = f['sr']
        sample_rates.add(sr)
        signal = np.array(f['samples'], dtype=np.float32)
        peak = np.max(np.abs(signal)) or 1.0
        signal = signal / peak
        signal = trim_signal(signal, sr, f.get('cropStart') or 0.0, f.get('cropEnd') or 0.0)

        onsets = detect_taps(signal, sr, min_gap_ms=min_gap_ms)
        if len(onsets) == 0:
            warnings.append(f"{name}: no taps detected, skipped")
            continue

        noise_spectrum = estimate_noise_spectrum(signal, sr, onsets, window_ms=window_ms)
        if noise_spectrum is None:
            warnings.append(f"{name}: no quiet gap found, denoising skipped for this file")

        for i, onset in enumerate(onsets):
            segment = extract_window(signal, sr, onset, window_ms=window_ms, pre_ms=offset_ms)
            feat = fft_features(segment, sr, n_bins=64, fmin=20, fmax=fmax, noise_spectrum=noise_spectrum)
            X.append(feat)
            meta.append({'file': name, 'tapIndex': i})
        if sr_used is None:
            sr_used = sr

    if len(sample_rates) > 1:
        warnings.append(f"files have different sample rates ({sorted(sample_rates)}) -- bin Hz ranges shown assume {sr_used} Hz")

    if len(X) < 6:
        return json.dumps({'error': f'Need at least 6 detected taps total to cluster meaningfully (got {len(X)}).'})

    X = np.array(X)
    km_labels, k, Xs = kmeans_cluster(X, k=force_k)
    if k is None:
        return json.dumps({'error': 'Could not determine a cluster count -- try more taps or force a k.'})

    rf_labels, importances = rf_proximity_clustering(X, k=k, n_estimators=n_estimators, random_state=random_state)
    agreement = adjusted_rand_score(km_labels, rf_labels)
    edges = get_bin_edges(sr_used, n_bins=64, fmin=20, fmax=fmax)

    return json.dumps({
        'meta': meta,
        'rfLabels': [int(x) for x in rf_labels],
        'importances': [float(x) for x in importances],
        'edges': [float(x) for x in edges],
        'k': int(k),
        'agreement': float(agreement),
        'nTaps': len(X),
        'nFiles': len(files_data),
        'warnings': warnings,
    })
