/**
 * 特效资产**注册表** —— 「名字 → 精确路径」的唯一入口（同步查表）+ 启动预载。
 *
 * 为什么这样（用户 2026-09-18 定调）：**原版从不探测文件系统** —— 启动时按硬编码清单预载
 * 脚本（`HoEffect.cpp:12030+` 一连 307 条 `LoadScript("Effect\\Particle\\Script\\X.part")`），
 * 运行时 `g_NewParticleMgr.Start("ChaosKaraSkill", …)` 只在内存注册表里查名字
 * （`HoNewParticleMgr.cpp:220` → `FindScript`，定义在 `:26`）。
 * 我们过去是"先试 `effect/animationdata/<名>.ini`，404 了再试 `.part`"，
 * 于是**每次 spawn 都白打一次 404**（用户实测控制台一堆 `GET /res/effect/animationdata/*.ini 404`）。
 *
 * 现在：
 *   ① 清单 `effect-names.generated.json`（`npm run fx-names` 生成）**随包进来** ⇒ `lookupEffect`
 *      同步返回精确路径，**不可能 404**，也没有"两族试哪家"的歧义（四族名字实测交集 0）。
 *   ② `preloadEffects()` 启动时按清单把 ini/part **解析**一遍（只读文本，**不解码贴图** ——
 *      那一步留给第一次真的要用到时，见两个 loaders 的两段式说明）。
 *   ③ 家族 → 入口的分派**只在这一张表里**（`PARSE` / `LOAD`）：Lua 前端落地时在这里加一行，
 *      预载、运行时播放、将来的烘焙取资产三处同时生效（用户要求的"一致的运行时接口"）。
 *
 * 未知名字与解析失败**一律上报**（`reportFallback`）—— 旧版 `catch(() => null)` 会把
 * "资产缺失/清单过期"伪装成"本来就没有这个名字"（AGENTS #12）。
 */
import {
  parseEffectAtPath, decodeEffectFrames,
  type EffectParseOutcome, type EffectRef, type LoadedEffect,
} from './effect-assets.js';
import {
  parsePartAtPath, decodePartTextures, printPartGapSummary, partGapCounts,
  type PartParseOutcome, type PartRef, type LoadedPart,
} from './part-assets.js';
import { lookupEffect, entriesOf, EFFECT_FAMILIES, type EffectEntry, type EffectFamily } from './effect-names.js';
import { reportFallback } from '../../char/fallback-log.js';

// 纯查表那层（离线脚本也要用）从这里一并转出，调用方只认 `effect-registry` 一个入口
export { lookupEffect, entriesOf, effectCounts, EFFECT_FAMILIES } from './effect-names.js';
export type { EffectEntry, EffectFamily } from './effect-names.js';

function reportRefFailure(ref: { name: string; path: string }, why: string): void {
  reportFallback('fx', `特效「${ref.name}」（${ref.path}）加载失败：${why}`);
}

/* ─────────── 家族 → 入口（**唯一**分派表） ─────────── */

/**
 * 家族 → **解析**入口（便宜的那一段，预载用它）。
 * 未登记的家族 = 前端还没实现 ⇒ `familyUnavailable` 会给出一句话原因。
 */
const PARSE: Partial<Record<EffectFamily, (ref: EffectEntry) => Promise<EffectParseOutcome | PartParseOutcome>>> = {
  ini: parseEffectAtPath,
  part: parsePartAtPath,
};

/**
 * 家族 → **完整加载**入口（解析 + 解码贴图）。
 * 新家族（Lua）落地时：① 写它的解析器 ② 在这两张表各加一行 ③ 预载与播放同时生效。
 */
const LOAD: Partial<Record<EffectFamily, (ref: EffectEntry) => Promise<LoadedEffect | LoadedPart | null>>> = {
  ini: (ref) => loadEffectByRef(ref),
  part: (ref) => loadPartByRef(ref),
};

/** 这个家族现在能不能播？不能则返回原因（如 Lua 前端还没做） */
export function familyUnavailable(family: EffectFamily): string | null {
  if (LOAD[family]) return null;
  return family === 'lua' || family === 'luac'
    ? `${family} 粒子（NewEffect）的前端还没实现`
    : `${family} 这一族还没有加载实现`;
}

/* ─────────── 运行时取资产（名字 或 条目） ─────────── */

/** 按精确路径加载一份 INI 特效（**失败已上报**，返回 null） */
export async function loadEffectByRef(ref: EffectRef): Promise<LoadedEffect | null> {
  const out = await parseEffectAtPath(ref);
  if ('fail' in out) { reportRefFailure(ref, out.fail); return null; }
  return decodeEffectFrames(out);
}

/** 按精确路径加载一份 `.part`（**失败已上报**，返回 null） */
export async function loadPartByRef(ref: PartRef): Promise<LoadedPart | null> {
  const out = await parsePartAtPath(ref);
  if ('fail' in out) { reportRefFailure(ref, out.fail); return null; }
  return decodePartTextures(out);
}

/** 名字 → 加载好的 INI 特效（给已经确定是 INI 的调用方，如 `quarks-runtime` 的药水/Light1） */
export async function loadEffectByName(name: string): Promise<LoadedEffect | null> {
  const entry = lookupEffect(name);
  if (!entry) { reportFallback('fx', `INI 特效「${name}」不在清单里（npm run fx-names 未收录？）`); return null; }
  if (entry.family !== 'ini') {
    reportFallback('fx', `「${name}」不是 INI 特效，而是 ${entry.family}（${entry.path}）`);
    return null;
  }
  return loadEffectByRef(entry);
}

/** 名字 → 加载好的 `.part`（同上，给确定是 `.part` 的调用方） */
export async function loadPartByName(name: string): Promise<LoadedPart | null> {
  const entry = lookupEffect(name);
  if (!entry) { reportFallback('fx', `.part 资产「${name}」不在清单里（npm run fx-names 未收录？）`); return null; }
  if (entry.family !== 'part') {
    reportFallback('fx', `「${name}」不是 .part 资产，而是 ${entry.family}（${entry.path}）`);
    return null;
  }
  return loadPartByRef(entry);
}

/** 加载结果（家族标签让调用方知道拿到的该是哪一种） */
export type LoadedAny =
  | { family: 'ini'; effect: LoadedEffect }
  | { family: 'part'; part: LoadedPart };

/** 条目 → 加载好的资产（家族分派在 `LOAD` 表里；不可播的家族上报原因后返回 null） */
export async function loadByEntry(entry: EffectEntry): Promise<LoadedAny | null> {
  const why = familyUnavailable(entry.family);
  if (why) { reportFallback('fx', `特效「${entry.name}」（${entry.path}）：${why}，本次不放`); return null; }
  const out = await LOAD[entry.family]!(entry);
  if (!out) return null;                       // 失败原因已在 loadXByRef 里上报
  return entry.family === 'ini'
    ? { family: 'ini', effect: out as LoadedEffect }
    : { family: 'part', part: out as LoadedPart };
}

/* ─────────── 启动预载 ─────────── */

export interface PreloadReport {
  /** 逐族的 [成功, 总数] */
  families: Record<string, [number, number]>;
  /** 失败的条目（名字 + 原因）—— 已逐条上报，这里只是回执 */
  failed: Array<{ name: string; path: string; why: string }>;
  /** `.part` 翻译缺口（去重后）：几**种**键/时间轴、涉及几个脚本 —— 全表已打到控制台 */
  gaps: { keys: number; tracks: number; scripts: number };
  ms: number;
}

let preloadJob: Promise<PreloadReport> | null = null;
let lastReport: PreloadReport | null = null;

/** 预载的并发上限（608 个文件一次全发会把连接池和 dev server 挤爆，12 路够快也够稳） */
const PRELOAD_CONCURRENCY = 12;

/**
 * **启动时调一次**：按清单把能播的两族（ini / part）解析进缓存。
 *
 * 多处启动点（游戏 / 两个 lab / 检查器）都调它也没关系 —— 只跑一次，后来者拿到同一个 Promise。
 * 只做"解析"不做"解码贴图"：608 份资产全解贴图是几百 MB 与数秒，而原版也不是开局就解完
 * （`.part` 的贴图是 `Start` 时进纹理管理器的）。
 */
export function preloadEffects(): Promise<PreloadReport> {
  if (!preloadJob) preloadJob = runPreload();
  return preloadJob;
}

/** 上次预载的回执（没跑过 = null）—— 实验室/检查器回显用 */
export function preloadState(): PreloadReport | null {
  return lastReport;
}

async function runPreload(): Promise<PreloadReport> {
  const t0 = performance.now();
  const jobs: Array<{ entry: EffectEntry; run: () => Promise<EffectParseOutcome | PartParseOutcome> }> = [];
  const families: Record<string, [number, number]> = {};
  // 只预载**能播**的家族（有解析器的那两族）。lua/luac 现在没有解析器，预载它们只是白拿字节 ——
  // 而且**不进回执**：写成 `lua 0/42` 会被误读成"42 个失败"，其实根本没去读（前端落地后自会进回执）。
  for (const family of EFFECT_FAMILIES) {
    const run = PARSE[family];
    if (!run) continue;
    const entries = entriesOf(family);
    families[family] = [0, entries.length];
    for (const e of entries) jobs.push({ entry: e, run: () => run(e) });
  }

  const failed: PreloadReport['failed'] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      const job = jobs[i];
      if (!job) return;
      const out = await job.run().catch((e: unknown) => ({ fail: String(e) }));
      if ('fail' in out) {
        failed.push({ name: job.entry.name, path: job.entry.path, why: out.fail });
        reportRefFailure(job.entry, out.fail);
      } else {
        families[job.entry.family]![0]++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PRELOAD_CONCURRENCY, jobs.length) }, worker));

  const ms = Math.round(performance.now() - t0);
  // 预载把每个脚本都解析了一遍 ⇒ 这时报缺口才是**完整的一张表**（去重后很短，
  // 不是"每资产一行"的噪声）。它是**后续开发参考**，不是运行期降级（用户 2026-09-18 定调）。
  printPartGapSummary();
  const report: PreloadReport = { families, failed, gaps: partGapCounts(), ms };
  lastReport = report;
  const parts = Object.entries(families)
    .filter(([, [, total]]) => total > 0)
    .map(([f, [ok, total]]) => `${f} ${ok}/${total}`);
  console.log(`[fx] 预载完成：${parts.join('、')}`
    + (failed.length ? `，**失败 ${failed.length}**（见降级清单）` : '')
    + `，用时 ${ms}ms`);
  return report;
}
