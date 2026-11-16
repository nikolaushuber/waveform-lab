// Average-linkage (UPGMA) agglomerative clustering cut at k clusters,
// matching scipy.cluster.hierarchy.linkage(..., method="average") +
// fcluster(Z, t=k, criterion="maxclust"), via the Lance-Williams update.
export function hierarchicalClusterAverageLinkage(distance, k){
  const n = distance.length;
  let clusters = Array.from({length:n}, (_,i) => ({ members: [i], id: i }));
  let D = distance.map(row => Float64Array.from(row));

  while (clusters.length > k){
    let bi = 0, bj = 1, bd = Infinity;
    for (let i = 0; i < clusters.length; i++){
      for (let j = i+1; j < clusters.length; j++){
        if (D[i][j] < bd){ bd = D[i][j]; bi = i; bj = j; }
      }
    }
    const ni = clusters[bi].members.length, nj = clusters[bj].members.length;
    const newRow = new Float64Array(clusters.length);
    for (let m = 0; m < clusters.length; m++){
      if (m === bi || m === bj) continue;
      newRow[m] = (ni*D[bi][m] + nj*D[bj][m]) / (ni+nj);
    }

    const merged = { members: clusters[bi].members.concat(clusters[bj].members), id: clusters[bi].id };
    const keep = [];
    for (let m = 0; m < clusters.length; m++) if (m !== bi && m !== bj) keep.push(m);

    const newClusters = keep.map(m => clusters[m]);
    newClusters.push(merged);
    const newD = Array.from({length:newClusters.length}, () => new Float64Array(newClusters.length));
    for (let a = 0; a < keep.length; a++){
      for (let b = a+1; b < keep.length; b++){
        newD[a][b] = newD[b][a] = D[keep[a]][keep[b]];
      }
    }
    const lastIdx = newClusters.length - 1;
    for (let a = 0; a < keep.length; a++){
      newD[a][lastIdx] = newD[lastIdx][a] = newRow[keep[a]];
    }

    clusters = newClusters;
    D = newD;
  }

  const labels = new Array(n);
  clusters.forEach((c, ci) => { for (const m of c.members) labels[m] = ci + 1; });
  return labels;
}
