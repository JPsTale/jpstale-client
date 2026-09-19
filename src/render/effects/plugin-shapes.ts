/**
 * Lua 粒子控制器的**球形出生形状**（照 C++ `HoEffectController`）：
 *
 *   `InitSpawnBoundingSphere(x1,x2)` = **球面上**的点：半径 `m_Radius.GetRandom()`（区间 [x1,x2]）、
 *   方向随机（`HoEffectController.h:322-345`：先取 `(0,0,r)` 再随机旋转）——
 *   不是"球体内均匀"，是"半径随机的球面点"。盒形已由 `PartBoxEmitter` 承担（三轴各自区间）。
 *
 * 速度型（`CreateNewParticle`，`HoEffectController.cpp:600-628`）：
 *   · `SPAWN_VELOCITY_RANDOM`：三轴各自区间随机（与 `.part` 的 `initial velocity` 同义）；
 *   · `SPAWN_VELOCITY_CURPOS`：**方向 = 出生点方向（径向）**、大小 = `velocity.x`（**只取 X 分量**，
 *     可为负 ⇒ 反向）；轴对齐广告板的轴向 = 同一径向（`HoEffectModel.cpp:164` 的
 *     `m_DesPos = m_Translate + m_Direction * m_Size.y`）。
 */
import { Vector3 } from 'three';
import type { EmitterShape, EmissionState, IParticleSystem, Particle } from 'quarks.core';
import { reportFallback } from '../../char/fallback-log.js';
import type { Vec3 } from '../../core/effect/pt-value.js';

export type Rand = () => number;
export type VelocityMode = 'random' | 'curpos';

/** 球形出生（球面点；半径区间 + 速度型） */
export class PartSphereEmitter implements EmitterShape {
  type = 'partSphere';
  private readonly dir = new Vector3();

  constructor(
    private readonly radiusMin: number,
    private readonly radiusMax: number,
    private readonly velocity: Vec3 | null,
    private readonly velocityMode: VelocityMode,
    private readonly rand: Rand = Math.random,
  ) {}

  initialize(p: Particle, _state?: EmissionState): void {
    // 半径：区间 [min,max] 一次掷（= `m_Radius.GetRandom()`）
    const radius = this.radiusMin + this.rand() * (this.radiusMax - this.radiusMin);
    // 方向：均匀球面（z 均匀 + 方位角均匀 = 原版"随机旋转"的等价物）
    const z = this.rand() * 2 - 1;
    const a = this.rand() * Math.PI * 2;
    const s = Math.sqrt(Math.max(0, 1 - z * z));
    this.dir.set(s * Math.cos(a), s * Math.sin(a), z).normalize();

    const pos = (p as unknown as { position?: { x: number; y: number; z: number } }).position;
    if (pos) { pos.x = this.dir.x * radius; pos.y = this.dir.y * radius; pos.z = this.dir.z * radius; }

    const vel = (p as unknown as { velocity?: { x: number; y: number; z: number } }).velocity;
    if (!vel || !this.velocity) return;
    const roll = (n: Vec3['x']): number => (n.k === 'n' ? n.v : n.a + this.rand() * (n.b - n.a));
    if (this.velocityMode === 'curpos') {
      // 方向 = 出生点方向（径向）；大小 = velocity.x（**只取 X 分量**，负值 ⇒ 反向）
      const speed = roll(this.velocity.x);
      vel.x = this.dir.x * speed; vel.y = this.dir.y * speed; vel.z = this.dir.z * speed;
    } else {
      vel.x = roll(this.velocity.x); vel.y = roll(this.velocity.y); vel.z = roll(this.velocity.z);
    }
  }

  update(): void { /* 静态形状 */ }
  toJSON(): { type: string } { return { type: this.type }; }
  clone(): EmitterShape {
    return new PartSphereEmitter(this.radiusMin, this.radiusMax, this.velocity, this.velocityMode, this.rand);
  }
}

/**
 * **圆环出生**（`InitSpawnBoundingDoughnut(x1,x2,y1,y2)`）—— 照 `HoEffectController.h:355-404`
 * 的 `HoEffectBoundingDoughnut`：
 * ```
 * Init(x1,x2,y1,y2): m_Pos 三轴都 = [y1,y2]；m_Radius = [x1,x2]（角度 m_Angle 构造值 [0,8]）
 * GetPos(): pos = m_Pos.GetRandom();            // 三轴各在 [y1,y2] 内随机
 *           pos.z += m_Radius.GetRandom();      // z 再加一个 [x1,x2] 的半径
 *           Angle = m_Angle.GetRandom();        // 默认 [0,8]（PT 角度单位 ⇒ 约 0~0.7°，接近不动）
 *           返回 Translate(pos) · Rotate(0, Angle.y, 0) 的平移部分 = pos 绕 Y 转 Angle.y
 * ```
 * ⇒ 名字叫"圆环"但**不是**均匀环：是"以 z 为轴的短柱 + 半径偏移 + 极小的 Y 旋转"。照抄。
 */
export class PartDoughnutEmitter implements EmitterShape {
  type = 'partDoughnut';
  constructor(
    private readonly x1: number, private readonly x2: number,   // 半径区间（加到 z 上）
    private readonly y1: number, private readonly y2: number,   // 三轴各自的盒区间
    private readonly velocity: Vec3 | null,
    private readonly velocityMode: VelocityMode,
    private readonly rand: Rand = Math.random,
    /** `m_Angle` 构造值 = [0,8]（PT 角度单位，4096 = 一圈） */
    private readonly angleMax = 8,
  ) {}

  initialize(p: Particle, _state?: EmissionState): void {
    const r = (lo: number, hi: number): number => lo + this.rand() * (hi - lo);
    let x = r(this.y1, this.y2);
    let y = r(this.y1, this.y2);
    let z = r(this.y1, this.y2) + r(this.x1, this.x2);
    // 绕 Y 转 m_Angle（PT 单位 → 弧度）：仅旋转位置向量
    const angY = (this.rand() * this.angleMax) * (Math.PI * 2 / 4096);
    const c = Math.cos(angY), s = Math.sin(angY);
    const rx = x * c + z * s;              // 与 geom.getMoveLocation 的 Y 旋转同式
    const rz = z * c - x * s;
    x = rx; z = rz;

    const pos = (p as unknown as { position?: { x: number; y: number; z: number } }).position;
    if (pos) { pos.x = x; pos.y = y; pos.z = z; }

    const vel = (p as unknown as { velocity?: { x: number; y: number; z: number } }).velocity;
    if (!vel || !this.velocity) return;
    const roll = (n: Vec3['x']): number => (n.k === 'n' ? n.v : n.a + this.rand() * (n.b - n.a));
    if (this.velocityMode === 'curpos') {
      const len = Math.hypot(x, y, z) || 1;
      const speed = roll(this.velocity.x);
      vel.x = (x / len) * speed; vel.y = (y / len) * speed; vel.z = (z / len) * speed;
    } else {
      vel.x = roll(this.velocity.x); vel.y = roll(this.velocity.y); vel.z = roll(this.velocity.z);
    }
  }

  update(): void { /* 静态形状 */ }
  toJSON(): { type: string } { return { type: this.type }; }
  clone(): EmitterShape {
    return new PartDoughnutEmitter(this.x1, this.x2, this.y1, this.y2, this.velocity, this.velocityMode, this.rand, this.angleMax);
  }
}

/**
 * **`CurPos` 速度型的统一包装**（`InitVelocityType("CurPos")`）—— 与**出生形状无关**。
 *
 * 原版在 `CreateNewParticle` 里做这件事（`HoEffectController.cpp:600-628`）：先 `m_EmitRange->GetPos()`
 * 拿到出生偏移，再 `m_TranslateStep = m_Translate.Normalized() * velocity.x` ⇒ 速度方向 = 出生点径向、
 * 大小 = `velocity.x`（**只取 X 分量**，负值 ⇒ 反向）。所以它属于"形状之后"的一步，三种形状都适用。
 * ⇒ 本包装：调内层形状的 `initialize`（摆位 + 默认速度），再**按出生位置覆写速度**。
 */
export class CurPosVelocityShape implements EmitterShape {
  type = 'curPosVelocity';
  constructor(
    private readonly inner: EmitterShape,
    /** `m_Velocity.x` 的区间（只取 X 分量） */
    private readonly speedX: Vec3['x'],
    private readonly rand: Rand = Math.random,
  ) {}

  initialize(p: Particle, state: EmissionState): void {
    this.inner.initialize(p, state);
    const pos = (p as unknown as { position?: { x: number; y: number; z: number } }).position;
    const vel = (p as unknown as { velocity?: { x: number; y: number; z: number } }).velocity;
    if (!pos || !vel) return;
    const len = Math.hypot(pos.x, pos.y, pos.z);
    if (len === 0) {
      // 出生点恰在原点 ⇒ 径向无方向（原版 `Normalized()` 在此同样退化）。**不静默**：上报后速度置 0。
      reportFallback('fx', 'CurPos 速度型但出生点在原点（径向退化）⇒ 速度置 0');
      vel.x = 0; vel.y = 0; vel.z = 0;
      return;
    }
    const speed = this.speedX.k === 'n' ? this.speedX.v : this.speedX.a + this.rand() * (this.speedX.b - this.speedX.a);
    vel.x = (pos.x / len) * speed;
    vel.y = (pos.y / len) * speed;
    vel.z = (pos.z / len) * speed;
  }

  update(system: IParticleSystem, delta: number): void { this.inner.update(system, delta); }
  toJSON(): { type: string; inner: unknown } { return { type: this.type, inner: this.inner.toJSON() }; }
  clone(): EmitterShape { return new CurPosVelocityShape(this.inner.clone(), this.speedX, this.rand); }
}

/** C++ 的 `GetPos()` 退化（原点出生）时 `Normalized()` 无方向 ⇒ 速度置 0（与原版一致的退化） */
export const CURPOS_DEGENERATE_NOTE = 'CurPos 且出生点恰在原点 ⇒ 方向退化（原版 Normalized 同样退化）';
