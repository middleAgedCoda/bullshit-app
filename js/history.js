// history.js
// Local receipt history via IndexedDB. Works for every user today, with
// zero backend — this is deliberately the foundation described in
// HANDOFF.md §11 (anonymous event schema): when accounts eventually
// exist, this local store is what gets migrated up to the account on
// first sign-in, rather than starting the user's history from zero.

const DB_NAME = 'bullshit-history';
const DB_VERSION = 1;
const STORE = 'receipts';

function openDB(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if(!db.objectStoreNames.contains(STORE)){
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function addReceipt(entry){
  try{
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(entry);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }catch(e){
    // IndexedDB can fail in private browsing / storage-restricted
    // contexts — history is a nice-to-have, never block the app on it.
    console.warn('History save skipped:', e);
    return false;
  }
}

export async function getHistory(){
  try{
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const index = tx.objectStore(STORE).index('timestamp');
      const items = [];
      const req = index.openCursor(null, 'prev'); // newest first
      req.onsuccess = () => {
        const cursor = req.result;
        if(cursor){
          items.push(cursor.value);
          cursor.continue();
        }else{
          resolve(items);
        }
      };
      req.onerror = () => reject(req.error);
    });
  }catch(e){
    console.warn('History read failed:', e);
    return [];
  }
}

export async function deleteReceipt(id){
  try{
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }catch(e){
    console.warn('History delete failed:', e);
    return false;
  }
}

export async function clearAllHistory(){
  try{
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }catch(e){
    console.warn('History clear failed:', e);
    return false;
  }
}
