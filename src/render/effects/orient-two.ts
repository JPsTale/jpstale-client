/**
 * B4 TYPE_TWO 朝向（渲染与混合行 [17]）—— 依据冻结文档：
 *
 *   · 顶点 = **固定世界 XZ 平面** (±width, 0, ±height)（HoNewParticle.cpp:2117-2131；
 *     2 号顶点 y=9 为源码笔误、按 0 读）——不随相机（HorizontalBillBoard 的相机偏航耦合是旧实现近似）；
 *   · 角度 = `PartAngle + 发射器 Angle`（cpp:3158-3166），旋转在世界空间作用于 XZ 顶点；
 *   · 坑表 #3：几何一律 XY 单位面片，"水平"由**朝向**表达——基础朝向 = Rx(-90°)
 *     （把 XY 面片的法线 +z 转到世界 +y），随后 PartAngle+Angle 的 Rx·Ry·Rz 作用于其上：
 *     `q = (Rx·Ry·Rz) ⊗ Rx(-90°)`（先躺平、再世界旋转）。
 */
import { Quaternion, Vector3 } from 'quarks.core';
import type { Behavior, IParticleSystem, Particle } from 'quarks.core';
import { blockOf } from './plugin-clock.js';
import { eulerQuat, writeRotation, type OrientOpts } from './orient-shared.js';

const AXIS_X = new Vector3(1, 0, 0);

export class PtOrientTwo implements Behavior {
  type = 'PtOrientTwo';
  private readonly q = new Quaternion();
  private readonly spin = new Quaternion();
  private readonly base = new Quaternion().setFromAxisAngle(AXIS_X, -Math.PI / 2);

  constructor(private readonly opts: OrientOpts) {}

  initialize(_particle: Particle, _ps: IParticleSystem): void { /* 朝向逐帧现算 */ }

  update(particle: Particle, _delta: number): void {
    const b = blockOf(particle.memory, this.opts.locator);
    const pa = b ? b.val.partAngle : [0, 0, 0];
    const a = { x: pa[0]!, y: pa[1]!, z: pa[2]! };
    const e = this.opts.emitterAngle ?? { x: 0, y: 0, z: 0 };
    eulerQuat(this.spin, a.x + e.x, a.y + e.y, a.z + e.z);  // Rx·Ry·Rz（同 [S17] 旋转序）
    this.q.copy(this.spin).multiply(this.base);             // q = spin ⊗ base
    writeRotation(particle, this.q);
  }

  frameUpdate(_delta: number): void { /* 逐粒子在 update 里做 */ }
  toJSON(): unknown { return { type: this.type }; }
  clone(): Behavior { return new PtOrientTwo(this.opts); }
  reset(): void { /* 无状态 */ }
}
