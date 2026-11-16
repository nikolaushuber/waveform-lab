// ---------------- WAV header parse (best-effort) ----------------
export function parseWavHeader(buf){
  try{
    const dv = new DataView(buf);
    if (dv.getUint32(0,false) !== 0x52494646) return null; // "RIFF"
    let offset = 12;
    let fmt = null;
    while (offset < dv.byteLength - 8){
      const id = String.fromCharCode(dv.getUint8(offset),dv.getUint8(offset+1),dv.getUint8(offset+2),dv.getUint8(offset+3));
      const size = dv.getUint32(offset+4,true);
      if (id === 'fmt '){
        fmt = {
          audioFormat: dv.getUint16(offset+8,true),
          numChannels: dv.getUint16(offset+10,true),
          sampleRate: dv.getUint32(offset+12,true),
          byteRate: dv.getUint32(offset+16,true),
          blockAlign: dv.getUint16(offset+20,true),
          bitsPerSample: dv.getUint16(offset+22,true),
        };
        break;
      }
      offset += 8 + size + (size % 2);
    }
    return fmt;
  }catch(e){ return null; }
}
