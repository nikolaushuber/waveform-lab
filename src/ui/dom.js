export const el = (id) => document.getElementById(id);
export const fileInput = el('fileInput');
export const dropzone = el('dropzone');
export const fileList = el('fileList');
export const fileCount = el('fileCount');
export const nowPlayingLabel = el('nowPlayingLabel');
export const playBtn = el('playBtn');
export const stopBtn = el('stopBtn');
export const curTimeEl = el('curTime');
export const durTimeEl = el('durTime');
export const scrub = el('scrub');
export const waveCanvas = el('waveCanvas');
export const sampleOffsetInput = el('sampleOffset');
export const sampleBtn = el('sampleBtn');
export const fftCanvas = el('fftCanvas');
export const screenBadge = el('screenBadge');
export const screenStamp = el('screenStamp');
export const sheetBody = el('sheetBody');
export const sheetSub = el('sheetSub');
export const exportBtn = el('exportBtn');

export const fileInputCompare = el('fileInputCompare');
export const dropzoneCompare = el('dropzoneCompare');
export const compareFileCount = el('compareFileCount');
export const compareRows = el('compareRows');
export const compareCanvas = el('compareCanvas');
export const compareLegend = el('compareLegend');
export const compareCursorInfo = el('compareCursorInfo');
export const clearCompareBtn = el('clearCompareBtn');
export const previewCanvas = el('previewCanvas');
export const previewLabel = el('previewLabel');

// Tap analyser page
export const fileInputTap = el('fileInputTap');
export const dropzoneTap = el('dropzoneTap');
export const tapFileCount = el('tapFileCount');
export const tapRows = el('tapRows');
export const runTapBtn = el('runTapBtn');
export const tapStatus = el('tapStatus');
export const scatterCanvas = el('scatterCanvas');
export const scatterLegend = el('scatterLegend');
export const scatterTooltip = el('scatterTooltip');
export const tapResultsBody = el('tapResultsBody');
export const tapTopNSelect = el('tapTopNSelect');
export const tapFreqRangeLabel = el('tapFreqRangeLabel');
export const tapMetricSelect = el('tapMetric');
export const tapMetricNote = el('tapMetricNote');

// Clustering page state
export const dropzoneCluster = el('dropzoneCluster');
export const fileInputCluster = el('fileInputCluster');
export const clusterRows = el('clusterRows');
export const clusterFileCount = el('clusterFileCount');
export const runClusterBtn = el('runClusterBtn');
export const clusterStatus = el('clusterStatus');
export const clusterResultsBody = el('clusterResultsBody');

// File Folder page state
export const dropzoneFolder = el('dropzoneFolder');
export const fileInputFolder = el('fileInputFolder');
export const folderDirInput = el('folderDirInput');
export const dropzoneFolderMenu = el('dropzoneFolderMenu');
export const dzChooseFiles = el('dzChooseFiles');
export const dzChooseFolder = el('dzChooseFolder');
export const folderRows = el('folderRows');
export const folderFileCount = el('folderFileCount');
export const folderSearchInput = el('folderSearchInput');
export const folderNewFolderBtn = el('folderNewFolderBtn');
export const folderCrumbs = el('folderCrumbs');

// "Load from local folder" buttons next to each tool's dropzone
export const loadFromFolderBtnAnalyze = el('loadFromFolderBtnAnalyze');
export const loadFromFolderBtnCompare = el('loadFromFolderBtnCompare');
export const loadFromFolderBtnTap = el('loadFromFolderBtnTap');
export const loadFromFolderBtnCluster = el('loadFromFolderBtnCluster');
