/**
 * B4 TYPE_THREE 朝向（渲染与混合行 [18]）—— 依据冻结文档：
 *
 *   · 竖直段 (0,±height,0) 先按 PartAngle 做 Rx·Ry·Rz（HoNewParticle.cpp:2448-2450），
 *     再**投影到屏幕**、沿投影后的轴向在屏幕空间撑宽（[S18] 后半）；
 *   · 等效形态（行 [18] 映射）：面片面向相机 + 绕**视线轴**旋转"旋转后局部 up 的屏幕面内角"：
 *     `u_world = R·(0,1,0)`；`u_cam = q_cam⁻¹ · u_world`；`screen = atan2(u_cam.x, u_cam.y)`；
 *     `q = q_cam ⊗ Rz(screen)`。
 *   · 行 [18] 期望值：PartAngle.z=30° ⇒ screen=-30°；PartAngle.x=90° ⇒ u=(0,0,1) 指向相机。
 *   · 字面"屏幕空间撑宽"需自定义渲染器（U-A3-1）；世界缩放 vs 屏幕等比的透视差已登记。
 */
import { Quaternion, Vector3 } from 'quarks.core';
import type { Behavior, IParticleSystem, Particle } from 'quarks.core';
import { eulerQuat, orientCamera, writeRotation, type OrientOpts } from './orient-shared.js';
import { blockOf } from './plugin-clock.js';

const UP = new Vector3(0, 1, 0);
const VIEW_Z = new Vector3(0, 0, 1);
const uWorld = new Vector3();
const uCam = new Vector3();
const camInv = new Quaternion();

export class PtOrientThree implements Behavior {
  type = 'PtOrientThree';
  private readonly q = new Quaternion();
  private readonly spin = new Quaternion();
  private readonly rz = new Quaternion();

  constructor(private readonly opts: OrientOpts) {}

  initialize(_particle: Particle, _ps: IParticleSystem): void { /* 朝向逐帧现算 */ }

  update(particle: Particle, _delta: number): void {
    const cam = orientCamera();
    if (!cam) return;                                       // 缺相机 = 装配错误（同 orient-one）
    const b = blockOf(particle.memory, this.opts.locator);
    const pa = b ? b.val.partAngle : [0, 0, 0];
    const a = { x: pa[0]!, y: pa[1]!, z: pa[2]! };
    eulerQuat(this.spin, a.x, a.y, a.z);                    // Rx·Ry·Rz（cpp:2448-2450 同序）
    uWorld.copy(UP).applyQuaternion(this.spin);             // 旋转后的局部 up
    camInv.copy(cam).invert();
    uCam.copy(uWorld).applyQuaternion(camInv);              // 变换到相机空间
    const screen = Math.atan2(uCam.x, uCam.y);              // 屏幕面内角（行 [18] 期望值算式）
    this.q.copy(cam);
    this.rz.setFromAxisAngle(VIEW_Z, screen);               // 绕视线轴（相机局部 +z）
    this.q.multiply(this.rz);                               // q = q_cam ⊗ Rz(screen)
    writeRotation(particle, this.q);
  }

  frameUpdate(_delta: number): void { /* 逐粒子在 update 里做 */ }
  toJSON(): unknown { return { type: this.type }; }
  clone(): Behavior { return new PtOrientThree(this.opts); }
  reset(): void { /* 无状态 */ }
}
