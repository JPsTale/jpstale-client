/**
 * PT 骨骼动画求值器
 *
 * 严格依据 exm C++ 源码：
 *  - smOBJ3D::GetRotFrame（smObj3d.cpp:800）：Slerp(零四元数→B) × PrevRot[cnt]
 *  - smOBJ3D::GetPosFrame / GetScaleFrame（smObj3d.cpp:851/881）：线性插值
 *  - smOBJ3D::TmAnimation（smObj3d.cpp:1021）：TmResult = qmat × pParent->TmResult
 *
 * 矩阵布局（行主序）：
 *  - smFMATRIX: _ij 在 m[(i-1)*4+(j-1)]，位移 _41,_42,_43 在 m[12],m[13],m[14]
 *  - PrevRot[cnt] = 关键帧 cnt 的绝对旋转矩阵
 */

import type { Obj3D, SmbData, SkelFrame } from './char-format.js';

/** 四元数 → 旋转矩阵（行主序） */
export function quatToMatrixRow(x: number, y: number, z: number, w: number): number[] {
  const xx = x * x, yy = y * y, zz = z * z;
  const xy = x * y, xz = x * z, yz = y * z;
  const wx = w * x, wy = w * y, wz = w * z;
  return [
    1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy), 0,
    2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx), 0,
    2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy), 0,
    0, 0, 0, 1,
  ];
}

/** 四元数 Slerp（A=零四元数） */
function quatSlerpFromZero(bx: number, by: number, bz: number, bw: number, alpha: number) {
  const fTheta = Math.PI / 2;
  const fScale2 = Math.sin(fTheta * alpha);
  return { x: bx * fScale2, y: by * fScale2, z: bz * fScale2, w: bw * fScale2 };
}

/** 行主序矩阵乘法 m = a × b */
export function matMulRow(a: number[], b: number[]): number[] {
  const m = new Array(16).fill(0);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++)
      for (let k = 0; k < 4; k++)
        m[j * 4 + i] += a[j * 4 + k] * b[k * 4 + i];
  return m;
}

function getTmFrameRot(obj: Obj3D, frame: number): number {
  if (obj.tmFrameCnt > 0 && obj.tmRotFrame) {
    for (const f of obj.tmRotFrame) {
      if (f.posCnt > 0 && f.startFrame <= frame && f.endFrame > frame) {
        return f.posNum;
      }
    }
  }
  return -1;
}

function getRotMatrix(obj: Obj3D, frame: number): number[] {
  const { tmRot, tmPrevRot } = obj;
  if (!tmRot || tmRot.length === 0 || !tmPrevRot || tmPrevRot.length === 0) {
    const m = obj.tmRotate.m;
    return [m[0] / 256, m[1] / 256, m[2] / 256, 0, m[4] / 256, m[5] / 256, m[6] / 256, 0, m[8] / 256, m[9] / 256, m[10] / 256, 0, 0, 0, 0, 1];
  }

  let num = getTmFrameRot(obj, frame);
  if (num < 0) num = 0;

  let cnt = num;
  if (tmRot[cnt].frame > frame) {
    return tmPrevRot[0].slice();
  }
  let s: number, e: number;
  while (true) {
    if (cnt + 1 >= tmRot.length) break;
    s = tmRot[cnt].frame;
    e = tmRot[cnt + 1].frame;
    if (s <= frame && e > frame) break;
    cnt++;
  }
  if (cnt + 1 >= tmRot.length) {
    return tmPrevRot[tmPrevRot.length - 1].slice();
  }

  const ch = e! - s!;
  const sh = frame - s!;
  const alpha = ch > 0 ? sh / ch : 0;

  const b = tmRot[cnt + 1];
  const q = quatSlerpFromZero(b.x, b.y, b.z, b.w, alpha);
  const qMat = quatToMatrixRow(q.x, q.y, q.z, q.w);

  return matMulRow(tmPrevRot[cnt], qMat);
}

function getPos(obj: Obj3D, frame: number): { x: number; y: number; z: number } {
  const { tmPos } = obj;
  if (!tmPos || tmPos.length === 0) {
    return { x: obj.bindPos.x, y: obj.bindPos.y, z: obj.bindPos.z };
  }
  if (tmPos[0].frame > frame) return { x: tmPos[0].x, y: tmPos[0].y, z: tmPos[0].z };
  let cnt = 0;
  let s: number, e: number;
  while (true) {
    if (cnt + 1 >= tmPos.length) break;
    s = tmPos[cnt].frame;
    e = tmPos[cnt + 1].frame;
    if (s <= frame && e > frame) break;
    cnt++;
  }
  if (cnt + 1 >= tmPos.length) {
    const last = tmPos[tmPos.length - 1];
    return { x: last.x, y: last.y, z: last.z };
  }
  const alpha = (frame - s!) / (e! - s!);
  return {
    x: tmPos[cnt].x + (tmPos[cnt + 1].x - tmPos[cnt].x) * alpha,
    y: tmPos[cnt].y + (tmPos[cnt + 1].y - tmPos[cnt].y) * alpha,
    z: tmPos[cnt].z + (tmPos[cnt + 1].z - tmPos[cnt].z) * alpha,
  };
}

// R = 绕 X 轴 -90°（行主序 4x4）
const ROT_X_NEG90 = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1];
const ROT_X_NEG90_INV = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1];

/** 引擎 Z-up 行主序矩阵 → GL Y-up */
export function toYupRow(rm: number[]): number[] {
  return matMulRow(ROT_X_NEG90, matMulRow(rm, ROT_X_NEG90_INV));
}

/**
 * 计算整副骨骼在指定帧的矩阵
 * rawMode=false: 转 Y-up（用于 GL 显示）
 * rawMode=true:  保持引擎坐标（Z-up）
 */
export function evalSkeleton(smb: SmbData, frame: number, rawMode: boolean): SkelFrame[] {
  const byName = new Map(smb.objects.map(o => [o.nodeName, o]));
  const result = new Map<string, { local: number[]; world: number[]; pos: { x: number; y: number; z: number } }>();

  function calc(obj: Obj3D): { local: number[]; world: number[]; pos: { x: number; y: number; z: number } } {
    if (result.has(obj.nodeName)) return result.get(obj.nodeName)!;

    const rotZup = getRotMatrix(obj, frame);
    const pos = getPos(obj, frame);

    let localMat: number[];
    if (rawMode) {
      localMat = rotZup.slice();
      localMat[12] = pos.x;
      localMat[13] = pos.y;
      localMat[14] = pos.z;
    } else {
      const engineMat = rotZup.slice();
      engineMat[12] = pos.x;
      engineMat[13] = pos.y;
      engineMat[14] = pos.z;
      localMat = toYupRow(engineMat);
    }

    let worldMat: number[];
    if (obj.nodeParent && byName.has(obj.nodeParent)) {
      const parent = calc(byName.get(obj.nodeParent)!);
      worldMat = matMulRow(localMat, parent.world);
    } else {
      worldMat = localMat;
    }

    const entry = { local: localMat, world: worldMat, pos };
    result.set(obj.nodeName, entry);
    return entry;
  }

  for (const obj of smb.objects) {
    calc(obj);
  }

  return smb.objects.map(o => ({ name: o.nodeName, ...result.get(o.nodeName)! }));
}

/**
 * 把 evalSkeleton 的局部矩阵应用到 three.js 骨骼
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyToBones(
  bones: any[],
  skelFrames: SkelFrame[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tmp: any,
  posV: { x: number; y: number; z: number },
  quatQ: { x: number; y: number; z: number; w: number },
  sclV: { x: number; y: number; z: number },
): void {
  const byName = new Map(bones.map((b: any) => [b.userData.nodeName, b]));
  for (const sf of skelFrames) {
    const bone = byName.get(sf.name);
    if (!bone) continue;
    tmp.fromArray(sf.local);
    tmp.decompose(posV, quatQ, sclV);
    bone.position.copy(posV);
    bone.quaternion.copy(quatQ);
    bone.scale.copy(sclV);
    bone.matrixWorldNeedsUpdate = true;
  }
}
