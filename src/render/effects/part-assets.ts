/**
 * `.part` 粒子资产加载 —— **按精确路径**读脚本 + 解码贴图，带缓存与诊断。
 *
 * **两段式**（用户 2026-09-18 定调）：
 *   ① `parsePartAtPath` —— 读脚本文本 + 解析成 IR（便宜）⇒ **启动预载只做这一段**
 *   ② `decodePartTextures` —— 逐张贴图解码（贵）⇒ 真的要用到才做（贴图本身在
 *      `char-texture-loader` 里已按路径全局缓存）
 * 于是"启动时把粒子都加载好、运行时不探测"与"启动时不解码几百张贴图"两件事同时成立。
 *
 * **路径只从注册表的清单来**（`effect-registry.lookupEffect`）。此前是"两个脚本目录各试一遍"
 * —— 那是我们发明的探测：原版是按名查**内存注册表**（启动时按硬编码清单预载，
 * `HoNewParticleMgr.cpp:220` → `FindScript`），见 `scripts/scan-effect-names.ts` 的说明。
 *
 * **失败一律带原因**（`{ fail }` / 抛错），由 `effect-registry` 统一上报 ——
 * 旧版的 `catch(() => null)` 会把"资产缺失/清单过期"伪装成"本来就没有这个名字"（AGENTS #12）。
 */
import type * as THREE from 'three';
import { cachedFetch } from '../../core/asset-cache.js';
import { fetchAndDecodeTexture } from '../char-texture-loader.js';
import { parsePart, type PartSystem } from '../../core/effect/part-script.js';
import { reportFallback } from '../../char/fallback-log.js';
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
 * **翻译缺口要可见**（AGENTS #12）—— `.part` 是原版自研的源语，我们的"解析 → 转换"只覆盖一部分，
 * 而此前两层都是**静默丢弃**（"粒子看着不动"就来自这里）：
 *   · `system.unhandled`：解析器没消费的键（源语未覆盖）
 *   · 未应用的时间轴：清单**只有一份**（`part-to-quarks.APPLIED_KEYFRAME_PROPS`，AGENTS #15）
 */
export function reportPartGaps(name: string, system: PartSystem): void {
  for (const k of system.unhandled ?? []) {
    reportFallback('part', `「${name}」的键「${k}」没有翻译（源语未覆盖）`);
  }
  const applied: readonly string[] = APPLIED_KEYFRAME_PROPS;
  for (const em of system.emitters) {
    for (const p of Object.keys(em.keyframes ?? {})) {
      if (!applied.includes(p)) {
        reportFallback('part', `「${name}」的时间轴「${p}」未应用（已应用的只有 ${applied.join('/')}）`);
      }
    }
  }
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
  // ⚠ **翻译缺口不在这里报**：解析是**启动预载**走的路（全部 445 个脚本），
  //   在这里报会把控制台刷成一片"未应用"（用户实测），而其中绝大多数我们根本没用过。
  //   缺口的**运行时**上报在 `decodePartTextures`（第一次真的要用它才解码 ⇒ 那时才报，每次会话一次）；
  //   全局覆盖率清点走离线扫描器 `npm run` → `scripts/scan-part-coverage.ts`。
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
  // **翻译缺口在这里报**（每个资产一次，`decodePartTextures` 的缓存保证）——
  // 与"启动预载"分开：预载只解析，缺口要等**真的要用这个资产**时才说（见 `parsePartUncached` 的说明）。
  reportPartGaps(parsed.name, parsed.system);
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
  const paths = system.emitters.map((em) => (em.texture ? normalizeTexturePath(em.texture) : null));
  // 缺口上报在 `decodePartTextures` 里（唯一一处）—— 别在这里再报一遍
  return decodePartTextures({
    name,
    path: `sys:${name}`,
    system,
    texturePaths: paths,
    diag: { scriptPath: '(代码内 spec)', emitterCount: system.emitters.length, textures: paths, missing: [] },
  });
}
