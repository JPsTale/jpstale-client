/**
 * B4 TYPE_ONE 朝向（渲染与混合行 [16]）—— 依据冻结文档：
 *
 *   · 顶点先变换到相机空间（减相机位置、乘 mCamera），单位面片 (±width,±height,0)，
 *     再按 `PartAngle` 做 **Rx·Ry·Rz**（HoNewParticle.cpp:2874-2879）；
 *   · PartAngle 全零走无角度分支（cpp:3135-3140）⇒ 纯 billboard；
 *   · 几何一律 XY 单位面片（坑表 #3），"朝向相机"由四元数表达；
 *   · 相机未注册 ⇒ 保持上次值并跳过（缺相机是装配错误，不静默造默认朝向）。
 */
import { Quaternion } from 'quarks.core';
import type { Behavior, IParticleSystem, Particle } from 'quarks.core';
import { allZero, eulerQuat, orientCamera, writeRotation, type OrientOpts } from './orient-shared.js';
import { blockOf } from './plugin-clock.js';

export class PtOrientOne implements Behavior {
  type = 'PtOrientOne';
  private readonly q = new Quaternion();
  private readonly spin = new Quaternion();

  constructor(private readonly opts: OrientOpts) {}

  initialize(_particle: Particle, _ps: IParticleSystem): void { /* 朝向逐帧现算，无逐粒子状态 */ }

  update(particle: Particle, _delta: number): void {
    const cam = orientCamera();
    if (!cam) return;                                       // 装配错误由接线方负责（见文件头）
    const b = blockOf(particle.memory, this.opts.locator);
    const pa = b ? b.val.partAngle : [0, 0, 0];
    const a = { x: pa[0]!, y: pa[1]!, z: pa[2]! };
    this.q.copy(cam);
    if (!allZero(a.x, a.y, a.z)) {
      eulerQuat(this.spin, a.x, a.y, a.z);                  // outMatrix = Rx·Ry·Rz（cpp:2874-2879）
      this.q.multiply(this.spin);                           // q = q_cam ⊗ (Rx·Ry·Rz)：相机基底上的三轴旋转
    }
    writeRotation(particle, this.q);
  }

  frameUpdate(_delta: number): void { /* 逐粒子在 update 里做 */ }
  toJSON(): unknown { return { type: this.type }; }
  clone(): Behavior { return new PtOrientOne(this.opts); }
  reset(): void { /* 无状态 */ }
}
