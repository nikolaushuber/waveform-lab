// Mono downmix of a Web Audio AudioBuffer (or anything shaped like one:
// {sampleRate, numberOfChannels, length, getChannelData(c)}) — the channel
// average, as a fresh Float32Array.
export function toMono(audioBuffer){
  const nCh = audioBuffer.numberOfChannels;
  if (nCh === 1) return audioBuffer.getChannelData(0).slice();
  const n = audioBuffer.length;
  const samples = new Float32Array(n);
  for (let c = 0; c < nCh; c++){
    const ch = audioBuffer.getChannelData(c);
    for (let i = 0; i < n; i++) samples[i] += ch[i]/nCh;
  }
  return samples;
}
