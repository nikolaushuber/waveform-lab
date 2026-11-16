import { S } from '../state.js';
import { applyHann } from '../../core/signal.js';
import { autoDbRange } from '../../core/spectrum.js';
import { computeFftMagExact } from '../../core/tap/peaks.js';
import { idbDelete, idbGetAll } from '../../platform/idb.js';
import { dropzoneFolder, dropzoneFolderMenu, dzChooseFiles, dzChooseFolder, fileInputFolder, folderCrumbs, folderDirInput, folderFileCount, folderNewFolderBtn, folderRows, folderSearchInput } from '../dom.js';
import { persistFolderEntry, persistFolderGroup } from '../folder-store.js';
import { fmtHz, sortByName, uid } from '../format.js';
import { drawWaveformOverview } from '../views/waveform.js';

// ---------------- File Folder page ----------------
// The one shared, persisted library. Files added here (and their Crop
// Start / Crop End) are saved to IndexedDB and can be pulled into any of
// the four tools above via their "Load from local folder" button.
// Shared decode/persist path for both single-file(s) upload and whole-
// folder upload — each file lands in `targetFolderId` (null = root).
export function ingestFolderFiles(fileArr, targetFolderId){
  [...fileArr].forEach(file => {
    if (!/\.wav$/i.test(file.name) && file.type !== 'audio/wav' && file.type !== 'audio/x-wav') return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      const arrayBuffer = e.target.result;
      try{
        const tmpCtx = new (window.AudioContext||window.webkitAudioContext)();
        const audioBuffer = await tmpCtx.decodeAudioData(arrayBuffer.slice(0));
        const entry = {
          id: uid(), name: file.name, size: file.size, audioBuffer,
          skipStart:'', skipEnd:'', folderId: targetFolderId,
          _rawBuffer: arrayBuffer.slice(0)
        };
        S.folderLibrary.push(entry);
        sortByName(S.folderLibrary);
        persistFolderEntry(entry);
        renderFolderRows();
        tmpCtx.close();
      }catch(err){
        console.error('Could not decode', file.name, err);
        alert(`Couldn't decode "${file.name}" as a WAV file.`);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

export function addFolderFiles(fileArr){
  const targetFolderId = S.currentFolderGroupId; // capture at drop-time, not decode-time
  ingestFolderFiles(fileArr, targetFolderId);
}

// "Upload a whole folder" — picks up every .wav file in the chosen
// computer folder (recursively, via webkitRelativePath) and auto-creates
// a matching File Folder group named after the top-level folder, so a
// folder full of tap recordings arrives already grouped. Subfolders below
// that top level are flattened into the same group. If a group with that
// name already exists, the files are merged into it instead of making a
// duplicate.
export function addFolderDirectory(fileArr){
  const wavFiles = [...fileArr].filter(f => /\.wav$/i.test(f.name) || f.type === 'audio/wav' || f.type === 'audio/x-wav');
  if (!wavFiles.length){
    alert('No .wav files found in that folder.');
    return;
  }
  const byTopFolder = new Map();
  wavFiles.forEach(f => {
    const rel = f.webkitRelativePath || f.name;
    const top = rel.includes('/') ? rel.split('/')[0] : 'Uploaded folder';
    if (!byTopFolder.has(top)) byTopFolder.set(top, []);
    byTopFolder.get(top).push(f);
  });
  byTopFolder.forEach((groupFiles, folderName) => {
    let group = S.folderGroups.find(g => g.name === folderName);
    if (!group){
      group = { id: uid(), name: folderName };
      S.folderGroups.push(group);
      sortByName(S.folderGroups);
      persistFolderGroup(group);
    }
    ingestFolderFiles(groupFiles, group.id);
  });
  renderFolderRows();
}

// ---- Drag-and-drop file/folder auto-detection for the File Folder
// dropzone. Dropping loose files behaves like the normal file picker;
// dropping a whole folder is detected via the (widely supported, if
// non-standard) File System Entries API and routed through the same
// auto-grouping path as picking a folder — all from the one dropzone,
// no separate control needed.

// A FileSystemDirectoryReader's readEntries() is only guaranteed to
// return *some* of a directory's entries per call — repeat until it
// returns an empty batch.
export function readAllDirectoryEntries(reader){
  return new Promise((resolve, reject) => {
    let all = [];
    const readBatch = () => {
      reader.readEntries((batch) => {
        if (!batch || !batch.length){ resolve(all); return; }
        all = all.concat(batch);
        readBatch();
      }, reject);
    };
    readBatch();
  });
}

// Converts a FileSystemFileEntry into a real File, tagging it with a
// webkitRelativePath so it can be treated exactly like a file picked via
// an OS folder picker (addFolderDirectory groups by the path's first
// segment).
export function fileFromEntry(entry, relPath){
  return new Promise((resolve, reject) => {
    entry.file((file) => {
      try{ Object.defineProperty(file, 'webkitRelativePath', { value: relPath, configurable:true }); }catch(err){}
      resolve(file);
    }, reject);
  });
}

// Recursively walks a dropped FileSystemEntry (file or directory) into a
// flat array of Files, building up each one's relative path as it goes.
export async function walkDroppedEntry(entry, relPath){
  if (entry.isFile){
    const path = relPath ? relPath + '/' + entry.name : entry.name;
    return [await fileFromEntry(entry, path)];
  }
  if (entry.isDirectory){
    const nextPrefix = relPath ? relPath + '/' + entry.name : entry.name;
    const children = await readAllDirectoryEntries(entry.createReader());
    const nested = await Promise.all(children.map(child => walkDroppedEntry(child, nextPrefix)));
    return nested.flat();
  }
  return [];
}

// Inspects everything dropped onto the File Folder dropzone, separating
// loose files (-> addFolderFiles, lands wherever you're browsing) from
// whole folders (-> addFolderDirectory, auto-grouped) — automatically,
// with no separate "upload a folder" control.
export async function handleFolderDrop(dataTransfer){
  if (!dataTransfer) return;
  const items = dataTransfer.items;
  if (!items || !items.length || typeof items[0].webkitGetAsEntry !== 'function'){
    // No File System Entries API support in this browser — fall back to
    // treating everything dropped as loose files.
    if (dataTransfer.files && dataTransfer.files.length) addFolderFiles(dataTransfer.files);
    return;
  }
  const entries = [...items].map(it => it.webkitGetAsEntry()).filter(Boolean);
  const looseFiles = [];
  const dirFiles = [];
  for (const entry of entries){
    if (entry.isFile){
      looseFiles.push(await fileFromEntry(entry, ''));
    } else if (entry.isDirectory){
      dirFiles.push(...await walkDroppedEntry(entry, ''));
    }
  }
  if (looseFiles.length) addFolderFiles(looseFiles);
  if (dirFiles.length) addFolderDirectory(dirFiles);
}

export function drawFolderRowWave(canvas, entry){
  drawWaveformOverview(canvas, entry.audioBuffer);
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const dur = entry.audioBuffer.duration || 1;
  const ss = parseFloat(entry.skipStart);
  const se = parseFloat(entry.skipEnd);
  ctx.fillStyle = 'rgba(194,59,46,0.16)';
  if (isFinite(ss) && ss > 0) ctx.fillRect(0, 0, Math.min(w, (ss/dur)*w), h);
  if (isFinite(se) && se > 0){
    const seStart = Math.max(0, dur-se);
    ctx.fillRect(Math.max(0,(seStart/dur)*w), 0, w - Math.max(0,(seStart/dur)*w), h);
  }
}

// Builds a single Hann-windowed FFT (up to 8192 samples, taken from the
// middle of the file) for the File Folder's "summary FFT" preview —
// respects this entry's Crop Start / Crop End first, same convention used
// everywhere else (Crop End = seconds trimmed off the end).
export function computeFolderSpectrum(entry){
  const audioBuffer = entry.audioBuffer;
  const sr = audioBuffer.sampleRate;
  const nCh = audioBuffer.numberOfChannels;
  let samples;
  if (nCh === 1){
    samples = audioBuffer.getChannelData(0).slice();
  } else {
    const n = audioBuffer.length;
    samples = new Float32Array(n);
    for (let c = 0; c < nCh; c++){
      const ch = audioBuffer.getChannelData(c);
      for (let i = 0; i < n; i++) samples[i] += ch[i]/nCh;
    }
  }

  const ssVal = (entry.skipStart||'').trim();
  const ssSec = ssVal !== '' ? parseFloat(ssVal) : 0;
  if (isFinite(ssSec) && ssSec > 0){
    samples = samples.subarray(Math.min(samples.length, Math.round(ssSec*sr)));
  }
  const seVal = (entry.skipEnd||'').trim();
  const seSec = seVal !== '' ? parseFloat(seVal) : 0;
  if (isFinite(seSec) && seSec > 0){
    const keepLen = Math.max(1, samples.length - Math.round(seSec*sr));
    samples = samples.subarray(0, keepLen);
  }
  if (samples.length < 16) return null;

  const M = Math.min(8192, samples.length);
  const startIdx = Math.max(0, Math.floor((samples.length - M) / 2));
  const windowed = applyHann(samples.subarray(startIdx, startIdx + M));
  const { freqs, mags } = computeFftMagExact(windowed, sr);
  return { freqs, mags, sr };
}

export function drawFolderSpectrum(canvas, entry){
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0,0,w,h);
  ctx.fillStyle = '#f4f4f0';
  ctx.fillRect(0,0,w,h);

  const spec = computeFolderSpectrum(entry);
  if (!spec){
    ctx.fillStyle = '#8f8f86';
    ctx.font = '13px "JetBrains Mono", monospace';
    ctx.fillText('Not enough audio to analyse (check Crop Start / Crop End).', 10, h/2);
    return;
  }
  const { freqs, mags, sr } = spec;
  const fMin = 0, fMax = Math.min(2000, sr/2);
  const binHz = freqs[1] - freqs[0];

  ctx.strokeStyle = '#e2e2dc';
  ctx.lineWidth = 1;
  const nTicks = 5;
  for (let i = 0; i <= nTicks; i++){
    const f = fMin + (i/nTicks)*(fMax-fMin);
    const x = (f-fMin)/(fMax-fMin)*w;
    ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke();
    ctx.fillStyle = '#6b6b64';
    ctx.font = '11px "JetBrains Mono", monospace';
    const label = fmtHz(f);
    const lx = Math.min(w - ctx.measureText(label).width - 4, Math.max(2, x+3));
    ctx.fillText(label, lx, h-4);
  }

  const loBin = Math.max(0, Math.floor(fMin/binHz));
  const hiBin = Math.min(freqs.length-1, Math.ceil(fMax/binHz));
  const dbVals = [];
  for (let k = loBin; k <= hiBin; k++) dbVals.push(20*Math.log10(mags[k]+1e-12));
  const { dbMin, dbMax } = autoDbRange(dbVals);

  ctx.beginPath();
  ctx.strokeStyle = '#b5690a';
  ctx.lineWidth = 1.75;
  for (let x = 0; x < w; x++){
    const f = fMin + (x/w)*(fMax-fMin);
    const idx = Math.max(0, Math.min(freqs.length-1, Math.round(f/binHz)));
    const db = Math.max(dbMin, Math.min(dbMax, 20*Math.log10(mags[idx]+1e-12)));
    const norm = (db-dbMin)/(dbMax-dbMin);
    const y = h - norm*h;
    if (x===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.stroke();

  let peakDb = -Infinity, peakFreq = 0;
  for (let k = loBin; k <= hiBin; k++){
    const db = 20*Math.log10(mags[k]+1e-12);
    if (db > peakDb){ peakDb = db; peakFreq = freqs[k]; }
  }
  if (isFinite(peakDb)){
    const x = (peakFreq-fMin)/(fMax-fMin)*w;
    ctx.strokeStyle = 'rgba(181,105,10,0.4)';
    ctx.setLineDash([3,3]);
    ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#b5690a';
    ctx.font = '13px "JetBrains Mono", monospace';
    ctx.fillText(fmtHz(peakFreq), Math.min(w-70, x+6), 14);
  }
}

// ⋮ menu for a file row: Move (drills into a folder-target sublist),
// Rename, Delete.
export function buildFileMenu(entry){
  const menu = document.createElement('div');
  menu.className = 'tr-menu';
  const state = S.folderMenuOpen;

  if (state.mode === 'move'){
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'tr-menu-item tr-menu-back';
    back.textContent = '‹ Back';
    back.addEventListener('click', (e) => { e.stopPropagation(); S.folderMenuOpen.mode = 'main'; renderFolderRows(); });
    menu.appendChild(back);

    if (entry.folderId !== null){
      const rootBtn = document.createElement('button');
      rootBtn.type = 'button';
      rootBtn.className = 'tr-menu-item';
      rootBtn.textContent = 'File Folder (no folder)';
      rootBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        entry.folderId = null;
        persistFolderEntry(entry);
        S.folderMenuOpen = null;
        renderFolderRows();
      });
      menu.appendChild(rootBtn);
    }
    const targets = S.folderGroups.filter(g => g.id !== entry.folderId);
    targets.forEach(g => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tr-menu-item';
      btn.textContent = g.name;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        entry.folderId = g.id;
        persistFolderEntry(entry);
        S.folderMenuOpen = null;
        renderFolderRows();
      });
      menu.appendChild(btn);
    });
    if (!targets.length && entry.folderId === null){
      const note = document.createElement('div');
      note.className = 'tr-menu-note';
      note.textContent = 'No folders yet — create one first.';
      menu.appendChild(note);
    }
    return menu;
  }

  const moveBtn = document.createElement('button');
  moveBtn.type = 'button';
  moveBtn.className = 'tr-menu-item';
  moveBtn.textContent = 'Move';
  moveBtn.addEventListener('click', (e) => { e.stopPropagation(); S.folderMenuOpen.mode = 'move'; renderFolderRows(); });
  menu.appendChild(moveBtn);

  const renameBtn = document.createElement('button');
  renameBtn.type = 'button';
  renameBtn.className = 'tr-menu-item';
  renameBtn.textContent = 'Rename';
  renameBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    S.folderRenaming = {kind:'file', id: entry.id};
    S.folderMenuOpen = null;
    renderFolderRows();
  });
  menu.appendChild(renameBtn);

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'tr-menu-item danger';
  delBtn.textContent = 'Delete';
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    S.folderLibrary = S.folderLibrary.filter(f => f.id !== entry.id);
    S.folderExpandedIds.delete(entry.id);
    idbDelete('fileFolder', entry.id);
    S.folderMenuOpen = null;
    renderFolderRows();
  });
  menu.appendChild(delBtn);
  return menu;
}

// ⋮ menu for a folder row: Rename, Delete (deleting a folder just
// ungroups its files back to the root — it never deletes the files).
export function buildGroupMenu(group){
  const menu = document.createElement('div');
  menu.className = 'tr-menu';

  const renameBtn = document.createElement('button');
  renameBtn.type = 'button';
  renameBtn.className = 'tr-menu-item';
  renameBtn.textContent = 'Rename';
  renameBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    S.folderRenaming = {kind:'folder', id: group.id};
    S.folderMenuOpen = null;
    renderFolderRows();
  });
  menu.appendChild(renameBtn);

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'tr-menu-item danger';
  delBtn.textContent = 'Delete';
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    S.folderLibrary.forEach(f => {
      if (f.folderId === group.id){
        f.folderId = null;
        persistFolderEntry(f);
      }
    });
    S.folderGroups = S.folderGroups.filter(g => g.id !== group.id);
    idbDelete('fileFolderGroups', group.id);
    if (S.currentFolderGroupId === group.id) S.currentFolderGroupId = null;
    S.folderMenuOpen = null;
    renderFolderRows();
  });
  menu.appendChild(delBtn);
  return menu;
}

export function buildFileRow(entry){
  const isRenaming = S.folderRenaming && S.folderRenaming.kind === 'file' && S.folderRenaming.id === entry.id;
  const expanded = S.folderExpandedIds.has(entry.id);
  const row = document.createElement('div');
  row.className = 'tap-row' + (expanded ? ' expanded' : '');

  const head = document.createElement('div');
  head.className = 'tr-head';

  const chevron = document.createElement('div');
  chevron.className = 'tr-chevron';
  chevron.innerHTML = '&#9656;';

  if (isRenaming){
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tr-name-input';
    input.value = entry.name;
    head.appendChild(chevron);
    head.appendChild(input);
    row.appendChild(head);
    setTimeout(() => { input.focus(); input.select(); }, 0);
    const commit = () => {
      const v = input.value.trim();
      if (v && v !== entry.name){ entry.name = v; persistFolderEntry(entry); sortByName(S.folderLibrary); }
      S.folderRenaming = null;
      renderFolderRows();
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter'){ e.preventDefault(); commit(); }
      else if (e.key === 'Escape'){ e.preventDefault(); S.folderRenaming = null; renderFolderRows(); }
    });
    return row;
  }

  const nameEl = document.createElement('div');
  nameEl.className = 'tr-name';
  nameEl.textContent = entry.name;
  nameEl.title = 'Click to show/hide waveform, crop times & summary FFT';

  const toggleExpand = () => {
    if (S.folderExpandedIds.has(entry.id)) S.folderExpandedIds.delete(entry.id);
    else S.folderExpandedIds.add(entry.id);
    renderFolderRows();
  };
  chevron.addEventListener('click', toggleExpand);
  nameEl.addEventListener('click', toggleExpand);

  const dotsBtn = document.createElement('button');
  dotsBtn.type = 'button';
  dotsBtn.className = 'tr-dots';
  dotsBtn.title = 'More options';
  dotsBtn.innerHTML = '&#8942;';
  dotsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = S.folderMenuOpen && S.folderMenuOpen.kind === 'file' && S.folderMenuOpen.id === entry.id;
    S.folderMenuOpen = isOpen ? null : {kind:'file', id: entry.id, mode:'main'};
    renderFolderRows();
  });

  head.appendChild(chevron);
  head.appendChild(nameEl);
  head.appendChild(dotsBtn);
  row.appendChild(head);

  if (S.folderMenuOpen && S.folderMenuOpen.kind === 'file' && S.folderMenuOpen.id === entry.id){
    row.appendChild(buildFileMenu(entry));
  }

  if (expanded){
    const body = document.createElement('div');
    body.className = 'tr-body';

    const canvas = document.createElement('canvas');
    canvas.className = 'tr-wave';
    canvas.width = 1200; canvas.height = 70;

    const fields = document.createElement('div');
    fields.className = 'tr-fields';

    const fftCanvasEl = document.createElement('canvas');
    fftCanvasEl.className = 'tr-fft';
    fftCanvasEl.width = 1200; fftCanvasEl.height = 110;

    const ssField = document.createElement('div');
    ssField.className = 'tap-field';
    ssField.innerHTML = '<label>Crop Start (s)</label>';
    const ssInput = document.createElement('input');
    ssInput.type = 'number'; ssInput.min = '0'; ssInput.step = '0.1'; ssInput.placeholder = 'none';
    ssInput.value = entry.skipStart;
    ssInput.addEventListener('change', () => {
      entry.skipStart = ssInput.value;
      drawFolderRowWave(canvas, entry);
      drawFolderSpectrum(fftCanvasEl, entry);
      persistFolderEntry(entry);
    });
    ssField.appendChild(ssInput);

    const seField = document.createElement('div');
    seField.className = 'tap-field';
    seField.innerHTML = '<label>Crop End (s)</label>';
    const seInput = document.createElement('input');
    seInput.type = 'number'; seInput.min = '0'; seInput.step = '0.1'; seInput.placeholder = 'none';
    seInput.value = entry.skipEnd;
    seInput.addEventListener('change', () => {
      entry.skipEnd = seInput.value;
      drawFolderRowWave(canvas, entry);
      drawFolderSpectrum(fftCanvasEl, entry);
      persistFolderEntry(entry);
    });
    seField.appendChild(seInput);

    fields.appendChild(ssField);
    fields.appendChild(seField);

    const fftLabel = document.createElement('div');
    fftLabel.className = 'tr-fft-label';
    fftLabel.textContent = 'Summary FFT (crop applied, up to 2 kHz)';

    body.appendChild(canvas);
    body.appendChild(fields);
    body.appendChild(fftLabel);
    body.appendChild(fftCanvasEl);
    row.appendChild(body);

    drawFolderRowWave(canvas, entry);
    drawFolderSpectrum(fftCanvasEl, entry);
  }

  return row;
}

export function buildGroupRow(group){
  const isRenaming = S.folderRenaming && S.folderRenaming.kind === 'folder' && S.folderRenaming.id === group.id;
  const row = document.createElement('div');
  row.className = 'tap-row' + (isRenaming ? '' : ' is-group');

  const head = document.createElement('div');
  head.className = 'tr-head';

  if (isRenaming){
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tr-name-input';
    input.value = group.name;
    head.appendChild(input);
    row.appendChild(head);
    setTimeout(() => { input.focus(); input.select(); }, 0);
    const commit = () => {
      const v = input.value.trim();
      if (v && v !== group.name){ group.name = v; persistFolderGroup(group); sortByName(S.folderGroups); }
      S.folderRenaming = null;
      renderFolderRows();
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter'){ e.preventDefault(); commit(); }
      else if (e.key === 'Escape'){ e.preventDefault(); S.folderRenaming = null; renderFolderRows(); }
    });
    return row;
  }

  const nameEl = document.createElement('div');
  nameEl.className = 'tr-name';
  nameEl.textContent = group.name;
  nameEl.title = 'Open this folder';

  const count = S.folderLibrary.filter(f => f.folderId === group.id).length;
  const meta = document.createElement('div');
  meta.className = 'tr-meta';
  meta.textContent = count + (count === 1 ? ' file' : ' files');

  const dotsBtn = document.createElement('button');
  dotsBtn.type = 'button';
  dotsBtn.className = 'tr-dots';
  dotsBtn.title = 'More options';
  dotsBtn.innerHTML = '&#8942;';
  dotsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = S.folderMenuOpen && S.folderMenuOpen.kind === 'folder' && S.folderMenuOpen.id === group.id;
    S.folderMenuOpen = isOpen ? null : {kind:'folder', id: group.id, mode:'main'};
    renderFolderRows();
  });

  head.appendChild(nameEl);
  head.appendChild(meta);
  head.appendChild(dotsBtn);
  row.appendChild(head);

  row.addEventListener('click', () => {
    S.currentFolderGroupId = group.id;
    renderFolderRows();
  });

  if (S.folderMenuOpen && S.folderMenuOpen.kind === 'folder' && S.folderMenuOpen.id === group.id){
    row.appendChild(buildGroupMenu(group));
  }
  return row;
}

export function renderFolderCrumbs(){
  folderCrumbs.innerHTML = '';
  if (S.folderSearchQuery.trim()) return; // flat cross-folder results while searching
  if (S.currentFolderGroupId === null){
    const cur = document.createElement('span');
    cur.className = 'fc-cur';
    cur.textContent = 'File Folder';
    folderCrumbs.appendChild(cur);
    return;
  }
  const group = S.folderGroups.find(g => g.id === S.currentFolderGroupId);
  const root = document.createElement('span');
  root.className = 'fc-seg';
  root.textContent = 'File Folder';
  root.addEventListener('click', () => { S.currentFolderGroupId = null; renderFolderRows(); });
  const sep = document.createElement('span');
  sep.textContent = '▸';
  const cur = document.createElement('span');
  cur.className = 'fc-cur';
  cur.textContent = group ? group.name : '';
  folderCrumbs.appendChild(root);
  folderCrumbs.appendChild(sep);
  folderCrumbs.appendChild(cur);
}

export function renderFolderRows(){
  renderFolderCrumbs();
  const q = S.folderSearchQuery.trim().toLowerCase();

  folderFileCount.textContent = q
    ? `${S.folderLibrary.filter(e => e.name.toLowerCase().includes(q)).length} of ${S.folderLibrary.length} shown`
    : `${S.folderLibrary.length} saved`;

  if (!S.folderLibrary.length && !S.folderGroups.length && !S.addingFolderGroup){
    folderRows.innerHTML = '<div class="empty-note">No files yet.</div>';
    return;
  }
  folderRows.innerHTML = '';

  if (S.addingFolderGroup && !q){
    const row = document.createElement('div');
    row.className = 'tap-row is-group';
    const head = document.createElement('div');
    head.className = 'tr-head';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tr-name-input';
    input.placeholder = 'Folder name';
    head.appendChild(input);
    row.appendChild(head);
    folderRows.appendChild(row);
    setTimeout(() => input.focus(), 0);
    const commit = () => {
      const v = input.value.trim();
      if (v){
        const group = { id: uid(), name: v };
        S.folderGroups.push(group);
        sortByName(S.folderGroups);
        persistFolderGroup(group);
      }
      S.addingFolderGroup = false;
      renderFolderRows();
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter'){ e.preventDefault(); commit(); }
      else if (e.key === 'Escape'){ e.preventDefault(); S.addingFolderGroup = false; renderFolderRows(); }
    });
  }

  if (q){
    const matchingGroups = S.folderGroups.filter(g => g.name.toLowerCase().includes(q));
    const matchingFiles = S.folderLibrary.filter(e => e.name.toLowerCase().includes(q));
    if (!matchingGroups.length && !matchingFiles.length){
      const note = document.createElement('div');
      note.className = 'empty-note';
      note.textContent = 'No files match your search.';
      folderRows.appendChild(note);
      return;
    }
    if (matchingGroups.length){
      const lbl = document.createElement('div');
      lbl.className = 'folder-group-label';
      lbl.textContent = 'Folders';
      folderRows.appendChild(lbl);
      matchingGroups.forEach(g => folderRows.appendChild(buildGroupRow(g)));
    }
    const lbl2 = document.createElement('div');
    lbl2.className = 'folder-group-label';
    lbl2.textContent = 'Files';
    folderRows.appendChild(lbl2);
    if (matchingFiles.length){
      matchingFiles.forEach(f => folderRows.appendChild(buildFileRow(f)));
    } else {
      const note = document.createElement('div');
      note.className = 'empty-note';
      note.textContent = 'No files match your search.';
      folderRows.appendChild(note);
    }
    return;
  }

  if (S.currentFolderGroupId === null){
    if (S.folderGroups.length){
      const lbl = document.createElement('div');
      lbl.className = 'folder-group-label';
      lbl.textContent = 'Folders';
      folderRows.appendChild(lbl);
      S.folderGroups.forEach(g => folderRows.appendChild(buildGroupRow(g)));
    }
    const loose = S.folderLibrary.filter(f => f.folderId == null);
    const lbl2 = document.createElement('div');
    lbl2.className = 'folder-group-label';
    lbl2.textContent = 'Files';
    folderRows.appendChild(lbl2);
    if (loose.length){
      loose.forEach(f => folderRows.appendChild(buildFileRow(f)));
    } else {
      const note = document.createElement('div');
      note.className = 'empty-note';
      note.textContent = 'No ungrouped files.';
      folderRows.appendChild(note);
    }
  } else {
    const inGroup = S.folderLibrary.filter(f => f.folderId === S.currentFolderGroupId);
    if (inGroup.length){
      inGroup.forEach(f => folderRows.appendChild(buildFileRow(f)));
    } else {
      const note = document.createElement('div');
      note.className = 'empty-note';
      note.textContent = 'This folder is empty. Move files in from File Folder.';
      folderRows.appendChild(note);
    }
  }
}

// ---------------- Restore saved folder ----------------
export async function restoreLibraries(){
  // Rebuilds the shared File Folder from IndexedDB after a reload —
  // including each file's Crop Start / Crop End — so it's still there
  // next time. Waveform Lab, Compare, Tap Analyser and Clustering are no
  // longer auto-persisted themselves; each reload starts with an empty
  // working list in those tools until files are loaded fresh or pulled
  // in from this folder.
  try{
    const groupRecords = await idbGetAll('fileFolderGroups');
    S.folderGroups = groupRecords.map(rec => ({ id: rec.id, name: rec.name }));
    sortByName(S.folderGroups);

    const folderRecords = await idbGetAll('fileFolder');
    for (const rec of folderRecords){
      try{
        const tmpCtx = new (window.AudioContext||window.webkitAudioContext)();
        const audioBuffer = await tmpCtx.decodeAudioData(rec.arrayBuffer.slice(0));
        S.folderLibrary.push({
          id: rec.id, name: rec.name, size: rec.size, audioBuffer,
          skipStart: rec.skipStart || '', skipEnd: rec.skipEnd || '',
          folderId: rec.folderId || null,
          _rawBuffer: rec.arrayBuffer
        });
        tmpCtx.close();
      }catch(err){
        console.warn('Could not restore', rec.name, err);
      }
    }
    if (S.folderLibrary.length || S.folderGroups.length){
      sortByName(S.folderLibrary);
      renderFolderRows();
    }
  }catch(err){
    console.warn('Could not restore local file folder', err);
  }
}

// Wiring that ran at load time in the original script.js; main.js calls
// each module's init() in the original order.
export function init(){
  folderNewFolderBtn.addEventListener('click', () => {
    S.currentFolderGroupId = null;
    S.folderSearchQuery = '';
    folderSearchInput.value = '';
    S.addingFolderGroup = true;
    renderFolderRows();
  });

  folderSearchInput.addEventListener('input', () => {
    S.folderSearchQuery = folderSearchInput.value;
    renderFolderRows();
  });

  fileInputFolder.addEventListener('change', (e) => { addFolderFiles(e.target.files); e.target.value = ''; });
  folderDirInput.addEventListener('change', (e) => { addFolderDirectory(e.target.files); e.target.value = ''; });

  // The dropzone is a plain clickable box (not a <label>) so a click can
  // open a small "Choose files… / Choose a folder…" menu instead of always
  // jumping straight to the multi-file picker — same single control either
  // way, drag-and-drop still auto-detects files vs. a whole folder on top.
  dropzoneFolder.addEventListener('click', (e) => {
    // Ignore the synthetic click that bubbles up when we programmatically
    // call .click() on one of the hidden inputs below (fileInputFolder.click()
    // / folderDirInput.click()) — otherwise it re-toggles the menu open again
    // right after we just closed it.
    if (e.target === fileInputFolder || e.target === folderDirInput) return;
    dropzoneFolderMenu.classList.toggle('open');
  });
  dropzoneFolder.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); dropzoneFolderMenu.classList.toggle('open'); }
  });
  document.addEventListener('click', (e) => {
    if (!dropzoneFolder.contains(e.target)) dropzoneFolderMenu.classList.remove('open');
  });
  dzChooseFiles.addEventListener('click', (e) => {
    e.stopPropagation();
    dropzoneFolderMenu.classList.remove('open');
    fileInputFolder.click();
  });
  dzChooseFolder.addEventListener('click', (e) => {
    e.stopPropagation();
    dropzoneFolderMenu.classList.remove('open');
    folderDirInput.click();
  });

  ;['dragover','dragenter'].forEach(evtName => {
    dropzoneFolder.addEventListener(evtName, (e) => { e.preventDefault(); dropzoneFolder.classList.add('drag'); });
  });
  ;['dragleave','drop'].forEach(evtName => {
    dropzoneFolder.addEventListener(evtName, (e) => { e.preventDefault(); dropzoneFolder.classList.remove('drag'); });
  });
  dropzoneFolder.addEventListener('drop', (e) => {
    handleFolderDrop(e.dataTransfer);
  });
}
