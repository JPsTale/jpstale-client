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

// ─────────── 下载进度统计（用户 2026-09-14）───────────
/**
 * 为什么要它：原来的进度是"大文件级"的 —— 一个几十 MB 的文件下完才跳一次数字，
 * 玩家在几秒到几十秒里看不到任何进展，只能对着不动的进度条发呆。
 *
 * 这里在**每个 chunk** 上累加字节（见 `fetchWithProgress`），LoadingScreen 每 200ms 取一次快照，
 * 于是"已下载量 + 瞬时速度"是连续变化的。**只统计实际走网络的字节**：命中内存/IndexedDB 不计
 * （命中数单独记 `cacheHits`），所以玩家看到的数字就是"这次真的下了多少"。
 */
export interface AssetProgress {
  /**
   * **已加载的数据总量（含缓存命中）** —— 玩家要看的是"一共加载成功了多少"。
   * （用户 2026-09-14："玩家要看到的是已经加载成功多少数据，命中缓存的可以直接累加数字就好了"。）
   */
  bytesLoaded: number;
  /** 其中走了网络的字节（瞬时速度按它算：命中缓存没有"速度"可言） */
  bytesNetwork: number;
  /** 已知 Content-Length 的累加（仅作"总量"参考；未知长度的响应不计入） */
  bytesTotal: number;
  /** 瞬时速度（字节/秒，约 1.5s 滑动窗口；无网络活动时为 0） */
  speed: number;
  /** 本窗口内缓存命中次数 */
  cacheHits: number;
  /** 正在下载的资产（显示用，通常 1~几个） */
  active: string[];
}

let bytesLoaded = 0;
let bytesNetwork = 0;
let bytesTotal = 0;
let cacheHits = 0;
/** 采样 { 时刻, 累计**网络**字节 } —— 滑动窗口算速度（读取时清理，见 assetProgress） */
const samples: { t: number; n: number }[] = [];
const activeDownloads = new Set<string>();
const WINDOW_MS = 1500;

/** 记一笔**网络**字节（速度用）+ 一笔**总**字节（"已加载"显示用） */
function noteBytes(n: number, viaNetwork: boolean): void {
  bytesLoaded += n;
  if (!viaNetwork) return;
  bytesNetwork += n;
  samples.push({ t: performance.now(), n: bytesNetwork });
  if (samples.length > 600) samples.splice(0, samples.length - 600); // 防御：长期不读取也不无限增长
}

/** 记一笔**缓存命中**：只累加"已加载"总量（玩家看到的数字要把它算上） */
export function noteCacheHitBytes(n: number): void {
  bytesLoaded += n;
}

/** 取当前进度快照（LoadingScreen 每 200ms 调一次） */
export function assetProgress(): AssetProgress {
  const now = performance.now();
  while (samples.length > 1 && now - samples[0]!.t > WINDOW_MS) samples.shift();
  const first = samples[0];
  const last = samples[samples.length - 1];
  const dt = first && last ? (last.t - first.t) / 1000 : 0;
  const speed = dt > 0.05 && first && last ? (last.n - first.n) / dt : 0;
  return { bytesLoaded, bytesNetwork, bytesTotal, speed, cacheHits, active: [...activeDownloads] };
}

/** 重置窗口（每次 LoadingScreen.show 调一次，让"这次加载了多少"从 0 开始） */
export function resetAssetProgress(): void {
  bytesLoaded = 0;
  bytesNetwork = 0;
  bytesTotal = 0;
  cacheHits = 0;
  samples.length = 0;
}

/** 资产种类 —— 缓存/统计/优先级/失效都要按它说话（见 core/asset-manager.ts 的策略表） */
export type AssetKind =
  | 'texture:char'   // 角色/怪物/武器贴图（flipY=true）
  | 'texture:map'    // 地图贴图（flipY=false）
  | 'texture:ui'     // HUD / 小地图等界面图标（不进世界渲染管线）
  | 'model'          // 网格（.smd，含体模/怪物/武器）
  | 'anim'           // 骨骼动画（.smb：完整包与 lite 包）
  | 'map'            // 地图几何（.smd 场景）
  | 'audio'          // 音效（wav → decodeAudioData）
  | 'misc';          // 其余

/** 按 kind 的字节与命中的记账（由 cachedFetch 填，asset-manager 读） */
const bytesByKind = new Map<string, number>();
const hitsByKind = new Map<string, number>();

export function kindProgress(): { kind: string; bytes: number; hits: number }[] {
  const kinds = new Set([...bytesByKind.keys(), ...hitsByKind.keys()]);
  return [...kinds].map((kind) => ({
    kind,
    bytes: bytesByKind.get(kind) ?? 0,
    hits: hitsByKind.get(kind) ?? 0,
  }));
}

function noteKindBytes(kind: string, n: number): void {
  bytesByKind.set(kind, (bytesByKind.get(kind) ?? 0) + n);
}

/**
 * 资产路径统一小写 —— **在唯一入口处做一次**。
 *
 * 用户 2026-09-14 提醒："我们的资产路径理论上应该一律小写，主要是为了适配 linux 和 url；
 * 而原版资产中很多路径都是大小写混着来的。"
 *
 * 原先小写化散在各 loader（`assetUrl` / `monster-loader` / `char-loader` / `effects`… 各写一遍），
 * 漏一处就有两个后果：① **Linux 上 404**（大小写敏感的文件系统）；② **缓存键分裂**
 * （`Map/x.bmp` 与 `map/x.bmp` 各存一份、各解码一次 —— 而且因为 Windows 大小写不敏感，
 * 这种分裂在开发机上完全看不出来）。
 *
 * ⚠ 前提：传进来的是**未做百分号编码**的路径。编码只由 `encodeAssetPath` 负责，且必须发生在
 * 小写化**之后** —— 否则已编码的 `%2F` 会被小写成 `%2f`，再编码一次就成了 `%252f`。
 */
function normalizeAssetPath(url: string): string {
  const q = url.indexOf('?');
  if (q < 0) return url.toLowerCase();
  return url.slice(0, q).toLowerCase() + url.slice(q);   // query 原样（将来放版本参数用）
}

/**
 * 带进度上报的下载：逐 chunk 读取并累加（这是"进度条能动起来"的关键 ——
 * 不是等 `arrayBuffer()` 一次性拿到，而是每收到一块就上报一块）。
 * 末尾拼成一块 ArrayBuffer（预分配 + 逐块 set，只拷一次），返回值是新分配的，
 * 与 `cachedFetch` 的既有约定一致（使用方不得修改）。
 */
async function fetchWithProgress(url: string, kind: string): Promise<ArrayBuffer> {
  const resp = await fetch(encodeAssetPath(url));
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${url}`);
  const len = Number(resp.headers.get('content-length') ?? 0);
  if (Number.isFinite(len) && len > 0) bytesTotal += len;
  // 没有流式 body（老环境）时退回一次性读取：进度会跳，功能不受影响
  if (!resp.body) {
    const buf = await resp.arrayBuffer();
    noteBytes(buf.byteLength, true);
    noteKindBytes(kind, buf.byteLength);
    return buf;
  }
  activeDownloads.add(url);
  const chunks: Uint8Array[] = [];
  let got = 0;
  const reader = resp.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) {
        chunks.push(value);
        got += value.byteLength;
        noteBytes(value.byteLength, true);   // ← 每块都上报：数字连续变化，而不是"下完才跳"
        noteKindBytes(kind, value.byteLength);
      }
    }
  } finally {
    activeDownloads.delete(url);
  }
  const out = new Uint8Array(got);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out.buffer;
}

/**
 * 取资产二进制。命中内存或 IndexedDB 都不走网络。
 *
 * @param kind 资产种类（默认 `misc`）：只用于**按类记账**（哪些资产最占带宽），
 *             不影响缓存行为。走 `asset-manager.fetchAsset` 时会自动带上。
 *
 * ⚠ 返回值**不再拷贝**：原先每次命中都 `slice(0)` 复制一份（地图 5.6MB，纯浪费），
 * 而调用方（`parseSMD` 等）都只读。**约定：使用方不得修改返回的 ArrayBuffer。**
 */
export async function cachedFetch(url: string, kind: string = 'misc'): Promise<ArrayBuffer> {
  // 路径归一化（小写）在这里做**一次**：缓存键与请求 URL 于是自动一致（见 normalizeAssetPath）
  const key = normalizeAssetPath(url);
  const hit = memory.get(key);
  if (hit) {
    cacheHits++;
    hitsByKind.set(kind, (hitsByKind.get(kind) ?? 0) + 1);
    noteCacheHitBytes(hit.byteLength);   // 命中也要算进"已加载"（玩家看的是加载成功了多少）
    return hit;
  }

  const persisted = await idbGet(key);
  if (persisted) {
    memory.set(key, persisted);
    cacheHits++;
    hitsByKind.set(kind, (hitsByKind.get(kind) ?? 0) + 1);
    noteCacheHitBytes(persisted.byteLength);
    return persisted;
  }

  const buf = await fetchWithProgress(key, kind);
  memory.set(key, buf);
  void idbSet(key, buf);   // 落盘不阻塞调用方（弱网下也不拖慢这次加载）
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
