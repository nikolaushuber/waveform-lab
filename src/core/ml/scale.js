export function euclideanSq(a, b){
  let s = 0;
  for (let i = 0; i < a.length; i++){ const d = a[i]-b[i]; s += d*d; }
  return s;
}

// StandardScaler: zero mean, unit variance per column (population std,
// ddof=0, matching sklearn.preprocessing.StandardScaler). A zero-variance
// column is left unscaled (scale forced to 1), same as sklearn's
// _handle_zeros_in_scale.
export function standardScale(X){
  const n = X.length, d = X[0].length;
  const mean = new Float64Array(d), std = new Float64Array(d);
  for (let j = 0; j < d; j++){
    let s = 0;
    for (let i = 0; i < n; i++) s += X[i][j];
    mean[j] = s / n;
  }
  for (let j = 0; j < d; j++){
    let s = 0;
    for (let i = 0; i < n; i++){ const dv = X[i][j]-mean[j]; s += dv*dv; }
    let sd = Math.sqrt(s / n);
    std[j] = sd === 0 ? 1 : sd;
  }
  const Xs = X.map(row => row.map((v,j) => (v - mean[j]) / std[j]));
  return { Xs, mean, std };
}
