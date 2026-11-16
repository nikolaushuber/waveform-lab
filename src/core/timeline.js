// Visible time window of a zoomable recording view: { start, end } in
// seconds. Pure helpers, shared by the Tap Analyser's recording editor.

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// Keep the window inside [0, dur] and at least `minSpan` wide.
export function clampWindow(start, end, dur, minSpan){
  const span = clamp(end - start, Math.min(minSpan, dur), dur);
  const s = clamp(start, 0, dur - span);
  return { start: s, end: s + span };
}

// Zoom by `factor` (< 1 zooms in) keeping time `anchor` at the same place on screen.
export function zoomWindow(win, factor, anchor, dur, minSpan){
  const span = win.end - win.start;
  const next = clamp(span * factor, Math.min(minSpan, dur), dur);
  const frac = span > 0 ? (anchor - win.start) / span : 0.5;
  const start = anchor - frac * next;
  return clampWindow(start, start + next, dur, minSpan);
}

export function panWindow(win, deltaSec, dur, minSpan){
  return clampWindow(win.start + deltaSec, win.end + deltaSec, dur, minSpan);
}

// Scrolls the window so that `t` is visible: a playhead that runs off the
// right edge reappears 10% in from the left ("page flip").
export function followTime(win, t, dur, minSpan){
  if (t >= win.start && t <= win.end) return win;
  const span = win.end - win.start;
  const start = t - 0.1 * span;
  return clampWindow(start, start + span, dur, minSpan);
}

// Tick positions for a time axis: a 1-2-5 step giving at most `maxTicks`.
export function niceTicks(start, end, maxTicks = 7){
  const span = end - start;
  if (!(span > 0)) return [];
  const raw = span / maxTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const ticks = [];
  for (let t = Math.ceil(start / step) * step; t <= end + step * 1e-9; t += step) ticks.push(Math.round(t / step) * step);
  return ticks;
}
