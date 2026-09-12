/**
 * 特效实例管理 —— 把加载好的特效摆到场景里按帧播放。
 *
 * 渲染语义（对齐原版 HoPrimitiveBillboard / CParticleSystem 的做法）：
 *  - **depthWrite = false、depthTest = true**：特效不写深度，但被场景遮挡
 *  - 混合模式由 INI 的 BlendType 决定（lamp=加法，占我方资产 92/99）
 *  - 帧时长 = Delay / 70 秒（EFFECT_HZ）
 *
 * 有意偏离（原版缺陷）：原版把 BlendType 写在 ImageData 的**共享材质**上，
 * 同一贴图的两个特效会互相改写混合模式；这里每个实例自带材质。
 */
import * as THREE from 'three';
import { loadEffect, type LoadedEffect, type EffectDiag } from './effect-assets.js';
import { loadPart, type LoadedPart } from './part-assets.js';
import { createPartRuntime, type PartRuntime } from './part-emitter.js';
import type { EffectBlend } from '../../core/effect/anim-ini.js';
import { EFFECT_HZ } from '../../core/effect/anim-ini.js';

/** INI 未提供 Size 段时的默认世界尺寸（角色高约 46 世界单位，取 32 与命中特效同量级） */
const DEFAULT_SIZE = 32;

export interface SpawnOpts {
  pos: { x: number; y: number; z: number };
  /** 整体尺寸倍率（默认 1） */
  scale?: number;
  /** 跟随目标（如骨骼 Object3D）；给出后用其世界坐标 + offset */
  attach?: THREE.Object3D;
}

interface Instance {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  eff: LoadedEffect;
  /** 已播放秒数 */
  t: number;
  frameIdx: number;
  size: number;
  scale: number;
  attach?: THREE.Object3D;
  offset: THREE.Vector3;
  tmp: THREE.Vector3;
}

export interface EffectManager {
  /** 播放一个特效：先按 INI 广告牌解析，找不到再按 `.part` 粒子脚本解析 */
  spawn(name: string, opts: SpawnOpts): Promise<boolean>;
  /** 每帧推进（`.part` 的朝向需要相机） */
  update(dt: number, camera: THREE.Camera): void;
  clear(): void;
  stats(): { active: number; pending: number; loaded: number; parts: number };
  /** 最近一次 spawn 的解析结果（检查器诊断用） */
  lastDiag(): EffectDiag | null;
  /** 最近一次 `.part` 解析结果 */
  lastPart(): LoadedPart['diag'] | null;
}

/**
 * BlendType → three.js 混合。**按原版 D3D 因子逐项对齐**（Graphics/DeviceRenderState.cpp）：
 *
 *   Color (0)：SRC_COLOR / INV_SRC_COLOR  → result = src² + dst·(1-src)
 *              **黑色天然被"抠掉"**（src=0 → 结果=dst）。无 alpha 通道的贴图（如 dust1 的 .bmp）
 *              就是靠这个合成的 —— 不能用普通透明混合，否则黑底会被画成黑框。
 *   Alpha (1)：SRC_ALPHA / INV_SRC_ALPHA  → 常规透明混合
 *   Lamp  (2)：SRC_ALPHA / ONE            → 加法（我方资产 92/99 属此类）
 *   Shadow(3)：ZERO / SRC_COLOR           → result = dst·src
 */
function applyBlend(mat: THREE.SpriteMaterial, b: EffectBlend): void {
  switch (b) {
    case 'lamp':
      mat.blending = THREE.AdditiveBlending;
      mat.blendSrc = THREE.SrcAlphaFactor;
      mat.blendDst = THREE.OneFactor;
      mat.blendSrcAlpha = THREE.SrcAlphaFactor;
      mat.blendDstAlpha = THREE.OneFactor;
      break;
    case 'alpha':
      mat.blending = THREE.NormalBlending;
      break;
    case 'color':
      mat.blending = THREE.CustomBlending;
      mat.blendEquation = THREE.AddEquation;
      mat.blendSrc = THREE.SrcColorFactor;
      mat.blendDst = THREE.OneMinusSrcColorFactor;
      mat.blendSrcAlpha = THREE.SrcAlphaFactor;
      mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
      break;
    case 'shadow':
      mat.blending = THREE.CustomBlending;
      mat.blendEquation = THREE.AddEquation;
      mat.blendSrc = THREE.ZeroFactor;
      mat.blendDst = THREE.SrcColorFactor;
      mat.blendSrcAlpha = THREE.ZeroFactor;
      mat.blendDstAlpha = THREE.SrcAlphaFactor;
      break;
  }
}

export function createEffectManager(scene: THREE.Scene): EffectManager {
  const root = new THREE.Group();
  root.name = 'effects';
  scene.add(root);

  const live: Instance[] = [];
  const parts: PartRuntime = createPartRuntime(scene);
  let pending = 0;
  let loaded = 0;
  let partDiag: LoadedPart['diag'] | null = null;
  let diag: EffectDiag | null = null;

  function frameSeconds(eff: LoadedEffect, i: number): number {
    return Math.max(1, eff.frames[i]?.delay ?? 1) / EFFECT_HZ;
  }

  function applyFrame(inst: Instance): void {
    const f = inst.eff.frames[inst.frameIdx];
    if (!f) return;
    if (f.tex && inst.mat.map !== f.tex) {
      inst.mat.map = f.tex;
      inst.mat.needsUpdate = true;
    }
    // Size 段缺失时不应用尺寸动画，用默认值
    if (f.size !== null) inst.size = f.size;
    const s = Math.max(0.5, inst.size * inst.scale);
    inst.sprite.scale.set(s, s, 1);
    inst.mat.opacity = Math.min(1, Math.max(0, f.alpha / 255));
    inst.mat.rotation = f.angle === null ? 0 : (f.angle * Math.PI) / 180;
  }

  async function spawn(name: string, opts: SpawnOpts): Promise<boolean> {
    pending++;
    try {
      const eff = await loadEffect(name);
      if (!eff) {
        // 退到 `.part` 粒子脚本（两个家族同名互不冲突：INI 在 animationdata，脚本在 particle/script）
        const part = await loadPart(name);
        if (!part) return false;
        loaded++;
        partDiag = part.diag;
        parts.spawn(part, opts.pos, opts.scale ?? 1);
        return true;
      }
      loaded++;
      diag = eff.diag;
      // 一帧贴图都没有 → 视为无法播放（避免生成不可见精灵）
      if (!eff.frames.some((f) => f.tex)) return false;

      const mat = new THREE.SpriteMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: true,
        color: 0xffffff,
      });
      applyBlend(mat, eff.blend);
      const sprite = new THREE.Sprite(mat);
      root.add(sprite);

      const inst: Instance = {
        sprite, mat, eff, t: 0, frameIdx: 0,
        size: eff.frames[0]?.size ?? DEFAULT_SIZE,
        scale: opts.scale ?? 1,
        attach: opts.attach,
        offset: new THREE.Vector3(opts.pos.x, opts.pos.y, opts.pos.z),
        tmp: new THREE.Vector3(),
      };
      applyFrame(inst);
      live.push(inst);
      return true;
    } catch {
      return false;
    } finally {
      pending--;
    }
  }

  function update(dt: number, camera: THREE.Camera): void {
    parts.update(dt, camera);

    for (let i = live.length - 1; i >= 0; i--) {
      const inst = live[i]!;
      inst.t += dt;

      // 推进帧（可跨多帧，保证低帧率下时长准确）
      let guard = 0;
      while (inst.frameIdx < inst.eff.frames.length - 1
             && inst.t >= frameSeconds(inst.eff, inst.frameIdx)
             && guard++ < 256) {
        inst.t -= frameSeconds(inst.eff, inst.frameIdx);
        inst.frameIdx++;
        applyFrame(inst);
      }

      // 位置：跟随目标或固定点
      if (inst.attach) inst.attach.getWorldPosition(inst.tmp).add(inst.offset);
      else inst.tmp.copy(inst.offset);
      inst.sprite.position.copy(inst.tmp);

      // 播完销毁
      if (inst.frameIdx >= inst.eff.frames.length - 1
          && inst.t >= frameSeconds(inst.eff, inst.frameIdx)) {
        root.remove(inst.sprite);
        inst.mat.dispose();          // 贴图是共享缓存，不 dispose
        live.splice(i, 1);
      }
    }
  }

  function clear(): void {
    for (const inst of live) {
      root.remove(inst.sprite);
      inst.mat.dispose();
    }
    live.length = 0;
    parts.clear();
  }

  return {
    spawn,
    update,
    clear,
    stats: () => ({ active: live.length, pending, loaded, parts: parts.stats().emitters }),
    lastDiag: () => diag,
    lastPart: () => partDiag,
  };
}
