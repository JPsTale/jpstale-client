/**
 * 特效资产加载 —— 把 INI 这条链解析成可直接播放的帧序列（**按精确路径**取）。
 *
 * 链路（原版 HoEffect 的 StartBillRect 走的路径）：
 *   effect/animationdata/<Name>.ini          逐帧：图号/时长/透明度/尺寸/角度 + BlendType
 *     └─ DataFile = <ImageData>.ini          effect/imagedata/<ImageData>.ini
 *          └─ Name = Effect\ImageData\X\Shock0.tga + Count
 *               └─ effect/imagedata/x/shock01.tga …（1-based 序号插在扩展名前）
 *
 * 纹理加载用角色纹理那条链（flipY=true + sRGB），与精灵的 UV 朝向一致。
 *
 * **两段式**（与 `part-assets.ts` 同一套约定，用户 2026-09-18 定调）：
 *   ① `parseEffectAtPath` —— 读 ini + ImageData ini 的**文本**并解析（便宜）⇒ 启动预载只做这一段
 *   ② `decodeEffectFrames` —— 逐帧解码贴图（贵）⇒ 真的要用到才做
 * 路径**只从注册表的清单来**（`effect-registry.lookupEffect`），不再自己拼名字去猜目录。
 */
import type * as THREE from 'three';
import { cachedFetch } from '../../core/asset-cache.js';
import { reportFallback } from '../../char/fallback-log.js';
import { fetchAndDecodeTexture } from '../char-texture-loader.js';
import {
  parseAnimationData, parseImageData, resolveImageFrames, EFFECT_HZ,
  type EffectBlend,
} from '../../core/effect/anim-ini.js';

const IMG_DIR = 'effect/imagedata/';

/** 清单里的一条资产（名字 + 精确路径）—— 定义在 `effect-registry`，这里只要形状 */
export interface EffectRef { name: string; path: string }

/** 一帧的贴图与播放参数（`tex` 为 null = 该帧贴图没解出来） */
export interface EffectFrameTex {
  tex: THREE.DataTexture | null;
  /** 该帧持续的 70Hz 步数 */
  delay: number;
  /** 不透明度 0..255 */
  alpha: number;
  /** 世界尺寸（Size）；该 INI 未提供 Size 段时为 null */
  size: number | null;
  /** 旋转角（度）；未提供时为 null */
  angle: number | null;
}

/** 解析出来的一帧（**贴图还没解**，只有一个路径） */
export interface EffectFrameSpec {
  path: string | null;
  delay: number;
  alpha: number;
  size: number | null;
  angle: number | null;
}

export interface EffectDiag {
  animationIni: string;
  imageIni: string | null;
  blend: EffectBlend;
  /** 是否提供了 Size 段 */
  hasSize: boolean;
  framePaths: string[];
  missing: string[];
}

/** 解析好的 INI 特效（**还没解码贴图**）—— 启动预载就停在这一步 */
export interface ParsedEffect {
  name: string;
  path: string;
  blend: EffectBlend;
  frameSpecs: EffectFrameSpec[];
  /** 总时长（秒；Delay 以 70Hz 计） */
  duration: number;
  diag: EffectDiag;
}

/** 解析失败（带原因）—— 调用方必须上报，别丢 */
export type EffectParseOutcome = ParsedEffect | { fail: string };

export interface LoadedEffect extends ParsedEffect {
  frames: EffectFrameTex[];
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const buf = await cachedFetch(url);
    return new TextDecoder('utf-8').decode(buf);
  } catch {
    return null;
  }
}

/* ─────────── ① 解析（启动预载做这一段） ─────────── */

const parseCache = new Map<string, Promise<EffectParseOutcome>>();

/** 按**精确路径**解析一个 INI 特效（不含贴图解码）。失败**带原因返回**，不抛。 */
export function parseEffectAtPath(ref: EffectRef): Promise<EffectParseOutcome> {
  const hit = parseCache.get(ref.path);
  if (hit) return hit;
  const job = parseEffectUncached(ref).catch((e: unknown) => ({ fail: String(e) }));
  parseCache.set(ref.path, job);
  return job;
}

async function parseEffectUncached(ref: EffectRef): Promise<EffectParseOutcome> {
  const text = await fetchText('/res/' + ref.path);
  if (text === null) {
    return { fail: `ini 取不到（404？清单可能比资产旧 ⇒ 重跑 npm run fx-names）：${ref.path}` };
  }
  const anim = parseAnimationData(text);
  // 0 帧 = 这不是一份可播的 INI。旧版把这里当"文件不存在 ⇒ 去试 .part"，于是
  // **dev server 的 SPA 兜底（200 + HTML）也会走到这里**；现在路径是清单给的精确路径，
  // 出现 0 帧就只能是资产本身的问题 —— 说出来（AGENTS #12），别当"没有这个名字"。
  if (anim.frames.length === 0) {
    return { fail: `解析出 0 帧（ini 损坏？或该路径返回的是 SPA 兜底 HTML）：${ref.path}` };
  }

  // ImageData：DataFile 是 basename（如 Hit1.ini），我方资产是小写
  let framePaths: string[] = [];
  let imageIni: string | null = null;
  /** ImageData 这一层**为什么没有帧**（进 diag，播放时"一帧贴图都没解出来"会把它一并显示） */
  let imgFail = 'ini 里没有 DataFile 段';
  if (anim.dataFile) {
    const imgPath = IMG_DIR + anim.dataFile.toLowerCase();
    imageIni = imgPath;
    const imgText = await fetchText('/res/' + imgPath);
    if (imgText === null) {
      // **资产自带的坏链**（`DataFile` 指向一份不存在的 ImageData）—— 我方 client 实测 3 个：
      // groundpike / round2 / skillroarlinepartice1（清单与成因见 `scripts/verify-fx-names.ts`）。
      // ⚠ **不藏**：请求照发（404 就是它的信号），这里再把它作为**缺陷**点名报一次 ——
      //   "某份特效一帧都放不出来"必须能看见，而不是只在被用到时才浮现（用户 2026-09-18）。
      imgFail = `ImageData「${imgPath}」取不到（404）`;
    } else {
      const img = parseImageData(imgText);
      if (!img) imgFail = `ImageData「${imgPath}」解析不出来`;
      else {
        framePaths = resolveImageFrames(img);
        if (!framePaths.length) imgFail = `ImageData「${imgPath}」→ 0 张帧图（Name/Count 段？）`;
      }
    }
    // 帧一张都拿不到 ⇒ 这份特效**放不出任何东西**：当场报出来（同资产只报一次，reportFallback 自带去重）
    if (!framePaths.length) {
      reportFallback('fx', `效果「${ref.name}」的 ImageData 链断了：${imgFail} ⇒ 这份特效一帧都放不出来`
        + '（资产自带的问题，非我们拼错路径；同类清单见 scripts/verify-fx-names.ts）');
    }
  }

  const missing: string[] = [];
  const frameSpecs: EffectFrameSpec[] = [];
  let durationSteps = 0;
  for (const f of anim.frames) {
    const path = framePaths[f.imageIndex] ?? null;
    // 帧图**缺失**就在这里记账（真正解码时才知道贴图能不能解出来）；
    // 整份特效"一帧都解不出贴图"由调用方判（`effect-manager.spawn` 的 guard）
    if (!path) missing.push(framePaths.length ? `(ImageData 里没有第 ${f.imageIndex} 帧)` : imgFail);
    frameSpecs.push({ path, delay: f.delay, alpha: f.alpha, size: f.size, angle: f.angle });
    durationSteps += f.delay;
  }

  return {
    name: ref.name,
    path: ref.path,
    blend: anim.blend,
    frameSpecs,
    duration: durationSteps / EFFECT_HZ,
    diag: {
      animationIni: ref.path, imageIni, blend: anim.blend, hasSize: anim.hasSize,
      framePaths, missing,
    },
  };
}

/* ─────────── ② 解码贴图（用到才做） ─────────── */

const texCache = new Map<string, Promise<LoadedEffect>>();

/** 逐帧解码贴图（**唯一实现**）。贴图本身在 `char-texture-loader` 里已按路径全局缓存。 */
export function decodeEffectFrames(parsed: ParsedEffect): Promise<LoadedEffect> {
  const hit = texCache.get(parsed.path);
  if (hit) return hit;
  const job = decodeUncached(parsed);
  texCache.set(parsed.path, job);
  return job;
}

async function decodeUncached(parsed: ParsedEffect): Promise<LoadedEffect> {
  const missing = [...parsed.diag.missing];
  const frames: EffectFrameTex[] = [];
  for (const f of parsed.frameSpecs) {
    let tex: THREE.DataTexture | null = null;
    if (f.path) {
      tex = await fetchAndDecodeTexture('/res/' + f.path, 1, { linear: true });   // 特效：原样进（见 fetchAndDecodeTexture 的说明）
      if (!tex) missing.push(f.path);
    }
    frames.push({ tex, delay: f.delay, alpha: f.alpha, size: f.size, angle: f.angle });
  }
  return { ...parsed, frames, diag: { ...parsed.diag, missing } };
}
