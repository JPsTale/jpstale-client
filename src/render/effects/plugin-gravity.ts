/**
 * B5 重力插件（值时间层行 [7] 的实现）—— 依据冻结文档：
 *
 *   · 行 [7]：原版重力是**逐粒子逐帧重掷**（`Gravity.GetRandomNumInRange()` 每帧每粒子新掷，
 *     [S1] h:1256-1263）—— quarks 的 ApplyForce/GravityForce 是恒力 ⇒ **替代**（二选一，§G1）；
 *   · `RandomNumber(float)` 对 Min==Max **短路返回、不消费 rand**（HoMinMax.cpp:6-7）⇒
 *     常量轴不烧随机数（r[B1-7] 期实测：急切求值会让区间轴的 u 序列错位）；
 *   · 单位：掷出的是每帧加速度量，`velocity += g·dt` 每帧施加；
 *   · 相位：本行为排在 PtClockBehavior **之前**（C++ 重力在事件前，行 [15]）；
 *     quarks 在行为之后统一积分 ⇒ 与原版"本帧掷、下帧积分用"差一帧相位（行 [15] 差异已登记）。
 */
import type { Behavior, IParticleSystem, Particle } from 'quarks.core';
import type { Num, Vec3 } from '../../core/effect/pt-value.js';
import type { Rand } from '../../core/effect/pt-timeline.js';

/** 惰性掷值（IR 的 tagged Num）：`k:'n'` 定值短路；`k:'r'` 且 a===b 时 C++ `Min==Max` 短路
 *  **不消费 rand**（HoMinMax.cpp:6-7）；否则 `a + rand()×(b−a)` */
export function rollLazy(n: Num, rand: Rand): number {
  if (n.k === 'n') return n.v;
  if (n.a === n.b) return n.a;
  return n.a + rand() * (n.b - n.a);
}

export class PtGravityBehavior implements Behavior {
  type = 'PtGravity';
  constructor(
    private readonly gravity: Vec3,
    private readonly rand: Rand = Math.random,
  ) {}

  initialize(_particle: Particle, _ps: IParticleSystem): void { /* 无逐粒子状态（掷完即用） */ }

  update(particle: Particle, delta: number): void {
    particle.velocity.x += rollLazy(this.gravity.x, this.rand) * delta;
    particle.velocity.y += rollLazy(this.gravity.y, this.rand) * delta;
    particle.velocity.z += rollLazy(this.gravity.z, this.rand) * delta;
  }

  frameUpdate(_delta: number): void { /* 逐粒子在 update 里做 */ }
  toJSON(): unknown { return { type: this.type }; }
  clone(): Behavior { return new PtGravityBehavior(this.gravity, this.rand); }
  reset(): void { /* 无状态 */ }
}
