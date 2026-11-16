// Web Worker that runs the Python analysis (python/waveform_lab) in Pyodide,
// off the main thread. Protocol:
//   in:  { id, fn, payload, arrays }  -> calls waveform_lab.bridge.<fn>(JSON payload, arrays)
//   out: { type: 'status', message } while loading, { type: 'ready' } once,
//        { id, result } or { id, error } per call.
import initSrc from '../../python/waveform_lab/__init__.py?raw';
import bridgeSrc from '../../python/waveform_lab/bridge.py?raw';
import clusteringSrc from '../../python/waveform_lab/clustering.py?raw';
import tapSrc from '../../python/waveform_lab/tap.py?raw';

// Keep in sync with python/pyproject.toml (same Python / numpy / scipy / sklearn).
export const PYODIDE_VERSION = '314.0.4';
const PYODIDE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/pyodide.mjs`;

const status = (message) => self.postMessage({ type: 'status', message });

async function boot() {
  status('Loading Python runtime (Pyodide)…');
  const { loadPyodide } = await import(/* @vite-ignore */ PYODIDE_URL);
  const pyodide = await loadPyodide();

  status('Loading numpy / scipy / scikit-learn (first run only, ~40 MB)…');
  await pyodide.loadPackage(['numpy', 'scipy', 'scikit-learn']);

  const dir = '/home/pyodide/waveform_lab';
  pyodide.FS.mkdirTree(dir);
  for (const [name, src] of Object.entries({ '__init__.py': initSrc, 'bridge.py': bridgeSrc, 'clustering.py': clusteringSrc, 'tap.py': tapSrc })) {
    pyodide.FS.writeFile(`${dir}/${name}`, src);
  }
  const bridge = pyodide.pyimport('waveform_lab.bridge');
  self.postMessage({ type: 'ready' });
  return bridge;
}

const ready = boot();
ready.catch((err) => self.postMessage({ type: 'failed', error: String(err && err.message || err) }));

self.onmessage = async ({ data: { id, fn, payload, arrays } }) => {
  try {
    const bridge = await ready;
    const result = bridge[fn](JSON.stringify(payload), arrays);
    self.postMessage({ id, result: JSON.parse(result) });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
