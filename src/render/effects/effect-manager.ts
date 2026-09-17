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
import { loadPart, loadPartFromSystem, type LoadedPart } from './part-assets.js';
import type { PartHandle } from './part-emitter.js';
import type { PartSystem } from '../../core/effect/part-script.js';
import { reportFallback } from '../../char/fallback-log.js';
import { createPartRuntime, type PartRuntime } from './part-emitter.js';
import type { EffectBlend } from '../../core/effect/anim-ini.js';
import { EFFECT_HZ } from '../../core/effect/anim-ini.js';

/** INI 未提供 Size 段时的默认世界尺寸（角色高约 46 世界单位，取 32 与命中特效同量级） */
const DEFAULT_SIZE = 32;

/**
 * 物理粒子爆发 —— 原版 `HoPrimitiveBillboard` + `HoPhysicsParticle`（`HoEffect.cpp:7114` 药水即此）。
 *
 * 原版把**同一份 INI 动画复制 N 份**，每份各自带一个物理体：
 *   每帧 `vy += gravity; pos += velocity; 自转 += step`，寿命到就整颗消失。
 * 而 `EffectManager.spawn` 原本只放**一份静止的**动画（那正是"粒子不会动"的原因）。
 * 给出 `burst` 就按上面这套跑。
 *
 * ⚠ 单位换算：原版这几个量是**每帧**的原始单位（`fONE=256` ⇒ 除以 256 得世界单位），
 * 而本运行时是**每秒**制 ⇒ 先 ÷256 再 ×70（原版 `MainEffect` 按 1/70 s 步进）。
 * 换算逐项写在调用方（`potion-burst.ts`），这里只认世界单位/秒。
 */
export interface BurstSpec {
  /** 份数（原版 30） */
  count: number;
  /** 水平初速（世界单位/秒）；方向在 XZ 面上随机 */
  speed: number;
  /** 垂直初速（世界单位/秒） */
  speedY: number;
  /** 重力（世界单位/秒²，负值向下） */
  gravity: number;
  /** 寿命（秒）；到期整颗移除（不等 INI 播完） */
  life: { min: number; max: number };
  /** 自转（度/秒） */
  spin: number;
}

export interface SpawnOpts {
  pos: { x: number; y: number; z: number };
  /** 整体尺寸倍率（默认 1） */
  scale?: number;
  /**
   * **INI 没有 Size 段时**用的尺寸（世界单位），替代 `DEFAULT_SIZE`。
   *
   * 为什么需要：原版 `HoEffectMgr::Start` 的很多分支是**显式**给尺寸的
   * （`StartBillRectPrimitive(x,y,z,sizeX,sizeY,ini)` / `SetSize(...)`），
   * 而那些 INI 自己并没有 Size 段 —— 我方 `DEFAULT_SIZE = 32` 只是兜底猜值。
   * 药水就是典型：原版 `SetSize(8,8)`（`HoEffect.cpp:7144`）而 `potion1.ini` 无 Size 段
   * ⇒ 不覆盖的话粒子会**大 4 倍**，"飞出去一小段"看着就像没动（用户 2026-09-16 实测）。
   *
   * ⚠ INI **有** Size 段时本项不生效（逐帧尺寸动画说了算）—— 那才是原版没显式给尺寸的情形。
   */
  size?: number;
  /** 跟随目标（如骨骼 Object3D）；给出后用其世界坐标 + offset */
  attach?: THREE.Object3D;
  /**
   * 覆盖初速度（世界单位/秒）—— 给**飞出物**用（原版 `AssaParticle_*Shot` 那类朝目标飞的弹）。
   *
   * 与 `attach` 的区别：`attach` 是"外部每帧推一个节点、粒子挂上去"，而本项是
   * **让粒子自己按这个速度飞**（`.part` 路径下即覆盖 emitter 的 `initialVelocity`）。
   * ⚠ `.part` 路径此前**没有实现 `attach` 跟随**（只有 INI 广告牌那条路有），
   * 所以飞出物要走这里，不要走 attach。
   */
  velocity?: { x: number; y: number; z: number };
  /** 物理粒子爆发：给出时复制 count 份并按原版物理运动（见 BurstSpec） */
  burst?: BurstSpec;
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
  /** 物理粒子（burst）：速度 / 重力 / 寿命 / 自转。`life <= 0` = 不是爆发粒子（按 INI 播完） */
  vel: THREE.Vector3;
  gravity: number;
  life: number;
  age: number;
  /** 自转（度/秒）与累计角度（度）—— 叠在 INI 每帧的 angle 之上 */
  spin: number;
  spinDeg: number;
}

export interface EffectManager {
  /** 播放一个特效：先按 INI 广告牌解析，找不到再按 `.part` 粒子脚本解析 */
  spawn(name: string, opts: SpawnOpts): Promise<boolean>;
  /**
   * 播放一份**代码内 spec**（没有数据文件的那类原版特效，如法杖普攻弹 `MONSTER_IMP_SHOT1`）。
   * `opts.attach` 给出时粒子跟随该节点（飞行投射物），尾迹留在身后。
   * 返回**可停止的句柄**（飞行物到点要 `stop()`，否则粒子会堆在命中点上）——失败返回 null。
   */
  spawnSystem(system: PartSystem, opts: SpawnOpts): Promise<PartHandle | null>;
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
    // 旋转 = INI 每帧的角度 + 物理粒子的累计自转（原版 DirectionAngle 与 PutAngle 是两回事，相加）
    inst.mat.rotation = ((f.angle ?? 0) + inst.spinDeg) * (Math.PI / 180);
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

      // 爆发：同一份 INI 复制 count 份，每份一个物理体（原版 30 个 HoPrimitiveBillboard）
      const burst = opts.burst;
      const n = burst ? Math.max(1, Math.round(burst.count)) : 1;
      for (let i = 0; i < n; i++) {
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
          size: eff.frames[0]?.size ?? opts.size ?? DEFAULT_SIZE,
          scale: opts.scale ?? 1,
          attach: opts.attach,
          offset: new THREE.Vector3(opts.pos.x, opts.pos.y, opts.pos.z),
          tmp: new THREE.Vector3(),
          vel: new THREE.Vector3(), gravity: 0, life: 0, age: 0, spin: 0, spinDeg: 0,
        };
        if (burst) {
          // 水平方向随机（原版 `ang = rand() % ANGLE_360`，x 用 cos、z 用 sin）
          const a = Math.random() * Math.PI * 2;
          inst.vel.set(Math.cos(a) * burst.speed, burst.speedY, Math.sin(a) * burst.speed);
          inst.gravity = burst.gravity;
          inst.life = burst.life.min + Math.random() * (burst.life.max - burst.life.min);
          inst.spin = burst.spin;
          // 自转的**初始相位**也随机，否则 30 颗同相起步（原版每颗 DirectionAngle 从 0 起，
          // 但各自的步进是 destAngle/Live、且 Live 随机 ⇒ 天然错开；这里直接给随机初相，等价且更稳）
          inst.spinDeg = Math.random() * 360;
        }
        applyFrame(inst);
        live.push(inst);
      }
      return true;
    } catch {
      return false;
    } finally {
      pending--;
    }
  }

  async function spawnSystem(system: PartSystem, opts: SpawnOpts): Promise<PartHandle | null> {
    const part = await loadPartFromSystem(system.name || 'inline', system);
    console.log('[fx] 播代码内 spec「' + part.name + '」：emitter ' + part.diag.emitterCount
      + ' 个，贴图 ' + JSON.stringify(part.diag.textures)
      + (part.diag.missing.length ? ' ⚠ 缺失 ' + part.diag.missing.join(',') : '')
      + '，跟随节点=' + !!opts.attach);
    const handle = parts.spawn(part, opts.pos, opts.scale ?? 1, opts.attach ?? null, opts.velocity);
    partDiag = part.diag;
    if (part.diag.missing.length) {
      reportFallback('fx', `代码内 spec「${part.name}」贴图缺失：${part.diag.missing.join(', ')}`);
    }
    return handle;
  }

  function update(dt: number, camera: THREE.Camera): void {
    parts.update(dt, camera);

    for (let i = live.length - 1; i >= 0; i--) {
      const inst = live[i]!;
      inst.t += dt;

      // 物理粒子（burst）：`vy += g·dt; pos += v·dt; 自转 += ω·dt`，寿命到就整颗移除。
      // 原版是每帧直接加（`HoPrimitiveBillboard::Main` → `LocalX += DirectionVelocity.x`），
      // 这里是每秒制，等价（换算见 BurstSpec）。
      if (inst.life > 0) {
        inst.age += dt;
        if (inst.age >= inst.life) {
          root.remove(inst.sprite);
          inst.mat.dispose();
          live.splice(i, 1);
          continue;
        }
        inst.vel.y += inst.gravity * dt;
        inst.offset.x += inst.vel.x * dt;
        inst.offset.y += inst.vel.y * dt;
        inst.offset.z += inst.vel.z * dt;
        inst.spinDeg += inst.spin * dt;
      }

      // 推进帧（可跨多帧，保证低帧率下时长准确）
      let guard = 0;
      while (inst.frameIdx < inst.eff.frames.length - 1
             && inst.t >= frameSeconds(inst.eff, inst.frameIdx)
             && guard++ < 256) {
        inst.t -= frameSeconds(inst.eff, inst.frameIdx);
        inst.frameIdx++;
        applyFrame(inst);
      }
      // 自转是逐帧累积的（上面 +dt），要每帧刷一次旋转，否则只在换帧时才动
      if (inst.life > 0) applyFrame(inst);

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
    spawnSystem,
    update,
    clear,
    stats: () => ({ active: live.length, pending, loaded, parts: parts.stats().emitters }),
    lastDiag: () => diag,
    lastPart: () => partDiag,
  };
}
