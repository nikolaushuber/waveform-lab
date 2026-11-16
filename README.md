# Waveform Lab

Browser-based `.wav` analysis: playback with freeze-frame spectra, snapshot
comparison, tap/pluck frequency analysis, and unsupervised clustering of taps.

The analysis (Tap Analyser, Clustering) is Python — numpy, scipy,
scikit-learn — running in the browser via [Pyodide](https://pyodide.org) in a
Web Worker. The UI, audio playback and the interactive spectrum views are
JavaScript.

## Development

Requires Node (see `.nvmrc`) and [uv](https://docs.astral.sh/uv/).

```bash
npm install
npx playwright install chromium   # once, for the browser tests
npm run dev                       # dev server with reload
npm run build                     # static site in dist/
npm test                          # JS unit + golden tests (Vitest)
npm run coverage                  # same, with coverage thresholds for src/core
npm run test:e2e                  # browser smoke tests (Playwright, against the build)
```

```bash
cd python
uv run pytest                     # Python analysis tests
```

The page uses ES modules, so it has to be served (`npm run dev`, or any
static server for `dist/`); opening `index.html` from disk won't work.

Pyodide and the scientific packages (~40 MB) load from the jsDelivr CDN when
the page opens, then come from the browser cache. The first analysis run on a
new machine needs an internet connection.

## Layout

```
python/
  waveform_lab/
    tap.py         Tap Analyser pipeline (analyse_tap_samples)
    clustering.py  tap features, k-means, random-forest proximity clustering
    bridge.py      JSON + Float32Array entry points called from the browser
  tests/           pytest, against the golden files
src/
  engines/         python-worker.js (Pyodide in a Web Worker) + python.js (client)
  core/            JS maths for the interactive views: snapshot spectrum, FFT,
                   WAV header, mono downmix — synchronous, so it stays in JS
  platform/        IndexedDB persistence
  ui/              pages, views, DOM lookups (dom.js) and shared UI state (state.js)
  main.js          startup
tests/
  unit/            Vitest tests for src/core
  golden/          frozen outputs (see below)
  e2e/             Playwright smoke tests, one per tab
```

The Python package versions in `python/pyproject.toml` are pinned to what the
Pyodide release in `src/engines/python-worker.js` ships; update both together.

### Golden files

`tests/golden/*.json` freeze outputs on fixed synthetic recordings
(`tests/helpers/fixtures.js`, mirrored by `python/tests/fixtures.py`):

- `tap-analysis-*.json`, `clustering.json` — from the original JavaScript
  pipelines; the Python port must reproduce them (the originals the JS was
  ported from are lost, so these are the reference behaviour).
- `clustering-py.json` — the Python clustering result. Regenerate on purpose
  with `UPDATE_GOLDEN=1 uv run pytest`.
- `spectrum-chord.json`, `fixtures.json` — written by the JS tests;
  regenerate on purpose with `npm test -- -u`.

Review the diff whenever one of them changes.
