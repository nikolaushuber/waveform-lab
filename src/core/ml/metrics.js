import { euclideanSq } from './scale.js';

// Exact silhouette score (mean silhouette coefficient), matching
// sklearn.metrics.silhouette_score with metric="euclidean".
export function silhouetteScore(X, labels){
  const n = X.length;
  const clusters = {};
  for (let i = 0; i < n; i++){
    (clusters[labels[i]] = clusters[labels[i]] || []).push(i);
  }
  const clusterIds = Object.keys(clusters);
  if (clusterIds.length < 2) return NaN;

  const dist = Array.from({length:n}, () => new Float64Array(n));
  for (let i = 0; i < n; i++){
    for (let j = i+1; j < n; j++){
      const dd = Math.sqrt(euclideanSq(X[i], X[j]));
      dist[i][j] = dd; dist[j][i] = dd;
    }
  }

  let total = 0;
  for (let i = 0; i < n; i++){
    const own = clusters[labels[i]];
    let a = 0;
    if (own.length > 1){
      let s = 0;
      for (const j of own) if (j !== i) s += dist[i][j];
      a = s / (own.length - 1);
    } else {
      continue; // singleton cluster -> silhouette 0 for this point (sklearn convention)
    }
    let b = Infinity;
    for (const cid of clusterIds){
      if (Number(cid) === labels[i]) continue;
      const members = clusters[cid];
      let s = 0;
      for (const j of members) s += dist[i][j];
      const meanD = s / members.length;
      if (meanD < b) b = meanD;
    }
    const s = (b - a) / Math.max(a, b);
    total += s;
  }
  return total / n;
}

// Adjusted Rand index between two label assignments, matching
// sklearn.metrics.adjusted_rand_score exactly.
export function adjustedRandScore(labelsA, labelsB){
  const n = labelsA.length;
  const mapA = {}, mapB = {};
  let ai = 0, bi = 0;
  const a2 = new Array(n), b2 = new Array(n);
  for (let i = 0; i < n; i++){
    if (!(labelsA[i] in mapA)) mapA[labelsA[i]] = ai++;
    if (!(labelsB[i] in mapB)) mapB[labelsB[i]] = bi++;
    a2[i] = mapA[labelsA[i]]; b2[i] = mapB[labelsB[i]];
  }
  const nA = ai, nB = bi;
  const contingency = Array.from({length:nA}, () => new Float64Array(nB));
  for (let i = 0; i < n; i++) contingency[a2[i]][b2[i]]++;

  const comb2 = x => x*(x-1)/2;
  let sumComb = 0;
  const rowSum = new Float64Array(nA), colSum = new Float64Array(nB);
  for (let i = 0; i < nA; i++){
    for (let j = 0; j < nB; j++){
      sumComb += comb2(contingency[i][j]);
      rowSum[i] += contingency[i][j];
      colSum[j] += contingency[i][j];
    }
  }
  let sumRow = 0; for (let i = 0; i < nA; i++) sumRow += comb2(rowSum[i]);
  let sumCol = 0; for (let j = 0; j < nB; j++) sumCol += comb2(colSum[j]);
  const totalComb = comb2(n);
  const expected = (sumRow*sumCol) / totalComb;
  const maxIndex = (sumRow + sumCol) / 2;
  if (maxIndex === expected) return 0;
  return (sumComb - expected) / (maxIndex - expected);
}
