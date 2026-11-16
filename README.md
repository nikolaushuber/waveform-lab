# Waveform Lab

Browser-based `.wav` analysis: playback with freeze-frame spectra, snapshot
comparison, tap/pluck frequency analysis, and unsupervised clustering of taps.

## Development

Requires Node (see `.nvmrc`).

```bash
npm install
npx playwright install chromium   # once, for the browser tests
npm run dev                       # dev server with reload
npm run build                     # static site in dist/
npm test                          # unit + golden tests (Vitest)
npm run coverage                  # same, with coverage thresholds for src/core
npm run test:e2e                  # browser smoke tests (Playwright, against the build)
```

The page uses ES modules, so it has to be served (`npm run dev`, or any
static server for `dist/`); opening `index.html` from disk won't work.

`E2E_PYODIDE=1 npm run test:e2e` also runs the Pyodide clustering engine
(downloads ~40 MB).

## Layout

```
src/
  core/       analysis code: plain numbers in, plain numbers out, no DOM
    fft.js, signal.js, spectrum.js, wav.js, mono.js
    tap/      Tap Analyser pipeline (analyseTapSamples)
    cluster/  clustering features (extractTapFeatures)
    ml/       k-means, random forest, hierarchical clustering, metrics
  engines/    Pyodide runner + random_forest.py (the Python clustering engine)
  platform/   IndexedDB persistence
  ui/         pages, views, DOM lookups (dom.js) and shared UI state (state.js)
  main.js     startup
tests/
  unit/       Vitest tests for src/core
  golden/     frozen pipeline outputs (see below)
  e2e/        Playwright smoke tests, one per tab
```

`src/core` is deliberately kept free of browser APIs: it is the part meant
to be replaced by Python later, behind the same function signatures.

### Golden files

`tests/golden/*.json` freeze the outputs of the analysis pipelines on fixed
synthetic recordings (`tests/helpers/fixtures.js`). They are the reference
behaviour — the original Python scripts these pipelines were ported from are
not available — and any future Python port should reproduce them. If you
change an algorithm on purpose, regenerate them with `npm test -- -u` and
review the diff.
