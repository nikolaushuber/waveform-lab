// Plays an AudioBuffer from any position, with pause and a position query.
// One shared AudioContext, created on first play (browsers only allow audio
// to start from a user gesture).
let ctx = null;

export function createPlayer({ onEnded } = {}){
  let source = null;
  let buffer = null;
  let startedAt = 0;   // ctx.currentTime when playback (re)started
  let offset = 0;      // buffer position (s) at startedAt

  function stopSource(){
    if (!source) return;
    source.onended = null;
    try { source.stop(); } catch (e) { /* already stopped */ }
    source.disconnect();
    source = null;
  }

  return {
    get playing(){ return !!source; },
    position(){
      if (!buffer) return 0;
      return source ? Math.min(buffer.duration, offset + (ctx.currentTime - startedAt)) : offset;
    },
    play(audioBuffer, from){
      ctx ??= new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      stopSource();
      buffer = audioBuffer;
      offset = Math.min(Math.max(0, from), Math.max(0, buffer.duration - 0.001));
      source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.onended = () => { source = null; offset = buffer.duration; if (onEnded) onEnded(); };
      startedAt = ctx.currentTime;
      source.start(0, offset);
    },
    pause(){
      offset = this.position();
      stopSource();
    },
    // Move the position; keeps playing if it was.
    seek(audioBuffer, to){
      if (source) this.play(audioBuffer, to);
      else { buffer = audioBuffer; offset = Math.min(Math.max(0, to), audioBuffer.duration); }
    },
    stop(){ stopSource(); offset = 0; },
  };
}
