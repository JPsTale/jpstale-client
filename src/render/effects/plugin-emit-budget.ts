/**
 * B5 发射预算插件（值时间层行 [6] 的实现）—— 依据冻结文档：
 *
 *   · 行 [6]：`Loops × NumParticles` 总预算 + `EmitRate` **逐帧掷** + 浮点零头 + 池满丢弃；
 *     quarks 是"速率/爆发"模型，无预算/池/停发接口 ⇒ 系统级行为记账 + 停发。
 *   · [S1] h:1275-1287 逐字算术：`n = int(rate·dt)`；`excess += rate·dt − n`；
 *     `excess > 1 ⇒ n += int(excess)`；`Loops>0 且 Total+n > Loops×NumParticles ⇒ n = 预算−Total`。
 *   · U-A1-1：quarks 无 `stopEmit` ⇒ 停发 = `emissionOverTime = ConstantValue(0)` + `looping = false`
 *     （首选机制；若阶段 B 证实不够——burst 已入队/waitEmiting 有余量——再提接口，不许静默换方案）。
 *   · 零头归属：quarks 自己的 `emissionState.waitEmiting` 就是零头累加（ParticleSystem.ts:1086）⇒
 *     本行为**不做二次零头**，只负责"逐帧掷 rate + 预算夹断"两件事，避免双重零头。
 *
 * 记账口径：`emitted` 由装配层注入的 `spawnedProbe` 提供（B6/B7 接线：监听系统生成或计数）——
 * 行为不假装自己知道 quarks 内部发了几个（那才是安静降级）。
 */
import type { Behavior, IParticleSystem, Particle } from 'quarks.core';
import { ConstantValue } from 'quarks.core';
import type { Num } from '../../core/effect/pt-value.js';
import type { Rand } from '../../core/effect/pt-timeline.js';
import { rollLazy } from './plugin-gravity.js';

/** 停发要写的系统句柄面（U-A1-1 的两个现有字段） */
export interface EmitStopHandle {
  emissionOverTime: { genValue: (memory: never, t: number) => number };
  looping: boolean;
}

export class PtEmitBudgetGate implements Behavior {
  type = 'PtEmitBudget';
  private stopped = false;

  constructor(
    /** 总预算 = Loops × NumParticles；<=0 = 不限（[S12]） */
    private readonly budget: number,
    /** EmitRate（定值或区间）——逐帧掷 */
    private readonly rate: Num,
    private readonly rand: Rand,
    /** 系统句柄（停发写这里） */
    private readonly handle: EmitStopHandle,
    /** 已生成数探针（装配层接线；返回值 = TotalParticleLives 口径） */
    private readonly spawnedProbe: () => number,
  ) {}

  initialize(_particle: Particle, _ps: IParticleSystem): void { /* 系统级：逐粒子入口不动 */ }

  update(_particle: Particle, _delta: number): void { /* 系统级：逐粒子入口不动 */ }

  /** 每帧：逐帧掷 rate → 写回 emissionOverTime；预算尽 ⇒ 停发（U-A1-1 机制） */
  frameUpdate(delta: number): void {
    if (this.stopped) return;
    const drawn = rollLazy(this.rate, this.rand);                 // 逐帧掷（[S1] h:1275）
    const emitted = this.spawnedProbe();
    if (this.budget > 0 && emitted >= this.budget) {
      this.handle.emissionOverTime = new ConstantValue(0);
      this.handle.looping = false;
      this.stopped = true;
      return;
    }
    const remaining = this.budget > 0 ? this.budget - emitted : Infinity;
    // 夹断到剩余预算：把本帧速率按"剩余/dt"封顶（发满即触发下一帧的停发分支）
    const capped = remaining < drawn * delta ? remaining / Math.max(delta, 1e-6) : drawn;
    this.handle.emissionOverTime = new ConstantValue(capped);
  }

  toJSON(): unknown { return { type: this.type, budget: this.budget }; }
  clone(): Behavior { return new PtEmitBudgetGate(this.budget, this.rate, this.rand, this.handle, this.spawnedProbe); }
  reset(): void { this.stopped = false; }
}

/**
 * 纯算术（照 [S1] h:1275-1287，含零头与夹断）—— 供不走 quarks 发射层的接线（B9 的 code spec）直接用；
 * quarks 路径的零头由 waitEmiting 承担（见文件头）。
 */
export function emitFrameArithmetic(
  rate: number, dt: number, excessIn: number, emitted: number, budget: number,
): { count: number; excess: number } {
  let n = Math.trunc(rate * dt);
  let excess = excessIn + (rate * dt - n);
  if (excess > 1) {
    n += Math.trunc(excess);
    excess -= Math.trunc(excess);
  }
  if (budget > 0 && emitted + n > budget) n = Math.max(0, budget - emitted);
  return { count: n, excess };
}
