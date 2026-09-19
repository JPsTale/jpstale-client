/**
 * 阶段 B 插件契约（B1）—— 把冻结文档映射栏的"接口签名 / 状态布局 / 字段所有权 / 替代关系"
 * 变成可引用的类型与常量。实现落在 B2-B5（本文件不含运行时逻辑）。
 *
 * 依据（冻结文档，快照 docs/handoff/frozen/2026-09-19）：
 *   · 统一形态 = §F.2"行为推钟 + 生成器读钟"（值时间层行 [1]-[7]）
 *   · 状态布局 = 行 [2]【映射】：particle.memory 里一块 {clock, cursor, steps, values}
 *   · 字段所有权 = §G1 表（README §3 铁律 5 之②：一个字段一个写者）
 *   · 机制事实 = 行 [2]【目标侧证据】：SizeOverLife.update 无 delta、ColorOverLife.update 有、
 *     particle.memory 逐粒子一份被所有行为/生成器共享
 * 映射数据本体 = 同目录 quarks-map.json（64 行，oracle/mutation 供 verify-quarks-mechanisms）。
 */

import type { Behavior, FunctionValueGenerator, GeneratorMemory } from 'quarks.core';

/* ─────────── 行 [2]/[3]/[4]：逐粒子状态块（particle.memory 里的契约布局） ─────────── */

/** 行 [2]【映射】：一块逐粒子状态，存进 `particle.memory`，由 PtClockBehavior 独占读写 */
export interface PtMemoryBlock {
  /** 原版 EventTimer（第二时钟；Age/life 归 quarks 死判，行 [4]） */
  clock: number;
  /** 事件游标（原版 CurrentEvent；eventtimer 拨钟后重扫，行 [4]） */
  cursor: number;
  /** 按轨的当前步长（原版 XxxStep；fade 重瞄在此写，行 [3]） */
  steps: number[];
  /** 按轨的当前值 */
  values: number[];
}

/**
 * memory 块的登记键：块对象以 `memory[PT_MEMORY_KEY_INDEX] = block` 的形式挂在
 * 生成器数值槽位流之外（数值槽位从 0 顺序 push，块在 `initialize` 时一次性追加）。
 * 读方永远通过本常量取，不猜下标。
 */
export const PT_MEMORY_KEY = 'pt:block';

/* ─────────── 行 [2]/[3]/[4]：推钟行为契约 ─────────── */

/** 每帧推钟步骤（行 [2]【映射】①②③；eventtimer/重扫分支 = 行 [4]） */
export interface PtClockBehavior extends Behavior {
  /** ① clock += delta；② 按 clock 推游标（非 fade ⇒ 写 values；fade 不赋值；凡有
   *  NextFadeEvent 者一律重算 steps——含非 fade 事件，行 [3]；eventtimer ⇒ 改 clock 并重扫）；
   *  ③ values += steps·delta */
  update(particle: { memory: GeneratorMemory }, delta: number): void;
}

/** 生成器契约：genValue 忽略 quarks 传入的 t（quarks 的 t=age/life 与原版事件钟是两个时间基，行 [2]） */
export interface PtValueGen extends FunctionValueGenerator {
  /** 只读 memory 里的当前值返回（不推进、不需要 delta） */
  genValue(memory: GeneratorMemory, t?: number): number;
}

/* ─────────── 行 [7]：重力（替代 ApplyForce/GravityForce） ─────────── */

/** 每帧每粒子三轴各掷一次（原版逐粒子逐帧重掷，[S1] h:1256-1263） */
export interface PtGravityBehavior extends Behavior {
  /** p.velocity += 三轴各掷的 RandomNumber × delta（方向恒定的 ApplyForce 不合格） */
  update(particle: { velocity: { x: number; y: number; z: number } }, delta: number): void;
}

/* ─────────── 行 [6]：发射预算（系统级；U-A1-1：quarks 无 stopEmit） ─────────── */

/**
 * 系统级行为实例（每系统一个，非逐粒子）：frameUpdate 记账，到预算停发。
 * 停发机制（U-A1-1 裁定）：`ps.emissionOverTime = new ConstantValue(0)` + `ps.looping = false`；
 * 若阶段 B 证实不够（burst 已入队 / waitEmiting 有余量），再提接口——不许静默换方案。
 */
export interface PtEmitBudget {
  /** 已生成粒子数（含 burst） */
  readonly emitted: number;
  /** 预算 = Loops × NumParticles（Loops<=0 = 不限，行 [6]） */
  readonly budget: number;
  /** 每帧调用：记账 + 到预算停发 */
  frameUpdate(delta: number, rate: number): void;
}

/* ─────────── 行 [16]-[19]/[21]：rotation 写者分配（每类型一个写者） ─────────── */

export type PtFaceType = 'TYPE_ONE' | 'TYPE_TWO' | 'TYPE_THREE' | 'TYPE_FOUR' | 'TYPE_FIVE';

/**
 * §G1/行 [21]：rotation 的写者按 ParticleType 二选一，绝并存即违规。
 * FOUR 不写 rotation（LocalAngle 在进位置缓冲前旋转，行 [19]）。
 */
export const ROTATION_WRITER_BY_TYPE: Record<PtFaceType, string> = {
  TYPE_ONE: 'PtCameraFacingSpin（相机基底 × Rx·Ry·Rz）',
  TYPE_TWO: '固定世界朝向（Ry·Rx(-90°)，行 [17]）',
  TYPE_THREE: 'PtAxialBandOrientation（相机基底 × Rz(屏幕面内角)，行 [18]）',
  TYPE_FOUR: '无（Trail 不承载横截面朝向）',
  TYPE_FIVE: 'MeshRandomOrientation + OrientVelocityToNormal（行 [22]）',
};

/* ─────────── §G1 字段所有权（校验 6 的对照表） ─────────── */

export interface FieldOwner {
  field: string;
  owner: string;
  /** 允许的第二写者及其模式（必须在此显式声明，否则 verify-quarks-map 报抢字段） */
  coOwners?: Array<{ owner: string; mode: string }>;
}

export const FIELD_OWNERS: FieldOwner[] = [
  { field: 'particle.position', owner: 'quarks（形状出生 + position += velocity·dt）' },
  {
    field: 'particle.velocity',
    owner: '形状（出生，行 [8]）',
    coOwners: [
      { owner: 'PtGravityBehavior（行 [7]）', mode: '加法（重力）' },
      { owner: 'OrientVelocityToNormal（行 [22]，TYPE_FIVE）', mode: '逐帧重设' },
      { owner: '向量轨 VelocityTrack / TRANSLATION（行 [30]）', mode: '覆盖式（绝对速度）' },
    ],
  },
  {
    field: 'particle.rotation',
    owner: '按 ParticleType 二选一（ROTATION_WRITER_BY_TYPE）',
    coOwners: [
      { owner: 'TYPE_ONE（行 [16]）', mode: '按类型互斥' },
      { owner: 'TYPE_TWO（行 [17]）', mode: '按类型互斥' },
      { owner: 'TYPE_THREE（行 [18]）', mode: '按类型互斥' },
      { owner: 'TYPE_FIVE（行 [22]，两行为=初值+逐帧）', mode: '按类型互斥' },
    ],
  },
  {
    field: 'particle.size',
    owner: 'SizeOverLife（quarks）',
    coOwners: [{ owner: 'PtSizeBehavior（行 [20]）', mode: '替代（二选一）' }],
  },
  { field: 'particle.color', owner: 'ColorOverLife（quarks；startColor 恒白当乘法单位元，行 [L4]）' },
  { field: 'particle.age/life', owner: 'quarks（startLife 出生掷 + age += dt + died 判死，行 [9]）' },
  { field: 'particle.memory', owner: 'PtClockBehavior 块（行 [2]）+ 各生成器槽位（IntervalValue 协议，行 [5]）' },
];

/* ─────────── 行 [6]：发射预算算术（照 [S1] 尾部，供 B5 直接实现） ─────────── */

/**
 * 一帧的发射数（照 [S1] h:1275-1287 逐字算术）：
 * ```
 * rate = EmitRate.GetRandomNumInRange()        ← 逐帧掷
 * n = int(rate·dt)
 * excess += rate·dt − n；excess > 1 ⇒ n += int(excess)；excess -= int(excess)
 * 若 Loops>0 且 TotalLives + n > Loops×NumParticles ⇒ n = 预算 − TotalLives（夹断）
 * ```
 */
export interface EmitFrameResult {
  count: number;
  excess: number;
}

export function emitFrame(rate: number, dt: number, excessIn: number, budgetLeft: number): EmitFrameResult {
  let n = Math.trunc(rate * dt);
  let excess = excessIn + (rate * dt - n);
  if (excess > 1) {
    n += Math.trunc(excess);
    excess -= Math.trunc(excess);
  }
  if (budgetLeft >= 0 && n > budgetLeft) n = Math.max(0, budgetLeft);
  return { count: n, excess };
}
