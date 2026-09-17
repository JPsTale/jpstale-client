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
import { loadEffect, type EffectDiag } from './effect-assets.js';
import { loadPart, type LoadedPart } from './part-assets.js';
import type { PartSystem } from '../../core/effect/part-script.js';
import { reportFallback } from '../../char/fallback-log.js';
import { iniToQuarks } from './ini-to-quarks.js';
import type { QuarksRuntime, QuarksPartHandle } from './quarks-runtime.js';

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
  /**
   * **刚体跟随**：`attach` 移动时已生成的粒子**一起平移**（= 原版 `SetAttachPos` 的语义：
   * `if (attachPosFlag) part.WorldPos = 系统位置`）。观感是"**一团**被整体搬运"。
   *
   * 不给则 `attach` 是"出生点固化" ⇒ 老粒子留在原地形成**尾迹**（玩家施法弹要这个观感）。
   */
  rigidFollow?: boolean;
  /** 物理粒子爆发：给出时复制 count 份并按原版物理运动（见 BurstSpec） */
  burst?: BurstSpec;
}

export interface EffectManager {
  /** 播放一个特效：先按 INI 广告牌解析，找不到再按 `.part` 粒子脚本解析 */
  spawn(name: string, opts: SpawnOpts): Promise<boolean>;
  /**
   * 播放一份**代码内 spec**（没有数据文件的那类原版特效，如法杖普攻弹 `MONSTER_IMP_SHOT1`）。
   * `opts.attach` 给出时粒子跟随该节点（飞行投射物），尾迹留在身后。
   * 返回**可停止的句柄**（飞行物到点要 `stop()`，否则粒子会堆在命中点上）——失败返回 null。
   */
  spawnSystem(system: PartSystem, opts: SpawnOpts): Promise<QuarksPartHandle | null>;
  /**
   * 每帧推进。**只吃 dt** —— quarks 自己算朝向，不再需要相机
   * （旧自研 emitter 的 `camera` 参数随它一起退役，见 §12 迁移）。
   */
  update(dt: number): void;
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
/**
 * 特效管理器 —— 现在**只负责"载入 + 派发"**：把 INI / `.part` / 代码内 spec 都交给 quarks 渲染。
 *
 * ⚠ 因此**不再需要 `scene`**：场景节点由 quarks 运行时自己管（旧的自研 emitter 与 INI 精灵
 *   两套渲染器都已退役，见 §12 迁移）。这个签名变化本身就是"全用 quark"的证据。
 */
export function createEffectManager(quarks: QuarksRuntime | null = null): EffectManager {
  const quarksFx: QuarksRuntime | null = quarks;
  let pending = 0;
  let loaded = 0;
  let partDiag: LoadedPart['diag'] | null = null;
  let diag: EffectDiag | null = null;

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
        // `.part` 文件 → **同样交给 quarks**（与代码内 spec 同一条路，见工厂处说明）
        return (await spawnViaQuarks(part.system, opts, part.name)) !== null;
      }
      loaded++;
      diag = eff.diag;
      // 一帧贴图都没有 → 视为无法播放（避免生成不可见精灵）
      if (!eff.frames.some((f) => f.tex)) return false;
      // **INI 广告板 → quarks**（"全用 quark"的最后一条，见 `ini-to-quarks.ts`）：
      // 每帧一个单粒子系统（各带自己的贴图/Delay/BlendValue/Size）—— 才能表达
      // `returnparticle1.ini` 那种**不等长 Delay**（20,5,5,5,30）。
      if (!quarksFx) {
        reportFallback('fx', `INI 特效「${name}」要渲染，但 effect-manager 没拿到 QuarksRuntime`);
        return false;
      }
      if (opts.burst) {
        // 原版这里是"同一份 INI 复制 count 份、每份一个物理体"（30 个 HoPrimitiveBillboard）。
        // **现已无调用者**（药水改走 `quarksFx.playPotion`）⇒ 不静默兜底，明确上报。
        reportFallback('fx', `INI 特效「${name}」传了 burst（物理粒子爆发），该模式随旧渲染器一并退役，未表达`);
      }
      const systems = iniToQuarks(eff, {
        size: opts.size ?? eff.frames[0]?.size ?? DEFAULT_SIZE,
        scale: opts.scale,
      });
      if (!systems.length) {
        reportFallback('fx', `INI 特效「${name}」→ quarks 得到 0 个系统（帧贴图全缺？）`);
        return false;
      }
      for (const ps of systems) {
        ps.emitter.position.set(opts.pos.x, opts.pos.y, opts.pos.z);
      }
      quarksFx.addSystems(systems, opts.attach ?? null);
      return true;
      return true;
    } catch {
      return false;
    } finally {
      pending--;
    }
  }

  /**
   * **代码内 spec → quarks**（唯一入口）。
   *
   * `pos` / `scale` / `attach` / `rigidFollow` / `velocity` 全部透传给 quarks（见
   * `QuarksSpawnOpts` 的逐项说明）—— 语义与旧 `part-emitter` 一致，调用方无需改。
   */
  async function spawnViaQuarks(
    system: PartSystem, opts: SpawnOpts, label: string,
  ): Promise<QuarksPartHandle | null> {
    if (!quarksFx) {
      reportFallback('fx', `「${label}」要 quarks 渲染，但 effect-manager 没拿到 QuarksRuntime`);
      return null;
    }
    const handle = await quarksFx.spawnSystem(system, {
      pos: opts.pos,
      scale: opts.scale,
      attach: opts.attach ?? null,
      // `rigidFollow` = 粒子吃载体位移 ⇒ quarks 的"局部空间"（worldSpace = false）
      follow: opts.rigidFollow === true,
      velocity: opts.velocity,
    });
    partDiag = quarksFx.lastPartDiag();
    if (!handle) reportFallback('fx', `「${label}」在 quarks 路起不来（见 quarks stats.missing）`);
    return handle;
  }

  /** 已打过日志的 spec 名（同名只打一次）—— 拖尾那种"每帧 spawn"会刷爆控制台（实测卡顿） */
  const loggedSpecs = new Set<string>();

  async function spawnSystem(system: PartSystem, opts: SpawnOpts): Promise<QuarksPartHandle | null> {
    const specName = system.name || 'inline';
    if (!loggedSpecs.has(specName)) {
      loggedSpecs.add(specName);
      console.log('[fx] 播代码内 spec「' + specName + '」：emitter '
        + system.emitters.length + ' 个，跟随节点=' + !!opts.attach + '（同名后续 spawn 不再打印）');
    }
    return spawnViaQuarks(system, opts, system.name || 'inline');
  }

  function update(dt: number): void {
    quarksFx?.update(dt);        // 代码内 spec + `.part`

    // INI 广告板已改由 quarks 渲染（`ini-to-quarks.ts`），这里不再有逐帧精灵循环
  }

  function clear(): void {
    // quarks 那条不在 `clear()` 里强拆（它的系统按自身寿命回收；强拆会把在飞的粒子剪掉）
  }

  return {
    spawn,
    spawnSystem,
    update,
    clear,
    stats: () => ({
      active: quarksFx?.stats().systems ?? 0, pending, loaded,
      parts: 0,   // 自研 emitter 已退役（§12 迁移）；字段留着不改调用方
      quarks: quarksFx?.stats().systems ?? 0,
    }),
    lastDiag: () => diag,
    lastPart: () => partDiag,
  };
}
