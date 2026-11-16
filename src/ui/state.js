// Mutable UI state shared between modules (formerly top-level `let`s in script.js).
export const S = {
  // ---------------- State ----------------
  library: [], // {id, name, size, url, audioBuffer, wavInfo}
  activeId: null,
  folderLibrary: [], // shared local File Folder: {id, name, size, audioBuffer, skipStart:'', skipEnd:'', folderId:null, _rawBuffer}
  folderGroups: [], // named folders within the File Folder tab: {id, name}
  audioCtx: null,
  analyser: null,
  rafId: null,
  isPlaying: false,
  lastCapture: null, // {time, freqs, mags, peaks, rms, sampleRate}
  cursorFreq: null, // user-draggable readout line on the frozen graph
  compareTraces: [], // {id, color, entryName, time, capture}
  compareIdSeq: 0,
  compareCursorFreq: null,
  draggingCompareCursor: false,
  draggingTraceId: null,
  dragStartClientY: 0,
  dragStartOffset: 0,
  previewScheduled: false,
  pendingPreviewEntry: null,
  pendingPreviewTime: null,
  lastPreviewCapture: null,
  tapSelectedId: null, // file shown in the Tap Analyser's recording editor
  tapLibrary: [], // {id, name, size, audioBuffer, skipStart:'', skipEnd:'', included, _rawBuffer}
  clusterLibrary: [], // {id, name, size, audioBuffer, cropStart:'', cropEnd:'', included, _rawBuffer}
  clusterRunning: false,
  folderSearchQuery: '',
  folderExpandedIds: new Set(), // rows the user has clicked open, to show crop controls + summary FFT
  currentFolderGroupId: null, // null = root of the File Folder ("Files" not in any folder)
  folderMenuOpen: null, // {kind:'file'|'folder', id, mode:'main'|'move'} — the one open ⋮ menu
  folderRenaming: null, // {kind:'file'|'folder', id} — the one row mid-rename
  addingFolderGroup: false, // true while the inline "new folder" name input is showing

  // ---------------- Drawing: spectrum screen ----------------
  FREQ_MIN: 50,
  FREQ_MAX: 1000,
  freqScaleMode: 'linear', // 'linear' | 'log'
  OCTAVE_FRACTION: 1/24, // fractional-octave smoothing; 0 = off (raw)

  // Shared with traceYAtFreq (used when hit-testing/dragging a trace on the
  // Compare graph) so curve-picking stays in sync with whatever range
  // drawCompareGraph most recently auto-fit to.
  compareDbMin: -90,
  compareDbMax: 0,
};
