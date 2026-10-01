// 직접 선택한 저장 폴더의 FileSystemDirectoryHandle 을 IndexedDB 에 보관한다 (확장프로그램 출처 공용).
const DB = 'smd';
const STORE = 'kv';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGet(key) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const r = tx.objectStore(STORE).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function idbSet(key, value) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function idbDel(key) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export const DIR_KEY = 'saveDir';

// 폴더 권한 상태: 'granted' | 'prompt' | 'denied' | 'none'
export async function dirStatus() {
  try {
    const h = await idbGet(DIR_KEY);
    if (!h) return { state: 'none' };
    const state = await h.queryPermission({ mode: 'readwrite' });
    return { state, name: h.name, handle: h };
  } catch (err) {
    return { state: 'none', error: String(err?.message || err) };
  }
}
