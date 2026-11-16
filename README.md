# Waveform Lab

Browser-based `.wav` analysis: playback with freeze-frame spectra, snapshot
comparison, tap/pluck frequency analysis, and unsupervised clustering of taps.

## Development

Requires Node (see `.nvmrc`).

```bash
npm install
npx playwright install chromium   # once, for the browser tests
npm run serve                     # http://localhost:4173
npm test                          # unit + golden tests (Vitest)
npm run test:e2e                  # browser smoke tests (Playwright)
```

`E2E_PYODIDE=1 npm run test:e2e` also runs the Pyodide clustering engine
(downloads ~40 MB).

### Golden files

`tests/golden/*.json` freeze the outputs of the analysis pipelines on fixed
synthetic recordings (`tests/helpers/fixtures.js`). They are the reference
behaviour — the original Python scripts these pipelines were ported from are
not available — and any future Python port should reproduce them. If you
change an algorithm on purpose, regenerate them with `npm test -- -u` and
review the diff.
