/**
 * **轴向丝带朝向**（`BillboardAxial` = 原版 `CLASS_EFFECT_BILLBOARD_AXIAL`）—— 唯一实现。
 *
 * 原版怎么画（`HoEffectView.cpp:187-250 UpdateBillboardAxial` + `HoEffectModel.cpp:164`）：
 *   · 丝带的两端 = `m_Pos`（粒子位置）与 `m_DesPos = m_Translate + m_Direction × m_Size.y`
 *     ⇒ **轴向 = 粒子自己的径向方向，长度 = `Size.y`**；
 *   · 半宽 = `Size.x`，且在**屏幕空间**取垂直（`persp = (-dy, +dx, 0)`，dy/dx 是投影后的轴向）
 *     ⇒ 丝带**绕自身轴面向相机**（谁看都是"一条沿径向的细带"）。
 *
 * 落到 quarks：`RenderMode.Mesh` + 单位 XY 面片（局部 +Y = 长度轴、+X = 宽度轴）+ 本行为每帧写四元数：
 *   · `Y = normalize(velocity)`（= 径向；`CurPos` 速度型时 velocity 本身就是径向）；
 *   · `Z = normalize(toCam − Y·(toCam·Y))`（垂直于 Y、尽量朝向相机 = 屏幕空间垂直）；
 *   · `X = Y × Z`（右手系）。
 * ⇒ 宽 = `particle.size.x`、长 = `particle.size.y`（由 `PtSizeBehavior` 按块值写，行 [20]）。
 *
 * ⚠ 与 quarks 原生 `StretchedBillBoard` 的区别：后者用 `avgSize=(size.x+size.y)/2` 同时定宽和长、
 * 长度还受 `speedFactor/lengthFactor` 影响 ⇒ **表达不了"宽 0.5、长 150"这种双维独立**（本资产的实参）。
 */
import { Quaternion, Matrix4, Vector3 } from 'three';
import type { Behavior, IParticleSystem, Particle } from 'quarks.core';
import { orientCameraPos } from './orient-shared.js';

const Y_AXIS = new Vector3();
const Z_AXIS = new Vector3();
const X_AXIS = new Vector3();
const TO_CAM = new Vector3();
const FALLBACK_Z = new Vector3(0, 0, 1);
const X_FALLBACK = new Vector3(1, 0, 0);
const Y_FALLBACK = new Vector3(0, 1, 0);
const m4 = new Matrix4();

export class PtAxialOrientation implements Behavior {
  type = 'PtAxialOrientation';
  private readonly q = new Quaternion();

  initialize(_p: Particle, _ps: IParticleSystem): void { /* 逐帧现算 */ }

  update(p: Particle, _delta: number): void {
    const vel = (p as unknown as { velocity?: { x: number; y: number; z: number } }).velocity;
    if (!vel) return;
    Y_AXIS.set(vel.x, vel.y, vel.z);
    if (Y_AXIS.lengthSq() < 1e-12) return;                  // 静止粒子无轴向（原版同：Normalized 会退化）
    Y_AXIS.normalize();

    // 与 Y 最不平行的坐标轴（退化时的回退基准）——**必须正交化后再用**，否则基不正交 ⇒ 四元数非单位
    const pick = Math.abs(Y_AXIS.x) < 0.9 ? X_FALLBACK : Y_FALLBACK;
    const perpToY = (out: Vector3, v: Vector3): void => {
      out.copy(v).addScaledVector(Y_AXIS, -v.dot(Y_AXIS));
      if (out.lengthSq() < 1e-8) { out.copy(pick).addScaledVector(Y_AXIS, -pick.dot(Y_AXIS)); }
      out.normalize();
    };

    const camPos = orientCameraPos();
    const pos = (p as unknown as { position?: { x: number; y: number; z: number } }).position;
    if (camPos && pos) {
      TO_CAM.set(camPos.x - pos.x, camPos.y - pos.y, camPos.z - pos.z);
      perpToY(Z_AXIS, TO_CAM);          // 垂直于 Y、尽量指向相机（退化为任取垂直）
    } else {
      perpToY(Z_AXIS, FALLBACK_Z);
    }
    X_AXIS.crossVectors(Y_AXIS, Z_AXIS).normalize();        // 右手系：X = Y × Z

    m4.makeBasis(X_AXIS, Y_AXIS, Z_AXIS);
    this.q.setFromRotationMatrix(m4);
    (p as unknown as { rotation?: unknown }).rotation = this.q;
  }

  frameUpdate(_delta: number): void { /* 逐粒子在 update 里做 */ }
  toJSON(): { type: string } { return { type: this.type }; }
  clone(): Behavior { return new PtAxialOrientation(); }
  reset(): void { /* 无状态 */ }
}
