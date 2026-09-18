/**
 * ⚠ **当前不接入运行时**（用户 2026-09-18 定调）：它是**自持生命周期**的状态机
 * （自己推进 position/velocity/size/color/rotation），等于在 quarks 里塞第二套粒子系统
 * ⇒ 必然与 quarks 抢字段（实测连栽三次：世界原点、拖尾塌陷、长条方向固定）。
 * **保留原因**：它的算术是照 C++ 逐行搬运并用 `verify-pt-timeline` 的**手算期望值**钉住的，
 * 是"语义正确"的参照；`eventtimer`/阶跃重瞄准/逐粒子掷这些**必须补**的语义都在这里，
 * 下一步按 **quarks 插件形态**（`FunctionValueGenerator` / `Behavior`，逐粒子状态放
 * `particle.memory`）重写，而不是继续用这套自持生命周期。
 *
 * PT 粒子状态机（**`.part` 与 Lua 共用**）—— 纯逻辑，不碰 three/quarks。
 *
 * 逐行搬运自 C++（`NewSourcePT-2023/SrcGame/src/HoBaram/`）：
 *   · 每粒子每帧：`HoNewParticle::Main`（`HoNewParticle.h:814-936`）
 *   · 序列每帧：  `HoNewParticleEventSequence::Main`（`:1222-1320`）
 *   · 事件触发：  `RunEvents`（`:1340-1362`）
 *   · 事件生效：  各 `HoNewParticleEvent_*::DoItToIt`（`HoNewParticle.cpp:140-700`）
 *   · 创建：      `CreateNewParticle`（`:1172`）
 * 规格说明与每一条的出处见 `docs/PT粒子系统-规格说明书.md` §B。
 *
 * **为什么自持**：原版的推进是 `X += XStep·dt`（线性步进）+ 双时钟（`Age`/`EventTimer`），
 * 而 `XStep` 是在事件**触发那一刻**用"当前值 → 下一条 fade 事件的值"重算的 ⇒
 * 按键帧插值（曲线）表达不了（中间夹非 fade 事件时会重新瞄准）。
 *
 * 时间单位：秒（原版 `timeDelta = 1.f/70.f`，`HoEffect.cpp:12795`）。
 */

import type { Num, Vec3 } from './pt-value.js';

/** 事件能写的"字段组"（对应 C++ 里 `part` 的那些成员） */
export type PtGroup = 'size' | 'sizeExt' | 'color' | 'dir' | 'partAngle' | 'localAngle';
export const PT_GROUPS: PtGroup[] = ['size', 'sizeExt', 'color', 'dir', 'partAngle', 'localAngle'];
/** 每组的份量数：size/sizeExt 各 1；color 4（rgba）；dir/partAngle/localAngle 各 3 */
export const PT_ARITY: Record<PtGroup, number> = {
  size: 1, sizeExt: 1, color: 4, dir: 3, partAngle: 3, localAngle: 3,
};

/**
 * 事件的"槽"= 组 + 分量（`comp = -1` = 整组，对应 `partangle = XYZ(...)` 那种一次写三轴）。
 * 与 C++ 的 `EventID`（`HoNewParticle.h:24-45`）一一对应：`partanglex` 只写 `.x`、
 * `partangle` 写 `.xyz`；fade 链只把**同一槽**的事件串起来（`CreateFadeLists` `:1506`）。
 */
export type PtSlot =
  | 'size' | 'sizeExt' | 'eventTimer'
  | 'color' | 'colorR' | 'colorG' | 'colorB' | 'colorA'
  | 'dir' | 'dirX' | 'dirY' | 'dirZ'
  | 'partAngle' | 'partAngleX' | 'partAngleY' | 'partAngleZ'
  | 'localAngle' | 'localAngleX' | 'localAngleY' | 'localAngleZ';

export function slotOf(slot: PtSlot): { group: PtGroup | 'eventTimer'; comp: number } {
  const m: Record<string, [PtGroup | 'eventTimer', number]> = {
    size: ['size', -1], sizeExt: ['sizeExt', -1], eventTimer: ['eventTimer', 0],
    color: ['color', -1], colorR: ['color', 0], colorG: ['color', 1], colorB: ['color', 2], colorA: ['color', 3],
    dir: ['dir', -1], dirX: ['dir', 0], dirY: ['dir', 1], dirZ: ['dir', 2],
    partAngle: ['partAngle', -1], partAngleX: ['partAngle', 0], partAngleY: ['partAngle', 1], partAngleZ: ['partAngle', 2],
    localAngle: ['localAngle', -1], localAngleX: ['localAngle', 0], localAngleY: ['localAngle', 1], localAngleZ: ['localAngle', 2],
  };
  const hit = m[slot];
  if (!hit) throw new Error(`未知的事件槽：${slot}`);
  return { group: hit[0], comp: hit[1] };
}

/** 一条事件（= 原版一个 `HoNewParticleEvent*` 实例） */
export interface PtEvent {
  /** 事件时间（秒；原版 `ActualTime`，装载期由 `NailDownRandomTimes` 定一次） */
  time: number;
  slot: PtSlot;
  /** `fade so` ⇒ true（渐变目标）；裸 `at` ⇒ false（到点直接赋值，阶跃） */
  fade: boolean;
  /** 值（定值或区间）：份量数由 slot 所属组决定 */
  value: Num[];
  /**
   * fade 链：**同槽**的下一条 fade 事件下标（-1 = 无）。装载期算好，等价 `CreateFadeLists`。
   * ⇒ 斜坡 = "本条事件触发时的当前值 → next 的值"，除以两者时间差（见 `applyEvent`）。
   */
  next: number;
  /** `velocity = outlength|inlength XYZ(...)`：沿出生点径向向外/向内（`HoNewParticle.cpp:165-171`、`:602-620`） */
  radial?: 'out' | 'in';
}

export interface PtTimelineCfg {
  /** 寿命（秒；区间 ⇒ 逐粒子掷） */
  lifetime: Num;
  /** 出生位置偏移盒：各轴独立随机（`CreateNewParticle`） */
  emitRadius: Vec3;
  /** 重力：**逐粒子逐帧重掷**后 `dir += g·dt`（`HoNewParticle.h:1256`） */
  gravity: Vec3;
  /** 事件表（按 time 升序；`initial X` 是 time = 0 的事件） */
  events: PtEvent[];
}

export interface PtState {
  /** 寿命（创建时掷） */
  life: number;
  /** 事件时钟（原版 `EventTimer`）：与 Age 各自累加，**事件判据用它** */
  eventTimer: number;
  /** 位置（原版 `LocalPos`，发射器局部空间；创建时 = 发射半径盒内一点） */
  pos: number[];
  /**
   * **出生时的世界坐标**（原版 `WorldPos`）——由渲染侧在创建时捕获（quarks 把发射器世界坐标
   * 烘进出生位置）。原版**只在 `attachPosFlag` 时逐帧更新**它（`HoNewParticle.h:1232`）
   * ⇒ 默认"冻在出生点"：发射器飞走、老粒子留在原地 ⇒ **尾迹**（陨石拖尾就是这个）。
   */
  base: number[];
  /** 当前值（每组 `PT_ARITY` 个分量） */
  val: Record<PtGroup, number[]>;
  /** 每分量步长（原版 `XxxStep`） */
  step: Record<PtGroup, number[]>;
  /** 事件游标（原版 `CurrentEvent`） */
  cursor: number;
}

export type Rand = () => number;

/** 掷一个 `Num`（区间 ⇒ 均匀取；原版 `GetRandomNumInRange`） */
export function roll(n: Num, rand: Rand): number {
  return n.k === 'n' ? n.v : n.a + rand() * (n.b - n.a);
}

/** 原版 `HoNewParticle()` 构造的初值（`HoNewParticle.h:712-780`）：size 1、sizeExt 0、color 255、其余 0 */
export function defaultValues(): Record<PtGroup, number[]> {
  return {
    size: [1], sizeExt: [0],
    color: [255, 255, 255, 255],
    dir: [0, 0, 0], partAngle: [0, 0, 0], localAngle: [0, 0, 0],
  };
}

/** 创建粒子状态 —— 等价 `CreateNewParticle`：掷寿命、出生点、跑 `ActualTime == 0` 的事件 */
export function createState(cfg: PtTimelineCfg, rand: Rand): PtState {
  const st: PtState = {
    life: roll(cfg.lifetime, rand),
    eventTimer: 0,
    pos: [roll(cfg.emitRadius.x, rand), roll(cfg.emitRadius.y, rand), roll(cfg.emitRadius.z, rand)],
    base: [0, 0, 0],
    val: defaultValues(),
    step: { size: [0], sizeExt: [0], color: [0, 0, 0, 0], dir: [0, 0, 0], partAngle: [0, 0, 0], localAngle: [0, 0, 0] },
    cursor: 0,
  };
  // C++：`for (i = Events.begin(); i != Events.end() && !(*i)->GetActualTime(); i++) (*i)->DoItToIt(*part);`
  let i = 0;
  while (i < cfg.events.length && cfg.events[i]!.time === 0) { applyEvent(cfg, st, cfg.events[i]!, rand); i++; }
  st.cursor = i;
  return st;
}

/**
 * 一条事件生效 —— 照抄各 `HoNewParticleEvent_*::DoItToIt`：
 * ```
 * 非 fade：part.X = 掷值                       （radial 时按 Flag 分支：沿 LocalPos 径向）
 * fade   ：不动 part.X
 * 有 next：part.XStep = (next 的掷值 − part.X) / (next.time − time)     // 分母 0 → 1
 * ```
 * ⚠ 掷值发生在**本条事件触发的那一刻**（含"给 next 掷"）—— 原版就是这样。
 */
export function applyEvent(cfg: PtTimelineCfg, st: PtState, ev: PtEvent, rand: Rand): void {
  const { group, comp } = slotOf(ev.slot);
  if (group === 'eventTimer') {
    st.eventTimer = roll(ev.value[0]!, rand);      // `part.EventTimer = EventTimer.GetRandomNumInRange()`
    return;
  }
  if (!ev.fade) {
    // 非 fade：到点直接赋值
    const vals = ev.value.map((n) => roll(n, rand));
    if (ev.radial && group === 'dir') {
      // `velocity = outlength|inlength XYZ(...)`：大小取第一分量，方向沿"出生点 → 当前位置"
      const mag = vals[0]!;
      const len = Math.hypot(st.pos[0]!, st.pos[1]!, st.pos[2]!) || 1;
      const s = ev.radial === 'out' ? 1 : -1;
      st.val.dir[0] = (st.pos[0]! / len) * mag * s;
      st.val.dir[1] = (st.pos[1]! / len) * mag * s;
      st.val.dir[2] = (st.pos[2]! / len) * mag * s;
    } else if (comp < 0) {
      // 整组事件（`partangle = XYZ(...)`）：值数组 = 全部分量
      for (let i = 0; i < vals.length; i++) st.val[group]![i] = vals[i]!;
    } else {
      // 单分量事件（`partanglez = …` / `velocityx = …`）：值数组**只有 1 个元素**（它的载荷）
      st.val[group]![comp] = vals[0]!;
    }
  }
  if (ev.next < 0) return;
  const nx = cfg.events[ev.next]!;
  let delta = nx.time - ev.time;
  if (delta === 0) delta = 1;
  const target = nx.value.map((n) => roll(n, rand));
  if (comp < 0) {
    for (let i = 0; i < PT_ARITY[group]!; i++) st.step[group]![i] = ((target[i] ?? 0) - st.val[group]![i]!) / delta;
  } else {
    // 同上：单分量事件的载荷在 `[0]`
    st.step[group]![comp] = (target[0]! - st.val[group]![comp]!) / delta;
  }
}

/** 触发所有到点的事件 —— 照抄 `RunEvents`（含 `EventTimer` 跳变后的**游标重扫**） */
export function runEvents(cfg: PtTimelineCfg, st: PtState, rand: Rand): void {
  let i = st.cursor;
  const evs = cfg.events;
  while (i < evs.length && evs[i]!.time <= st.eventTimer) {
    const ev = evs[i]!;
    const before = st.eventTimer;
    applyEvent(cfg, st, ev, rand);
    if (st.eventTimer !== before) {
      // `EventTimer` 被事件改了（只有 eventtimer 事件会）⇒ 从表头重扫到第一条 >= 新时间的位置。
      // 语义：让这套事件对该粒子从头再走一遍（`HoNewParticle.h:1348-1360`）。
      let k = 0;
      while (k < evs.length && evs[k]!.time < st.eventTimer) k++;
      i = k - 1;
    }
    i++;
  }
  st.cursor = i;
}

/**
 * 推进**一帧**（对应"序列每帧"里对单个粒子做的那一串）：
 * ```
 * 各 Step 推进 → （此处位置积分用推进前的 dir）→ 重力（逐粒子逐帧重掷）→ 运行事件
 * ```
 * @returns 本帧用于**位置积分**的 dir（重力/事件生效前的值 —— 与 C++ 的先后一致）
 */
export function stepFrame(cfg: PtTimelineCfg, st: PtState, dt: number, rand: Rand): number[] {
  st.eventTimer += dt;
  // `LocalPos += Dir·dt` 用**本帧积分前**的 dir（原版顺序：Main 里先积分位置、后加重力/跑事件）
  const dirForMotion = [st.val.dir[0]!, st.val.dir[1]!, st.val.dir[2]!];
  for (const g of PT_GROUPS) {
    for (let i = 0; i < PT_ARITY[g]!; i++) st.val[g]![i] = st.val[g]![i]! + st.step[g]![i]! * dt;
  }
  // 重力：逐粒子逐帧重掷（原版就在这个位置，`HoNewParticle.h:1256`）
  st.val.dir[0] = st.val.dir[0]! + roll(cfg.gravity.x, rand) * dt;
  st.val.dir[1] = st.val.dir[1]! + roll(cfg.gravity.y, rand) * dt;
  st.val.dir[2] = st.val.dir[2]! + roll(cfg.gravity.z, rand) * dt;
  runEvents(cfg, st, rand);
  // 位置积分放在最后（我们的调用方在 update 之后把 dirForMotion 交给渲染侧积分）
  st.pos[0] = st.pos[0]! + dirForMotion[0]! * dt;
  st.pos[1] = st.pos[1]! + dirForMotion[1]! * dt;
  st.pos[2] = st.pos[2]! + dirForMotion[2]! * dt;
  return dirForMotion;
}

/**
 * 面片尺寸 —— 照抄 `HoNewParticle.cpp:3090-3180`：
 * ```
 * width = height = Size;   if (SizeExt != 0) height = SizeExt
 * ```
 * ⇒ `SizeExt == 0` 时高度**回落** `Size`（不是 0）。
 */
export function quadSize(st: PtState): { w: number; h: number } {
  const w = st.val.size[0]!;
  const e = st.val.sizeExt[0]!;
  return { w, h: e !== 0 ? e : w };
}

/** 从 IR 的 keyframes/端点构造事件表，并算好 fade 链（等价 `SortEvents` + `CreateFadeLists`） */
export function buildEvents(raw: PtEvent[]): PtEvent[] {
  const evs = [...raw].sort((a, b) => a.time - b.time);
  // CreateFadeLists：对每条事件向后找**第一条 IsFade 且同槽**的事件
  for (let i = 0; i < evs.length; i++) {
    evs[i]!.next = -1;
    for (let j = i + 1; j < evs.length; j++) {
      if (evs[j]!.fade && evs[j]!.slot === evs[i]!.slot) { evs[i]!.next = j; break; }
    }
  }
  return evs;
}
