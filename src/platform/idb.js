// ---------------- Persistence (IndexedDB) ----------------
// A single shared "File Folder" (fileFolder store) is now the only place
// files + their Crop Start / Crop End get saved locally. Each of the four
// tools (Waveform Lab, Compare, Tap Analyser, Clustering) is session-only
// for files picked straight from your computer; loading from the folder
// instead brings along its saved skip times. `library`/`tapLibrary`/
// `clusterLibrary` are legacy stores kept only so existing saved files
// can be migrated into `fileFolder` the first time a returning user's DB
// gets upgraded — nothing writes to them any more.
export const DB_NAME = 'waveform-lab-db';
export const DB_VERSION = 4;
let dbPromise = null;

export function openDB(){
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!window.indexedDB){ reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      if (!db.objectStoreNames.contains('library')) db.createObjectStore('library', {keyPath:'id'});
      if (!db.objectStoreNames.contains('tapLibrary')) db.createObjectStore('tapLibrary', {keyPath:'id'});
      if (!db.objectStoreNames.contains('clusterLibrary')) db.createObjectStore('clusterLibrary', {keyPath:'id'});
      const hadFolder = db.objectStoreNames.contains('fileFolder');
      if (!hadFolder) db.createObjectStore('fileFolder', {keyPath:'id'});
      // v4: named folders within the File Folder tab, for grouping files.
      // A file's membership lives on its own fileFolder record (folderId),
      // this store just holds the folder names themselves.
      if (!db.objectStoreNames.contains('fileFolderGroups')) db.createObjectStore('fileFolderGroups', {keyPath:'id'});

      // One-time migration: fold any files already saved under the old
      // per-section stores into the new shared folder, so upgrading
      // doesn't lose anything a returning user had saved. Runs inside the
      // same versionchange transaction as the store creation above.
      if (!hadFolder){
        const tx = event.target.transaction;
        const folderStore = tx.objectStore('fileFolder');
        const seen = new Set();
        const mergeFrom = (storeName, mapFields) => {
          if (!db.objectStoreNames.contains(storeName)) return;
          const src = tx.objectStore(storeName);
          src.openCursor().onsuccess = (ev) => {
            const cursor = ev.target.result;
            if (!cursor) return;
            const rec = cursor.value;
            if (!seen.has(rec.id)){
              seen.add(rec.id);
              folderStore.put(mapFields(rec));
            }
            cursor.continue();
          };
        };
        mergeFrom('tapLibrary', rec => ({ id: rec.id, name: rec.name, size: rec.size, arrayBuffer: rec.arrayBuffer, skipStart: rec.skipStart || '', skipEnd: rec.skipEnd || '' }));
        mergeFrom('clusterLibrary', rec => ({ id: rec.id, name: rec.name, size: rec.size, arrayBuffer: rec.arrayBuffer, skipStart: rec.cropStart || '', skipEnd: rec.cropEnd || '' }));
        mergeFrom('library', rec => ({ id: rec.id, name: rec.name, size: rec.size, arrayBuffer: rec.arrayBuffer, skipStart: '', skipEnd: '' }));
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function idbPut(storeName, record){
  try{
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(record);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }catch(err){ console.warn('Could not save to local storage', err); }
}

export async function idbDelete(storeName, id){
  try{
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }catch(err){ console.warn('Could not remove from local storage', err); }
}

export async function idbGetAll(storeName){
  try{
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }catch(err){ console.warn('Could not read from local storage', err); return []; }
}
