// ---------------- Utils ----------------
export function fmtTime(t){
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t/60);
  const s = t - m*60;
  return `${m}:${s.toFixed(3).padStart(6,'0')}`;
}
export function fmtBytes(n){
  if (n < 1024) return n + ' B';
  if (n < 1024*1024) return (n/1024).toFixed(1) + ' KB';
  return (n/1024/1024).toFixed(2) + ' MB';
}
export function fmtHz(f){
  if (f >= 1000) return (f/1000).toFixed(2) + ' kHz';
  return f.toFixed(1) + ' Hz';
}
export function uid(){ return Math.random().toString(36).slice(2,10); }

// Keeps a file library sorted alphabetically (naturally, so "file2" sorts
// before "file10") by name — used whenever a list is loaded or restored.
export function sortByName(arr){
  arr.sort((a,b) => a.name.localeCompare(b.name, undefined, {numeric:true, sensitivity:'base'}));
}
