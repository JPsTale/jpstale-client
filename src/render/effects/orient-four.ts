/**
 * B4 TYPE_FOUR（渲染与混合行 [19]）—— 依据冻结文档：
 *
 *   · **不写 rotation**（行 [21]：Trail 不承载横截面朝向；现行 = RenderMode.Trail +
 *     startLength=sizeExt??size 的长度型近似，part-to-quarks.ts:943-953 自述）；
 *   · LocalAngle 的语义 = 旋转**进入 TraceList 的位置点**（[S2] 的 TYPE_FOUR 分支，
 *     HoNewParticle.h:838-841：`angle.x=(int)LocalAngle.x & ANGCLIP` 后 Rx·Ry·Rz）。
 *
 * 定点数口径（本文件的单位决策，2026-09-19 B4）：
 *   · C++ 单位链 = 文件(度) → 解析 ×4096/360 → 块(4096 圈制，float 累加) → 渲染 (int)&ANGCLIP(4095)
 *     → smRotate 矩阵（HoNewParticle.cpp:314-319 解析换算、PartAngle 同、smSin.h:21/smType.h:14）；
 *   · 我方链条 = 文件(度) → part-script(度) → 块(度) → orient ×π/180 —— **全程浮点**；
 *     C++ 的 4096 量化步长 0.0879° 在渲染端不可见（亚量子误差）⇒ 等价，不逐帧复刻；
 *   · 例外 = rotateLocalPosForTrace：字面渲染器（U-A3-2）的输入变换**逐字复刻 C++ 全程**
 *     （度 → ×4096/360 → (int)&4095 → ×2π/4096），含量化——因为它是给"逐字复刻 C++"
 *     的位置历史渲染器用的，量化本身是那套渲染器语义的一部分。
 */
import { Quaternion, Vector3 } from 'three';
import type { GeneratorMemory } from 'quarks.core';
import type { Behavior, IParticleSystem, Particle } from 'quarks.core';
import { blockOf } from './plugin-clock.js';
import type { OrientOpts } from './orient-shared.js';

const ANGLE_360 = 4096;                                   // smSin.h:21
const ANGLE_MASK = ANGLE_360 - 1;                         // smType.h:14（ANGCLIP）

export class PtOrientFour implements Behavior {
  type = 'PtOrientFour';
  constructor(private readonly opts: OrientOpts) {}

  initialize(_particle: Particle, _ps: IParticleSystem): void { /* FOUR 无 rotation 写者 */ }
  update(_particle: Particle, _delta: number): void { /* 无 */ }
  frameUpdate(_delta: number): void { /* 无 */ }
  toJSON(): unknown { return { type: this.type }; }
  clone(): Behavior { return new PtOrientFour(this.opts); }
  reset(): void { /* 无 */ }

  /** LocalAngle 当前值（度；与块单位一致）——字面渲染器（U-A3-2）取用 */
  localAngleOf(memory: GeneratorMemory): { x: number; y: number; z: number } {
    const b = blockOf(memory, this.opts.locator);
    return b ? { x: b.val.partAngle[0]!, y: b.val.partAngle[1]!, z: b.val.partAngle[2]! } : { x: 0, y: 0, z: 0 };
  }
}

/** [S2] TYPE_FOUR 分支的位置变换——逐字复刻 C++ 定点全程：
 *  度 → ×4096/360（解析换算，cpp:314-319）→ (int) 截断 → &ANGCLIP（负角二补数回绕）
 *  → ×2π/4096 弧度 → Rx·Ry·Rz（cpp:2874-2879 同序） */
export function rotateLocalPosForTrace(
  pos: { x: number; y: number; z: number },
  localAngleDeg: { x: number; y: number; z: number },
): Vector3 {
  const toRad = (deg: number): number => {
    const units = Math.trunc(deg * (ANGLE_360 / 360)) & ANGLE_MASK;   // (int) 换算 + 掩码（负角回绕）
    return (units * 2 * Math.PI) / ANGLE_360;
  };
  const qx = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), toRad(localAngleDeg.x));
  const qy = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), toRad(localAngleDeg.y));
  const qz = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), toRad(localAngleDeg.z));
  const out = new Vector3(pos.x, pos.y, pos.z);
  out.applyQuaternion(qx.multiply(qy).multiply(qz));        // Rx·Ry·Rz（同 cpp 旋转序）
  return out;
}
