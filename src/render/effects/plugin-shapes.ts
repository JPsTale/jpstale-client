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
import type { EmitterShape, EmissionState, Particle } from 'quarks.core';
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
