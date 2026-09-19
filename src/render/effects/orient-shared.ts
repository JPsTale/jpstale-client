/**
 * B4 面片朝向共享基建（渲染与混合行 [16]-[19]/[21]）—— 相机注册表 + 四元数助手。
 *
 *   · 相机：相机空间朝向（TYPE_ONE/THREE）由渲染侧注册一次（WorldView/实验室各一次，
 *     与旧实现 setBillboardCamera 同型）；未注册时朝向行为直接跳过——缺相机是装配错误，
 *     不静默造默认朝向（行 [16] 反例：x/y 丢弃是错误）。
 *   · 旋绕顺序照抄 C++：`outMatrix = Rx·Ry·Rz`（HoNewParticle.cpp:2874-2879）⇒
 *     四元数 `q = qx⊗qy⊗qz`（作用于向量 = Rx·Ry·Rz·v，先 Z 后 Y 后 X）。
 *   · 数学全用 quarks.core 的 Quaternion/Vector3（particle.rotation 就是这个类）；
 *     渲染侧的 three 相机四元数经 setOrientCamera 的分量拷贝进入（three/quarks 布局同构）。
 *   · 行 [21]：rotation 每类型一个写者（工厂在 orient-factory.ts）；FOUR 不写。
 */
import { Quaternion, Vector3 } from 'quarks.core';

// 相机四元数的**活引用**（不拷贝快照）：渲染侧的相机被 OrbitControls 等持续旋转，
// 拷贝会立刻过期（r[B7-1] 期实测需求）。orient 行为每帧经 orientCamera() 读最新分量。
let cameraRef: { x: number; y: number; z: number; w: number } | null = null;
const camScratch = new Quaternion();

/** 渲染侧建好相机后调一次：传**相机的四元数对象**（活引用，传 null 注销） */
export function setOrientCamera(q: { x: number; y: number; z: number; w: number } | null): void {
  cameraRef = q;
}
export function orientCamera(): Quaternion | null {
  if (!cameraRef) return null;
  camScratch.set(cameraRef.x, cameraRef.y, cameraRef.z, cameraRef.w);
  return camScratch;
}

const AXIS_X = new Vector3(1, 0, 0);
const AXIS_Y = new Vector3(0, 1, 0);
const AXIS_Z = new Vector3(0, 0, 1);
const DEG = Math.PI / 180;

/** 按 C++ 的 Rx·Ry·Rz 顺序把三轴欧拉角（度）转成四元数（out = Rx⊗Ry⊗Rz） */
export function eulerQuat(out: Quaternion, xDeg: number, yDeg: number, zDeg: number): Quaternion {
  const qx = new Quaternion().setFromAxisAngle(AXIS_X, xDeg * DEG);
  const qy = new Quaternion().setFromAxisAngle(AXIS_Y, yDeg * DEG);
  const qz = new Quaternion().setFromAxisAngle(AXIS_Z, zDeg * DEG);
  out.copy(qx).multiply(qy).multiply(qz);
  return out;
}

/** 行 [16] 的"全零走无角度分支"判据（cpp:3135-3140 的 x==0&&y==0&&z==0） */
export function allZero(x: number, y: number, z: number, eps = 1e-6): boolean {
  return Math.abs(x) < eps && Math.abs(y) < eps && Math.abs(z) < eps;
}

/* ── 行 [21]：rotation 写者分配表（工厂在 orient-factory.ts——避免与四文件循环导入） ── */

import type { PtBlockLocator } from './plugin-clock.js';

/** 装配选项：块定位器（PartAngle 是**逐粒子**的——行为内部经 locator 直读块）+ 序列级发射器角 */
export interface OrientOpts {
  locator: PtBlockLocator;
  /** TYPE_TWO 的发射器 Angle（度；序列级，行 [17]） */
  emitterAngle?: { x: number; y: number; z: number };
}

/** 把算好的四元数写进粒子自己的 rotation（每粒子一份，不共享行为实例的临时对象） */
export function writeRotation(particle: { rotation?: unknown }, q: Quaternion): void {
  const r = particle.rotation;
  if (r instanceof Quaternion) r.copy(q);
  else particle.rotation = new Quaternion().copy(q);
}
