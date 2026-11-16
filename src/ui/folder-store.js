import { S } from './state.js';
import { idbPut } from '../platform/idb.js';

// Saves/updates one file in the shared local File Folder (name, size, raw
// bytes, Crop Start / Crop End). This is the only place file data gets
// persisted now — Waveform Lab, Compare, Tap Analyser and Clustering no
// longer save their working lists themselves.
export function persistFolderEntry(entry){
  idbPut('fileFolder', {
    id: entry.id, name: entry.name, size: entry.size,
    skipStart: entry.skipStart, skipEnd: entry.skipEnd,
    taps: entry.taps || null, // hand-edited tap times (s) from the Tap Analyser, or null
    folderId: entry.folderId || null,
    arrayBuffer: entry._rawBuffer
  });
}

// Named folders within the File Folder tab, for grouping files. A file's
// membership lives on its own fileFolder record (folderId); this store
// just holds the folder names themselves.
export function persistFolderGroup(group){
  idbPut('fileFolderGroups', { id: group.id, name: group.name });
}

// When a Tap Analyser / Clustering row that was loaded from the shared
// folder (entry._folderSynced) has its skip/crop times (or, in the Tap
// Analyser, its taps) edited, mirror them back onto the matching folder
// entry and save them — so the
// folder always reflects the latest times, wherever they were last set.
// Files picked ad hoc from your computer (no matching folder entry) are
// left alone; nothing gets persisted for them.
export function syncEntryToFolder(entry, startField, endField){
  if (!entry._folderSynced) return;
  const rec = S.folderLibrary.find(f => f.id === entry.id);
  if (!rec) return;
  rec.skipStart = entry[startField];
  rec.skipEnd = entry[endField];
  if ('taps' in entry) rec.taps = entry.taps ? [...entry.taps] : null;
  persistFolderEntry(rec);
}
