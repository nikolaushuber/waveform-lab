import { describe, it, expect } from 'vitest';
import { applyTree, buildCARTTree, columnShuffle, giniImpurity, rfProximityClustering } from '../../src/core/ml/forest.js';
import { hierarchicalClusterAverageLinkage } from '../../src/core/ml/hierarchical.js';
import { kmeansClusterAutoK, kmeansFit } from '../../src/core/ml/kmeans.js';
import { adjustedRandScore, silhouetteScore } from '../../src/core/ml/metrics.js';
import { makeRng } from '../../src/core/ml/rng.js';
import { standardScale } from '../../src/core/ml/scale.js';
import { seededRandom } from '../helpers/signals.js';


// Three well-separated Gaussian-ish blobs in 4-D.
function blobs(perBlob = 10, seed = 3) {
  const r = seededRandom(seed);
  const centres = [[0, 0, 0, 0], [8, 8, 0, 0], [0, 8, 8, 8]];
  const X = [], truth = [];
  centres.forEach((c, ci) => {
    for (let i = 0; i < perBlob; i++) { X.push(c.map((v) => v + (r() - 0.5))); truth.push(ci); }
  });
  return { X, truth };
}

describe('makeRng', () => {
  it('is deterministic per seed and in [0, 1)', () => {
    const a = makeRng(42), b = makeRng(42), c = makeRng(43);
    const sa = Array.from({ length: 5 }, a);
    expect(sa).toEqual(Array.from({ length: 5 }, b));
    expect(sa).not.toEqual(Array.from({ length: 5 }, c));
    sa.forEach((v) => { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); });
  });
});

describe('standardScale', () => {
  it('gives zero mean / unit population std, leaving constant columns unscaled', () => {
    const { Xs, mean, std } = standardScale([[1, 5], [3, 5], [5, 5]]);
    expect(Array.from(mean)).toEqual([3, 5]);
    expect(std[0]).toBeCloseTo(Math.sqrt(8 / 3), 12);
    expect(std[1]).toBe(1);
    expect(Xs.map((r) => r[1])).toEqual([0, 0, 0]);
  });
});

describe('metrics', () => {
  it('adjustedRandScore: 1 for identical partitions regardless of label names', () => {
    expect(adjustedRandScore([0, 0, 1, 1, 2, 2], [5, 5, 9, 9, 1, 1])).toBe(1);
  });

  it('adjustedRandScore: matches a hand-computed value', () => {
    // sklearn.metrics.adjusted_rand_score([0,0,0,1,1,1],[0,0,1,1,2,2]) == 0.24242424...
    expect(adjustedRandScore([0, 0, 0, 1, 1, 1], [0, 0, 1, 1, 2, 2])).toBeCloseTo(0.24242424242424243, 12);
  });

  it('silhouetteScore: near 1 for tight separate clusters, NaN for one cluster', () => {
    const { X, truth } = blobs();
    expect(silhouetteScore(X, truth)).toBeGreaterThan(0.85);
    expect(silhouetteScore(X, truth.map(() => 0))).toBeNaN();
  });

  it('silhouetteScore: matches a hand-computed value', () => {
    // points 0,1 | 4,5: s = (3.5/4.5 + 2.5/3.5) / 2 for each side = 0.746031746...
    expect(silhouetteScore([[0], [1], [4], [5]], [0, 0, 1, 1])).toBeCloseTo(0.746031746031746, 12);
  });
});

describe('k-means', () => {
  it('kmeansFit recovers the blobs', () => {
    const { X, truth } = blobs();
    const res = kmeansFit(X, 3, { rng: makeRng(1) });
    expect(adjustedRandScore(truth, res.labels)).toBe(1);
    expect(res.centers).toHaveLength(3);
  });

  it('kmeansClusterAutoK picks k=3 by silhouette, or uses a forced k', () => {
    const { X, truth } = blobs();
    const auto = kmeansClusterAutoK(X, {});
    expect(auto.k).toBe(3);
    expect(adjustedRandScore(truth, auto.labels)).toBe(1);
    expect(auto.scores.map((s) => s.k)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(kmeansClusterAutoK(X, { k: 2 }).k).toBe(2);
  });

  it('kmeansClusterAutoK skips k >= n', () => {
    const res = kmeansClusterAutoK([[0], [0.1], [5], [5.1]], {});
    expect(res.scores.map((s) => s.k)).toEqual([2, 3]);
  });
});

describe('hierarchicalClusterAverageLinkage', () => {
  it('cuts the dendrogram at k clusters, labelling from 1', () => {
    const pts = [0, 1, 10, 11, 30];
    const D = pts.map((a) => pts.map((b) => Math.abs(a - b)));
    const labels = hierarchicalClusterAverageLinkage(D, 3);
    expect(new Set(labels).size).toBe(3);
    expect(labels[0]).toBe(labels[1]);
    expect(labels[2]).toBe(labels[3]);
    expect(Math.min(...labels)).toBe(1);
  });
});

describe('random forest', () => {
  it('columnShuffle permutes each column independently', () => {
    const X = [[1, 10], [2, 20], [3, 30], [4, 40]];
    const S = columnShuffle(X, makeRng(5));
    for (const j of [0, 1]) expect(S.map((r) => r[j]).sort((a, b) => a - b)).toEqual(X.map((r) => r[j]));
  });

  it('giniImpurity', () => {
    expect(giniImpurity([5, 5], 10)).toBe(0.5);
    expect(giniImpurity([10, 0], 10)).toBe(0);
    expect(giniImpurity([0, 0], 0)).toBe(0);
  });

  it('a single CART tree separates linearly separable classes', () => {
    const X = [[0], [1], [2], [10], [11], [12]], y = [0, 0, 0, 1, 1, 1];
    const tree = buildCARTTree(X, y, [0, 1, 2, 3, 4, 5], 2, 1, 1, makeRng(1), new Float64Array(1), { next: 0 });
    expect(tree.threshold).toBe(6);
    expect(applyTree(tree, [3]).majority).toBe(0);
    expect(applyTree(tree, [9]).majority).toBe(1);
  });

  it('rfProximityClustering recovers the blobs with normalised importances', () => {
    // Unsupervised RF is noisy on very small sets (10/blob gives ARI 0.65-0.9),
    // so use 15/blob and a threshold rather than demanding a perfect match.
    const { X, truth } = blobs(15);
    const res = rfProximityClustering(X, 3, { nEstimators: 60 });
    expect(adjustedRandScore(truth, res.labels)).toBeGreaterThan(0.8);
    expect(res.importances.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 9);
    expect(res.proximity[0][0]).toBe(1);
  });
});
