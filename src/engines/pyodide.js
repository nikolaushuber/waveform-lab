import PYTHON_CLUSTERING_SOURCE from './random_forest.py?raw';

// ---------------- Clustering: "real Python" engine via Pyodide ----------------
// Runs the *actual* functions from random_forest.py (kept verbatim in ./random_forest.py)
// inside the browser using a real CPython + numpy/scipy/scikit-learn build
// (Pyodide, compiled to WebAssembly) instead of the JS reimplementation
// in src/core. This is the only way to get results that match your local Python
// run, since JS and Python use different underlying random-number
// generators for the Random Forest step — no amount of careful JS porting
// can reproduce numpy's exact random sequence.
export const PYODIDE_CDN = 'https://cdn.jsdelivr.net/pyodide/v314.0.4/full/pyodide.js';
let pyodideInstance = null;
let pyodidePackagesReady = false;
let pyodideLoadPromise = null;

export function loadPyodideScriptTag(){
  return new Promise((resolve, reject) => {
    if (window.loadPyodide){ resolve(); return; }
    const existing = document.querySelector(`script[src="${PYODIDE_CDN}"]`);
    if (existing){
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Could not load the Pyodide script from ' + PYODIDE_CDN)));
      return;
    }
    const s = document.createElement('script');
    s.src = PYODIDE_CDN;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load the Pyodide script from ' + PYODIDE_CDN + ' — check your internet connection.'));
    document.head.appendChild(s);
  });
}

// Verbatim (I/O and CLI-plumbing stripped) port of the algorithmic core of
// random_forest.py, plus a thin JSON-in/JSON-out bridge function at the
// bottom. Every function between the markers in it is copied unmodified
// from the uploaded script — only load_wav_mono's file-reading and
// build_dataset_unlabeled's folder-globbing were replaced, since audio
// decoding happens in the browser (Web Audio API) rather than via
// scipy.io.wavfile.read.

export async function ensurePyodideReady(onStatus){
  if (pyodideInstance && pyodidePackagesReady) return pyodideInstance;
  if (pyodideLoadPromise) return pyodideLoadPromise;

  pyodideLoadPromise = (async () => {
    onStatus('Loading Python runtime (Pyodide)…');
    await loadPyodideScriptTag();
    pyodideInstance = await window.loadPyodide();

    onStatus('Loading numpy / scipy / scikit-learn (first run only, ~40MB, needs internet)…');
    await pyodideInstance.loadPackage(['numpy', 'scipy', 'scikit-learn']);

    onStatus('Preparing the clustering pipeline…');
    await pyodideInstance.runPythonAsync(PYTHON_CLUSTERING_SOURCE);

    pyodidePackagesReady = true;
    return pyodideInstance;
  })();

  try{
    return await pyodideLoadPromise;
  }catch(err){
    pyodideLoadPromise = null; // allow retrying on the next Run click
    throw err;
  }
}
