import { fmtTime } from '../format.js';

// ---------------- Drawing: waveform overview ----------------
// `durationSec`, if given, adds time-axis tick labels along the bottom
// (used on the bigger Compare-page previews for extra detail).
// `gain` (default 1) scales the amplitude; louder parts are clipped.
export function drawWaveformOverview(canvasEl, audioBuffer, playheadFrac, durationSec, gain = 1){
  const ctx = canvasEl.getContext('2d');
  const w = canvasEl.width, h = canvasEl.height;
  ctx.clearRect(0,0,w,h);
  ctx.fillStyle = '#f4f4f0';
  ctx.fillRect(0,0,w,h);

  const mid = h/2;

  // subtle horizontal centre + quarter lines for amplitude reference
  ctx.strokeStyle = '#e2e2dc';
  ctx.lineWidth = 1;
  [0.25, 0.5, 0.75].forEach(f => {
    const y = h*f;
    ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke();
  });

  const data = audioBuffer.getChannelData(0);
  const step = Math.ceil(data.length / w);
  ctx.strokeStyle = '#1f9d5c';
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  for (let x = 0; x < w; x++){
    let min = 1, max = -1;
    const start = x*step;
    for (let i = 0; i < step; i++){
      const v = data[start+i] || 0;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const lo = Math.max(-1, Math.min(1, min*gain)), hi = Math.max(-1, Math.min(1, max*gain));
    ctx.moveTo(x, mid + lo*mid*0.9);
    ctx.lineTo(x, mid + hi*mid*0.9);
  }
  ctx.stroke();

  if (durationSec){
    ctx.fillStyle = '#8a8a83';
    ctx.font = '13px "JetBrains Mono", monospace';
    const nTicks = 6;
    for (let i = 0; i <= nTicks; i++){
      const frac = i/nTicks;
      const x = frac*w;
      ctx.strokeStyle = '#eaeae5';
      ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke();
      const label = fmtTime(frac*durationSec);
      const lx = i === nTicks ? w - ctx.measureText(label).width - 4 : (i === 0 ? 4 : x - 20);
      ctx.fillText(label, lx, h - 6);
    }
  }

  if (typeof playheadFrac === 'number'){
    const x = playheadFrac*w;
    ctx.strokeStyle = '#111111';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x,0); ctx.lineTo(x,h);
    ctx.stroke();
  }
}

// Waveform of `audioBuffer` (channel 0) between t0 and t1 seconds, with a
// time axis. Zoomed out it draws a min/max bar per pixel; zoomed in far
// enough to see individual samples it draws a line through them. `gain`
// scales the amplitude (louder parts are clipped at the edges).
export function drawWaveformRange(canvasEl, audioBuffer, t0, t1, ticks, gain = 1){
  const ctx = canvasEl.getContext('2d');
  const w = canvasEl.width, h = canvasEl.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#f4f4f0';
  ctx.fillRect(0, 0, w, h);
  const mid = h / 2;

  ctx.strokeStyle = '#e2e2dc';
  ctx.lineWidth = 1;
  [0.25, 0.5, 0.75].forEach((f) => { ctx.beginPath(); ctx.moveTo(0, h * f); ctx.lineTo(w, h * f); ctx.stroke(); });

  const sr = audioBuffer.sampleRate;
  const data = audioBuffer.getChannelData(0);
  const perPx = ((t1 - t0) * sr) / w;
  const yOf = (v) => mid - Math.max(-1, Math.min(1, v * gain)) * mid * 0.9;
  ctx.strokeStyle = '#1f9d5c';
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  if (perPx >= 1){
    for (let x = 0; x < w; x++){
      const a = Math.floor(t0 * sr + x * perPx), b = Math.max(a + 1, Math.floor(t0 * sr + (x + 1) * perPx));
      let min = 1, max = -1;
      for (let i = Math.max(0, a); i < Math.min(data.length, b); i++){ const v = data[i]; if (v < min) min = v; if (v > max) max = v; }
      if (max < min) continue;
      ctx.moveTo(x + 0.5, yOf(max)); ctx.lineTo(x + 0.5, yOf(min));
    }
  } else {
    const first = Math.max(0, Math.floor(t0 * sr)), last = Math.min(data.length - 1, Math.ceil(t1 * sr));
    for (let i = first; i <= last; i++){
      const x = ((i / sr - t0) / (t1 - t0)) * w;
      if (i === first) ctx.moveTo(x, yOf(data[i])); else ctx.lineTo(x, yOf(data[i]));
    }
  }
  ctx.stroke();

  ctx.font = '13px "JetBrains Mono", monospace';
  for (const t of ticks || []){
    const x = ((t - t0) / (t1 - t0)) * w;
    ctx.strokeStyle = '#eaeae5';
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    const label = fmtTime(t);
    ctx.fillStyle = '#8a8a83';
    ctx.fillText(label, Math.min(w - ctx.measureText(label).width - 4, Math.max(4, x + 4)), h - 6);
  }
}
