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
 *
 * ── 关于"零分配"（2026-09-14）─────────────────────────────────────────────
 * 原实现每一步都新建数组（每根骨约 8 个：rotZup、localMat 的 slice、2 次 toYupRow 的乘法、
 * worldMat、SkelFrame 对象…），一只 25 骨的怪每帧 ≈ 200 个数组 ⇒ 220 只 = **4.4 万个数组/帧**。
 * 实测把一个 25 骨、每骨 3 次 4×4 乘的循环跑 2 万次：用 `new Array(16).fill(0)` 是 10.37µs，
 * 换成复用同一块数组只要 3.24µs（**3.2 倍**）—— 而同一份工作的"真·浮点量"只有 4800 次乘加，
 * 占一帧 CPU 预算的 0.03%。**瓶颈从来不是 JS 算得慢，是每次都重新分配。**
 *
 * 所以：热路径走 `evalSkeletonInto(smb, frame, rawMode, ws)`，`ws`（`createEvalWorkspace`）里
 * 预建了每根骨的 local/world 矩阵槽、pos 对象、以及按索引的父子关系（不再每帧建 Map）。
 * 一次性调用（构建期、检查器、验证脚本）继续用 `evalSkeleton()`，语义与返回值完全不变。
 *
 * ⚠ **`evalSkeletonInto` 返回的数组与矩阵是复用的**：下次调用就覆盖。调用方必须在同一次
 * 迭代内把要用的东西消费掉（典型用法是紧接着 `applyToBones`），**不能长期持有**。
 */

import type { Obj3D, SmbData, SkelFrame } from './char-format.js';

/** 四元数 → 旋转矩阵（行主序），写入 out（16 个元素全部覆盖） */
export function quatToMatrixRowInto(x: number, y: number, z: number, w: number, out: number[]): void {
  const xx = x * x, yy = y * y, zz = z * z;
  const xy = x * y, xz = x * z, yz = y * z;
  const wx = w * x, wy = w * y, wz = w * z;
  out[0] = 1 - 2 * (yy + zz); out[1] = 2 * (xy - wz); out[2] = 2 * (xz + wy); out[3] = 0;
  out[4] = 2 * (xy + wz); out[5] = 1 - 2 * (xx + zz); out[6] = 2 * (yz - wx); out[7] = 0;
  out[8] = 2 * (xz - wy); out[9] = 2 * (yz + wx); out[10] = 1 - 2 * (xx + yy); out[11] = 0;
  out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
}

/** 四元数 → 旋转矩阵（行主序）；返回新数组，供一次性调用方使用 */
export function quatToMatrixRow(x: number, y: number, z: number, w: number): number[] {
  const m = new Array(16);
  quatToMatrixRowInto(x, y, z, w, m);
  return m;
}

/** 四元数 Slerp（A=零四元数），结果写入 out（复用对象） */
function quatSlerpFromZeroInto(
  bx: number, by: number, bz: number, bw: number, alpha: number,
  out: { x: number; y: number; z: number; w: number },
): void {
  const fTheta = Math.PI / 2;
  const fScale2 = Math.sin(fTheta * alpha);
  out.x = bx * fScale2; out.y = by * fScale2; out.z = bz * fScale2; out.w = bw * fScale2;
}

/** 行主序矩阵乘法 out = a × b（out 可以与 a/b 不同；三者互不重叠时零分配） */
export function matMulRowInto(a: number[], b: number[], out: number[]): void {
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      // 先累加到局部变量再写回：原实现是 m[idx] += …（从 0 起步），浮点加法顺序必须一致
      let s = 0;
      const row = j * 4;
      for (let k = 0; k < 4; k++) s += a[row + k]! * b[k * 4 + i]!;
      out[row + i] = s;
    }
  }
}

/** 行主序矩阵乘法 m = a × b；返回新数组，供一次性调用方使用 */
export function matMulRow(a: number[], b: number[]): number[] {
  const m = new Array(16);
  matMulRowInto(a, b, m);
  return m;
}

/** 16 元素拷贝（矩阵池之间搬数据，避免 slice 分配） */
function copy16(src: number[], dst: number[]): void {
  for (let i = 0; i < 16; i++) dst[i] = src[i]!;
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

/** 绑定姿态的 3x3（tmRotate.m，1/256 定点）→ 行主序 4x4 写入 out */
function writeBindRot(out: number[], m: ArrayLike<number>): void {
  out[0] = m[0]! / 256; out[1] = m[1]! / 256; out[2] = m[2]! / 256; out[3] = 0;
  out[4] = m[4]! / 256; out[5] = m[5]! / 256; out[6] = m[6]! / 256; out[7] = 0;
  out[8] = m[8]! / 256; out[9] = m[9]! / 256; out[10] = m[10]! / 256; out[11] = 0;
  out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
}

/**
 * 该骨在当前帧的"引擎坐标系旋转矩阵"（Z-up 行主序），写入 out。
 * 逻辑与数值顺序严格照抄原实现（见文件头 C++ 出处）。
 * @param tmp 需要一块 16 元素的暂存（用于 slerp 后的旋转矩阵），由调用方提供
 */
function getRotMatrixInto(obj: Obj3D, frame: number, out: number[], tmp: number[]): void {
  const { tmRot, tmPrevRot } = obj;
  if (!tmRot || tmRot.length === 0 || !tmPrevRot || tmPrevRot.length === 0) {
    writeBindRot(out, obj.tmRotate.m);
    return;
  }

  const num = getTmFrameRot(obj, frame);
  // C++ TmAnimation: NumTmRot = GetTmFrameRot(frame)；若 <0（当前帧不在任何有效旋转段内，
  // 例如某骨骼在部分动作段无独立旋转数据）则走 else 分支 smFMatrixFromMatrix(qmat, TmRotate)，
  // 即回退到绑定姿态矩阵，而不是从全局 tmRot[0] 插值（后者对新 smb 多段数据会取错段 → 横躺）。
  if (num < 0) {
    writeBindRot(out, obj.tmRotate.m);
    return;
  }

  let cnt = num;
  if (tmRot[cnt]!.frame > frame) {
    // 帧早于该段首关键帧：C++ GetRotFrame 对 tmRot[cnt].frame>frame 直接 return frame
    //（不写 gmat），上层调用后 qmat 保持单位阵，等价于 PrevRot 首帧（段起点）。
    copy16(tmPrevRot[cnt]!, out);
    return;
  }
  let s: number, e: number;
  while (true) {
    if (cnt + 1 >= tmRot.length) break;
    s = tmRot[cnt]!.frame;
    e = tmRot[cnt + 1]!.frame;
    if (s <= frame && e > frame) break;
    cnt++;
  }
  if (cnt + 1 >= tmRot.length) {
    copy16(tmPrevRot[tmPrevRot.length - 1]!, out);
    return;
  }

  const ch = e! - s!;
  const sh = frame - s!;
  const alpha = ch > 0 ? sh / ch : 0;

  const b = tmRot[cnt + 1]!;
  quatSlerpFromZeroInto(b.x, b.y, b.z, b.w, alpha, QUAT_SCRATCH);
  quatToMatrixRowInto(QUAT_SCRATCH.x, QUAT_SCRATCH.y, QUAT_SCRATCH.z, QUAT_SCRATCH.w, tmp);
  matMulRowInto(tmPrevRot[cnt]!, tmp, out);
}

/** slerp 结果的复用容器（求值是单线程串行的，不存在重入） */
const QUAT_SCRATCH = { x: 0, y: 0, z: 0, w: 0 };

/** 该骨在当前帧的位移，写入 out（复用对象） */
function getPosInto(obj: Obj3D, frame: number, out: { x: number; y: number; z: number }): void {
  const { tmPos } = obj;
  if (!tmPos || tmPos.length === 0) {
    out.x = obj.bindPos.x; out.y = obj.bindPos.y; out.z = obj.bindPos.z;
    return;
  }
  if (tmPos[0]!.frame > frame) {
    out.x = tmPos[0]!.x; out.y = tmPos[0]!.y; out.z = tmPos[0]!.z;
    return;
  }
  let cnt = 0;
  let s: number, e: number;
  while (true) {
    if (cnt + 1 >= tmPos.length) break;
    s = tmPos[cnt]!.frame;
    e = tmPos[cnt + 1]!.frame;
    if (s <= frame && e > frame) break;
    cnt++;
  }
  if (cnt + 1 >= tmPos.length) {
    const last = tmPos[tmPos.length - 1]!;
    out.x = last.x; out.y = last.y; out.z = last.z;
    return;
  }
  const alpha = (frame - s!) / (e! - s!);
  const a = tmPos[cnt]!, b = tmPos[cnt + 1]!;
  out.x = a.x + (b.x - a.x) * alpha;
  out.y = a.y + (b.y - a.y) * alpha;
  out.z = a.z + (b.z - a.z) * alpha;
}

// R = 绕 X 轴 -90°（行主序 4x4）
const ROT_X_NEG90 = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1];
const ROT_X_NEG90_INV = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1];

/** 引擎 Z-up 行主序矩阵 → GL Y-up，写入 out */
export function toYupRowInto(rm: number[], out: number[], scratch: number[]): void {
  matMulRowInto(rm, ROT_X_NEG90_INV, scratch);
  matMulRowInto(ROT_X_NEG90, scratch, out);
}

/** 引擎 Z-up 行主序矩阵 → GL Y-up；返回新数组，供一次性调用方使用 */
export function toYupRow(rm: number[]): number[] {
  const out = new Array(16);
  toYupRowInto(rm, out, new Array(16));
  return out;
}

/**
 * 求值工作区：把"每帧都要重建的东西"预先建好一次（按 smb）。
 *
 * 这是**显式**的（调用方持有并传入），刻意不做成"按 smb 隐式缓存的全局池" ——
 * 共享可变状态 + 隐式复用正是过去几类难查 bug 的温床（见 AGENTS #11/#15）。
 */
export interface EvalWorkspace {
  smb: SmbData;
  objects: Obj3D[];
  /** 骨骼名 → objects 下标（父节点查找用，不再每帧建 Map） */
  byName: Map<string, number>;
  /** 每根骨的父节点下标（-1 = 根） */
  parent: Int32Array;
  /** 本帧是否已求值（按索引，替代原来的 result Map） */
  state: Uint8Array;
  /** 按 objects 顺序的骨架帧；local/world 指向 mats 里的槽，每次求值原地覆盖 */
  frames: SkelFrame[];
  /** 矩阵池：[i*2] = 第 i 根骨的 local，[i*2+1] = world；末尾 2 块给 scratch/scratch2 */
  mats: number[][];
  /** 暂存矩阵 1（旋转结果 / Y-up 变换的中转） */
  scratch: number[];
  /** 暂存矩阵 2（Y-up 变换的中转） */
  scratch2: number[];
}

/** 为一个 smb 建工作区（每个 smb 建一次即可，反复使用） */
export function createEvalWorkspace(smb: SmbData): EvalWorkspace {
  const objects = smb.objects;
  const n = objects.length;
  const byName = new Map<string, number>();
  for (let i = 0; i < n; i++) byName.set(objects[i]!.nodeName, i);
  const parent = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const pn = objects[i]!.nodeParent;
    if (pn) {
      const pi = byName.get(pn);
      if (pi !== undefined) parent[i] = pi;
    }
  }
  const mats: number[][] = [];
  for (let i = 0; i < n * 2 + 2; i++) mats.push(new Array(16).fill(0));
  const frames: SkelFrame[] = objects.map((o, i) => ({
    name: o.nodeName,
    local: mats[i * 2]!,
    world: mats[i * 2 + 1]!,
    pos: { x: 0, y: 0, z: 0 },
  }));
  return {
    smb, objects, byName, parent,
    state: new Uint8Array(n),
    frames, mats,
    scratch: mats[n * 2]!,
    scratch2: mats[n * 2 + 1]!,
  };
}

/** 按索引递归求值一根骨（父节点先算），全部结果写进 ws 的池子里 */
function calcBone(ws: EvalWorkspace, i: number, frame: number, rawMode: boolean): void {
  if (ws.state[i]) return;
  const obj = ws.objects[i]!;
  const frame_i = ws.frames[i]!;
  const localMat = frame_i.local;

  getPosInto(obj, frame, frame_i.pos);
  getRotMatrixInto(obj, frame, ws.scratch, ws.scratch2);

  if (rawMode) {
    copy16(ws.scratch, localMat);
    localMat[12] = frame_i.pos.x;
    localMat[13] = frame_i.pos.y;
    localMat[14] = frame_i.pos.z;
  } else {
    // 引擎矩阵 = 旋转 + 位移，再整体转 Y-up（顺序与数值同原实现）
    ws.scratch[12] = frame_i.pos.x;
    ws.scratch[13] = frame_i.pos.y;
    ws.scratch[14] = frame_i.pos.z;
    toYupRowInto(ws.scratch, localMat, ws.scratch2);
  }

  const pi = ws.parent[i]!;
  const worldMat = frame_i.world;
  if (pi >= 0) {
    calcBone(ws, pi, frame, rawMode);
    matMulRowInto(localMat, ws.frames[pi]!.world, worldMat);
  } else {
    // 无父：world 即 local（原实现直接复用同一个数组引用；这里内容相同、槽位分开）
    copy16(localMat, worldMat);
  }
  ws.state[i] = 1;
}

/**
 * 计算整副骨骼在指定帧的矩阵（零分配热路径）。
 * rawMode=false: 转 Y-up（用于 GL 显示）；rawMode=true: 保持引擎坐标（Z-up）
 *
 * ⚠ 返回的 SkelFrame[] 与其矩阵**归 ws 所有、下次调用即被覆盖** —— 调用方要在同一次迭代内
 * 用掉（如紧接着 applyToBones），不要长期持有。
 */
export function evalSkeletonInto(
  smb: SmbData, frame: number, rawMode: boolean, ws: EvalWorkspace,
): SkelFrame[] {
  // 工作区与 smb 必须配套：腕错的后果是"矩阵数量/骨名对不上"，表现为莫名其妙的变形，
  // 所以宁可当场炸掉（各模型的 workspace 绝不能混用）。
  if (ws.smb !== smb) {
    throw new Error('evalSkeletonInto: workspace 与 smb 不匹配（不同模型的 workspace 不能混用）');
  }
  const n = ws.objects.length;
  ws.state.fill(0);
  for (let i = 0; i < n; i++) calcBone(ws, i, frame, rawMode);
  return ws.frames;
}

/**
 * 计算整副骨骼在指定帧的矩阵。
 * 一次性调用（构建期 / 检查器 / 验证脚本）用这个：每次新建工作区，返回值可长期持有。
 * 逐帧调用的热路径请用 `evalSkeletonInto` + 自持工作区（否则等于白优化）。
 */
export function evalSkeleton(smb: SmbData, frame: number, rawMode: boolean): SkelFrame[] {
  return evalSkeletonInto(smb, frame, rawMode, createEvalWorkspace(smb));
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

/* ─────────── 动画帧推进（游戏与工具共用） ─────────── */

/** 每秒推进的子帧数 = 30 动画帧/秒 × 160 子帧/帧（与 WorldView 一致） */
export const ANIM_UNITS_PER_SEC = 4800;

export interface AnimStep {
  /** 推进后应采用的帧位置（已处理循环回绕 / 非循环截到末尾） */
  frame: number;
  /** 推进后的原始帧位置（未回绕）——命中帧跨帧检测必须用这个值 */
  raw: number;
  /** 非循环动作是否已推进到末尾；调用方决定后续（状态机切换等） */
  ended: boolean;
}

/**
 * 推进一步动画帧位置。
 *
 * 抽出来的原因：此前 WorldView / CharSelect / 资产检查器各写了一份帧推进，
 * 其中一处甚至把 4800 写成字面量 —— 语义一旦漂移就会"游戏里改了、工具里没跟着改"。
 * 现在三处统一走这里（原 char-demo 已删除）。
 *
 * @param frame 当前帧位置（子帧单位，1 动画帧 = 160）
 * @param motion 当前动作（用 startFrame/endFrame/repeat）
 * @param dt 秒
 * @param rate 速率倍率（攻击动画按攻速改写；检查器用 speed）
 * @param maxDt 单步 dt 上限（防切后台回来跳帧），默认 0.1
 */
export function advanceAnimFrame(
  frame: number,
  motion: { startFrame: number; endFrame: number; repeat: number },
  dt: number,
  rate = 1,
  maxDt = 0.1,
): AnimStep {
  const start = motion.startFrame * 160;
  const end = motion.endFrame * 160;
  const len = end - start;
  if (len <= 0) return { frame, raw: frame, ended: false };
  const raw = frame + ANIM_UNITS_PER_SEC * rate * Math.min(dt, maxDt);
  if (raw < end) return { frame: raw, raw, ended: false };
  if (motion.repeat) return { frame: start + ((raw - start) % len), raw, ended: false };
  return { frame: end, raw, ended: true };
}

/**
 * 本帧**跨过了哪些事件帧** —— 攻击/技能事件帧判定的**唯一实现**。
 *
 * 原版 `EventAttack()` 每帧被调（`character.cpp:5837`，紧跟 `frame += FrameStep`），内部比对
 * `EventFrame[0..3]`，**每个跨过的事件帧都触发一次**（`:4173-4183`）。
 *
 * ⚠ 为什么必须收敛成一处：这段判定此前在仓库里有**三份**（玩家自机 / 怪物 / 怪物实验室），
 * 而且已经漂移了 —— 玩家侧遍历全部事件帧，怪物侧只认第一个，于是"连续打三拳的怪
 * （HULK 的事件帧 `[1280,3040,4800]`）只播一次粒子"（用户 2026-09-17 实测发现）。
 * 两边各自演化，正是 AGENTS #15 描述的失效方式。
 *
 * **怎么算**归这里，**跨过之后做什么**（播音效 / 起特效 / 发 `C2S_AttackHit`）归各调用方。
 *
 * @param frames    本动作的全部**非零**事件帧（升序）
 * @param fired     已触发到第几个
 * @param compFrame 当前 compFrame —— **必须是未回绕的 `raw`**（`AnimStep.raw`）；
 *                  用回绕后的 `frame` 会在动画循环处误判。
 * @returns 本次跨过的事件帧（可能 0 个，也可能多个）与新的触发计数
 */
export function crossEventFrames(
  frames: readonly number[],
  fired: number,
  compFrame: number,
): { hit: number[]; fired: number } {
  const hit: number[] = [];
  let i = fired;
  // 用 while 而非 if：一帧内跨过多个事件帧时（低帧率 / 高速率）不能漏
  while (i < frames.length && compFrame >= frames[i]!) {
    hit.push(frames[i]!);
    i++;
  }
  return { hit, fired: i };
}

/**
 * 跨过的这个事件帧是本条动作的**第几个**事件帧（1 起）= 原版 `MotionEvent`。
 *
 * 用途：有的特效按"第几个事件帧"分左右（原版 `AssaParticle_VigorBall`：
 * `MotionEvent == 1 ? Angle.y - ANGLE_45 : Angle.y + ANGLE_45`）。
 * 原版是"每跨过一个事件帧就 `MotionEvent++`"，与"按 `.inx` 里非零事件帧的顺序取序号"
 * 在一次播放里等价（每个事件帧只跨过一次）—— 后者无状态，故取后者。
 *
 * @returns 没找到（`frame` 不在表里）时返回 0，调用方按"未知"处理
 */
export function motionEventIndexOf(
  eventFrames: readonly number[], frame: number,
): number {
  let n = 0;
  for (const f of eventFrames) {
    if (f > 0) {
      n++;
      if (f === frame) return n;
    }
  }
  return 0;
}
