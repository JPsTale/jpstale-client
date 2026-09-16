/**
 * quarks 运行时 —— 游戏里用 **three.quarks** 播特效的唯一入口。
 *
 * 为什么需要这一层（而不是各处直接 `new ParticleSystem`）：
 *  1. **生命周期**：游戏里的特效是**事件驱动的一次性播放**（吃药一次、每发法球一次），
 *     而 quarks 的 system 是"建 → 播 → 自己判断结束"。这里统一管"建 / 推进 / 到点清理"。
 *  2. **预载**：纹理解码要几百毫秒，等到播放时才做会让粒子晚于事件出现（实测踩过：
 *     法球飞行只有 0.45 s，系统建好时飞行已过半 ⇒ 观感"只剩一条淡拖尾"）。
 *  3. **批渲染**：所有系统共用**一个** `BatchedRenderer`（quarks 的性能前提）。
 *  4. **载体跟随**：法球要挂在飞行节点上（emitter 挂节点下 + `worldSpace`）。
 *
 * ⚠ 两条 quarks 语义坑（实测踩过，别再犯）：
 *  - `restart()` **只把 `particleNum` 归零、不清 `particles` 数组**（连它自己的 setter 都要补
 *    `this.particles.length = 0`，见 `ParticleSystem.ts:618-619`）⇒ 复用系统会带上一轮残留
 *    （观感"越散越开"）。所以**每次播放都新建系统**，不复用。
 *  - Trail（`RenderMode.Trail`）必须给 `rendererEmitterSettings.startLength`，否则 spawn 抛 undefined。
 */
import * as THREE from 'three';
import { BatchedRenderer, ParticleSystem, RenderMode } from 'three.quarks';
import {
  ConstantValue, IntervalValue, Gradient, Vector3 as QVec3,
  ApplyForce, RotationOverLife, FrameOverLife, PointEmitter, ColorOverLife,
  type FunctionValueGenerator, type EmitterShape,
} from 'quarks.core';
import { buildSheet, type RawImage } from '../../core/asset-cache.js';
import { loadEffect } from './effect-assets.js';
import { loadPartFromSystem, type LoadedPart } from './part-assets.js';
import { convertPart } from './part-to-quarks.js';
import { impShotSystem } from './imp-shot.js';
import {
  POTION_BURST, POTION_PARTICLE_SIZE, POTION_LIGHT_SIZE,
} from './potion-burst.js';

/* ─────────── 药水：三种各自的 INI ─────────── */

/** 药水种类（与 `game/useEffect.ts` 的 `UseEffectKind` 里那三支对应） */
export type PotionKind = 'potion1' | 'potion2' | 'potion3';

/**
 * 三种药水各自的 INI —— **颜色差异全在贴图上**，参数（`POTION_BURST`）是共用的。
 * 出处：`effect/animationdata/Potion{1,2,3}.ini`，对应原版 `EFFECT_POTION1/2/3`
 * （红 PartRed / 蓝 PartBlue / 绿 PartGreen，见 `game/useEffect.ts` 文件头）。
 */
const POTION_INI: Record<PotionKind, string> = {
  potion1: 'Potion1', potion2: 'Potion2', potion3: 'Potion3',
};

interface PotionAssets {
  tex: THREE.Texture;
  tiles: { u: number; v: number; count: number };
}

/* ─────────── 药水的"四散 + 上抛"初速 ─────────── */

/**
 * 原版药水初速 = 水平随机角 × 70 raw/帧 + y 固定 70（证据链见 `potion-burst.ts`）。
 * quarks 的 `EmitterShape.initialize` 是唯一能写 `velocity` 的地方，内置形状都不是这个语义
 * （`RectangleEmitter` 是 2D 边框 + 径向速度）⇒ 自定义。
 */
class PotionBurstShape implements EmitterShape {
  type = 'potionBurst';
  initialize(p: { velocity: QVec3 }): void {
    const ang = Math.random() * Math.PI * 2;
    p.velocity.x = Math.cos(ang) * POTION_BURST.speed;
    p.velocity.y = POTION_BURST.speedY;
    p.velocity.z = Math.sin(ang) * POTION_BURST.speed;
  }
  update(): void { /* 一次性，无推进 */ }
  toJSON(): { type: string } { return { type: this.type }; }
  clone(): PotionBurstShape { return new PotionBurstShape(); }
}

/** 帧序列轨道：按归一化寿命**取整**到第 n 帧（PT 的帧动画是逐帧固定时长，不插值） */
class StepTrack implements FunctionValueGenerator {
  type = 'function' as const;
  constructor(private readonly frames: number) {}
  startGen(): void { /* 无状态 */ }
  genValue(_memory: unknown, t = 0): number {
    return Math.min(this.frames - 1, Math.max(0, Math.floor(t * this.frames)));
  }
  toJSON(): { type: 'function'; frames: number } { return { type: 'function', frames: this.frames }; }
  clone(): StepTrack { return new StepTrack(this.frames); }
}

/* ─────────── 运行时 ─────────── */

export interface QuarksStats {
  systems: number;
  particles: number;
  /** 预载/播放期的缺口（不静默：缺失与跳过都记在这里） */
  missing: string[];
}

export interface QuarksRuntime {
  /** 药水爆发（30 颗物理粒子 + 那记 120×120 闪光）。`kind` 决定用哪支——三种贴图不同 */
  playPotion(kind: PotionKind, pos: { x: number; y: number; z: number }): void;
  /**
   * 法术弹：把一簇粒子挂到飞行节点上（粒子留在世界空间 ⇒ 尾迹留身后）。
   * 返回"飞行到点"时要调的卸载函数；预载未完成时返回 null。
   */
  attachMagic(node: THREE.Object3D): (() => void) | null;
  update(dt: number): void;
  dispose(): void;
  stats(): QuarksStats;
}

export function createQuarksRuntime(scene: THREE.Scene): QuarksRuntime {
  const batch = new BatchedRenderer();
  batch.name = 'quarks-fx';
  scene.add(batch);

  const live: ParticleSystem[] = [];
  const missing: string[] = [];

  /* 预载（一次）：三种药水图集 + 闪光贴图 + 法术弹 spec —— 播放路径上不再有 await */
  const potions = new Map<PotionKind, PotionAssets>();
  let lightTex: THREE.Texture | null = null;
  let lightLife = 0.3;
  /** `Light1.ini` 的**逐帧 alpha 轨道**（`BlendValue` 200→20）—— 见 `playLight` 的说明 */
  let lightAlpha: Gradient | null = null;
  let magicSpec: LoadedPart | null = null;

  void (async () => {
    // 三种药水各加载一套（贴图不同 ⇒ 颜色不同）
    for (const kind of Object.keys(POTION_INI) as PotionKind[]) {
      const ini = POTION_INI[kind];
      const eff = await loadEffect(ini);
      // 帧动画：原版是 4 张独立贴图 ⇒ 拼成 sprite sheet 交给 quarks 的帧动画
      const raw = (eff?.frames ?? [])
        .map((f) => f.tex?.image as RawImage | undefined)
        .filter((x): x is RawImage => !!x && !!x.data);
      let tex: THREE.Texture | null = null;
      let tiles = { u: 1, v: 1, count: 1 };
      if (raw.length > 1) {
        const sheet = buildSheet(raw, `effect/${ini.toLowerCase()}`);
        if (sheet) {
          // TS 5.7+ 的 TypedArray 泛型：DataTexture 要 `Uint8Array<ArrayBuffer>`，而 buildSheet
          // 返回的是 `Uint8Array<ArrayBufferLike>`（可能被推断成 SharedArrayBuffer 系）⇒ 断言，零拷贝
          const t = new THREE.DataTexture(
            sheet.data as unknown as Uint8Array<ArrayBuffer>, sheet.width, sheet.height, THREE.RGBAFormat,
          );
          t.needsUpdate = true;
          tex = t;
          tiles = { u: sheet.cols, v: sheet.rows, count: sheet.count };
          if (sheet.mismatched.length) missing.push(`${ini} 图集跳过 ${sheet.mismatched.length} 帧（尺寸不一致）`);
        }
      } else {
        tex = eff?.frames[0]?.tex ?? null;
      }
      if (tex) potions.set(kind, { tex, tiles });
      else missing.push(`${ini} 贴图未加载`);
    }
  })();

  // ⚠ 三块预载**必须各自独立**（并行、互不阻塞）。曾经串成一条 `await` 链：
  // 药水贴图慢或失败 ⇒ 后面的 `magicSpec` **永不就绪** ⇒ **法师/祭司攻击完全没粒子**（用户实测）。
  // 教训：预载之间没有任何先后依赖，就不该排成队列。
  void (async () => {
    const light = await loadEffect('Light1');
    lightTex = light?.frames[0]?.tex ?? null;
    lightLife = Math.max(0.1, light?.duration ?? 0.3);
    if (!lightTex) missing.push('Light1 贴图未加载');
    // ⚠ `Light1.ini` 是**10 帧的淡出动画**（同一张图，`BlendValue` 200,220,…,20），
    // 而它 `ImageNum` 全是 0 ⇒ 不需要图集，缺的是**逐帧 alpha**。
    // 只取第 1 帧当静止贴图的话，白光会变成"持续 0.43 秒不衰减的大白斑"、把粒子盖住
    // （用户实测："右侧粒子要等白光出来一段时间后才出现"）。故把 BlendValue 做成 alpha 轨道。
    if (light && light.frames.length > 1) {
      const total = light.frames.reduce((s, f) => s + f.delay, 0) || 1;
      const keys: Array<[number, number]> = [];
      let acc = 0;
      for (const f of light.frames) {
        keys.push([f.alpha / 255, acc / total]);      // [alpha, 归一化时刻]
        acc += f.delay;
      }
      keys.push([(light.frames[light.frames.length - 1]?.alpha ?? 255) / 255, 1]);
      lightAlpha = new Gradient([[new QVec3(1, 1, 1), 0]], keys);
    }
  })();

  void (async () => {
    magicSpec = await loadPartFromSystem('ImpShot', impShotSystem());
    if (!magicSpec) missing.push('ImpShot spec 未加载');
  })();

  /**
   * 登记一个系统。`parent` 是 emitter 的父节点 —— **默认 scene，但载体跟随场景必须传载体**：
   * `scene.add()` 会把 emitter 从载体节点上摘下来，"跟随飞行物"就废了。
   */
  function track(ps: ParticleSystem, parent: THREE.Object3D = scene): ParticleSystem {
    parent.add(ps.emitter);
    batch.addSystem(ps);
    live.push(ps);
    return ps;
  }

  /** 药水那记闪光（原版 `StartBillRectPrimitive(..., 120, 120, "Light1.ini")`） */
  function playLight(pos: { x: number; y: number; z: number }): void {
    if (!lightTex) { missing.push('playLight: Light1 贴图未加载'); return; }
    const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
    mat.blending = THREE.AdditiveBlending;
    const ps = new ParticleSystem({
      duration: 0.02,
      looping: false,
      emissionBursts: [{ time: 0, count: new ConstantValue(1), cycle: 1, interval: 0, probability: 1 }],
      shape: new PointEmitter(),
      startLife: new ConstantValue(lightLife),
      startSpeed: new ConstantValue(0),
      startSize: new ConstantValue(POTION_LIGHT_SIZE),
      startColor: new Gradient([[new QVec3(1, 1, 1), 0]], [[1, 0]]),
      emissionOverTime: new ConstantValue(0),
      renderMode: RenderMode.BillBoard,
      material: mat,
      // 逐帧 alpha（200→20 淡出）—— 不做的话白光就是一块不衰减的大白斑（见预载处的说明）
      behaviors: lightAlpha ? [new ColorOverLife(lightAlpha)] : [],
      worldSpace: true,
    });
    ps.texture = lightTex;
    ps.emitter.position.set(pos.x, pos.y, pos.z);
    track(ps);
  }

  return {
    playPotion(kind, pos) {
      const assets = potions.get(kind);
      if (!assets) { missing.push(`playPotion(${kind}): 资产未就绪`); return; }
      const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
      mat.blending = THREE.AdditiveBlending;
      const ps = new ParticleSystem({
        duration: 0.02,
        looping: false,
        emissionBursts: [{
          time: 0, count: new ConstantValue(POTION_BURST.count),
          cycle: 1, interval: 0, probability: 1,
        }],
        shape: new PotionBurstShape(),
        startLife: new IntervalValue(POTION_BURST.life.min, POTION_BURST.life.max),
        startSpeed: new ConstantValue(1),            // 速度由 shape 写入
        startSize: new ConstantValue(POTION_PARTICLE_SIZE),
        startColor: new Gradient([[new QVec3(1, 1, 1), 0]], [[1, 0]]),
        emissionOverTime: new ConstantValue(0),      // 只靠 burst
        renderMode: RenderMode.BillBoard,
        material: mat,
        startTileIndex: new ConstantValue(0),
        uTileCount: assets.tiles.u,
        vTileCount: assets.tiles.v,
        behaviors: [
          new ApplyForce(new QVec3(0, -1, 0), new ConstantValue(Math.abs(POTION_BURST.gravity))),
          new RotationOverLife(new ConstantValue((POTION_BURST.spin * Math.PI) / 180)),
          ...(assets.tiles.count > 1 ? [new FrameOverLife(new StepTrack(assets.tiles.count))] : []),
        ],
        worldSpace: true,
      });
      ps.texture = assets.tex;
      ps.emitter.position.set(pos.x, pos.y, pos.z);
      track(ps);
      playLight(pos);
    },

    attachMagic(node) {
      if (!magicSpec) { missing.push('attachMagic: 预载未完成'); return null; }
      const conv = convertPart(magicSpec.system, magicSpec.textures);
      const ps = conv[0]?.system;
      if (!ps) { missing.push('attachMagic: spec → quarks 转换失败'); return null; }
      ps.worldSpace = true;         // 粒子留在世界空间 ⇒ 尾迹留在身后
      // ⚠ 载体节点**必须进场景**：quarks 在 spawn 时用 `emitter.matrixWorld` 定位粒子，
      // 而 three 只对**场景内**的对象推进 world matrix —— 不入场景则矩阵停在单位阵，
      // 粒子全生成在世界原点。症状就是"日志有发射/到达，画面上一个粒子都没有"（用户实测）。
      scene.add(node);
      track(ps, node);
      return () => {
        // 到点：**停发射**并把 emitter 从载体摘到场景（保持世界坐标），
        // 让已在飞的粒子自然飞完再回收 —— 与旧 `PartHandle.stop()` 的语义一致。
        // 若在这里直接 `deleteSystem`，尾巴会被瞬间剪掉。
        ps.endEmit();
        const wp = new THREE.Vector3();
        ps.emitter.getWorldPosition(wp);
        scene.add(ps.emitter);
        ps.emitter.position.copy(wp);
        scene.remove(node);
      };
    },

    update(dt) {
      batch.update(dt);
      // 播完的（发射结束且无存活粒子）→ 摘掉（quarks 的 system 不会自己离开场景）
      for (let i = live.length - 1; i >= 0; i--) {
        const ps = live[i]!;
        const s = ps as unknown as { emitEnded: boolean; particleNum: number };
        if (s.emitEnded && s.particleNum === 0) {
          ps.emitter.removeFromParent();
          batch.deleteSystem(ps);
          live.splice(i, 1);
        }
      }
    },

    dispose() {
      for (const ps of live) ps.emitter.removeFromParent();
      live.length = 0;
      scene.remove(batch);
    },

    stats: () => ({
      systems: live.length,
      particles: live.reduce((n, ps) => n + ps.particles.length, 0),
      missing: [...new Set(missing)],
    }),
  };
}
