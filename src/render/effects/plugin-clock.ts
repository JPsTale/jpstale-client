/**
 * B2 时钟与事件插件（值时间层行 [1]-[4] 的实现）—— 依据冻结文档：
 *
 *   · 行 [2]：非 fade 事件 = 到点赋值（触发时掷）；fade = Step 逐帧累加
 *   · 行 [3]：fade 链 + 重新瞄准（凡有 NextFadeEvent 一律重算 Step，含非 fade 事件）
 *   · 行 [4]：EventTimer 第二时钟 + 跳变重放（拨钟 + 游标重扫）
 *   · 行 [1]：装载三步（NailDown 定值 / 排序 / fade 链）+ 创建时跑 ActualTime==0 的事件
 *   · 行 [15]：每帧顺序 = 值步进 → 重力 → 事件；本行为实现"步进+事件"的容器，
 *     重力行为（plugin-gravity）须排在**本行为之前**（quarks 的 behaviors 按序执行）。
 *
 * 状态放 `particle.memory`（quarks 自带机制，`GeneratorMemory = any[]`）：块对象以
 * **带下标元素**的方式 push（`memory.length = 0` 的池重置会清掉它——不能用 expando 键，
 * 那在重置后残留）。块下标经共享的 `PtBlockLocator` 告知值生成器（plugin-value-gen）。
 *
 * 事件表输入 = pt-timeline 的 `PtEvent`（`.part` 与 Lua 共用的 IR，行 [25]），
 * 装载用 pt-timeline 的 `buildEvents`（排序 + fade 链，等价 `SortEvents`+`CreateFadeLists`）。
 */
import type { Behavior, IParticleSystem, GeneratorMemory, Particle } from 'quarks.core';
import {
  buildEvents, defaultValues, roll, slotOf,
  PT_ARITY, PT_GROUPS,
  type PtEvent, type PtGroup, type Rand,
} from '../../core/effect/pt-timeline.js';
import type { Num, Vec3 } from '../../core/effect/pt-value.js';

/** 行 [2]【映射】：一块逐粒子状态（镜像 C++ 的 EventTimer/CurrentEvent/Xxx/XxxStep 字段面） */
export interface PtMemoryBlock {
  clock: number;
  cursor: number;
  val: Record<PtGroup, number[]>;
  step: Record<PtGroup, number[]>;
}

/** 块下标的共享信箱：装配代码创建一份，PtClockBehavior 写、PtValueGen 读 */
export interface PtBlockLocator { index: number }

const zeros = (): Record<PtGroup, number[]> => ({
  size: [0], sizeExt: [0], color: [0, 0, 0, 0], dir: [0, 0, 0], partAngle: [0, 0, 0], localAngle: [0, 0, 0],
});

export function blockOf(memory: GeneratorMemory, locator: PtBlockLocator): PtMemoryBlock | null {
  return (locator.index >= 0 ? (memory[locator.index] as PtMemoryBlock | undefined) ?? null : null);
}

export class PtClockBehavior implements Behavior {
  type = 'PtClock';
  private readonly events: PtEvent[];
  private readonly locator: PtBlockLocator;
  private readonly rand: Rand;
  /** mutation/诊断缝：测试注入"跳过某些下标的赋值"（行 [2] 反例 A 的机器形态） */
  skipAssign?: Set<number>;

  constructor(events: PtEvent[], locator: PtBlockLocator, rand: Rand = Math.random) {
    this.events = buildEvents(events);
    this.locator = locator;
    this.rand = rand;
  }

  /** 行 [1]/[S11]：创建 —— 建块 + 跑 ActualTime==0 的事件（initial） */
  initialize(particle: Particle, _ps: IParticleSystem): void {
    const block: PtMemoryBlock = { clock: 0, cursor: 0, val: defaultValues(), step: zeros() };
    particle.memory.push(block);
    this.locator.index = particle.memory.length - 1;
    let i = 0;
    while (i < this.events.length && this.events[i]!.time === 0) { this.applyEvent(block, this.events[i]!, i); i++; }
    block.cursor = i;
  }

  /** 每帧：clock += delta → values += steps·delta → RunEvents（行 [15] 顺序；重力行为排在本行为前） */
  update(particle: Particle, delta: number): void {
    const block = blockOf(particle.memory, this.locator);
    if (!block) return;
    block.clock += delta;
    for (const g of PT_GROUPS) {
      for (let c = 0; c < PT_ARITY[g]!; c++) block.val[g]![c] = block.val[g]![c]! + block.step[g]![c]! * delta;
    }
    this.runEvents(block);
  }

  frameUpdate(_delta: number): void { /* 逐粒子在 update 里做 */ }

  /** 触发所有到点的事件 —— 照抄 RunEvents（含 eventtimer 拨钟后的游标重扫，行 [4]） */
  private runEvents(block: PtMemoryBlock): void {
    let i = block.cursor;
    // 触发判据带 1e-9 容差：clock 按 dt 累加有浮点漂移（49×(1/70) = 0.6999… < 0.7），
    // 数学语义 = "第 N 帧 clock = N·dt"——实现须符合冻结 oracle 的帧号表（r[B1-7] 期实测），
    // C++ 原码的漂移是浮点意外、非设计语义。
    while (i < this.events.length && this.events[i]!.time <= block.clock + 1e-9) {
      const before = block.clock;
      this.applyEvent(block, this.events[i]!, i);
      if (block.clock !== before) {
        let r = 0;
        while (r < this.events.length && this.events[r]!.time < block.clock) r++;
        i = r - 1;
      }
      i++;
    }
    block.cursor = i;
  }

  /** 照抄各 DoItToIt（行 [2]/[3]/[S5]/[S3]/[S10]）：非 fade 赋值（触发时掷）、fade 不赋值、
   *  凡有 next 一律重算 Step（Δt=0 → 1）；eventtimer 拨钟。 */
  private applyEvent(block: PtMemoryBlock, ev: PtEvent, idx: number): void {
    const { group, comp } = slotOf(ev.slot);
    if (group === 'eventTimer') {
      block.clock = roll(ev.value[0]!, this.rand);           // [S3]
      return;
    }
    const conflated = this.skipAssign?.has(idx) ?? false;
    if (!ev.fade && !conflated) {
      const vals = ev.value.map((n: Num) => roll(n, this.rand));
      if (ev.radial && group === 'dir') {
        // [S10]：outlength/inlength —— 大小取首分量，方向沿出生点径向（pt-timeline 同语义）
        const mag = vals[0]!;
        const len = Math.hypot(block.val.dir[0]!, block.val.dir[1]!, block.val.dir[2]!) || 1;
        const s = ev.radial === 'out' ? 1 : -1;
        block.val.dir[0] = (block.val.dir[0]! / len) * mag * s;
        block.val.dir[1] = (block.val.dir[1]! / len) * mag * s;
        block.val.dir[2] = (block.val.dir[2]! / len) * mag * s;
      } else if (comp < 0) {
        for (let c = 0; c < PT_ARITY[group]!; c++) block.val[group]![c] = vals[c] ?? 0;
      } else {
        block.val[group]![comp] = vals[0]!;
      }
    }
    if (ev.next < 0) return;                                   // fade 事件自己不赋值（行 [2]）
    const nx = this.events[ev.next]!;
    let delta = nx.time - ev.time;
    if (delta === 0) delta = 1;                                // [S5]：Δt=0 → 1
    const target = roll(nx.value[0]!, this.rand);
    if (comp < 0) {
      for (let c = 0; c < PT_ARITY[group]!; c++) {
        block.step[group]![c] = ((comp < 0 ? roll(nx.value[c] ?? { k: 'n', v: 0 }, this.rand) : target) - block.val[group]![c]!) / delta;
      }
    } else {
      block.step[group]![comp] = (target - block.val[group]![comp]!) / delta;
    }
  }

  /** 给 render 侧读的当前值（行 [20] 的 PtSizeBehavior 等通过 locator 取块） */
  static valueOf(memory: GeneratorMemory, locator: PtBlockLocator, group: PtGroup, comp: number): number | null {
    const b = blockOf(memory, locator);
    return b ? b.val[group]![comp]! : null;
  }

  toJSON(): unknown { return { type: this.type, events: this.events.length }; }
  clone(): Behavior { const c = new PtClockBehavior(this.events, this.locator, this.rand); c.skipAssign = this.skipAssign; return c; }
  reset(): void { /* 逐粒子状态在 memory 里，随池重置清空 */ }
}

/** 行 [8]/[11] 的出生几何输入（由装配层从 IR 提取；Vec3<Num> 同 pt-timeline.cfg） */
export type PtVec3Num = Vec3;
export type PtNum = Num;
