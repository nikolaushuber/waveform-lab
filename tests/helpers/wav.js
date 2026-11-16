// Minimal 16-bit PCM WAV encoder (RIFF / "fmt " / "data").
export function encodeWav(channels, sampleRate, { extraChunk = null } = {}) {
  const chans = Array.isArray(channels) ? channels : [channels];
  const numChannels = chans.length;
  const n = chans[0].length;
  const blockAlign = numChannels * 2;
  const dataSize = n * blockAlign;
  const extraSize = extraChunk ? 8 + extraChunk.data.length + (extraChunk.data.length % 2) : 0;
  const buf = new ArrayBuffer(12 + extraSize + 24 + 8 + dataSize);
  const dv = new DataView(buf);
  let o = 0;
  const str = (s) => { for (const ch of s) dv.setUint8(o++, ch.charCodeAt(0)); };

  str('RIFF'); dv.setUint32(o, buf.byteLength - 8, true); o += 4; str('WAVE');
  if (extraChunk) {
    str(extraChunk.id); dv.setUint32(o, extraChunk.data.length, true); o += 4;
    for (const b of extraChunk.data) dv.setUint8(o++, b);
    if (extraChunk.data.length % 2) o++;
  }
  str('fmt '); dv.setUint32(o, 16, true); o += 4;
  dv.setUint16(o, 1, true); o += 2;                       // PCM
  dv.setUint16(o, numChannels, true); o += 2;
  dv.setUint32(o, sampleRate, true); o += 4;
  dv.setUint32(o, sampleRate * blockAlign, true); o += 4;
  dv.setUint16(o, blockAlign, true); o += 2;
  dv.setUint16(o, 16, true); o += 2;
  str('data'); dv.setUint32(o, dataSize, true); o += 4;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < numChannels; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      dv.setInt16(o, Math.round(s * 32767), true); o += 2;
    }
  }
  return buf;
}
