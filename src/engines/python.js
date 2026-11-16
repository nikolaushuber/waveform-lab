// Main-thread client for the Python analysis worker (python-worker.js).
//
//   startPython()                 begin loading Pyodide in the background (idempotent)
//   onPythonStatus(cb)            loading progress messages; returns an unsubscribe fn
//   callPython(fn, payload, arrays) -> Promise<result object>
//
// `arrays` (Float32Arrays) are transferred, not copied: don't reuse them.
let worker = null;
let ready = null;
let nextId = 1;
const pending = new Map();
const listeners = new Set();

function reset(err) {
  for (const { reject } of pending.values()) reject(err);
  pending.clear();
  if (worker) worker.terminate();
  worker = null;
  ready = null; // the next call retries from scratch (e.g. after going back online)
}

export function startPython() {
  if (ready) return ready;
  worker = new Worker(new URL('./python-worker.js', import.meta.url), { type: 'module' });
  ready = new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      if (data.type === 'status') { for (const cb of listeners) cb(data.message); return; }
      if (data.type === 'ready') { resolve(); return; }
      if (data.type === 'failed') { const err = new Error(data.error); reject(err); reset(err); return; }
      const call = pending.get(data.id);
      if (!call) return;
      pending.delete(data.id);
      if ('error' in data) call.reject(new Error(data.error)); else call.resolve(data.result);
    };
    worker.onerror = (e) => { const err = new Error(e.message || 'Python worker failed to start'); reject(err); reset(err); };
  });
  ready.catch(() => {}); // failures surface through callPython
  return ready;
}

export function onPythonStatus(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export async function callPython(fn, payload, arrays = []) {
  await startPython();
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, fn, payload, arrays }, arrays.map((a) => a.buffer));
  });
}

// Waits until Python is ready, reporting loading progress to onStatus
// (only called if it is still loading). Rejects if Pyodide can't load.
export async function waitForPython(onStatus) {
  const off = onPythonStatus(onStatus);
  try { await startPython(); } finally { off(); }
}
