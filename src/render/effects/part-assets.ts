/**
 * `.part` 粒子资产加载 —— **按精确路径**读脚本 + 解码贴图，带缓存与诊断。
 *
 * **两段式**：
 *   ① `parsePartAtPath` 读脚本 + 解析成 IR（便宜）⇒ 启动预载只做这一段
 *   ② `decodePartTextures` 逐张贴图解码（贵）⇒ 第一次用到才做（贴图本身在
 *      `char-texture-loader` 里已按路径全局缓存）
 *
 * 路径**只从注册表的清单来**（`effect-registry.lookupEffect`）—— 原版也是按名查内存注册表
 * （`HoNewParticleMgr.cpp:220` → `FindScript`），不探测目录。
 *
 * 失败一律带原因（`{ fail }`），由 `effect-registry` 上报；`catch(() => null)` 会把
 * "资产缺失/清单过期"伪装成"本来就没有这个名字"（AGENTS #12）。
 */
import type * as THREE from 'three';
import { cachedFetch } from '../../core/asset-cache.js';
import { fetchAndDecodeTexture } from '../char-texture-loader.js';
import { parsePart, type PartSystem } from '../../core/effect/part-script.js';
import { APPLIED_KEYFRAME_PROPS } from './part-to-quarks.js';

/** 清单里的一条资产（名字 + 精确路径）—— 定义在 `effect-registry`，这里只要形状 */
export interface PartRef { name: string; path: string }

export interface PartDiag {
  scriptPath: string;
  emitterCount: number;
  textures: Array<string | null>;
  missing: string[];
}

/** 解析好的 `.part`（**还没解码贴图**）—— 启动预载就停在这一步 */
export interface ParsedPart {
  name: string;
  path: string;
  system: PartSystem;
  /** 各 emitter 的贴图相对路径（下标与 `system.emitters` 对齐；无贴图为 null） */
  texturePaths: Array<string | null>;
  diag: PartDiag;
}

/** 解析失败（带原因）—— 调用方必须上报，别丢 */
export type PartParseOutcome = ParsedPart | { fail: string };

export interface LoadedPart extends ParsedPart {
  /** 各 emitter 的贴图（解码失败为 null） */
  textures: Array<THREE.DataTexture | null>;
}

/**
 * 把资产里写的贴图路径归一成 `/res/` 下的相对路径（反斜杠→斜杠、去前导斜杠、统一小写）。
 * **导出**给静态模型加载器（`static-fx.ts`）共用 —— 同一件事不写第二份。
 */
export function normalizeTexturePath(raw: string): string {
  return raw.replace(/\\+/g, '/').replace(/^\/+/, '').toLowerCase();
}

async function fetchText(url: string): Promise<string | null> {
  try {
    return new TextDecoder('utf-8').decode(await cachedFetch(url));
  } catch {
    return null;
  }
}

/**
 * `.part` 源语的**翻译缺口** —— 去重收集，预载结束时打一张表（后续开发参考，不是运行期降级：
 * 逐资产 `reportFallback` 是 445 行噪声，去重后只有几种键）。两类缺口：
 *   · `system.unhandled`：解析器没消费的键（源语未覆盖）
 *   · 未应用的时间轴：转换只应用了一部分，清单只有一份
 *     （`part-to-quarks.APPLIED_KEYFRAME_PROPS`，AGENTS #15）
 * 预载每次都完整解析一遍全部脚本 ⇒ 这张表天然是全貌。与离线扫描器
 * `scripts/scan-part-coverage.ts` 同源同义（那份给不启动引擎的场合用）。
 */
const gapKeys = new Map<string, Set<string>>();      // 源语未覆盖的键 → 用到它的脚本
const gapTracks = new Map<string, Set<string>>();    // 解析了但没应用的时间轴 → 用到它的脚本
/** 预载那张表已经打过了（之后再冒出来的缺口要当行打出来，别静默丢） */
let gapSummaryPrinted = false;
const gapPrinted = new Set<string>();

function gapAdd(map: Map<string, Set<string>>, key: string, name: string, kind: string): void {
  const set = map.get(key) ?? map.set(key, new Set()).get(key)!;
  const isNew = !set.has(name);
  set.add(name);
  if (!isNew) return;
  // 预载之后才遇到的（只有**代码内 spec** 会这样：它们不在清单里、不参与预载）
  if (gapSummaryPrinted && !gapPrinted.has(kind + key)) {
    gapPrinted.add(kind + key);
    console.log(`[fx] .part 新缺口（预载后才遇到）：${kind}「${key}」—— 来自 ${name}`);
  }
}

/** 收集一个脚本的翻译缺口（**不是**降级上报，见上面的说明） */
export function collectPartGaps(name: string, system: PartSystem): void {
  for (const k of system.unhandled ?? []) gapAdd(gapKeys, k, name, '键');
  const applied: readonly string[] = APPLIED_KEYFRAME_PROPS;
  for (const em of system.emitters) {
    for (const p of Object.keys(em.keyframes ?? {})) {
      if (!applied.includes(p)) gapAdd(gapTracks, p, name, '时间轴');
    }
  }
}

/** 缺口计数（预载回执里带一句，便于在实验室面板上一眼看到） */
export function partGapCounts(): { keys: number; tracks: number; scripts: number } {
  const scripts = new Set<string>();
  for (const s of gapKeys.values()) for (const n of s) scripts.add(n);
  for (const s of gapTracks.values()) for (const n of s) scripts.add(n);
  return { keys: gapKeys.size, tracks: gapTracks.size, scripts: scripts.size };
}

/**
 * **预载结束后打一次**：把去重后的缺口列成"后续开发参考"（短表，不是每资产一行的噪声）。
 * 排序：用到的脚本多 → 少（多的那些最值得先翻译）。
 */
export function printPartGapSummary(): void {
  gapSummaryPrinted = true;
  const counts = partGapCounts();
  const applied = `已应用的时间轴：${APPLIED_KEYFRAME_PROPS.join(' / ')}`;
  if (counts.keys === 0 && counts.tracks === 0) {
    console.log(`[fx] .part 翻译缺口：无（源语全部已翻译）。${applied}`);
    return;
  }
  const rows = (map: Map<string, Set<string>>): string[] =>
    [...map.entries()]
      .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
      .map(([k, set]) => `       ${k.padEnd(28)} ${String(set.size).padStart(4)} 个脚本   `
        + `例：${[...set].sort()[0]}`);
  console.log(`[fx] .part 翻译缺口（**后续开发参考**，不是运行期降级；与 npm run scan-part 同源）：`
    + `${counts.keys} 种键 + ${counts.tracks} 种时间轴，涉及 ${counts.scripts} 个脚本`);
  if (counts.keys) console.log(`     源语未覆盖的键：\n${rows(gapKeys).join('\n')}`);
  if (counts.tracks) console.log(`     解析了但没应用的时间轴：\n${rows(gapTracks).join('\n')}`);
  console.log(`     ${applied}`);
  for (const k of gapKeys.keys()) gapPrinted.add('键' + k);
  for (const k of gapTracks.keys()) gapPrinted.add('时间轴' + k);
}

/* ─────────── ① 解析（启动预载做这一段） ─────────── */

const parseCache = new Map<string, Promise<PartParseOutcome>>();

/** 按**精确路径**解析一个 `.part`（不含贴图解码）。失败**带原因返回**，不抛。 */
export function parsePartAtPath(ref: PartRef): Promise<PartParseOutcome> {
  const hit = parseCache.get(ref.path);
  if (hit) return hit;
  const job = parsePartUncached(ref).catch((e: unknown) => ({ fail: String(e) }));
  parseCache.set(ref.path, job);
  return job;
}

async function parsePartUncached(ref: PartRef): Promise<PartParseOutcome> {
  const text = await fetchText('/res/' + ref.path);
  // 取不到 = 清单比资产旧（或资产被挪走）——**不能当成"没有这个名字"**（AGENTS #12）
  if (text === null) {
    return { fail: `脚本取不到（404？清单可能比资产旧 ⇒ 重跑 npm run fx-names）：${ref.path}` };
  }
  const system = parsePart(text);
  // 文件在库里却解析成空系统：脚本坏了，或这个路径其实返回了 SPA 兜底 HTML —— 要说出来
  if (system.emitters.length === 0) {
    return { fail: `解析出 0 个发射器（脚本损坏？或该路径返回的是 SPA 兜底 HTML）：${ref.path}` };
  }
  // **翻译缺口在这一步收集**（去重，不逐条喊）：预载会解析全部 445 个脚本 ⇒ 统计完整，
  //   由 `printPartGapSummary()` 在预载结束时打一张"后续开发参考"的表（见 `collectPartGaps` 的说明）。
  collectPartGaps(ref.name, system);
  const paths = system.emitters.map((em) => (em.texture ? normalizeTexturePath(em.texture) : null));
  return {
    name: ref.name,
    path: ref.path,
    system,
    texturePaths: paths,
    diag: { scriptPath: ref.path, emitterCount: system.emitters.length, textures: paths, missing: [] },
  };
}

/* ─────────── ② 解码贴图（用到才做） ─────────── */

const textureCache = new Map<string, Promise<LoadedPart>>();

/**
 * 解码一份已解析的 `.part` 的贴图（**唯一实现**：文件来的与代码内 spec 来的都走这里）。
 *
 * 逐张解码本身已有全局缓存（`char-texture-loader` → AssetManager，同路径只解一次），
 * 这一层缓存只省掉"每次重建数组"的重复工作。键用 `path`；代码内 spec 的 path 里带名字
 * （`sys:<名>`），否则两份不同的 spec 会共用同一份贴图。
 */
export function decodePartTextures(parsed: ParsedPart): Promise<LoadedPart> {
  const hit = textureCache.get(parsed.path);
  if (hit) return hit;
  const job = decodeUncached(parsed);
  textureCache.set(parsed.path, job);
  return job;
}

async function decodeUncached(parsed: ParsedPart): Promise<LoadedPart> {
  const textures: Array<THREE.DataTexture | null> = [];
  const missing: string[] = [];
  for (const p of parsed.texturePaths) {
    if (!p) { textures.push(null); continue; }
    const tex = await fetchAndDecodeTexture('/res/' + p, 1, { linear: true });   // 特效：原样进（见 fetchAndDecodeTexture 的说明）
    if (!tex) missing.push(p);
    textures.push(tex);
  }
  return { ...parsed, textures, diag: { ...parsed.diag, missing } };
}

/**
 * 由**代码里的 spec** 造一份已加载资产（不读脚本文件）。
 *
 * 用途：原版有一类特效的参数**只写在 C++ 里**（没有 `.part`/INI 数据文件），
 * 例如法杖普攻那颗弹 `MONSTER_IMP_SHOT1`（`HoParticle.cpp:213-246`）。
 * 那种情况没办法"按名字播"，只能把参数搬成 spec —— 但**缺口上报与贴图解码
 * 必须共用同一份实现**（否则又是第二套加载逻辑）。
 *
 * @param name 调用方的**唯一标签**（quarks-runtime 传 `opts.label`）—— 同时当贴图缓存的键
 */
export async function loadPartFromSystem(name: string, system: PartSystem): Promise<LoadedPart> {
  collectPartGaps(name, system);
  const paths = system.emitters.map((em) => (em.texture ? normalizeTexturePath(em.texture) : null));
  // 代码内 spec 不参与预载 ⇒ 它的缺口只有走到这里才被看到（收集器会当行打出来，见 `gapAdd`）
  return decodePartTextures({
    name,
    path: `sys:${name}`,
    system,
    texturePaths: paths,
    diag: { scriptPath: '(代码内 spec)', emitterCount: system.emitters.length, textures: paths, missing: [] },
  });
}
