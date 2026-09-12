import { encodeAssetPath } from './texture';

/**
 * Asset Cache — 资产二进制的三级缓存：内存 → **IndexedDB（跨会话）** → 网络。
 *
 * 用户 2026-09-13：原先只有内存 Map，**刷新页面就全丢**；而且 fetch 用了 `cache: 'no-store'`
 * （连 HTTP 缓存都禁用），于是一张 5.6MB 的地图每次重开都要真下载一遍。
 * 地图/贴图这类资产在包里是不变的，跨会话缓存正是**期望行为**。
 *
 * 失效：换资产包时把 `DB_VERSION` +1 —— `onupgradeneeded` 里重建对象仓，旧缓存随之作废。
 * 降级：没有 IndexedDB（隐私模式/测试环境）时静默退回"内存 + 网络"，不影响功能。
 */
const DB_NAME = 'pt-assets';
const STORE = 'files';
/** 换资产包时 +1（旧缓存随之失效，不留永远读不到的垃圾） */
const DB_VERSION = 1;

/** 一级缓存：本次会话的内存副本 */
const memory = new Map<string, ArrayBuffer>();

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE);   // 版本升级 = 清旧缓存
      db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);   // 打不开就降级，不抛
  });
  return dbPromise;
}

function idbGet(url: string): Promise<ArrayBuffer | null> {
  return openDb().then((db) => new Promise((resolve) => {
    if (!db) return resolve(null);
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(url);
      req.onsuccess = () => resolve((req.result as ArrayBuffer | undefined) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  }));
}

function idbSet(url: string, buf: ArrayBuffer): Promise<void> {
  return openDb().then((db) => new Promise((resolve) => {
    if (!db) return resolve();
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(buf, url);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  }));
}

/**
 * 取资产二进制。命中内存或 IndexedDB 都不走网络。
 *
 * ⚠ 返回值**不再拷贝**：原先每次命中都 `slice(0)` 复制一份（地图 5.6MB，纯浪费），
 * 而调用方（`parseSMD` 等）都只读。**约定：使用方不得修改返回的 ArrayBuffer。**
 */
export async function cachedFetch(url: string): Promise<ArrayBuffer> {
  const hit = memory.get(url);
  if (hit) return hit;

  const persisted = await idbGet(url);
  if (persisted) {
    memory.set(url, persisted);
    return persisted;
  }

  const resp = await fetch(encodeAssetPath(url));
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${url}`);
  const buf = await resp.arrayBuffer();
  memory.set(url, buf);
  void idbSet(url, buf);   // 落盘不阻塞调用方（弱网下也不拖慢这次加载）
  return buf;
}

export function preloadAssets(urls: string[]): Promise<void[]> {
  return Promise.all(urls.map(async (url) => {
    try { await cachedFetch(url); } catch {}
  }));
}

export function cacheSize(): number { return memory.size; }

/** 清空资产缓存（内存 + IndexedDB）—— 换包/排障用 */
export async function clearAssetCache(): Promise<void> {
  memory.clear();
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}
