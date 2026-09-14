/**
 * 帧内分段耗时剖析器（**唯一实现**：WorldView 只插桩，不自己算耗时）。
 *
 * 为什么要它（用户 2026-09-14）：怪物暴增时 FPS 掉到 20，而浏览器 devtools 的 Performance
 * 面板对不熟悉的人门槛太高；现有统计面板又只统计**地图渲染器自报的** draw call / 三角形，
 * 看不见怪物、名牌、飘字、特效这些"随实体数量增长"的开销。于是需要一个**游戏内建**、
 * 能一眼看出"这一帧的时间花在哪一段"的剖析器。
 *
 * 用法（调用方）：帧起始 `frameStart()` → 每个阶段结束处 `mark('阶段名')` → 帧末 `frameEnd()`。
 * `mark` 记的是"自上一个 mark 起"的耗时，所以**调用顺序即阶段顺序**，名称由调用方给；
 * 每帧必须把每个 mark **无条件**调一遍（阶段里没干活也要调），否则后续名称会错位。
 *
 * 设计约束（避免剖析器自己成为瓶颈）：
 *  - 热路径只有 `performance.now()` + `Map.get` + 两次加法，每帧十余次，合计 < 10µs；
 *  - 热路径不拼字符串、不建对象（报告只在读取那一刻构造）；
 *  - `setPerfEnabled(false)` 之后 `frameStart`/`mark`/`frameEnd` 立即返回。
 * 场景侧的"有多少个"（怪物数、draw call、三角形…）由调用方 `setCounter` 喂进来。
 *
 * 读法：`jsMs` 是本帧 JS 干活的总时间，`otherMs = frameMs - jsMs` 是**非 JS** 的部分
 * （GPU 提交后的等待、浏览器合成、被系统抢占）。若 otherMs 很大而 jsMs 很小，说明瓶颈不在
 * 我们的 JS 里；反之看 sections 里谁最大。
 */

/** 单个阶段在窗口内的统计 */
export interface SectionStat {
  name: string;
  /** 窗口内平均耗时（ms/帧） */
  avgMs: number;
  /** 窗口内峰值（ms） */
  maxMs: number;
  /** 占本帧 JS 总时间的比例（0~1） */
  share: number;
}

export interface PerfReport {
  /** 本窗口统计了多少帧 */
  windowFrames: number;
  /** 实际帧率（由相邻两帧起始时刻之差算得；被限帧时即目标帧率） */
  fps: number;
  /** 每帧总时长（ms） */
  frameMs: number;
  /** 其中 JS 各阶段之和（ms） */
  jsMs: number;
  /** 非 JS 部分 = frameMs - jsMs（ms） */
  otherMs: number;
  /** 按平均耗时降序 */
  sections: SectionStat[];
  /** 场景侧计数器的当前值（瞬时，不清零） */
  counters: Record<string, number>;
}

let enabled = true;
let frameBegin = 0;
let lastMark = 0;
let prevFrameBegin = 0;
let lastFrameDelta = 0;
let frames = 0;
let windowFrameMs = 0;
let windowJsMs = 0;
let windowStartAt = 0;

const acc = new Map<string, { sum: number; max: number }>();
const counters = new Map<string, number>();

/** 统计窗口长度：满了自动滚动。有它才能让**多个消费者**（状态栏摘要 + 剖析面板）读同一份
 *  数字而互不干扰 —— 若靠"读一次就清零"，先读的那个会把窗口掏空，另一个看到的是碎数据。 */
const WINDOW_MS = 1000;

// ─────────── 逐帧历史（时间轴控件的数据源）───────────
/**
 * 每帧存一份"帧总时长 + JS 时长 + 各阶段耗时 + 实体数"，供时间轴画出每帧一根柱。
 * 用**预分配的环形缓冲**（不是普通数组）：只在初始化时分配一次，之后每帧只写若干个
 * Float32 槽位 —— 采样本身不会变成新的 GC 压力（GL 剖析器把自己变成瓶颈就没意义了）。
 */
const MAX_STAGES = 32;
/** 900 帧 ≈ 15s @60fps：够看清"走两步就被围住"的过程，柱子仍细到能分辨单帧 */
const RING = 900;

const stageIndex = new Map<string, number>();
const ringStage = new Float32Array(RING * MAX_STAGES);
const ringFrameMs = new Float32Array(RING);
const ringJsMs = new Float32Array(RING);
const ringEntities = new Float32Array(RING);
const ringSeq = new Int32Array(RING);
/** 当前帧各阶段耗时（帧末搬进环形缓冲并清零） */
const curStages = new Float32Array(MAX_STAGES);
let head = 0;
let totalFrames = 0;
let seqCounter = 0;

// 展平输出（模块级复用，避免每次读取都分配）
let flatStage = new Float32Array(RING * MAX_STAGES);
let flatFrameMs = new Float32Array(RING);
let flatJsMs = new Float32Array(RING);
let flatEntities = new Float32Array(RING);

/** 时间轴跟踪的实体计数器名（"怪物暴增 → 掉帧"要看的就是它） */
const TRACKED_COUNTER = '怪物';

export function setPerfEnabled(on: boolean): void {
  enabled = on;
  if (!on) { resetWindow(); clearHistory(); }
}

export function isPerfEnabled(): boolean {
  return enabled;
}

/** 帧起始（放在"确认这一帧真的要渲染"之后，限帧跳过的帧不参与统计） */
export function frameStart(): void {
  if (!enabled) return;
  const now = performance.now();
  lastFrameDelta = prevFrameBegin > 0 ? now - prevFrameBegin : 0;
  if (prevFrameBegin > 0) windowFrameMs += lastFrameDelta;
  prevFrameBegin = now;
  if (windowStartAt === 0) windowStartAt = now;
  frameBegin = now;
  lastMark = now;
}

/** 标记一个阶段的结束（= 上一 mark 到此刻的耗时记到 name 上） */
export function mark(name: string): void {
  if (!enabled) return;
  const now = performance.now();
  const dt = now - lastMark;
  lastMark = now;
  const a = acc.get(name);
  if (a === undefined) acc.set(name, { sum: dt, max: dt });
  else { a.sum += dt; if (dt > a.max) a.max = dt; }
  // 逐帧历史：同名阶段固定占一个槽位（索引按首次出现分配）
  let idx = stageIndex.get(name);
  if (idx === undefined) {
    if (stageIndex.size >= MAX_STAGES) return; // 阶段数超上限：只影响时间轴，不影响汇总
    idx = stageIndex.size;
    stageIndex.set(name, idx);
  }
  curStages[idx] += dt;
}

/** 帧末 */
export function frameEnd(): void {
  if (!enabled) return;
  const jsMs = performance.now() - frameBegin;
  windowJsMs += jsMs;
  frames++;
  // 写入环形缓冲（顺序：帧总时长 / JS / 各阶段 / 被跟踪的实体数）
  ringFrameMs[head] = lastFrameDelta;
  ringJsMs[head] = jsMs;
  ringStage.set(curStages, head * MAX_STAGES);
  ringEntities[head] = counters.get(TRACKED_COUNTER) ?? 0;
  ringSeq[head] = seqCounter++;
  head = (head + 1) % RING;
  totalFrames++;
  curStages.fill(0);
}

/** 场景侧计数器（瞬时值，不是累加） */
export function setCounter(name: string, value: number): void {
  if (!enabled) return;
  counters.set(name, value);
}

/** 时间轴数据（按时间先后展平；输出缓冲模块级复用，调用方不要长期持有） */
export interface FrameHistory {
  /** 有效采样帧数 */
  count: number;
  /** 环形缓冲容量（调用方按这个定柱子宽度，绘图时只用最后 count 个点） */
  capacity: number;
  frameMs: Float32Array;
  jsMs: Float32Array;
  /** 阶段耗时，第 i 帧第 s 段 = stageMs[i * stride + s]（stride 见下，不要假设等于 stageCount） */
  stageMs: Float32Array;
  stageNames: string[];
  stageCount: number;
  /** 每帧在 stageMs 里占的行宽（绘制方必须用它算下标，不要自己推） */
  stride: number;
  /** 每帧的"怪物"计数（时间轴上叠一条折线，用来把掉帧和实体数对上） */
  entities: Float32Array;
  /** 首帧序号（hover 显示帧号用） */
  firstSeq: number;
  /** 有效帧里的最大帧总时长（纵轴定标用） */
  maxFrameMs: number;
}

export function frameHistory(): FrameHistory {
  const n = Math.min(totalFrames, RING);
  const start = totalFrames < RING ? 0 : head;
  const sc = Math.max(1, stageIndex.size);
  let maxFrameMs = 0;
  for (let i = 0; i < n; i++) {
    const src = (start + i) % RING;
    flatFrameMs[i] = ringFrameMs[src];
    flatJsMs[i] = ringJsMs[src];
    flatEntities[i] = ringEntities[src];
    flatStage.set(ringStage.subarray(src * MAX_STAGES, src * MAX_STAGES + MAX_STAGES), i * MAX_STAGES);
    if (ringFrameMs[src] > maxFrameMs) maxFrameMs = ringFrameMs[src];
  }
  const stageNames: string[] = new Array(stageIndex.size);
  for (const [name, idx] of stageIndex) stageNames[idx] = name;
  return {
    count: n,
    capacity: RING,
    frameMs: flatFrameMs,
    jsMs: flatJsMs,
    stageMs: flatStage,
    stageNames,
    stageCount: sc,
    stride: MAX_STAGES,
    entities: flatEntities,
    firstSeq: n > 0 ? ringSeq[start] : 0,
    maxFrameMs,
  };
}

/** 清空逐帧历史（关掉剖析器时调：再打开不该看到上一次的旧波形） */
function clearHistory(): void {
  head = 0;
  totalFrames = 0;
  seqCounter = 0;
  curStages.fill(0);
}

// ─────────── 结构化导出（给"贴给 AI 排查"用）───────────
/**
 * 导出必须**自带完整上下文**，否则拿到一堆数字也不知道是什么场景下测的。
 * 布局选**列式**（每个阶段一个数组）：同样 900 帧，列式比"每帧一个对象"小一个数量级
 * ——用户在聊天里贴得动，我也能一眼看出某阶段的时间序列。
 */
export interface PerfExport {
  generatedAt: string;
  /** 调用方补的环境信息（视口/DPR/UA/地图…），剖析器自身零 DOM 拿不到 */
  meta: Record<string, unknown>;
  summary: PerfReport;
  history: {
    /** 采样帧数（时间顺序，最后一个是当前帧） */
    count: number;
    /** 首帧序号 */
    firstSeq: number;
    /** 每帧总时长 ms（2 位小数） */
    frameMs: number[];
    jsMs: number[];
    /** 被跟踪的实体计数（怪物数），与 frameMs 同长 */
    entities: number[];
    /** 列式阶段耗时：stages[i] 对应 stageMs[阶段名][i] */
    stages: string[];
    stageMs: Record<string, number[]>;
  };
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export function buildExport(meta: Record<string, unknown>): PerfExport {
  const h = frameHistory();
  const frameMs: number[] = [];
  const jsMs: number[] = [];
  const entities: number[] = [];
  const stageMs: Record<string, number[]> = {};
  const stages = h.stageNames.slice(0, h.stageCount);
  for (const name of stages) stageMs[name] = [];
  for (let i = 0; i < h.count; i++) {
    frameMs.push(r2(h.frameMs[i]));
    jsMs.push(r2(h.jsMs[i]));
    entities.push(h.entities[i]);
    for (let s = 0; s < h.stageCount; s++) {
      const name = stages[s];
      if (name) stageMs[name].push(r2(h.stageMs[i * h.stride + s]));
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    meta,
    summary: report(),
    history: { count: h.count, firstSeq: h.firstSeq, frameMs, jsMs, entities, stages, stageMs },
  };
}

/** 一帧的"慢因"摘要 */
export interface SlowFrame {
  seq: number;
  frameMs: number;
  jsMs: number;
  entities: number;
  /** 该帧最贵的几个阶段（降序） */
  top: { name: string; ms: number }[];
}

/**
 * 最近窗口里最慢的若干帧（含那帧最贵的阶段）。
 *
 * 为什么需要：时间轴能看出"有尖刺"，但要靠鼠标一格一格扫才能知道那一帧贵在哪；
 * 掉帧现场（怪堆里）根本没空扫。这里直接把最慢的几帧连同"谁吃掉的"列出来 ——
 * 排查时第一眼看的就是这张短表。
 */
export function slowFrames(count = 5): SlowFrame[] {
  const n = Math.min(totalFrames, RING);
  if (n === 0) return [];
  const start = totalFrames < RING ? 0 : head;
  const stageCount = stageIndex.size;
  const names: string[] = new Array(stageCount);
  for (const [name, idx] of stageIndex) names[idx] = name;

  // 先只按 frameMs 选出最慢的 count 帧（900 帧排序 ≈ 0.1ms），
  // **再**对这几帧算阶段明细 —— 避免对全部帧都做一次阶段排序。
  const order: number[] = [];
  for (let i = 0; i < n; i++) order.push(i);
  order.sort((a, b) => ringFrameMs[(start + b) % RING]! - ringFrameMs[(start + a) % RING]!);

  const out: SlowFrame[] = [];
  for (const i of order.slice(0, Math.max(0, count))) {
    const src = (start + i) % RING;
    const row = src * MAX_STAGES;
    const top: { name: string; ms: number }[] = [];
    for (let s = 0; s < stageCount; s++) {
      const ms = ringStage[row + s]!;
      if (ms > 0.02) top.push({ name: names[s]!, ms });
    }
    top.sort((a, b) => b.ms - a.ms);
    out.push({
      seq: ringSeq[src]!,
      frameMs: ringFrameMs[src]!,
      jsMs: ringJsMs[src]!,
      entities: ringEntities[src]!,
      top: top.slice(0, 4),
    });
  }
  return out;
}

/**
 * 读取当前窗口的报告。
 * @param force 立即结束窗口（面板的"重开窗口"按钮用）；默认只在窗口满 `WINDOW_MS` 时滚动，
 *              否则返回同一份数字 —— 多个消费者（状态栏 / 面板）读到的是一致的，互不掏空。
 */
export function report(force = false): PerfReport {
  const now = performance.now();
  const snapshot = frames > 0 && (force || now - windowStartAt >= WINDOW_MS);
  const n = Math.max(1, frames);
  const frameMs = windowFrameMs / n;
  const jsMs = windowJsMs / n;
  const sections: SectionStat[] = [];
  for (const [name, a] of acc) {
    const avgMs = a.sum / n;
    sections.push({ name, avgMs, maxMs: a.max, share: jsMs > 0 ? avgMs / jsMs : 0 });
  }
  sections.sort((x, y) => y.avgMs - x.avgMs);
  const out: PerfReport = {
    windowFrames: frames,
    fps: frameMs > 0 ? 1000 / frameMs : 0,
    frameMs,
    jsMs,
    otherMs: Math.max(0, frameMs - jsMs),
    sections,
    counters: Object.fromEntries(counters),
  };
  if (snapshot) resetWindow(now);
  return out;
}

function resetWindow(now = performance.now()): void {
  frames = 0;
  windowFrameMs = 0;
  windowJsMs = 0;
  prevFrameBegin = 0;
  windowStartAt = now;
  for (const a of acc.values()) { a.sum = 0; a.max = 0; }
}

/** 阶段名（索引即 stageIdx，与时间轴列序一致） */
export function stageNameList(): string[] {
  const out: string[] = new Array(stageIndex.size);
  for (const [name, idx] of stageIndex) out[idx] = name;
  return out;
}

/**
 * 按**帧数**取最近 N 帧的汇总（面板用）。
 *
 * 与 `report()` 的差别：`report()` 是"时间窗口"（1s 滚动，刚滚动过只有几帧，数字会跳）；
 * 这个取固定帧数 —— 面板表格于是**和时间轴右侧的柱子完全同源**，看着对得上，也不跳。
 * 直接读环形缓冲，不经过展平（不重复拷贝）。
 */
export function summarizeRecent(maxFrames = 240): PerfReport {
  const count = Math.min(totalFrames, RING, maxFrames);
  const stageCount = stageIndex.size;
  let frameSum = 0, jsSum = 0;
  const sums = new Float64Array(stageCount);
  const maxes = new Float64Array(stageCount);
  const start = totalFrames < RING
    ? Math.max(0, totalFrames - count)
    : (head - count + RING) % RING;
  for (let i = 0; i < count; i++) {
    const src = (start + i) % RING;
    frameSum += ringFrameMs[src];
    jsSum += ringJsMs[src];
    const row = src * MAX_STAGES;
    for (let s = 0; s < stageCount; s++) {
      const v = ringStage[row + s];
      sums[s] += v;
      if (v > maxes[s]) maxes[s] = v;
    }
  }
  const denom = Math.max(1, count);
  const frameMs = frameSum / denom;
  const jsMs = jsSum / denom;
  const sections: SectionStat[] = [];
  for (const [name, idx] of stageIndex) {
    const avgMs = sums[idx] / denom;
    sections.push({ name, avgMs, maxMs: maxes[idx], share: jsMs > 0 ? avgMs / jsMs : 0 });
  }
  sections.sort((x, y) => y.avgMs - x.avgMs);
  return {
    windowFrames: count,
    fps: frameMs > 0 ? 1000 / frameMs : 0,
    frameMs,
    jsMs,
    otherMs: Math.max(0, frameMs - jsMs),
    sections,
    counters: Object.fromEntries(counters),
  };
}

/** 报告 → 可直接阅读/复制的文本（面板与 console 共用，避免两处各写一份排版） */
export function formatReport(r: PerfReport): string {
  const pad = (s: string, w: number) => (s.length >= w ? s : s + ' '.repeat(w - s.length));
  const padL = (s: string, w: number) => (s.length >= w ? s : ' '.repeat(w - s.length) + s);
  const num = (v: number, w = 8, d = 2) => padL(v.toFixed(d), w);

  const L: string[] = [];
  L.push(`FPS ${r.fps.toFixed(1)}  帧 ${r.frameMs.toFixed(1)}ms  JS ${r.jsMs.toFixed(1)}ms  `
    + `非JS ${r.otherMs.toFixed(1)}ms  （统计 ${r.windowFrames} 帧）`);
  L.push('');
  L.push(`${pad('阶段', 14)}${padL('平均ms', 9)}${padL('峰值ms', 9)}${padL('占JS', 7)}`);
  L.push('-'.repeat(40));
  for (const s of r.sections) {
    if (s.avgMs < 0.005) continue;
    L.push(`${pad(s.name, 14)}${num(s.avgMs, 9, 3)}${num(s.maxMs, 9, 3)}${padL((s.share * 100).toFixed(0) + '%', 7)}`);
  }
  const rest = r.jsMs - r.sections.reduce((a, s) => a + s.avgMs, 0);
  L.push(`${pad('（未插桩）', 14)}${num(Math.max(0, rest), 9, 3)}`);
  L.push('');
  const keys = Object.keys(r.counters);
  if (keys.length) {
    L.push('计数器（瞬时）');
    L.push('-'.repeat(40));
    for (const k of keys) L.push(`${pad(k, 18)}${r.counters[k].toLocaleString()}`);
  }
  return L.join('\n');
}
