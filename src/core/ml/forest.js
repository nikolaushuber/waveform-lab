import { hierarchicalClusterAverageLinkage } from './hierarchical.js';
import { makeRng } from './rng.js';

// ---- PRIMARY: Random Forest real-vs-synthetic proximity clustering ----
// (Shi & Horvath 2006 unsupervised-RF trick), mirroring
// rf_proximity_clustering() in the Python script.

// Independent per-column shuffle: X_synth[i][j] = X[perm_j[i]][j], with a
// fresh random permutation perm_j for every column j.
export function columnShuffle(X, rng){
  const n = X.length, d = X[0].length;
  const synth = Array.from({length:n}, () => new Array(d));
  for (let j = 0; j < d; j++){
    const order = Array.from({length:n}, (_,i) => i);
    for (let i = n-1; i > 0; i--){
      const r = Math.floor(rng() * (i+1));
      const tmp = order[i]; order[i] = order[r]; order[r] = tmp;
    }
    for (let i = 0; i < n; i++) synth[i][j] = X[order[i]][j];
  }
  return synth;
}

export function giniImpurity(counts, total){
  if (total === 0) return 0;
  let sumSq = 0;
  for (const c of counts) sumSq += (c/total)*(c/total);
  return 1 - sumSq;
}

// Find the best (feature, threshold) split among a random feature subset,
// scanning midpoint thresholds between consecutive distinct sorted values,
// subject to min_samples_leaf on both children.
export function bestSplitCART(X, y, idx, nClasses, featureSubset, minSamplesLeaf){
  const n = idx.length;
  const totalCounts = new Array(nClasses).fill(0);
  for (const i of idx) totalCounts[y[i]]++;
  const parentGini = giniImpurity(totalCounts, n);
  if (parentGini === 0) return null;

  let best = null;
  for (const f of featureSubset){
    const sorted = idx.slice().sort((a,b) => X[a][f] - X[b][f]);
    const leftCounts = new Array(nClasses).fill(0);
    const rightCounts = totalCounts.slice();
    for (let pos = 0; pos < n - 1; pos++){
      const i = sorted[pos];
      leftCounts[y[i]]++; rightCounts[y[i]]--;
      const nLeft = pos + 1, nRight = n - nLeft;
      const vHere = X[sorted[pos]][f], vNext = X[sorted[pos+1]][f];
      if (vHere === vNext) continue;
      if (nLeft < minSamplesLeaf || nRight < minSamplesLeaf) continue;

      const gLeft = giniImpurity(leftCounts, nLeft);
      const gRight = giniImpurity(rightCounts, nRight);
      const weighted = (nLeft/n)*gLeft + (nRight/n)*gRight;
      const decrease = parentGini - weighted;
      if (!best || decrease > best.impurityDecrease + 1e-15){
        best = {
          feature: f, threshold: (vHere + vNext) / 2,
          impurityDecrease: decrease,
          leftIdx: sorted.slice(0, nLeft), rightIdx: sorted.slice(nLeft),
          leftGini: gLeft, rightGini: gRight, nLeft, nRight,
        };
      }
    }
  }
  return best;
}

export function sampleFeatureSubset(nFeatures, maxFeatures, rng){
  const all = Array.from({length:nFeatures}, (_,i) => i);
  for (let i = all.length-1; i > 0; i--){
    const r = Math.floor(rng()*(i+1));
    const t = all[i]; all[i] = all[r]; all[r] = t;
  }
  return all.slice(0, maxFeatures);
}

// Recursively grow one CART tree (Gini impurity, min_samples_leaf, random
// per-split feature subsampling of size max_features). Leaf nodes carry a
// unique numeric id (for proximity co-occurrence). Also accumulates
// per-feature impurity-decrease importances into `importanceAccum`.
export function buildCARTTree(X, y, idx, nClasses, maxFeatures, minSamplesLeaf, rng, importanceAccum, leafIdCounter){
  const counts = new Array(nClasses).fill(0);
  for (const i of idx) counts[y[i]]++;
  let majority = 0;
  for (let c = 1; c < nClasses; c++) if (counts[c] > counts[majority]) majority = c;

  if (idx.length < 2*minSamplesLeaf){
    return { leaf: true, id: leafIdCounter.next++, majority, nSamples: idx.length };
  }

  const featureSubset = sampleFeatureSubset(X[0].length, maxFeatures, rng);
  const split = bestSplitCART(X, y, idx, nClasses, featureSubset, minSamplesLeaf);
  if (!split){
    return { leaf: true, id: leafIdCounter.next++, majority, nSamples: idx.length };
  }

  importanceAccum[split.feature] += idx.length * giniImpurity(counts, idx.length)
    - split.nLeft * split.leftGini - split.nRight * split.rightGini;

  const left = buildCARTTree(X, y, split.leftIdx, nClasses, maxFeatures, minSamplesLeaf, rng, importanceAccum, leafIdCounter);
  const right = buildCARTTree(X, y, split.rightIdx, nClasses, maxFeatures, minSamplesLeaf, rng, importanceAccum, leafIdCounter);
  return { leaf: false, feature: split.feature, threshold: split.threshold, left, right };
}

export function applyTree(tree, x){
  let node = tree;
  while (!node.leaf){
    node = x[node.feature] <= node.threshold ? node.left : node.right;
  }
  return node;
}

// Train n_estimators bootstrap-sampled CART trees to separate real rows
// (y=1) from column-shuffled synthetic rows (y=0), matching
// RandomForestClassifier(min_samples_leaf=3, max_features="sqrt",
// bootstrap=True). Returns cluster labels (via average-linkage hierarchical
// clustering on leaf-co-occurrence proximity) and forest-averaged,
// normalized Gini feature importances (matching clf.feature_importances_).
export function rfProximityClustering(X, k, opts){
  opts = opts || {};
  const nEstimators = opts.nEstimators != null ? opts.nEstimators : 500;
  const randomState = opts.randomState != null ? opts.randomState : 42;
  const minSamplesLeaf = opts.minSamplesLeaf != null ? opts.minSamplesLeaf : 3;
  const rng = makeRng(randomState);

  const n = X.length, d = X[0].length;
  const maxFeatures = Math.max(1, Math.round(Math.sqrt(d)));
  const synth = columnShuffle(X, rng);
  const Xc = X.concat(synth);
  const y = new Array(2*n);
  for (let i = 0; i < n; i++){ y[i] = 1; y[n+i] = 0; }
  const total = 2*n;

  const leafPerTree = [];
  const importanceSum = new Float64Array(d);

  for (let t = 0; t < nEstimators; t++){
    const bootIdx = new Array(total);
    for (let i = 0; i < total; i++) bootIdx[i] = Math.floor(rng() * total);

    const importanceAccum = new Float64Array(d);
    const leafIdCounter = { next: 0 };
    const tree = buildCARTTree(Xc, y, bootIdx, 2, maxFeatures, minSamplesLeaf, rng, importanceAccum, leafIdCounter);

    let treeSum = 0;
    for (let f = 0; f < d; f++) treeSum += importanceAccum[f];
    if (treeSum > 0){
      for (let f = 0; f < d; f++) importanceSum[f] += (importanceAccum[f] / treeSum);
    }

    const leaves = new Array(n);
    for (let i = 0; i < n; i++) leaves[i] = applyTree(tree, X[i]).id;
    leafPerTree.push(leaves);
  }

  const importances = new Float64Array(d);
  for (let f = 0; f < d; f++) importances[f] = importanceSum[f] / nEstimators;

  const prox = Array.from({length:n}, () => new Float64Array(n));
  for (const leaves of leafPerTree){
    for (let i = 0; i < n; i++){
      for (let j = 0; j < n; j++){
        if (leaves[i] === leaves[j]) prox[i][j] += 1;
      }
    }
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) prox[i][j] /= nEstimators;

  const distance = Array.from({length:n}, () => new Float64Array(n));
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) distance[i][j] = i===j ? 0 : 1 - prox[i][j];

  const labels = hierarchicalClusterAverageLinkage(distance, k);
  return { labels, importances: Array.from(importances), proximity: prox };
}
