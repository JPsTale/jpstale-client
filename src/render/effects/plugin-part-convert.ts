/**
 * B7 接线核心：`.part`/Lua IR → quarks ParticleSystem 的**新实现转换器**。
 *
 * 与旧 `part-to-quarks.convertPart` 的差别（= 冻结行的语义落地）：
 *   · 行 [2]/[3]/[4]：事件走 PtClockBehavior（到点赋值/fade Step/重瞄/eventtimer 重放）——
 *     不再是曲线（LinearTrack）也不再把阶跃当渐变；
 *   · 行 [20]：PtSizeBehavior 替代 SizeOverLife（绝对值 + SizeExt==0 回落）；
 *   · 行 [5]/[L4]：ColorOverLife(PtColorGen)——颜色从块读出，startColor 恒白；
 *   · 行 [7]：PtGravityBehavior 替代 ApplyForce（逐粒子逐帧重掷）；
 *   · 行 [16]-[18]/[21]：TYPE_ONE/TWO/THREE 全部 Mesh + orient 工厂写者
 *     （TYPE_ONE 不再走 BillBoard——U-A3-4 的合批代价已登记）；
 *   · 行 [19]：TYPE_FOUR 维持 Trail + startLength 近似（U-A3-2 未裁定）；
 *   · 行 [22]：TYPE_FIVE = MeshRandomOrientation + OrientVelocityToNormal（规格 = 旧实现）；
 *   · 行 [10]：delay = 时间门控生成器（不再用"整批同帧"burst）；
 *   · 行 [6]：预算暂以 duration 折算表达（发射窗 = 预算/速率）——U-A1-1 的逐帧记账
 *     随 B7/B8 的 EffectManager 接线落地。
 *
 * 复用（不重写已正确的部分）：PartBoxEmitter（行 [8]）、applyBlend（行 [13]）、
 * MeshRandomOrientation/OrientVelocityToNormal（行 [22]）来自 part-to-quarks.ts。
 */
import * as THREE from 'three';
import { ParticleSystem, RenderMode } from 'three.quarks';
import {
  ColorOverLife, ConstantValue, Gradient, IntervalValue, Vector3Function,
  Vector3 as QVec3,
} from 'quarks.core';
import type { Behavior, FunctionValueGenerator, ValueGenerator } from 'quarks.core';
import type { PartEmitter, PartSystem } from '../../core/effect/part-script.js';
import type { PtEvent, PtSlot } from '../../core/effect/pt-timeline.js';
import type { Num } from '../../core/effect/pt-value.js';
import type { LuaParticleIR } from '../../core/effect/lua-script.js';
import { PtClockBehavior, type PtBlockLocator } from './plugin-clock.js';
import { PtSizeBehavior } from './plugin-size.js';
import { PtColorGen } from './plugin-value-gen.js';
import { PtGravityBehavior } from './plugin-gravity.js';
import { rotationWriterFor } from './orient-factory.js';
import {
  MeshRandomOrientation, OrientVelocityToNormal, PartBoxEmitter, applyBlend,
  type ConvertedEmitter,
} from './part-to-quarks.js';

export type { ConvertedEmitter };

const UNIT_QUAD = new THREE.PlaneGeometry(1, 1, 1, 1);

/** 属性名 → 事件槽（part-script 的 keyframes 键与 pt-timeline 的 PtSlot 对齐表） */
const PROP_SLOT: Record<string, PtSlot> = {
  size: 'size', sizeExt: 'sizeExt', color: 'color',
  velocity: 'dir', velocityx: 'dirX', velocityy: 'dirY', velocityz: 'dirZ',
  partangle: 'partAngle', partanglex: 'partAngleX', partangley: 'partAngleY', partanglez: 'partAngleZ',
  localangle: 'localAngle', localanglex: 'localAngleX', localangley: 'localAngleY', localanglez: 'localAngleZ',
  eventtimer: 'eventTimer',
};

/** PartValue → Num[]（按槽的份量）；不认识的形状返回 null（调用方跳过并记 notes） */
function valueToNums(
  v: { k: 'num'; v: Num } | { k: 'vec'; v: { x: Num; y: Num; z: Num } } | { k: 'color'; v: { r: Num; g: Num; b: Num; a: Num } } | { k: 'str'; v: string },
  _slot: PtSlot,
): Num[] | null {
  if (v.k === 'num') return [v.v];
  if (v.k === 'vec') return [v.v.x, v.v.y, v.v.z];
  if (v.k === 'color') return [v.v.r, v.v.g, v.v.b, v.v.a];
  return null;
}

/** emitter → 事件表（行 [1]：initial=time-0、keyframes=at/fade、final=寿命末 fade） */
export function eventsOf(e: PartEmitter, finalTime: number): { events: PtEvent[]; skipped: string[] } {
  const events: PtEvent[] = [];
  const skipped: string[] = [];
  const push = (time: number, slot: PtSlot, fade: boolean, value: Num[]): void => {
    if (!Number.isFinite(time) || time < 0) return;
    events.push({ time, slot, fade, value, next: -1 });
  };
  // initial → time-0 非 fade（行 [1]：创建回路跑 ActualTime==0 的事件）
  if (e.initialSize) push(0, 'size', false, [e.initialSize]);
  if (e.initialSizeExt) push(0, 'sizeExt', false, [e.initialSizeExt]);
  if (e.initialColor) push(0, 'color', false, [e.initialColor.r, e.initialColor.g, e.initialColor.b, e.initialColor.a]);
  if (e.initialPartAngle) push(0, 'partAngle', false, [e.initialPartAngle.x, e.initialPartAngle.y, e.initialPartAngle.z]);
  // keyframes（中段事件；fade 标志每事件独立——行 [2]）
  for (const [prop, kfs] of Object.entries(e.keyframes)) {
    const slot = PROP_SLOT[prop];
    if (!slot) { skipped.push(prop); continue; }
    for (const k of kfs) {
      const value = valueToNums(k.value, slot);
      if (value) push(k.time, slot, k.fade, value);
      else skipped.push(`${prop}@${k.time}`);
    }
  }
  // final → 寿命末 fade（finalTime = 寿命中值——区间寿命时的序列级常量口径，行 [1]）
  if (e.finalSize) push(finalTime, 'size', true, [e.finalSize]);
  if (e.finalSizeExt) push(finalTime, 'sizeExt', true, [e.finalSizeExt]);
  if (e.finalColor) push(finalTime, 'color', true, [e.finalColor.r, e.finalColor.g, e.finalColor.b, e.finalColor.a]);
  if (e.finalPartAngle) push(finalTime, 'partAngle', true, [e.finalPartAngle.x, e.finalPartAngle.y, e.finalPartAngle.z]);
  return { events, skipped };
}

/** 延迟门控生成器（行 [10]）：t < delay/duration ⇒ 0（不发射），否则放行实际 rate */
export class PtDelayGateGen implements FunctionValueGenerator {
  type = 'function' as const;
  constructor(
    private readonly delaySec: number,
    private readonly durationSec: number,
    private readonly rate: number,
  ) {}

  startGen(_memory: unknown): void { /* 无逐粒子状态 */ }
  genValue(_memory: unknown, t = 0): number {
    const gate = this.durationSec > 0 ? this.delaySec / this.durationSec : 1;
    return t < gate ? 0 : this.rate;
  }
  toJSON(): { type: 'PtDelayGateGen' } { return { type: 'PtDelayGateGen' }; }
  clone(): FunctionValueGenerator { return new PtDelayGateGen(this.delaySec, this.durationSec, this.rate); }
}

/** 白色 startColor（乘法单位元——行 [L4]，颜色绝对值由轨道承担） */
function whiteGradient(): Gradient {
  return new Gradient([[new QVec3(1, 1, 1), 0]], [[1, 0]]);
}

/** IR Num → quarks 出生生成器（行 [5] native 路径；定值/区间都实现 ValueGenerator 面） */
function numToGen(n: Num | null | undefined, fallback = 1): ValueGenerator {
  if (!n) return new ConstantValue(fallback);
  return n.k === 'n' ? new ConstantValue(n.v) : new IntervalValue(n.a, n.b);
}

const midOf = (n: Num | null | undefined, fallback = 1): number =>
  (!n ? fallback : n.k === 'n' ? n.v : (n.a + n.b) / 2);

/** 装配输入（.part 与 Lua 两条路径都归一到这个形状） */
export interface EmitterBuild {
  name: string;
  events: PtEvent[];
  lifetime: Num | null;
  numParticles: number;
  emitRate: number;
  delay: number;
  loops: number;
  gravity: { x: Num; y: Num; z: Num } | null;
  emitRadius: { x: Num; y: Num; z: Num };
  initialVelocity: { x: Num; y: Num; z: Num } | null;
  blend: 'lamp' | 'alpha' | 'color' | 'shadow' | 'invshadow' | 'addcolor';
  texture: THREE.Texture | null;
  particleType: number;                      // 1-4（5 = FIVE 走独立分支）
  renderModeOverride?: RenderMode;           // Lua BillboardAxial ⇒ VerticalBillBoard（U-A5-3）
  sizeNum?: number;                          // 行 [19] startLength 的宽度基数
  sizeExtNum?: number;                       // 行 [19] startLength 的高度基数
  sizeXNum?: Num;                            // 行 [19] Trail 出生宽度（区间保留）
  sizeYNum?: Num;                            // 行 [19] Trail 出生长度（区间保留）
  initialSpeedLen?: number;                  // TYPE_FIVE 的法向速度
}

/** 单个 emitter → quarks ParticleSystem（新实现；.part 与 Lua 共用的装配体） */
export function buildEmitterSystem(cfg: EmitterBuild, rand: () => number = Math.random): ConvertedEmitter {
  const notes: string[] = [];
  const locator: PtBlockLocator = { index: -1 };
  const finalTime = midOf(cfg.lifetime, 1);
  const { events, skipped } = eventsOfRaw(cfg.events, finalTime);
  if (skipped.length) notes.push(`未接事件属性：${[...new Set(skipped)].join(', ')}`);

  const type = cfg.particleType;
  const isTrail = type === 4;
  const isFive = type === 5;
  const meshFace = type === 1 || type === 2 || type === 3 || isFive;

  const material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, depthTest: true });
  if (meshFace) material.side = THREE.DoubleSide;
  applyBlend(material, cfg.blend);
  if (cfg.blend === 'addcolor') notes.push('混合 addcolor：按 lamp 加法走（因子未核实，U-A3-3）');

  const behaviors: Behavior[] = [];
  const grav = cfg.gravity;
  const hasGravity = grav ? ['x', 'y', 'z'].some((k) => {
    const n = grav[k as 'x'];
    return n.k === 'r' || n.v !== 0;
  }) : false;
  if (hasGravity && grav) behaviors.push(new PtGravityBehavior(grav as never, rand));
  behaviors.push(new PtClockBehavior(events, locator, rand));
  if (!isTrail) behaviors.push(new PtSizeBehavior(locator));
  behaviors.push(new ColorOverLife(new PtColorGen(locator)));
  // 渲染模式先定：**四元数写者只在 Mesh 模式下挂**——广告板模式（BillBoard/VerticalBillBoard/…）
  // 的 `particle.rotation` 是**标量**，塞四元数会让渲染读错（r[B7-9]：BillboardAxial 曾同时挂
  // VerticalBillBoard 与 PtOrientThree ⇒ 类型不匹配）。
  const renderMode = cfg.renderModeOverride ?? (isTrail ? RenderMode.Trail : RenderMode.Mesh);
  const useMesh = renderMode === RenderMode.Mesh;

  if (isFive) {
    behaviors.push(new MeshRandomOrientation());
    // 行 [22]：速度沿自身法线是 F5 的**语义必需**（原版 GetMoveLocation 沿法线推进）——
    // 缺速度直接抛错，禁止静默跳过（那会让所有卡片同向飞行，r[B7-3] 实测）。
    const sp = Math.hypot(midOf(cfg.initialVelocity?.x, 0), midOf(cfg.initialVelocity?.y, 0), midOf(cfg.initialVelocity?.z, 0));
    if (!(sp > 0)) throw new Error(`TYPE_FIVE「${cfg.name}」缺法向速度（initialVelocity 为 0/缺失）——F5 语义必需`);
    behaviors.push(new OrientVelocityToNormal(sp));
  } else if (useMesh && (type === 1 || type === 2 || type === 3)) {
    const typeName = type === 1 ? 'ONE' : type === 2 ? 'TWO' : 'THREE';
    const writer = rotationWriterFor(`TYPE_${typeName}` as 'TYPE_ONE' | 'TYPE_TWO' | 'TYPE_THREE', { locator });
    if (writer) behaviors.push(writer);
  }

  const budget = cfg.loops > 0 ? cfg.loops * cfg.numParticles : cfg.numParticles;
  const emitDur = Math.max(0.05, budget / Math.max(1, cfg.emitRate));
  const duration = cfg.delay > 0 ? cfg.delay + emitDur : emitDur;

  const startLife = numToGen(cfg.lifetime, 1);
  const startLength = new ConstantValue(cfg.sizeExtNum ?? cfg.sizeNum ?? 20);

  const system = new ParticleSystem({
    duration,
    looping: false,
    shape: new PartBoxEmitter(cfg.emitRadius, cfg.initialVelocity ?? { x: { k: 'n', v: 0 }, y: { k: 'n', v: 0 }, z: { k: 'n', v: 0 } } as never),
    startLife,
    startSize: new Vector3Function(new ConstantValue(1), new ConstantValue(1), new ConstantValue(1)),
    startColor: whiteGradient(),
    startSpeed: new ConstantValue(1),
    emissionOverTime: cfg.delay > 0
      ? new PtDelayGateGen(cfg.delay, duration, Math.max(1, cfg.emitRate))
      : new ConstantValue(Math.max(1, cfg.emitRate)),
    emissionBursts: [],
    renderMode,
    instancingGeometry: meshFace || isTrail ? UNIT_QUAD : undefined,
    rendererEmitterSettings: isTrail ? { startLength } : undefined,
    material,
    behaviors,
    worldSpace: false,
  });

  if (cfg.texture) system.texture = cfg.texture;

  if (cfg.renderModeOverride) notes.push('Lua BillboardAxial ⇒ VerticalBillBoard（U-A5-3 未取证）');
  notes.push(`事件 ${events.length} 条（行[2]-[4] 块语义）`);
  return { system, emitterName: cfg.name, notes };
}

/** 事件表（已建好链）+ finalTime ⇒ buildEvents 前的 push 序列（供 buildEmitterSystem 复用） */
function eventsOfRaw(raw: PtEvent[], finalTime: number): { events: PtEvent[]; skipped: string[] } {
  void finalTime;
  return { events: raw, skipped: [] };
}

/** 整份 .part 系统 → quarks 系统（每 emitter 一支）—— 新实现入口 */
/** 单个 emitter → quarks ParticleSystem（新实现） */
export function convertEmitterV2(
  e: PartEmitter,
  texture: THREE.Texture | null,
  rand: () => number = Math.random,
): ConvertedEmitter {
  const finalTime = midOf(e.lifetime, 1);
  const { events } = eventsOf(e, finalTime);
  return buildEmitterSystem({
    name: e.name,
    events,
    lifetime: e.lifetime,
    numParticles: e.numParticles,
    emitRate: e.emitRate,
    delay: e.delay,
    loops: e.loops,
    gravity: e.gravity,
    emitRadius: e.emitRadius,
    initialVelocity: e.initialVelocity,
    blend: e.blend,
    texture,
    particleType: e.particleType,
    sizeNum: midOf(e.initialSize, 1),
    sizeExtNum: midOf(e.initialSizeExt ?? e.initialSize, 20),
  }, rand);
}

export function convertPartV2(sys: PartSystem, textures: Array<THREE.Texture | null>): ConvertedEmitter[] {
  const out: ConvertedEmitter[] = [];
  for (let i = 0; i < sys.emitters.length; i++) {
    // 无兜底（用户 2026-09-19 纪律）：转换异常直接抛——伪装成空系统才是更大的错误
    out.push(convertEmitterV2(sys.emitters[i]!, textures[i] ?? null));
  }
  return out;
}

/** IR 的尺寸项已是 Num（区间或定值）——原样用；缺省交给调用方 */
function sizeOf(n: Num | undefined): Num | null { return n ?? null; }

/** Lua IR → 装配输入（行 [25]：与 .part 归一） */
export function luaIRToBuild(ir: LuaParticleIR, name: string, texture: THREE.Texture | null): EmitterBuild {
  const notes: string[] = [];
  const blend = normalizeBlend(ir.blendType);
  const renderModeOverride = ir.particleType === 'BillboardAxial' ? RenderMode.VerticalBillBoard : undefined;
  if (renderModeOverride) notes.push('Lua BillboardAxial ⇒ VerticalBillBoard（U-A5-3 未取证）');
  const vel = ir.velocity;
  const initialVelocity = vel
    ? { x: { k: 'r' as const, a: vel[0]!, b: vel[1]! }, y: { k: 'r' as const, a: vel[2]!, b: vel[3]! }, z: { k: 'r' as const, a: vel[4]!, b: vel[5]! } }
    : null;
  const spawnBox = ir.spawnBox;
  const emitRadius = spawnBox
    ? { x: { k: 'r' as const, a: spawnBox[0]!, b: spawnBox[1]! }, y: { k: 'r' as const, a: spawnBox[2]!, b: spawnBox[3]! }, z: { k: 'r' as const, a: spawnBox[4]!, b: spawnBox[5]! } }
    : { x: { k: 'n' as const, v: 0 }, y: { k: 'n' as const, v: 0 }, z: { k: 'n' as const, v: 0 } };
  const endTime = ir.endTime;
  // 尺寸默认值 = C++ 控制器构造值（`m_Size.Min.x/Max.x = 5/10`，HoEffectController.cpp:486-490）
  const sizeW: Num = sizeOf(ir.size?.[0]) ?? { k: 'r', a: 5, b: 10 };
  const sizeH: Num = sizeOf(ir.size?.[1]) ?? { k: 'r', a: 5, b: 10 };
  // `InitLoop` 语义（照 `HoEffectParticleController::Main`）：loop > 0 ⇒ 预算 = ParticleNum × loop 且
  // 全部粒子死后系统结束；loop <= 0 ⇒ 不限（由调用方停）。我们的 `loops` 即该预算乘数（-1 = 不限）。
  const loop = ir.loop ?? 1;                       // C++ 默认 m_iLoop(1)
  return {
    name,
    events: [
      ...ir.events,
      // 尺寸作为 time-0 事件进块（**保留区间** ⇒ PtClockBehavior 逐粒子掷，与 C++ m_Size.GetRandom() 同义）
      { time: 0, slot: 'size' as const, fade: false, next: -1, value: [sizeW] },
      { time: 0, slot: 'sizeExt' as const, fade: false, next: -1, value: [sizeH] },
    ],
    lifetime: typeof endTime === 'number'
      ? { k: 'n', v: endTime }
      : endTime ? { k: 'r', a: endTime[0]!, b: endTime[1]! }
        : { k: 'r', a: 1, b: 2 },                    // C++ 默认 m_fEndTime = 1..2
    numParticles: ir.numParticles ?? 50,             // C++ 默认 m_fParticleNum(50)
    emitRate: ir.emitRate ?? 30,                     // C++ 默认 m_fEmitRate(30)
    delay: ir.delay ?? 0,
    loops: loop > 0 ? loop : -1,
    gravity: null,
    emitRadius,
    initialVelocity: initialVelocity ?? { x: { k: 'r', a: -10, b: 10 }, y: { k: 'r', a: -10, b: 10 }, z: { k: 'r', a: -10, b: 10 } },
    blend,
    texture,
    particleType: ir.particleType === 'BillboardAxial' ? 3 : 1,
    renderModeOverride,
    sizeNum: 0, sizeExtNum: 0,                       // 尺寸走 time-0 事件（保留区间），此处不用
  };
}

function normalizeBlend(s: string | undefined): 'lamp' | 'alpha' | 'color' | 'shadow' | 'invshadow' | 'addcolor' {
  const k = (s ?? '').toLowerCase();
  if (k === 'alpha') return 'alpha';
  if (k === 'color') return 'color';
  if (k === 'shadow') return 'shadow';
  if (k === 'invshadow') return 'invshadow';
  if (k === 'addcolor') return 'addcolor';
  return 'lamp';
}
