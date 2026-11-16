import { describe, it, expect } from 'vitest';
import { clampWindow, followTime, niceTicks, panWindow, zoomWindow } from '../../src/core/timeline.js';

const DUR = 20, MIN = 0.005;

describe('timeline window', () => {
  it('clampWindow keeps the window inside the file and at least minSpan wide', () => {
    expect(clampWindow(-2, 3, DUR, MIN)).toEqual({ start: 0, end: 5 });
    expect(clampWindow(18, 23, DUR, MIN)).toEqual({ start: 15, end: 20 });
    expect(clampWindow(-5, 50, DUR, MIN)).toEqual({ start: 0, end: 20 });
    const tiny = clampWindow(1, 1.001, DUR, MIN);
    expect(tiny.end - tiny.start).toBeCloseTo(MIN, 12);
  });

  it('zoomWindow keeps the anchor at the same place on screen', () => {
    const z = zoomWindow({ start: 0, end: 20 }, 0.25, 15, DUR, MIN); // anchor at 75%
    expect(z.end - z.start).toBeCloseTo(5, 12);
    expect((15 - z.start) / (z.end - z.start)).toBeCloseTo(0.75, 12);
    expect(zoomWindow(z, 100, 15, DUR, MIN)).toEqual({ start: 0, end: 20 }); // can't zoom past the file
    const deep = zoomWindow({ start: 0, end: 20 }, 1e-9, 3, DUR, MIN);
    expect(deep.end - deep.start).toBeCloseTo(MIN, 12);
  });

  it('panWindow shifts without changing the span, stopping at the ends', () => {
    expect(panWindow({ start: 2, end: 4 }, 1.5, DUR, MIN)).toEqual({ start: 3.5, end: 5.5 });
    expect(panWindow({ start: 2, end: 4 }, -10, DUR, MIN)).toEqual({ start: 0, end: 2 });
    expect(panWindow({ start: 2, end: 4 }, 100, DUR, MIN)).toEqual({ start: 18, end: 20 });
  });

  it('followTime leaves a visible time alone and page-flips to an off-screen one', () => {
    const win = { start: 2, end: 4 };
    expect(followTime(win, 3, DUR, MIN)).toBe(win);
    const next = followTime(win, 4.5, DUR, MIN);
    expect(next.start).toBeCloseTo(4.3, 12);
    expect(next.end - next.start).toBeCloseTo(2, 12);
  });

  it('niceTicks uses 1-2-5 steps', () => {
    expect(niceTicks(0, 20, 7)).toEqual([0, 5, 10, 15, 20]);
    expect(niceTicks(1.03, 1.11, 5)).toEqual([1.04, 1.06, 1.08, 1.1]);
    expect(niceTicks(3, 3, 5)).toEqual([]);
  });
});
