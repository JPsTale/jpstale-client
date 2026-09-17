/**
 * **Glacial Spike**（祭司技能）—— 玩家与怪物**同一招**。
 *
 * 原版原始数据是 NewEffect 的 Lua 脚本 `Effect/NewEffect/SkillCelestialGlacialSpike.lua`（81 行），
 * 本文件是它的**忠实移植**：参数逐条照抄，不按手感改。触发点：
 *   · 玩家：`character.cpp:16338` 那一族里的 `SKILL_PLAY_GLACIAL_SPIKE`（`skill-fx.json` 的
 *     `mp60 g_spike.bmp`）
 *   · 怪物：D_PR（`snCHAR_SOUND_REVIVED_PRIESTESS`）的 `'Z'` —— `character.cpp:14926`
 *     `SkillCelestialGlacialSpike(this)` + `SetDynLight(正前方 64, 0,0,100, 0, 700)`
 *
 * ## 结构与"前方"的约定
 *
 * Lua 的 `Parent` 在 `(0,-5,-20)`，5 个 `ParticleSystem` 在**局部负 z**：`0 / -40 / 0 / -50 / -100`，
 * 其中"大冰块"那三个（尺寸 **40 → 50 → 60**）在 `0 / -50 / -100` —— **越远越大**。
 * 而 `GetMoveLocation` 的 **+z 才是前方**（`character.cpp:14929` 那盏灯就在 +64）⇒
 * **Lua 的局部 −z = 世界前方**（效果节点的朝向约定）。故移植时统一做 `worldForward = -z_local`
 * （用户描述"向前方逐渐召唤出一簇簇冰块、离祭司越远冰块越大"正是这个方向）。
 *
 * ## 两个字段的语义已核实（不是猜）
 *
 *   · `InitMaxFrame(25)` → `HoEffectMeshController::InitMaxFrame`：`m_iMaxFrame = int(frame*160)`，
 *     `Main` 按 **30fps** 推进（`160*30*elapsedTime`），到点 `m_iLoopCount++`；
 *     `InitLoop(1)` ⇒ **播一次就灭**。⇒ 它是**寿命（25 帧 ≈ 0.833s）**，**不是网格动画**
 *     （`static-fx.ts` 里为法阵记的"序列帧尚未查明"由此结案：网格是静态的，
 *     看得见的"动"来自 `EventFadeColor` 的**秒级** alpha 包络）。
 *   · `InitEndTime(a,b)` → `CreateNewParticle` 里 `part.m_fEndTime = m_fEndTime.GetRandom()`
 *     ⇒ **粒子寿命**（随机区间）= 我们的 `lifetime`。
 *
 * ## 我方决定（如实记）
 *
 *   · `InitColor` 只给了起点色（Lua 里**没有**终点色）⇒ 终点取"同色 alpha 0"（末端淡出）。
 *     不这么做粒子到寿会**硬切**；原版是否有默认淡出未查明。
 *   · `InitBlendType` Lua 里没写 ⇒ 用引擎里最常见的 `lamp`（加法）。
 *   · 网格材质的不透明度直接用 Lua 的 alpha（50/70/50 于 255 ⇒ 0.20~0.27，很淡）。
 */
import * as THREE from 'three';
import type { PartEmitter, PartSystem, Num } from '../../core/effect/part-script.js';
import { loadStaticSmd } from './static-fx.js';
import { getMoveLocation, radToPtAngle } from '../../core/geom.js';
import type { SystemSpawner } from './multi-spark-runner.js';

/** Lua：`InitTextureName("Res\\TextureHit\\ice_001.bmp")` —— 相对 `Effect/NewEffect/` */
const TEX = 'effect/neweffect/res/texturehit/ice_001.bmp';
/** Lua：`InitMeshName("Effect\\NewEffect\\Res\\Object\\PT_4-1-25.ASE")` —— 资产实际是 `.smd` */
const MESH = 'effect/neweffect/res/object/pt_4-1-25.smd';
/** Lua：`Begin("Parent"); InitPos(0,-5,-20);` —— 注意 `z=-20` 即**前方 20** */
const PARENT = { x: 0, y: -5, forward: 20 };
/** Lua：`InitMaxFrame(25)` + `InitLoop(1)`，按 30fps ⇒ 25/30 秒后灭 */
const MESH_LIFE_SEC = 25 / 30;
/** Lua：`EventFadeColor(秒, 255,255,255, alpha)`（alpha 0..255） */
const MESH_FADE: ReadonlyArray<{ t: number; a: number }> = [
  { t: 0, a: 50 }, { t: 0.2, a: 70 }, { t: 0.5, a: 50 },
];
/** 正前方那盏蓝光（`character.cpp:14929`）：`SetDynLight(前方 64, 0,0,100, 0, 700)`，decPower 取签名默认 10 */
const LIGHT = { forward: 64, r: 0, g: 0, b: 100, a: 0, power: 700, decPower: 10 };

interface SystemDef {
  /** Lua `InitPos` 的**局部**坐标（z 负 = 前） */
  at: { x: number; y: number; forward: number };
  /** Lua `InitSize(x,y)` */
  size: [number, number];
  /** Lua `InitParticleNum` / `InitEmitRate` / `InitEndTime` */
  count: number; emitRate: number; life: [number, number];
  /** Lua `InitVelocity(x1,x2, y1,y2, z1,z2)` */
  vel: [number, number, number, number, number, number];
  /** Lua `InitSpawnBoundingBox(x1,x2, y1,y2, z1,z2)` */
  box: [number, number, number, number, number, number];
  /** Lua `InitColor(r,g,b,a)` */
  rgba: [number, number, number, number];
  /** 出处（Lua 行号） */
  line: string;
}

/**
 * 5 个 ParticleSystem —— **逐条照抄 Lua 16~79 行**。
 * 前两个是 size 2 的细雾（在 0 / 前方 40），后三个是"冰块"（size 40/50/60，在 0 / 前方 50 / 前方 100 ⇒ 越远越大）。
 */
const SYSTEMS: ReadonlyArray<SystemDef> = [
  { at: { x: 0, y: 10, forward: 0 }, size: [2, 2], count: 10, emitRate: 30, life: [0.2, 1],
    vel: [-10, 10, 10, 30, -20, 20], box: [-20, 20, 0, 50, -20, 0],
    rgba: [255, 255, 255, 250], line: 'Lua:16-27' },
  { at: { x: 0, y: 10, forward: 40 }, size: [2, 2], count: 10, emitRate: 30, life: [0.2, 1],
    vel: [-10, 10, 10, 30, -20, 20], box: [-20, 20, 0, 50, -20, 0],
    rgba: [255, 255, 255, 250], line: 'Lua:29-40' },
  { at: { x: 0, y: 10, forward: 0 }, size: [40, 40], count: 12, emitRate: 20, life: [0.2, 0.7],
    vel: [-10, 10, 10, 10, 0, 0], box: [-20, 20, 0, 10, -20, 20],
    rgba: [200, 200, 255, 40], line: 'Lua:42-53' },
  { at: { x: 0, y: 10, forward: 50 }, size: [50, 50], count: 12, emitRate: 20, life: [0.4, 1.2],
    vel: [-10, 10, 10, 30, 0, 0], box: [-50, 50, 0, 10, -30, 0],
    rgba: [200, 200, 200, 30], line: 'Lua:55-66' },
  { at: { x: 0, y: 10, forward: 100 }, size: [60, 60], count: 12, emitRate: 20, life: [0.5, 1.5],
    vel: [-10, 10, 10, 30, 0, 0], box: [-60, 60, 0, 10, -40, 0],
    rgba: [200, 200, 200, 50], line: 'Lua:68-79' },
];

const num = (v: number): Num => ({ k: 'n', v });
const rng = (a: number, b: number): Num => ({ k: 'r', a, b });

/** 一条 Lua `ParticleSystem` → 我们的 `PartSystem`（单个 emitter）。`scale` 供实验室调参（默认 1） */
function partOf(s: SystemDef, scale = 1): PartSystem {
  const sz = (v: number) => num(v * scale);
  const e: PartEmitter = {
    name: '', blend: 'lamp', particleType: 1,       // 面朝向：Lua 没写 ⇒ 默认朝相机的广告板
    numParticles: s.count, emitRate: s.emitRate,
    loops: 1, delay: 0,
    lifetime: rng(s.life[0], s.life[1]),            // `InitEndTime` = 粒子寿命（已核实）
    emitRadius: {
      x: rng(s.box[0] * scale, s.box[1] * scale),
      y: rng(s.box[2] * scale, s.box[3] * scale),
      z: rng(s.box[4] * scale, s.box[5] * scale),
    },
    initialVelocity: {
      x: rng(s.vel[0], s.vel[1]), y: rng(s.vel[2], s.vel[3]), z: rng(s.vel[4], s.vel[5]),
    },
    gravity: { x: num(0), y: num(0), z: num(0) },
    texture: TEX,
    initialSize: sz(s.size[0]), initialSizeExt: sz(s.size[1]),
    initialColor: { r: num(s.rgba[0]), g: num(s.rgba[1]), b: num(s.rgba[2]), a: num(s.rgba[3]) },
    initialPartAngle: null, initialLocalAngle: null,
    // 终点色 = 同色 alpha 0（Lua 没给终点 ⇒ 我方取"末端淡出"，见文件头）
    finalColor: { r: num(s.rgba[0]), g: num(s.rgba[1]), b: num(s.rgba[2]), a: num(0) },
    finalSize: sz(s.size[0]), finalSizeExt: sz(s.size[1]),
    finalPartAngle: null, finalLocalAngle: null, finalVelocity: null,
    keyframes: {},
  };
  return { name: 'GlacialSpike', version: 1, position: null, emitters: [e] };
}

export interface GlacialSpikeDeps {
  effects: SystemSpawner | null;
  scene: THREE.Scene;
  dynLights?: { set(x: number, y: number, z: number, r: number, g: number, b: number,
                    a: number, power: number, decPower: number): void | boolean } | null;
  log?: (msg: string) => void;
}

/** 在淡出的网格（模块级：调用方只调 `updateGlacialSpikes`） */
interface FadingMesh { group: THREE.Group; age: number; dispose: () => void }
const fading: FadingMesh[] = [];

/** 按 Lua 的 `EventFadeColor` 时间轴取 alpha（0..1） */
function meshAlphaAt(t: number): number {
  const ev = MESH_FADE;
  if (t <= ev[0]!.t) return ev[0]!.a / 255;
  for (let i = 1; i < ev.length; i++) {
    const p = ev[i - 1]!, q = ev[i]!;
    if (t <= q.t) {
      const k = (t - p.t) / Math.max(1e-6, q.t - p.t);
      return (p.a + (q.a - p.a) * k) / 255;
    }
  }
  return ev[ev.length - 1]!.a / 255;
}

/**
 * 放一次 Glacial Spike。
 *
 * @param caster 施法者世界坐标（原版 `pX/pY/pZ`）
 * @param yaw 施法者朝向（弧度，原版 `Angle.y` —— 调用方在放招前已转向目标）
 * @param scale **整体缩放**（诊断用，默认 1）。用户实测"冰块没逐渐远离、离得太近" ——
 *   三簇在 20/70/120（间距 50）而每颗尺寸 40~60、生成盒 120×40 ⇒ 相邻两簇会糊在一起。
 *   到底是"线该更长"还是"块该更小"，得靠眼睛定 ⇒ 实验室给个旋钮拧到像原版，
 *   再把倍数固化到 `SYSTEMS` 的数字里（那才是"数据"，不是运行时缩放）。
 */
export function runGlacialSpike(
  deps: GlacialSpikeDeps, caster: { x: number; y: number; z: number }, yaw: number, scale = 1,
): void {
  if (!deps.effects) { deps.log?.('  ✗ Glacial Spike：没有 effects（未接渲染器）'); return; }
  const angY = radToPtAngle(yaw);
  /**
   * 局部坐标（**forward 为正 = 前方**）→ 世界坐标。
   * Lua 的局部 `-z` 才是前方（见文件头），这个换算已经在 `SYSTEMS`/`PARENT` 的数据里做过了
   * ⇒ 这里直接喂 `GetMoveLocation`（它的 **+z 就是前方**，`character.cpp:14929` 那盏灯即证）。
   */
  const worldOf = (lx: number, ly: number, lf: number) => {
    const off = getMoveLocation(lx * scale, ly * scale, lf * scale, 0, angY, 0);
    return { x: caster.x + off.x, y: caster.y + off.y, z: caster.z + off.z };
  };

  for (const s of SYSTEMS) {
    const at = worldOf(s.at.x + PARENT.x, s.at.y + PARENT.y, s.at.forward + PARENT.forward);
    void deps.effects.spawnSystem(partOf(s, scale), { pos: at });
    deps.log?.(`  ❄ 冰枪粒子：size ${(s.size[0] * scale).toFixed(0)}×${(s.size[1] * scale).toFixed(0)}`
      + `（${s.count} 颗）→ 前方 ${((s.at.forward + PARENT.forward) * scale).toFixed(0)}　${s.line}`);
  }

  // **正前方那盏蓝光**（原版 `character.cpp:14929`）
  const lp = worldOf(0, 0, LIGHT.forward);
  deps.dynLights?.set(lp.x, lp.y, lp.z, LIGHT.r, LIGHT.g, LIGHT.b, LIGHT.a, LIGHT.power, LIGHT.decPower);

  // **冰块的网格本体**（静态 `.smd` + `EventFadeColor` 的秒级 alpha 包络）
  const mp = worldOf(PARENT.x, PARENT.y, PARENT.forward);
  void loadStaticSmd(MESH).then((r) => {
    if (!r) { deps.log?.(`  ✗ 冰枪网格 ${MESH} 加载失败`); return; }
    r.group.position.set(mp.x, mp.y, mp.z);
    r.group.rotation.y = yaw;
    if (scale !== 1) r.group.scale.setScalar(scale);
    deps.scene.add(r.group);
    fading.push({ group: r.group, age: 0, dispose: r.dispose });
    deps.log?.(`  ❄ 冰块网格就位（前方 ${(PARENT.forward * scale).toFixed(0)}，`
      + `寿命 ${MESH_LIFE_SEC.toFixed(2)}s，alpha ${MESH_FADE.map((e) => e.a).join('/')}`
      + `${scale !== 1 ? `，缩放 ×${scale}` : ''}）`);
  });
}

/** 每帧调一次：推进网格的 alpha 包络与寿命（`InitMaxFrame(25)` @30fps 后消失） */
export function updateGlacialSpikes(dt: number): void {
  for (let i = fading.length - 1; i >= 0; i--) {
    const f = fading[i]!;
    f.age += dt;
    const a = meshAlphaAt(f.age);
    f.group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m && 'opacity' in m) (m as THREE.MeshPhongMaterial).opacity = a;
    });
    if (f.age >= MESH_LIFE_SEC) {          // `InitLoop(1)`：播一次就灭
      f.group.removeFromParent();
      f.dispose();
      fading.splice(i, 1);
    }
  }
}
