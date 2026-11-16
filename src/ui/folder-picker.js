import { S } from './state.js';
import { parseWavHeader } from '../core/wav.js';
import { loadFromFolderBtnAnalyze, loadFromFolderBtnCluster, loadFromFolderBtnCompare, loadFromFolderBtnTap } from './dom.js';
import { fmtBytes, sortByName } from './format.js';
import { renderFileList, selectFile } from './pages/analyze.js';
import { renderClusterRows } from './pages/cluster.js';
import { renderCompareRows } from './pages/compare.js';
import { renderTapRows } from './pages/tap.js';

// ---------------- Folder picker modal ----------------
// Shared "load from local folder" UI, opened from each tool's "Load from
// local folder" button. `config` says which working list to add into and
// how to turn a folder record into that section's entry shape:
//   getTarget() -> the section's current working-list array (fetched
//                  fresh at confirm-time, since these arrays get
//                  reassigned elsewhere via `x = x.filter(...)`)
//   buildEntry(rec) -> a new entry for that section, built from the
//                      folder record (reusing its already-decoded
//                      audioBuffer rather than re-decoding)
//   onAdded() -> re-render (and any other post-add wiring) for that page
export function openFolderPicker(config){
  if (!S.folderLibrary.length){
    alert('Your local folder is empty. Add files to it from the File Folder tab first.');
    return;
  }
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const box = document.createElement('div');
  box.className = 'modal-box';

  const header = document.createElement('div');
  header.className = 'modal-header';
  const title = document.createElement('h3');
  title.textContent = 'Load from local folder';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'modal-close';
  closeBtn.innerHTML = '&times;';
  closeBtn.title = 'Cancel';
  closeBtn.addEventListener('click', () => overlay.remove());
  header.appendChild(title);
  header.appendChild(closeBtn);

  const searchWrap = document.createElement('div');
  searchWrap.className = 'modal-search-wrap';
  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.className = 'folder-search';
  searchInput.placeholder = 'Search files by name…';
  searchWrap.appendChild(searchInput);

  const body = document.createElement('div');
  body.className = 'modal-body';
  const checked = new Set();
  const expandedGroups = new Set();
  let groupCheckboxes = []; // {cb, memberIds} — kept in sync with `checked` after every render

  function buildFileRow(entry){
    const row = document.createElement('label');
    row.className = 'folder-pick-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = checked.has(entry.id);
    cb.addEventListener('change', () => {
      if (cb.checked) checked.add(entry.id); else checked.delete(entry.id);
      syncGroupCheckboxStates();
    });
    const info = document.createElement('div');
    info.className = 'fp-info';
    const nameDiv = document.createElement('div');
    nameDiv.className = 'fp-name';
    nameDiv.textContent = entry.name;
    const metaDiv = document.createElement('div');
    metaDiv.className = 'fp-meta';
    const trimBits = [
      entry.skipStart !== '' ? `crop start ${entry.skipStart}s` : null,
      entry.skipEnd !== '' ? `crop end ${entry.skipEnd}s` : null,
    ].filter(Boolean).join(' · ');
    metaDiv.textContent = fmtBytes(entry.size) + (trimBits ? ' · ' + trimBits : '');
    info.appendChild(nameDiv);
    info.appendChild(metaDiv);
    row.appendChild(cb);
    row.appendChild(info);
    return row;
  }

  function syncGroupCheckboxStates(){
    groupCheckboxes.forEach(({ cb, memberIds }) => {
      const n = memberIds.filter(id => checked.has(id)).length;
      cb.checked = n > 0 && n === memberIds.length;
      cb.indeterminate = n > 0 && n < memberIds.length;
    });
  }

  // A folder-group row: checking its box selects/deselects every file in
  // that folder at once; clicking the name expands it to fine-tune
  // individual files (each keeps its own checkbox).
  function buildGroupRow(group, memberFiles){
    const wrap = document.createElement('div');
    wrap.className = 'folder-pick-group';

    const head = document.createElement('div');
    head.className = 'folder-pick-group-head';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.title = `Select all ${memberFiles.length} files in "${group.name}"`;
    cb.addEventListener('click', (e) => e.stopPropagation());
    cb.addEventListener('change', () => {
      memberFiles.forEach(f => { if (cb.checked) checked.add(f.id); else checked.delete(f.id); });
      renderPickerList();
    });
    groupCheckboxes.push({ cb, memberIds: memberFiles.map(f => f.id) });

    const chevron = document.createElement('span');
    chevron.className = 'fp-chevron' + (expandedGroups.has(group.id) ? ' open' : '');
    chevron.innerHTML = '&#9656;';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'fp-group-name';
    nameSpan.textContent = group.name;

    const metaSpan = document.createElement('span');
    metaSpan.className = 'fp-meta';
    metaSpan.textContent = memberFiles.length + (memberFiles.length === 1 ? ' file' : ' files');

    const toggleExpand = () => {
      if (expandedGroups.has(group.id)) expandedGroups.delete(group.id);
      else expandedGroups.add(group.id);
      renderPickerList();
    };
    chevron.addEventListener('click', toggleExpand);
    nameSpan.addEventListener('click', toggleExpand);

    head.appendChild(cb);
    head.appendChild(chevron);
    head.appendChild(nameSpan);
    head.appendChild(metaSpan);
    wrap.appendChild(head);

    if (expandedGroups.has(group.id)){
      const nested = document.createElement('div');
      nested.className = 'folder-pick-nested';
      memberFiles.forEach(f => nested.appendChild(buildFileRow(f)));
      wrap.appendChild(nested);
    }
    return wrap;
  }

  function renderPickerList(){
    body.innerHTML = '';
    groupCheckboxes = [];
    const q = searchInput.value.trim().toLowerCase();

    if (q){
      const matches = S.folderLibrary.filter(e => e.name.toLowerCase().includes(q));
      if (!matches.length){
        const note = document.createElement('div');
        note.className = 'empty-note';
        note.textContent = 'No files match your search.';
        body.appendChild(note);
      } else {
        matches.forEach(e => body.appendChild(buildFileRow(e)));
      }
      return;
    }

    if (S.folderGroups.length){
      S.folderGroups.forEach(group => {
        const members = S.folderLibrary.filter(f => f.folderId === group.id);
        if (members.length) body.appendChild(buildGroupRow(group, members));
      });
    }
    const loose = S.folderLibrary.filter(f => f.folderId == null);
    loose.forEach(e => body.appendChild(buildFileRow(e)));

    syncGroupCheckboxStates();
  }

  searchInput.addEventListener('input', renderPickerList);
  renderPickerList();

  const footer = document.createElement('div');
  footer.className = 'modal-footer';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'text-btn';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => overlay.remove());
  const addBtn = document.createElement('button');
  addBtn.className = 'text-btn';
  addBtn.textContent = 'Add selected';
  addBtn.addEventListener('click', () => {
    const target = config.getTarget();
    const existingIds = new Set(target.map(e => e.id));
    let added = 0;
    checked.forEach(id => {
      if (existingIds.has(id)) return; // already loaded into this section
      const rec = S.folderLibrary.find(f => f.id === id);
      if (!rec) return;
      target.push(config.buildEntry(rec));
      added++;
    });
    if (added){
      sortByName(target);
      config.onAdded();
    }
    overlay.remove();
  });
  footer.appendChild(cancelBtn);
  footer.appendChild(addBtn);

  box.appendChild(header);
  box.appendChild(searchWrap);
  box.appendChild(body);
  box.appendChild(footer);
  overlay.appendChild(box);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

export const libraryFolderPickerConfig = {
  getTarget: () => S.library,
  buildEntry: (rec) => ({
    id: rec.id, name: rec.name, size: rec.size,
    url: URL.createObjectURL(new Blob([rec._rawBuffer], {type:'audio/wav'})),
    audioBuffer: rec.audioBuffer, wavInfo: parseWavHeader(rec._rawBuffer.slice(0))
  }),
  onAdded: () => {
    renderFileList();
    renderCompareRows();
    if (S.activeId === null && S.library.length) selectFile(S.library[0].id);
  }
};

// Event wiring, run once at startup (main.js calls each module's init()).
export function init(){
  loadFromFolderBtnAnalyze.addEventListener('click', () => openFolderPicker(libraryFolderPickerConfig));
  loadFromFolderBtnCompare.addEventListener('click', () => openFolderPicker(libraryFolderPickerConfig));

  loadFromFolderBtnTap.addEventListener('click', () => openFolderPicker({
    getTarget: () => S.tapLibrary,
    buildEntry: (rec) => ({
      id: rec.id, name: rec.name, size: rec.size, audioBuffer: rec.audioBuffer,
      skipStart: rec.skipStart || '', skipEnd: rec.skipEnd || '',
      taps: rec.taps ? [...rec.taps] : null, included: true,
      _rawBuffer: rec._rawBuffer, _folderSynced: true
    }),
    onAdded: () => renderTapRows()
  }));

  loadFromFolderBtnCluster.addEventListener('click', () => openFolderPicker({
    getTarget: () => S.clusterLibrary,
    buildEntry: (rec) => ({
      id: rec.id, name: rec.name, size: rec.size, audioBuffer: rec.audioBuffer,
      cropStart: rec.skipStart || '', cropEnd: rec.skipEnd || '', included: true,
      _rawBuffer: rec._rawBuffer, _folderSynced: true
    }),
    onAdded: () => renderClusterRows()
  }));
}
