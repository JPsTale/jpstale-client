/**
 * AssetManager —— 资产加载的**唯一入口**（取字节 → 解析 → 缓存 → 统计）。
 *
 * 为什么要有这一层（用户 2026-09-14："纹理、模型、骨骼动画都应该进 assetmanager"）：
 * 之前每个 loader 各自拼路径、各自 fetch（有的还 `no-store`）、各自写一份 promise memo，
 * 于是"缓存命中率""进度统计""谁该缓存解析结果"这三件事散在十几处，
 * 漏一处就是"同一张图每只怪重下重解码"（实测过）。
 *
 * ── 边界（刻意划清，别让它长成什么都管的怪物）──────────────────────────
 *  ✅ 取字节：内存 → IndexedDB → 网络（复用 `cachedFetch`），并按 `kind` 记字节/命中
 *  ✅ 解析结果的缓存：按 `kind` 定策略 + 有上限的 LRU（见下）
 *  ❌ **three 对象的构建**（SkinnedMesh / Group）—— 归各 loader：它们还要负责 clone
 *     （一个 Object3D 只能有一个父节点，共享构建结果是踩过的坑）
 *
 * ── 解析缓存策略（关键：不是所有东西都该缓存解析结果）────────────────────
 *  | kind        | 缓存解析结果 | 重建代价 | 理由 |
 *  |-------------|--------------|----------|------|
 *  | `texture:*` | ✅ | 3~4 | 同一张贴图被多个材质用；也避免重复解码 |
 *  | `model`     | ✅ | 6 | 同一模型被多只怪/多个部位复用 + 顶点变换 |
 *  | `map`/`misc`| ✅ | 10/1 | 地图几何重建最贵（解析 5.6MB smd + 建几何 + 碰撞）|
 *  | `anim`      | ❌ | — | 完整动画包解析出来是几十 MB 关键帧数组（8 组 = 几百 MB 常驻），
 *  |             |    |   | 而它每个职业只加载一次；重复下载已由 lite 包 + IDB 解决 |
 *
 * ── 缓存上限（LRU）─────────────────────────────────────────────────────
 * 门槛是**硬性**的（用户 2026-09-14："它需要有一个触发的门槛，例如内存上限、对象数量上限"），
 * 三层任一超了就淘汰到 80%：
 *   ① **资产字节预算** `BYTE_LIMIT`：按条目的源字节累加（模型/地图的解析结果与源字节同量级）。
 *      **以它为主门槛** —— 它只算我们自己的资产，比全局堆精确，且不依赖浏览器非标 API。
 *   ② **条目数** `MAX_ENTRIES`：防"海量小图标"把 Map 撑大（也是没有堆 API 时的唯一门槛）。
 *   ③ **单条过大不入缓存**：一个巨型条目不该把预算吃光（只返回、不留在缓存里）。
 *
 * **淘汰讲究"重建代价"**（用户 2026-09-14 定："按代价方案来评估缓存"）：不是纯 LRU ——
 * 先丢重建便宜的（UI 图标/杂项），同代价内再按"最久未用"，最贵的（地图几何）最后才动。
 * 淘汰**不影响已经在场景里的对象**（three 对象自己有引用链），只是"下次要用时得重建"；
 * 而字节仍在 IndexedDB 里 ⇒ **不会重新下载**。
 *
 * 零 three 依赖（core 层约定）：解码结果用泛型 `T`，解析函数由调用方注入。
 */
import { cachedFetch, kindProgress, type AssetKind } from './asset-cache.js';

export type { AssetKind };

/** 一个 kind 的综合使用情况（诊断：能回答"这次进图 30MB 里贴图占多少"） */
export interface KindUsage {
  /** 该 kind 实际走网络的字节（本统计窗口） */
  bytes: number;
  /** 命中内存/IndexedDB 的次数（没走网络） */
  hits: number;
  /** 发生解析（解码/parseSmb）的次数 */
  parsed: number;
}

/** 解析次数按 kind 计（字节与命中由 asset-cache 记账） */
const parsedCount = new Map<string, number>();

// ─────────── 解析结果缓存（带上限的 LRU，按重建代价分级淘汰）───────────
/**
 * 重建代价权重（**相对量级**，依据是"重建一次要做什么"）：
 * UI 图标只是解码几 ms；贴图要解码 + 上传 GPU；模型要 parseSmb + 逐顶点变换；
 * 地图要解析 5.6MB 的 smd + 建几何（还牵动碰撞）—— 差几个数量级，所以不能一视同仁。
 * 将来可以用内置 profiler 实测校准这几个数字。
 */
const COST_BY_KIND: Record<string, number> = {
  'texture:ui': 1,
  misc: 1,
  'texture:char': 3,
  'texture:map': 4,
  model: 6,
  map: 10,
};

interface ParsedEntry {
  promise: Promise<unknown>;
  /** 源字节数（内存占用的代理：模型/地图的解析结果与源字节同量级） */
  weight: number;
  /** 重建代价权重（见 COST_BY_KIND） */
  cost: number;
  kind: string;
  /** 最近一次命中/写入（LRU 的"新近"） */
  lastUsed: number;
  /** 是否已完成 —— 未完成的条目**不参与淘汰**（淘汰会与并发请求各解析一遍） */
  settled: boolean;
}

const parsedCache = new Map<string, ParsedEntry>();
let cachedBytes = 0;

/** ① 资产字节预算（主门槛） */
const BYTE_LIMIT = 600 * 1024 * 1024;
/** ② 条目数上限（兜底） */
const MAX_ENTRIES = 400;
/** ③ 单条超这个就不缓存解析结果（只返回） */
const MAX_SINGLE_CACHE_BYTES = 32 * 1024 * 1024;
/** 淘汰目标比例：一次丢够，避免"每条都淘汰一下"的抖动 */
const EVICT_TO = 0.8;

/** 取字节（**唯一入口**）。统计按 `kind` 归一。 */
export function fetchAsset(url: string, kind: AssetKind): Promise<ArrayBuffer> {
  return cachedFetch(url, kind);
}

/**
 * 取**解析后**的资产：同一 `(kind, url)` 只解析一次。
 *
 * @param parse 解析函数（`parseSmb` / `parseInx` / `decodeTextureAsync`…）—— AssetManager
 *              不关心它是什么，只管"同一份字节只喂它一次"
 * @param cache 是否缓存解析结果；**动画类必须传 false**（见文件头的策略表）
 */
export function loadParsedAsset<T>(
  url: string,
  kind: AssetKind,
  parse: (buf: ArrayBuffer) => T | Promise<T>,
  cache = true,
): Promise<T> {
  const key = `${kind}|${url}`;
  if (cache) {
    const hit = parsedCache.get(key);
    if (hit) {
      hit.lastUsed = performance.now();   // LRU 触碰
      return hit.promise as Promise<T>;
    }
  }

  let srcBytes = 0;
  const p = (async () => {
    const buf = await fetchAsset(url, kind);
    srcBytes = buf.byteLength;
    const out = await parse(buf);
    parsedCount.set(kind, (parsedCount.get(kind) ?? 0) + 1);
    return out;
  })();

  if (cache) {
    const entry: ParsedEntry = {
      promise: p, weight: 0, cost: COST_BY_KIND[kind] ?? 1,
      kind, lastUsed: performance.now(), settled: false,
    };
    parsedCache.set(key, entry);
    void p.then(() => {
      entry.settled = true;
      if (srcBytes > MAX_SINGLE_CACHE_BYTES) {
        // ③ 单条过大：不留缓存（否则一个大条目能吃掉整个预算）
        parsedCache.delete(key);
        console.warn(`[asset] ${kind} 条目过大（${(srcBytes / 1048576).toFixed(1)}MB > `
          + `${MAX_SINGLE_CACHE_BYTES / 1048576}MB）→ 不缓存解析结果：${url}`);
        return;
      }
      entry.weight = srcBytes;
      cachedBytes += srcBytes;
      evictIfNeeded();
    }).catch(() => {
      // 解析失败不留在缓存里：否则一次网络抖动会**永久**毒化这个 URL（之后永远拿到 rejected）
      parsedCache.delete(key);
    });
  }
  return p;
}

/**
 * 超门槛就淘汰（按重建代价：先丢便宜的，同代价内丢最久未用的）。
 *
 * 用 `console.warn` 而不是 `reportFallback`：core 层不反向依赖 `char/`。可见性不减 ——
 * 游戏内日志面板（Ctrl+Shift+L）包裹了 console.warn，这条会出现在里面。
 */
function evictIfNeeded(): void {
  if (cachedBytes <= BYTE_LIMIT && parsedCache.size <= MAX_ENTRIES) return;
  const items = [...parsedCache.entries()]
    .filter(([, e]) => e.settled)                       // 未完成的跳过（避免并发重复解析）
    .map(([k, e]) => ({ key: k, weight: e.weight, cost: e.cost, lastUsed: e.lastUsed, kind: e.kind }));
  items.sort((a, b) => a.cost - b.cost || a.lastUsed - b.lastUsed);

  const targetBytes = BYTE_LIMIT * EVICT_TO;
  const targetEntries = Math.floor(MAX_ENTRIES * EVICT_TO);
  const byKind = new Map<string, number>();
  let dropped = 0, droppedBytes = 0;
  for (const it of items) {
    if (cachedBytes <= targetBytes && parsedCache.size <= targetEntries) break;
    parsedCache.delete(it.key);
    cachedBytes -= it.weight;
    dropped++;
    droppedBytes += it.weight;
    byKind.set(it.kind, (byKind.get(it.kind) ?? 0) + 1);
  }
  if (dropped > 0) {
    console.warn(`[asset] 解析缓存超限 → 按重建代价淘汰 ${dropped} 个`
      + `（约 ${(droppedBytes / 1048576).toFixed(1)}MB：${[...byKind].map(([k, n]) => k + '×' + n).join(', ')}）`
      + `；下次用到会重新解析，但**不会重新下载**（字节仍在 IndexedDB）`);
  }
}

/** 全部 kind 的综合使用情况（按下载字节降序） */
export function kindUsage(): { kind: string; usage: KindUsage }[] {
  const bytes = new Map(kindProgress().map((k) => [k.kind, k]));
  const kinds = new Set([...bytes.keys(), ...parsedCount.keys()]);
  return [...kinds]
    .map((kind) => {
      const b = bytes.get(kind);
      return {
        kind,
        usage: {
          bytes: b ? b.bytes : 0,
          hits: b ? b.hits : 0,
          parsed: parsedCount.get(kind) ?? 0,
        },
      };
    })
    .sort((a, b) => b.usage.bytes - a.usage.bytes);
}

/** 清空解析缓存与计数（换资产包/排障用；字节层见 `asset-cache.clearAssetCache`） */
export function resetAssetManager(): void {
  parsedCache.clear();
  cachedBytes = 0;
  parsedCount.clear();
}

/** 缓存实况（诊断 / 调门槛用 —— 数字要有依据，不靠拍） */
export interface CacheStats {
  /** 解析结果缓存里的条目数 */
  entries: number;
  /** 缓存条目的源字节合计（对应 BYTE_LIMIT 这个门槛） */
  cachedBytes: number;
  /** 门槛 */
  byteLimit: number;
  maxEntries: number;
  /** JS 堆已用字节（仅 Chromium 系提供 `performance.memory`，其它为 null） */
  heapUsedBytes: number | null;
  heapLimitBytes: number | null;
}

export function cacheStats(): CacheStats {
  const mem = (performance as unknown as {
    memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
  }).memory;
  return {
    entries: parsedCache.size,
    cachedBytes,
    byteLimit: BYTE_LIMIT,
    maxEntries: MAX_ENTRIES,
    heapUsedBytes: mem ? mem.usedJSHeapSize : null,
    heapLimitBytes: mem ? mem.jsHeapSizeLimit : null,
  };
}

/**
 * 诊断：某个 kind 的缓存"去重情况"。
 *
 * 为什么需要它：实测 `texture:map` 解析了 **832 次**而缓存只有两百多条 —— 正常情况下一张贴图
 * 只该解析一次，所以要么是"同一张图以不同 URL 写法入缓存"（大小写/斜杠差异 ⇒ 键不一致 ⇒
 * 每次都当新贴图重新解码），要么是"确实有那么多张不同的贴图"（多张地图累积）。
 * 用 basename 分组就能一眼分辨：**同 basename 多键 = 重复**。
 */
export function cacheDigest(kind: string): {
  entries: number;
  uniqueBasenames: number;
  /** 同 basename 却有多个键的（重复入缓存的直接证据） */
  duplicated: { base: string; keys: string[] }[];
} {
  const groups = new Map<string, { base: string; keys: string[] }>();
  let entries = 0;
  for (const k of parsedCache.keys()) {
    if (!k.startsWith(kind + '|')) continue;
    entries++;
    const url = k.slice(kind.length + 1);
    const base = (url.split('/').pop() ?? url).toLowerCase();
    const g = groups.get(base);
    if (g) g.keys.push(url);
    else groups.set(base, { base, keys: [url] });
  }
  const duplicated = [...groups.values()].filter((g) => g.keys.length > 1);
  return { entries, uniqueBasenames: groups.size, duplicated };
}
