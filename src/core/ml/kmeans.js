import { silhouetteScore } from './metrics.js';
import { makeRng } from './rng.js';
import { euclideanSq, standardScale } from './scale.js';

// k-means++ seeding (Arthur & Vassilvitskii 2007), the sklearn default init.
export function kmeansPlusPlusInit(X, k, rng){
  const n = X.length;
  const centers = [];
  const first = Math.floor(rng() * n);
  centers.push(X[first].slice());
  const distSq = new Float64Array(n).fill(Infinity);
  for (let c = 1; c < k; c++){
    for (let i = 0; i < n; i++){
      const dc = euclideanSq(X[i], centers[centers.length-1]);
      if (dc < distSq[i]) distSq[i] = dc;
    }
    let total = 0;
    for (let i = 0; i < n; i++) total += distSq[i];
    let r = rng() * total, idx = 0;
    for (let i = 0; i < n; i++){ r -= distSq[i]; if (r <= 0){ idx = i; break; } idx = i; }
    centers.push(X[idx].slice());
  }
  return centers;
}

// One Lloyd's-algorithm run to convergence (or maxIter), matching sklearn's
// KMeans (init=k-means++, algorithm="lloyd").
export function kmeansSingleRun(X, k, rng, maxIter, tol){
  maxIter = maxIter != null ? maxIter : 300;
  tol = tol != null ? tol : 1e-4;
  const n = X.length, d = X[0].length;
  let centers = kmeansPlusPlusInit(X, k, rng);
  let labels = new Int32Array(n);

  for (let iter = 0; iter < maxIter; iter++){
    let changed = false;
    for (let i = 0; i < n; i++){
      let best = 0, bestD = Infinity;
      for (let c = 0; c < k; c++){
        const dd = euclideanSq(X[i], centers[c]);
        if (dd < bestD){ bestD = dd; best = c; }
      }
      if (labels[i] !== best){ labels[i] = best; changed = true; }
    }

    const newCenters = Array.from({length:k}, () => new Float64Array(d));
    const counts = new Int32Array(k);
    for (let i = 0; i < n; i++){
      const c = labels[i];
      counts[c]++;
      for (let j = 0; j < d; j++) newCenters[c][j] += X[i][j];
    }
    let shift = 0;
    for (let c = 0; c < k; c++){
      if (counts[c] === 0){ newCenters[c] = centers[c]; continue; }
      for (let j = 0; j < d; j++) newCenters[c][j] /= counts[c];
      shift += euclideanSq(newCenters[c], centers[c]);
    }
    centers = newCenters.map(a => Array.from(a));
    if (!changed || shift < tol) break;
  }

  let inertia = 0;
  for (let i = 0; i < n; i++) inertia += euclideanSq(X[i], centers[labels[i]]);
  return { labels: Array.from(labels), centers, inertia };
}

// KMeans with n_init restarts, keeping the lowest-inertia run.
export function kmeansFit(X, k, opts){
  opts = opts || {};
  const nInit = opts.nInit != null ? opts.nInit : 10;
  const rng = opts.rng || makeRng(42);
  let best = null;
  for (let r = 0; r < nInit; r++){
    const run = kmeansSingleRun(X, k, rng, opts.maxIter, opts.tol);
    if (!best || run.inertia < best.inertia) best = run;
  }
  return best;
}

// KMeans clustering used both to select k (via silhouette) and as the
// cross-check clustering against the RF-proximity labels. Mirrors
// kmeans_cluster() in the Python script.
export function kmeansClusterAutoK(X, opts){
  opts = opts || {};
  const { Xs } = standardScale(X);
  const n = X.length;
  const rng = makeRng(opts.randomState != null ? opts.randomState : 42);

  if (opts.k != null){
    const run = kmeansFit(Xs, opts.k, { nInit: 10, rng });
    return { labels: run.labels, k: opts.k, Xs, scores: null };
  }

  const kRange = opts.kRange || [2,3,4,5,6,7,8];
  let bestK = null, bestScore = -Infinity, bestLabels = null;
  const scores = [];
  for (const k of kRange){
    if (k >= n) break;
    const run = kmeansFit(Xs, k, { nInit: 10, rng });
    const score = silhouetteScore(Xs, run.labels);
    scores.push({ k, score });
    if (score > bestScore){ bestScore = score; bestK = k; bestLabels = run.labels; }
  }
  return { labels: bestLabels, k: bestK, Xs, scores };
}
