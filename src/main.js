import { init as initUiPagesTap } from './ui/pages/tap.js';
import { init as initTapRecording } from './ui/pages/tap-recording.js';
import { init as initUiPagesCluster } from './ui/pages/cluster.js';
import { init as initUiPagesCompare } from './ui/pages/compare.js';
import { init as initUiPagesFolder } from './ui/pages/folder.js';
import { init as initUiFolderPicker } from './ui/folder-picker.js';
import { init as initUiTabs } from './ui/tabs.js';
import { init as initUiAxisControls } from './ui/axis-controls.js';
import { init as initUiPagesAnalyze } from './ui/pages/analyze.js';
import { init as initUiResizable } from './ui/resizable.js';
import { startPython } from './engines/python.js';
import { updateFreqRangeLabels } from './ui/axis-controls.js';
import { renderClusterRows } from './ui/pages/cluster.js';
import { drawCompareGraph, renderCompareRows, resetPreview } from './ui/pages/compare.js';
import { renderFolderRows, restoreLibraries } from './ui/pages/folder.js';
import { renderTapRows } from './ui/pages/tap.js';
import { resetScreen } from './ui/views/spectrum.js';

initUiPagesTap();
initTapRecording();
initUiPagesCluster();
initUiPagesCompare();
initUiPagesFolder();
initUiFolderPicker();
initUiTabs();
initUiAxisControls();
initUiPagesAnalyze();
initUiResizable();

// ---------------- Init ----------------
resetScreen('idle');
renderCompareRows();
drawCompareGraph();
resetPreview();
updateFreqRangeLabels();
renderTapRows();
renderClusterRows();
renderFolderRows();
restoreLibraries();

// Start loading the Python analysis engine (Pyodide, in a Web Worker) right
// away, so it's usually ready by the time Tap Analyser / Clustering run.
startPython();
