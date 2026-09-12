/**
 * 特效资产加载 —— 把 `<name>.ini` 这条 INI 链解析成可直接播放的帧序列。
 *
 * 链路（原版 HoEffect 的 StartBillRect 走的路径）：
 *   effect/animationdata/<Name>.ini          逐帧：图号/时长/透明度/尺寸/角度 + BlendType
 *     └─ DataFile = <ImageData>.ini          effect/imagedata/<ImageData>.ini
 *          └─ Name = Effect\ImageData\X\Shock0.tga + Count
 *               └─ effect/imagedata/x/shock01.tga …（1-based 序号插在扩展名前）
 *
 * 纹理加载用角色纹理那条链（flipY=true + sRGB），与精灵的 UV 朝向一致。
 */
import type * as THREE from 'three';
import { cachedFetch } from '../../core/asset-cache.js';
import { fetchAndDecodeTexture } from '../char-texture-loader.js';
import {
  parseAnimationData, parseImageData, resolveImageFrames, EFFECT_HZ,
  type EffectBlend,
} from '../../core/effect/anim-ini.js';

const ANIM_DIR = 'effect/animationdata/';
const IMG_DIR = 'effect/imagedata/';

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

export interface EffectDiag {
  animationIni: string;
  imageIni: string | null;
  blend: EffectBlend;
  /** 是否提供了 Size 段 */
  hasSize: boolean;
  framePaths: string[];
  missing: string[];
}

export interface LoadedEffect {
  name: string;
  blend: EffectBlend;
  frames: EffectFrameTex[];
  /** 总时长（秒；Delay 以 70Hz 计） */
  duration: number;
  diag: EffectDiag;
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const buf = await cachedFetch(url);
    return new TextDecoder('utf-8').decode(buf);
  } catch {
    return null;
  }
}

/** 归一化特效名 → `effect/animationdata/<小写名>.ini` */
export function effectIniPath(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? name;
  const noExt = base.replace(/\.ini$/i, '').toLowerCase();
  return `${ANIM_DIR}${noExt}.ini`;
}

const cache = new Map<string, Promise<LoadedEffect | null>>();

/** 加载并缓存一个特效（失败返回 null，不抛） */
export function loadEffect(name: string): Promise<LoadedEffect | null> {
  const key = effectIniPath(name);
  const hit = cache.get(key);
  if (hit) return hit;
  const job = loadEffectUncached(name, key).catch(() => null);
  cache.set(key, job);
  return job;
}

async function loadEffectUncached(name: string, iniPath: string): Promise<LoadedEffect | null> {
  const text = await fetchText('/res/' + iniPath);
  if (text === null) return null;
  const anim = parseAnimationData(text);
  // 关键：资源不存在时 dev server 会落到 SPA 兜底返回 200 + HTML（不是 404），
  // 于是会解析出"0 帧"的空对象。必须把它当作"不存在"，否则调用方永远不会退到 `.part`。
  if (anim.frames.length === 0) return null;

  // ImageData：DataFile 是 basename（如 Hit1.ini），我方资产是小写
  let framePaths: string[] = [];
  let imageIni: string | null = null;
  if (anim.dataFile) {
    const imgPath = IMG_DIR + anim.dataFile.toLowerCase();
    imageIni = imgPath;
    const imgText = await fetchText('/res/' + imgPath);
    if (imgText) {
      const img = parseImageData(imgText);
      if (img) framePaths = resolveImageFrames(img);
    }
  }

  const missing: string[] = [];
  const frames: EffectFrameTex[] = [];
  let durationSteps = 0;
  for (const f of anim.frames) {
    const path = framePaths[f.imageIndex];
    let tex: THREE.DataTexture | null = null;
    if (path) {
      tex = await fetchAndDecodeTexture('/res/' + path);
      if (!tex) missing.push(path);
    } else {
      missing.push(`(无 ImageData 帧 #${f.imageIndex})`);
    }
    frames.push({ tex, delay: f.delay, alpha: f.alpha, size: f.size, angle: f.angle });
    durationSteps += f.delay;
  }

  return {
    name,
    blend: anim.blend,
    frames,
    duration: durationSteps / EFFECT_HZ,
    diag: {
      animationIni: iniPath, imageIni, blend: anim.blend, hasSize: anim.hasSize,
      framePaths, missing,
    },
  };
}
