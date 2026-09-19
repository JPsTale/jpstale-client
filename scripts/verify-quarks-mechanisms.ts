/**
 * B1 校验器二：**机制核对**（对应 02-交付标准 §1.1 的校验 3/4/5）。
 *
 *   校验3  oracle 可复算  —— oracle.kind = ref 的行：用参照状态机（pt-timeline.ts）按冻结文档
 *                           第 5 栏的输入逐帧推进、断言探测点；kind = formula 的行：按注册的
 *                           算式求值断言；kind = hand 的行：本阶段只计数（B2-B5 实现落地后扩覆盖）。
 *   校验4  换输入仍成立   —— ref/formula 检查的输入就写在 quarks-map.json 里，改输入重跑即复核。
 *   校验5  mutation 变红  —— 机器化 mutation（注入后必须与 oracle 出现差异）：
 *                           行[2] 把裸 at 当 fade（不赋值）、行[3] fade 不重瞄、
 *                           行[4] 不重扫游标、行[7] 恒力中值、行[13] lamp 误用 Normal。
 *                           注入后跑同一探测点，值不变化 = 本行 mutation 无辨伪力 = 红。
 *
 * 参照状态机 = src/core/effect/pt-timeline.ts（逐行搬运自 C++，oracle=ref 的"ref"）。
 * 用法：`npx tsx scripts/verify-quarks-mechanisms.ts`
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const mapPath = resolve(here, '../src/render/effects/quarks-map.json');
const map = JSON.parse(readFileSync(mapPath, 'utf8')) as MapFile;

let fails = 0;
const ok = (name: string, pass: boolean, detail = ''): void => {
  if (!pass) fails++;
  console.log(`${pass ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

interface MapFile {
  rows: Array<{
    id: string; vol: string; kind: string;
    oracle: { kind: string; desc: string; check?: Check & Record<string, unknown> };
    mutation: { machine?: string | null; desc: string };
  }>;
}
type Num = number | [number, number];
interface Check {
  lifetime?: number;
  gravity?: [number | [number, number], number | [number, number], number | [number, number]];
  uSequence?: number[];
  events?: Array<{ time: number; slot: string; fade: boolean; value: Num[] }>;
  probes?: Array<{ frame: number; group: string; comp: number; expect: number }>;
  quadSize?: { w: number; h: number };
  inputs?: Record<string, unknown>;
  expect?: unknown;
}

/* ── 参照状态机的本地复刻（语义照 pt-timeline.ts；带 mutation 注入开关） ── */

const ARITY: Record<string, number> = { size: 1, sizeExt: 1, color: 4, dir: 3, partAngle: 3, localAngle: 3 };
const SLOT: Record<string, [string, number]> = {
  size: ['size', 0], sizeExt: ['sizeExt', 0], colorR: ['color', 0], colorG: ['color', 1],
  colorB: ['color', 2], colorA: ['color', 3], eventTimer: ['__clock', 0],
  dir: ['dir', 0], dirX: ['dir', 0], dirY: ['dir', 1], dirZ: ['dir', 2],
};

const roll = (n: Num, u: number): number => (typeof n === 'number' ? n : n[0]! + u * (n[1]! - n[0]!));

interface Ev { time: number; slot: string; fade: boolean; value: Num[]; next: number }
function buildEvents(raw: Ev[]): Ev[] {
  const evs = [...raw].sort((a, b) => a.time - b.time);
  for (let i = 0; i < evs.length; i++) {
    evs[i]!.next = -1;
    for (let j = i + 1; j < evs.length; j++) {
      if (evs[j]!.fade && evs[j]!.slot === evs[i]!.slot) { evs[i]!.next = j; break; }
    }
  }
  return evs;
}

interface RunOpts {
  /** mutation：把指定下标的事件当 fade 执行（触发不赋值，行[2] 反例 A） */
  skipAssign?: Set<number>;
  /** mutation：fade 事件触发时不重瞄（行[3] 反例） */
  noReAimOnFade?: boolean;
  /** mutation：eventtimer 拨钟后不重扫游标（行[4] 反例） */
  noRescan?: boolean;
  /** mutation：恒力（该轴不再重掷，行[7] 反例） */
  constForceY?: number;
  /** 探测：第 N 帧"事件生效前"的值（行[3] 的 38 vs 34 在事件前） */
  preEventAt?: number;
}

interface RunResult {
  post: Map<string, number>;
  preEvent: Map<string, number>;
}

function runTimeline(check: Check, opts: RunOpts): RunResult {
  const dt = 1 / 70;
  const us = [...(check.uSequence ?? [])];
  const rand = (): number => (us.length ? us.shift()! : 0.5);
  const g = check.gravity ?? [0, 0, 0];
  // ⚠ 惰性求值：C++ `RandomNumber(float)` 对 Min==Max 短路返回、**不消费 rand**（HoMinMax.cpp:6）——
  // 常量轴不得烧随机数，否则区间轴的 u 序列错位（实测踩过：行[7] 帧1 拿到 0.8）。
  const rollAxis = (n: number | [number, number], axis: number): number => {
    if (typeof n === 'number') return n;
    if (axis === 1 && opts.constForceY !== undefined) return opts.constForceY;
    return roll(n, rand());
  };
  const evs = buildEvents((check.events ?? []).map((e) => ({ ...e, next: -1 })));
  const val: Record<string, number[]> = {
    size: [1], sizeExt: [0], color: [255, 255, 255, 255], dir: [0, 0, 0], partAngle: [0, 0, 0], localAngle: [0, 0, 0],
  };
  const step: Record<string, number[]> = {
    size: [0], sizeExt: [0], color: [0, 0, 0, 0], dir: [0, 0, 0], partAngle: [0, 0, 0], localAngle: [0, 0, 0],
  };
  let clock = 0;
  let cursor = 0;
  const post = new Map<string, number>();
  const preEvent = new Map<string, number>();
  const grab = (key: string, grp: string, comp: number): void => {
    if (grp === '__clock') post.set(key, clock);
    else post.set(key, val[grp]![comp]!);
  };

  const applyEvent = (ev: Ev, idx: number): void => {
    const [grp, comp] = SLOT[ev.slot]!;
    if (grp === '__clock') { clock = roll(ev.value[0]!, rand()); return; }
    const conflated = opts.skipAssign?.has(idx) ?? false;
    if (!ev.fade && !conflated) {
      const v = roll(ev.value[0]!, rand());
      val[grp]![comp] = v;
    }
    if (ev.next < 0) return;
    if (ev.fade && opts.noReAimOnFade) return;
    const nx = evs[ev.next]!;
    let delta = nx.time - ev.time;
    if (delta === 0) delta = 1;
    const cur = val[grp]![comp]!;
    step[grp]![comp] = (roll(nx.value[0]!, rand()) - cur) / delta;
  };

  // 创建（CreateNewParticle）：跑 ActualTime==0 的事件
  let i = 0;
  while (i < evs.length && evs[i]!.time === 0) { applyEvent(evs[i]!, i); i++; }
  cursor = i;

  const frames = Math.max(
    ...(check.probes ?? []).map((p) => p.frame),
    opts.preEventAt ?? 0,
  );
  for (let f = 1; f <= frames; f++) {
    clock += dt;
    for (const g of Object.keys(step)) for (let c = 0; c < step[g]!.length; c++) val[g]![c] = val[g]![c]! + step[g]![c]! * dt;
    val.dir![0] = val.dir![0]! + rollAxis(g[0] as number, 0) * dt;
    val.dir![1] = val.dir![1]! + rollAxis(g[1] as number, 1) * dt;
    val.dir![2] = val.dir![2]! + rollAxis(g[2] as number, 2) * dt;
    if (f === opts.preEventAt) {
      for (const [key, v] of post) { /* 保留 post 快照 */ }
      // 记录"事件生效前"的值（行[3] 反例的探测点）
      for (const p of check.probes ?? []) {
        const [grp, comp] = SLOT[p.slot] ?? [p.group, p.comp];
        preEvent.set(`f${f}:${p.group}:${p.comp}`, grp === '__clock' ? clock : val[p.group]![p.comp]!);
      }
    }
    let k = cursor;
    // 触发判据带 1e-9 容差：clock 按 dt 累加有浮点漂移（49×(1/70) = 0.6999…< 0.7），
    // 数学语义是"第 N 帧 clock = N·dt"（冻结文档的帧号即此口径）
    while (k < evs.length && evs[k]!.time <= clock + 1e-9) {
      const before = clock;
      applyEvent(evs[k]!, k);
      if (clock !== before && !opts.noRescan) {
        let r = 0;
        while (r < evs.length && evs[r]!.time < clock) r++;
        k = r - 1;
      }
      k++;
    }
    cursor = k;
    for (const p of check.probes ?? []) {
      if (p.frame === f) {
        const [grp, comp] = SLOT[p.slot] ?? [p.group, p.comp];
        grab(`f${f}:${p.group}:${p.comp}`, grp, comp);
      }
    }
  }
  // 兼容 probe 用 group 直接指组名（size/dir/color）的写法
  for (const p of check.probes ?? []) {
    const key = `f${p.frame}:${p.group}:${p.comp}`;
    if (!post.has(key)) {
      const [grp, comp] = SLOT[p.slot ?? p.group] ?? [p.group, p.comp];
      grab(key, grp, comp);
    }
  }
  return { post, preEvent };
}

const probeKey = (p: { frame: number; group: string; comp: number }): string => `f${p.frame}:${p.group}:${p.comp}`;
const near = (a: number, b: number, tol = 1e-3): boolean => Math.abs(a - b) <= tol;

/* ── formula 求值器（按 id 注册；输入/期望取自 quarks-map.json 的 oracle.check） ── */
const FORMULAS: Record<string, (inputs: Record<string, unknown>) => unknown> = {
  '1': (x) => (x.min as number) + (x.u as number) * ((x.max as number) - (x.min as number)),
  '5': (x) => (x.min as number) + (x.u as number) * ((x.max as number) - (x.min as number)),
  '6': (x) => Math.trunc((x.rate as number) * (x.dt as number)),
  '8': (x) => {
    const mins = x.mins as number[]; const maxs = x.maxs as number[]; const u = x.u as number[];
    return mins.map((m, i) => m + u[i]! * (maxs[i]! - m));
  },
  '9': (x) => {
    const life = (x.min as number) + (x.u as number) * ((x.max as number) - (x.min as number));
    return Math.round(life * 70);
  },
  '13': (x) => {
    const src = x.src as number; const a = x.alpha as number; const dst = x.dst as number;
    return { lamp: src * a + dst * 1, alpha: src * a + dst * (1 - a) };
  },
  '14': (x) => (x.noise as number) * (x.noise as number),
  '15': (x) => {
    const frames = Math.round((x.life as number) * 70);
    return { original: frames - 1, quarks: frames };
  },
  '16': (x) => {
    const z = ((x.z as number) * Math.PI) / 180; const w = x.w as number; const h = x.h as number;
    return [w * Math.cos(z) - h * Math.sin(z), w * Math.sin(z) + h * Math.cos(z)];
  },
  '22': (x) => {
    const [a, b, fps] = x.spinConst as number[];
    return ((a / b) * Math.PI * 2 * fps);
  },
  L16: (x) => (x.zMin as number) + (x.u as number) * ((x.zMax as number) - (x.zMin as number)),
};

/* ── 主流程 ── */
const rows = new Map(map.rows.map((r) => [r.id, r]));
let refChecked = 0; let formulaChecked = 0; let handRows = 0; let mutationsRun = 0;

console.log('校验3/4 oracle 可复算（ref = pt-timeline 参照 / formula = 算式）');
for (const r of map.rows) {
  const c = r.oracle.check;
  if (r.oracle.kind === 'ref' && c) {
    const res = runTimeline(c, {});
    let pass = true; let detail = '';
    for (const p of c.probes ?? []) {
      const got = res.post.get(probeKey(p));
      if (got === undefined || !near(got, p.expect)) { pass = false; detail += ` ${p.group}@帧${p.frame}: 期望 ${p.expect} 实际 ${got}`; }
    }
    if (c.quadSize) {
      // 行[20]：size=10/sizeExt=0 ⇒ 回落 (10,10)——由探测点 sizeExt=0 与 oracle.desc 共同锁定
      const e = res.post.get('f10:sizeExt:0');
      if (e === undefined || e !== 0) { pass = false; detail += ' sizeExt 应为 0（回落前提）'; }
    }
    refChecked++;
    ok(`${r.id}（ref）`, pass, detail || `${c.probes?.length ?? 0} 个探测点`);
  } else if (r.oracle.kind === 'formula' && c && FORMULAS[r.id]) {
    const got = FORMULAS[r.id]!(c.inputs ?? {});
    const want = c.expect;
    const same = Array.isArray(got) && Array.isArray(want)
      ? got.length === want.length && got.every((v, i) => near(v as number, want[i] as number, 1e-3))
      : JSON.stringify(got) === JSON.stringify(want)
        || (typeof got === 'number' && typeof want === 'number' && near(got, want, 1e-3));
    formulaChecked++;
    ok(`${r.id}（formula）`, same, `期望 ${JSON.stringify(want)} 实际 ${JSON.stringify(got)}`);
  } else if (r.oracle.kind === 'hand') {
    handRows++;
  }
}
console.log(`  · 覆盖：ref ${refChecked} + formula ${formulaChecked} = ${refChecked + formulaChecked} 行机器复算；hand ${handRows} 行文档锚定（B2-B5 实现落地后扩覆盖）`);

console.log('校验5 mutation 注入变红（机器化的五条；其余为文档锚定）');
const expectNum = (id: string, frame: number, group: string, comp: number): number => {
  const r = rows.get(id)!;
  const p = r.oracle.check!.probes!.find((x) => x.frame === frame && x.group === group && x.comp === comp)!;
  return p.expect;
};
{
  // 行[2]：把裸 at 0.5 当 fade（不赋值，fade 链不变）⇒ 帧35=25≠30、帧52=32.29≠34.857
  const c2 = rows.get('2')!.oracle.check!;
  const skip = new Set([c2.events!.findIndex((e) => e.time === 0.5)]);
  const mut = runTimeline(c2, { skipAssign: skip });
  const d35 = mut.post.get('f35:size:0'), o35 = expectNum('2', 35, 'size', 0);
  const d52 = mut.post.get('f52:size:0'), o52 = expectNum('2', 52, 'size', 0);
  mutationsRun++;
  ok('行[2] 注入"at 当 fade"变红', !near(d35!, o35) && !near(d52!, o52), `帧35 ${o35}→${d35}、帧52 ${o52}→${d52}`);

  // 行[3]：fade 触发不重瞄 ⇒ 帧49 事件前值 38≠34
  const c3 = rows.get('3')!.oracle.check!;
  const oRun = runTimeline(c3, { preEventAt: 49 });
  const mRun = runTimeline(c3, { noReAimOnFade: true, preEventAt: 49 });
  const o49 = oRun.preEvent.get('f49:size:0'), m49 = mRun.preEvent.get('f49:size:0');
  mutationsRun++;
  ok('行[3] 注入"fade 不重瞄"变红', o49 !== undefined && m49 !== undefined && !near(o49, m49), `帧49 事件前 ${o49}→${m49}`);

  // 行[4]：eventtimer 后不重扫 ⇒ 帧56=36≠15
  const c4 = rows.get('4')!.oracle.check!;
  const o4 = runTimeline(c4, {}).post.get('f56:size:0');
  const m4 = runTimeline(c4, { noRescan: true }).post.get('f56:size:0');
  mutationsRun++;
  ok('行[4] 注入"不重扫游标"变红', o4 !== undefined && m4 !== undefined && !near(o4, m4), `帧56 ${o4}→${m4}`);

  // 行[7]：恒力中值（-50 恒定）⇒ 帧2=-1.4286≠-1.5714
  const c7 = rows.get('7')!.oracle.check!;
  const o7 = runTimeline(c7, {}).post.get('f2:dir:1');
  const m7 = runTimeline(c7, { constForceY: -50 }).post.get('f2:dir:1');
  mutationsRun++;
  ok('行[7] 注入"恒力中值"变红', o7 !== undefined && m7 !== undefined && !near(o7, m7), `帧2 ${o7}→${m7}`);

  // 行[13]：lamp 误用 Normal ⇒ 黑底 0≠0.5
  const c13 = rows.get('13')!.oracle.check!;
  const black = { src: 0, alpha: 1, dst: 0.5 };
  const lamp = FORMULAS['13']!(black) as { lamp: number };
  const normal = { lamp: (black.src as number) * (black.alpha as number) + (black.dst as number) * (1 - (black.alpha as number)) };
  mutationsRun++;
  ok('行[13] 注入"lamp 误用 Normal"变红', !near(lamp.lamp, normal.lamp), `黑底 ${lamp.lamp}→${normal.lamp}`);
}

console.log(fails === 0
  ? `\n✓ verify-quarks-mechanisms 通过 —— oracle 机器复算 ${refChecked + formulaChecked} 行、mutation 注入 ${mutationsRun} 条全部变红`
  : `\n✗ ${fails} 条不符 —— 对照 docs/handoff/frozen/ 的冻结卷第 5/6 栏查数据与求值器`);

/* ════════ INI 族（B 计划：帧时长 / 坡道+相位 / 寿命 ε / 宽高 / 混合 / Angle） ════════ */

import * as THREE from 'three';
import { iniToQuarks } from '../src/render/effects/ini-to-quarks.js';

interface IniFrameSpec { delay: number; alpha: number; size: number | null; angle: number | null }
interface IniCheck {
  frames: IniFrameSpec[];
  opts: { size: number };
  blend?: string;
  expectDurations?: number[];
  expectStarts?: number[];
  expectFirstTickAlpha?: number;
  expectDrawCounts?: number[];
  expectEndWidth?: number;
  expectHeight?: number;
  expectBlending?: string;
  expectFrame1EndRotationDeg?: number;
  /** `INFO_DEFAULT` 分支（序列**没有 Size 段**）的对照：宽高都不步进 */
  noSize?: { frames: IniCheck['frames']; expectWidth: number; expectHeight: number };
}

/** 合成一份 INI（1×1 贴图 + 指定帧），走与运行时同一条 `iniToQuarks` */
function buildIni(c: IniCheck, blend: string): ReturnType<typeof iniToQuarks> {
  const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  const frames = c.frames.map((f) => ({ tex, delay: f.delay, alpha: f.alpha, size: f.size, angle: f.angle }));
  const duration = frames.reduce((t, f) => t + Math.max(1, f.delay) / 70, 0);
  const systems = iniToQuarks({ name: 'ini-synth', blend, frames, duration, diag: {} } as never, { size: c.opts.size });
  // ⚠ 必须挂进 Scene：`ParticleSystem.update` 会检查"根父节点是不是 Scene"，不满足就自我 dispose 并 return
  //   （与 lab/运行时的装配同一条要求）——不挂的话粒子数恒 0，检查会误报成"实现没画"。
  const scene = new THREE.Scene();
  for (const s2 of systems) scene.add(s2.emitter);
  scene.updateMatrixWorld(true);
  return systems;
}

console.log('INI 族（6 行 → 可机器验证；合成 effect + 逐帧绘制数不变式）');
{
  const iniRows = (map as unknown as { iniRows: Array<{ id: string; oracle: { check?: IniCheck } }> }).iniRows;
  const checkOf = (id: string): IniCheck => iniRows.find((r) => r.id === id)!.oracle.check!;

  // I1 帧时长 / 起始时刻
  {
    const c = checkOf('I1');
    const systems = buildIni(c, 'lamp');
    // `duration` 是**累计终点**（t + dur）⇒ 帧长 = 相邻差；同时校验帧起始的累计时刻
    const ends = systems.map((s) => s.duration);
    const lens = ends.map((e, i) => e - (i > 0 ? ends[i - 1]! : 0));
    const starts = ends.map((e, i) => e - (c.expectDurations![i] ?? 0));
    const wantLen = c.expectDurations!; const wantStart = c.expectStarts!;
    const okI1 = wantLen.every((d, i) => Math.abs(lens[i]! - d) < 1e-9)
      && wantStart.every((t, i) => Math.abs(starts[i]! - t) < 1e-9);
    ok('I1 帧时长 = Delay/70（0.1 / 0.2）、帧起始 = 0 / 0.1',
      okI1, `帧长 [${lens.map((d) => d.toFixed(3)).join(', ')}] 起始 [${starts.map((t) => t.toFixed(3)).join(', ')}]`);
  }

  // I2 坡道相位：单 tick 帧的 alpha = 目标值（不是起点）
  {
    const c = checkOf('I2');
    const [s0] = buildIni(c, 'lamp');
    s0!.update(1 / 70);
    const p = (s0 as unknown as { particles: Array<{ color: { w: number } }> }).particles[0];
    const alpha = p ? p.color.w * 255 : NaN;
    ok('I2 帧内坡道 + 相位：Delay=1、目标 200 ⇒ 唯一 tick 的 alpha = 200（一 tick 到位）',
      Math.abs(alpha - (c.expectFirstTickAlpha ?? 0)) < 0.5, `实际 alpha=${alpha.toFixed(1)}`);
  }

  // I3 寿命 ε：各系统**实际被绘制帧数** = 该帧 Delay
  {
    const c = checkOf('I3');
    const systems = buildIni(c, 'lamp');
    const counts = systems.map(() => 0);
    const total = (c.expectDrawCounts ?? []).reduce((a, b) => a + b, 0);
    for (let f = 0; f < total + 2; f++) {
      systems.forEach((s, i) => {
        s.update(1 / 70);
        if ((s as unknown as { particleNum: number }).particleNum > 0) counts[i]! += 1;
      });
    }
    const want = c.expectDrawCounts!;
    ok('I3 寿命 ε：各系统被绘制帧数 = 该帧 Delay（[1,60,35]）',
      want.every((w, i) => counts[i] === w), `实际 [${counts.join(', ')}]（期望 [${want.join(', ')}]）`);
  }

  // I4 宽高：宽向帧 Size 步进到目标、高 = 调用方 sizeY 恒定
  {
    const c = checkOf('I4');
    const [s0] = buildIni(c, 'lamp');
    for (let f = 0; f < c.frames[0]!.delay; f++) s0!.update(1 / 70);
    const p = (s0 as unknown as { particles: Array<{ size: { x: number; y: number } }> }).particles[0];
    const w = p ? p.size.x : NaN; const h = p ? p.size.y : NaN;
    ok('I4a 宽高（带 Size 段）：帧末宽 = 高 = 帧 Size(70)（高按同一步长 25+(70−25)）',
      Math.abs(w - (c.expectEndWidth ?? 0)) < 1e-6 && Math.abs(h - (c.expectHeight ?? 0)) < 1e-6,
      `实际 宽=${w.toFixed(2)} 高=${h.toFixed(2)}`);
    // I4b `INFO_DEFAULT`（无 Size 段）⇒ 宽高都保持调用方 sizeX/sizeY（`HoEffect.cpp:1075-1076`）
    const c2 = c.noSize!;
    const [b0] = buildIni({ ...c, frames: c2.frames }, 'lamp');
    for (let f = 0; f < c2.frames[0]!.delay; f++) b0!.update(1 / 70);
    const p2 = (b0 as unknown as { particles: Array<{ size: { x: number; y: number } }> }).particles[0];
    const w2 = p2 ? p2.size.x : NaN; const h2 = p2 ? p2.size.y : NaN;
    ok('I4b 宽高（INFO_DEFAULT，无 Size 段）：宽高都恒 = 调用方 size(25)',
      Math.abs(w2 - c2.expectWidth) < 1e-6 && Math.abs(h2 - c2.expectHeight) < 1e-6,
      `实际 宽=${w2.toFixed(2)} 高=${h2.toFixed(2)}`);
  }

  // I5 BlendType → 混合
  {
    const c = checkOf('I5');
    const [s0] = buildIni(c, c.blend ?? 'lamp');
    const blending = (s0 as unknown as { material: { blending: number } }).material.blending;
    const wantAdditive = blending === THREE.AdditiveBlending;
    ok('I5 BlendType=2(lamp) ⇒ AdditiveBlending', wantAdditive, `blending=${blending}`);
  }

  // I6 逐帧 Angle：帧1 末 rotation = 90°
  {
    const c = checkOf('I6');
    const systems = buildIni(c, 'lamp');
    const s1 = systems[1]!;
    // 先推进过**前面帧**的时长（帧1 的 burst 在 t = 前缀和处），再多推 1 tick 让粒子出生后步进到帧末
    const ticks = c.frames[0]!.delay + c.frames[1]!.delay;
    for (let f = 0; f < ticks; f++) s1.update(1 / 70);
    const p = (s1 as unknown as { particles: Array<{ rotation: unknown }> }).particles[0];
    const deg = p ? (Number(p.rotation) * 180) / Math.PI : NaN;
    ok('I6 逐帧 Angle：帧1 末 rotation = 90°（帧0 起点 0°）',
      Math.abs(deg - (c.expectFrame1EndRotationDeg ?? 0)) < 0.5, `实际 ${deg.toFixed(2)}°`);
  }
}

/* ════════ Lua 命令语义（A 计划：8 个 hand 行 → 可机器验证） ════════ */

import { parseLuaScript, particleIR, meshIR } from '../src/core/effect/lua-script.js';
import { luaIRToBuild, buildEmitterSystem } from '../src/render/effects/plugin-part-convert.js';
import { setOrientCamera } from '../src/render/effects/orient-shared.js';
import { PtAxialOrientation } from '../src/render/effects/orient-axial.js';
import { Quaternion as QQuat, Vector3 as QVec3 } from 'quarks.core';

/** 确定性随机（线性同余）——oracle 必须可复现 */
function seededRand(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
/** 用种子随机造一个"单粒子"系统，返回其 spawn 时的 position/velocity（照形状的 initialize） */
function probeSpawn(lua: string, seed: number): { pos: [number, number, number]; vel: [number, number, number]; behaviors: string[] } {
  const ir = particleIR(parseLuaScript(lua))[0]!;
  const rand = seededRand(seed);
  const built = buildEmitterSystem(luaIRToBuild(ir, 'probe', null), rand);
  const shape = (built.system as unknown as { emitterShape: { initialize(p: unknown, s?: unknown): void } }).emitterShape;
  const p = { position: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, memory: [] };
  shape.initialize(p as never, {} as never);
  return {
    pos: [p.position.x, p.position.y, p.position.z],
    vel: [p.velocity.x, p.velocity.y, p.velocity.z],
    behaviors: built.system.behaviors.map((b) => b.type),
  };
}
const V3LEN = (v: [number, number, number]): number => Math.hypot(v[0], v[1], v[2]);
const dot3 = (a: [number, number, number], b: [number, number, number]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

console.log('Lua 命令语义（8 行 → 可机器验证；合成片段 + 种子随机）');
{
  // L14 InitParticleNum：显式值 + **缺省 50**（C++ ctor m_fParticleNum(50.f)）
  const n7 = luaIRToBuild(particleIR(parseLuaScript('Begin("ParticleSystem");\nInitParticleNum(7);\nEnd();'))[0]!, 'x', null);
  const nBare = luaIRToBuild(particleIR(parseLuaScript('Begin("ParticleSystem");\nEnd();'))[0]!, 'x', null);
  ok('L14 InitParticleNum：显式 7 / 缺省 50（C++ ctor）', n7.numParticles === 7 && nBare.numParticles === 50,
    `显式=${n7.numParticles} 缺省=${nBare.numParticles}`);

  // L15 InitEmitRate：显式值 + **缺省 30**
  const r11 = luaIRToBuild(particleIR(parseLuaScript('Begin("ParticleSystem");\nInitEmitRate(11);\nEnd();'))[0]!, 'x', null);
  const rBare = luaIRToBuild(particleIR(parseLuaScript('Begin("ParticleSystem");\nEnd();'))[0]!, 'x', null);
  ok('L15 InitEmitRate：显式 11 / 缺省 30（C++ ctor）', r11.emitRate === 11 && rBare.emitRate === 30,
    `显式=${r11.emitRate} 缺省=${rBare.emitRate}`);

  // L17 InitVelocityType：Random ⇒ v.y=v.z=0（单轴区间）；CurPos ⇒ v ∥ pos、|v| ∈ [90,100]
  const rnd = probeSpawn('Begin("ParticleSystem");\nInitVelocity(-100,-90,0,0,0,0);\nInitVelocityType("Random");\nEnd();', 7);
  // ⚠ CurPos 需要**非退化出生偏移**（原版就是从 `m_EmitRange->GetPos()` 取方向）⇒ 用例带球面出生
  const cp = probeSpawn('Begin("ParticleSystem");\nInitSpawnBoundingSphere(100,100);\nInitVelocity(-100,-90,0,0,0,0);\nInitVelocityType("CurPos");\nEnd();', 7);
  const cpSpeed = V3LEN(cp.vel);
  const parallel = Math.abs(dot3(cp.vel, cp.pos)) / ((cpSpeed * V3LEN(cp.pos)) || 1);
  ok('L17 VelocityType：Random 单轴 / CurPos 沿径向（|v|∈[90,100]、v∥pos）',
    Math.abs(rnd.vel[1]) < 1e-9 && Math.abs(rnd.vel[2]) < 1e-9
    && cpSpeed >= 90 && cpSpeed <= 100 && parallel > 0.999,
    `Random v=(${rnd.vel.map((x) => x.toFixed(1)).join(',')}) CurPos |v|=${cpSpeed.toFixed(1)} v∥pos=${parallel.toFixed(3)}`);
  // 反例对撞：若 CurPos 与 Random 同路（旧 bug）则 v 与 pos 不同向
  const wrongParallel = Math.abs(dot3(rnd.vel, rnd.pos)) / ((V3LEN(rnd.vel) * V3LEN(rnd.pos)) || 1);
  ok('L17 反例：把 CurPos 当 Random 会被抓住（v∥pos 不成立）', wrongParallel < 0.999,
    `若同路：v∥pos=${wrongParallel.toFixed(3)}（<0.999 ⇒ 检查会红）`);

  // L18 InitParticleType：Default ⇒ PtOrientOne；Axial ⇒ PtAxialOrientation + 长轴∥速度 + |q|=1
  const dflt = probeSpawn('Begin("ParticleSystem");\nInitParticleType("BillboardDefault");\nEnd();', 3);
  const ax = probeSpawn('Begin("ParticleSystem");\nInitParticleType("BillboardAxial");\nInitVelocity(10,10,0,0,0,0);\nEnd();', 3);
  const hasDefault = dflt.behaviors.includes('PtOrientOne');
  const hasAxial = ax.behaviors.includes('PtAxialOrientation');
  // 轴向朝向的数学：Y 轴 ∥ 速度、四元数单位长
  setOrientCamera({ x: 0, y: 0, z: 0, w: 1 }, { x: 0, y: 0, z: 200 });
  const ob = new PtAxialOrientation();
  const probe = { velocity: { x: 10, y: 0, z: 0 }, position: { x: 0, y: 0, z: 0 }, rotation: undefined } as never;
  ob.update(probe as never, 1 / 60);
  const q = (probe as unknown as { rotation: { x: number; y: number; z: number; w: number } }).rotation;
  const qLen = Math.hypot(q.x, q.y, q.z, q.w);
  // ⚠ 用四元数作用求"局部 +Y 在世界里的像"——**不要手写矩阵列**（我第一版手写取了转置，
  //   于是把"实现正确"误判成 -X）。这里与 `_dbg-axial` 的验证方式一致。
  const qq = new QQuat(q.x, q.y, q.z, q.w);
  const yWorldV = new QVec3(0, 1, 0).applyQuaternion(qq);
  const yWorld = { x: yWorldV.x, y: yWorldV.y, z: yWorldV.z };
  ok('L18 ParticleType：Default→PtOrientOne / Axial→PtAxialOrientation（长轴∥速度、|q|=1）',
    hasDefault && hasAxial && Math.abs(qLen - 1) < 1e-6 && Math.abs(yWorld.x - 1) < 1e-6,
    `default=${hasDefault} axial=${hasAxial} |q|=${qLen.toFixed(6)} 长轴=(${yWorld.x.toFixed(3)},${yWorld.y.toFixed(3)},${yWorld.z.toFixed(3)})`);
  ok('L18 反例：VerticalBillBoard 路线会被抓住（行为表无 PtAxialOrientation）',
    ax.behaviors.includes('PtAxialOrientation'),
    `axial 行为=[${ax.behaviors.join(',')}]`);

  // L19 盒形：三轴各自区间
  {
    const ranges: Array<[number, number]> = [[-20, 20], [0, 50], [-30, 0]];
    let inRange = true;
    for (let s = 1; s <= 200; s++) {
      const p = probeSpawn('Begin("ParticleSystem");\nInitSpawnBoundingBox(-20,20,0,50,-30,0);\nEnd();', s).pos;
      for (let a = 0; a < 3; a++) if (p[a]! < ranges[a]![0]! - 1e-9 || p[a]! > ranges[a]![1]! + 1e-9) inRange = false;
    }
    ok('L19 InitSpawnBoundingBox：200 个样本全在三轴区间内', inRange, 'x[-20,20] y[0,50] z[-30,0]');
  }

  // L20 球面点：**半径恰等于掷出值**（不是球体内均匀）
  {
    let allOnSurface = true; let maxErr = 0;
    for (let s = 1; s <= 200; s++) {
      const d = Math.abs(V3LEN(probeSpawn('Begin("ParticleSystem");\nInitSpawnBoundingSphere(150,150);\nEnd();', s).pos) - 150);
      if (d > 1e-6) allOnSurface = false;
      maxErr = Math.max(maxErr, d);
    }
    ok('L20 InitSpawnBoundingSphere：定值半径 150 ⇒ |pos| 恒 150（球面而非球体）', allOnSurface, `最大偏差=${maxErr.toExponential(1)}`);
  }

  // L21 圆环：照 C++ 的"三轴盒 + z 加半径 + 绕 Y 微转" ⇒ |pos| 恒为 sqrt(1+1+51²)
  {
    const expect = Math.sqrt(1 + 1 + 51 * 51);
    let maxErr = 0;
    for (let s = 1; s <= 50; s++) {
      const p = probeSpawn('Begin("ParticleSystem");\nInitSpawnBoundingDoughnut(50,50,1,1);\nEnd();', s).pos;
      maxErr = Math.max(maxErr, Math.abs(V3LEN(p) - expect));
    }
    ok('L21 InitSpawnBoundingDoughnut：|pos| 恒 = sqrt(1+1+51²)（照 HoEffectController.h:355-404）',
      maxErr < 1e-6, `期望=${expect.toFixed(4)} 最大偏差=${maxErr.toExponential(1)}`);
  }

  // L22 InitAxialPos：门控只认 BILLBOARD_AXIAL（粒子块里 no-op）
  {
    const inPs = parseLuaScript('Begin("ParticleSystem");\nInitAxialPos(0,-50,0,0,50,0);\nEnd();');
    const inAx = parseLuaScript('Begin("BILLBOARD_AXIAL");\nInitAxialPos(0,-50,0,0,50,0);\nEnd();');
    const g1 = inPs.blocks[0]!.commands[0]!.gate;
    const g2 = inAx.blocks[0]!.commands[0]!.gate;
    ok('L22 InitAxialPos：粒子块 dropped-gate / BILLBOARD_AXIAL applied（门控照抄）',
      g1 === 'dropped-gate' && g2 === 'applied', `粒子=${g1} 轴对齐=${g2}`);
  }
  void meshIR;
}

/* ════════ 阶段二（B2/B5）：**实现符合性** —— 真实插件类跑同一批冻结 oracle ════════ */

import type { Behavior } from 'quarks.core';
import { PtClockBehavior, type PtBlockLocator } from '../src/render/effects/plugin-clock.js';
import { PtColorGen, PtValueGen } from '../src/render/effects/plugin-value-gen.js';
import { PtGravityBehavior } from '../src/render/effects/plugin-gravity.js';
import { emitFrameArithmetic } from '../src/render/effects/plugin-emit-budget.js';
import type { Num, PtSlot } from '../src/core/effect/pt-timeline.js';

if (fails === 0) {
  console.log('实现符合性（B2/B5 插件 vs 冻结 oracle；rand 注入 uSequence）');
  const toNum = (n: number | [number, number]): Num => (typeof n === 'number' ? { k: 'n', v: n } : { k: 'r', a: n[0]!, b: n[1]! });
  const toPtEvents = (check: Check): PtEvent[] =>
    (check.events ?? []).map((e) => ({ time: e.time, slot: e.slot as PtSlot, fade: e.fade, value: e.value.map(toNum), next: -1 }));

  /** 真实 PtClockBehavior 单次正向推 N 帧，逐帧快照块值（帧后 = 事件已生效） */
  const runClock = (check: Check, us: number[]): Map<string, number> => {
    const locator: PtBlockLocator = { index: -1 };
    const q = [...us];
    const behavior = new PtClockBehavior(toPtEvents(check), locator, () => (q.length ? q.shift()! : 0.5));
    const memory: unknown[] = [];
    const particle = { memory } as unknown as Parameters<typeof behavior.initialize>[0];
    behavior.initialize(particle, {} as never);
    const frames = Math.max(...(check.probes ?? []).map((p) => p.frame));
    const snap = new Map<string, number>();
    for (let f = 1; f <= frames; f++) {
      behavior.update(particle, 1 / 70);
      const block = memory[locator.index] as { val: Record<string, number[]>; clock: number };
      for (const p of check.probes ?? []) if (p.frame === f) snap.set(`f${f}:${p.group}:${p.comp}`, block.val[p.group]![p.comp]!);
      void block.clock;
    }
    return snap;
  };
  const at = (snap: Map<string, number>, frame: number, group: string, comp: number): number =>
    snap.get(`f${frame}:${group}:${comp}`)!;

  // 行[2]：真实时钟 vs 冻结帧表（帧35=30 / 帧52=34.857）
  {
    const snap = runClock(rows.get('2')!.oracle.check!, []);
    const g35 = at(snap, 35, 'size', 0); const g52 = at(snap, 52, 'size', 0);
    ok('impl 行[2]（PtClockBehavior）帧35=30 / 帧52=34.857', near(g35, 30) && near(g52, 34.8571), `${g35} / ${g52}`);
  }
  // 行[3]：帧49=25（重瞄后）/ 帧69=39.286
  {
    const snap = runClock(rows.get('3')!.oracle.check!, []);
    const g49 = at(snap, 49, 'size', 0); const g69 = at(snap, 69, 'size', 0);
    ok('impl 行[3]（PtClockBehavior）帧49=25 / 帧69=39.286', near(g49, 25) && near(g69, 39.2857), `${g49} / ${g69}`);
  }
  // 行[4]：eventtimer 重放 帧56=15 / 帧70=30
  {
    const snap = runClock(rows.get('4')!.oracle.check!, []);
    const g56 = at(snap, 56, 'size', 0); const g70 = at(snap, 70, 'size', 0);
    ok('impl 行[4]（PtClockBehavior）帧56=15 / 帧70=30', near(g56, 15) && near(g70, 30), `${g56} / ${g70}`);
  }
  // L25：颜色 0.5 时=128（重瞄）→ 帧60=36.571
  {
    const snap = runClock(rows.get('L25')!.oracle.check!, []);
    const g35 = at(snap, 35, 'color', 0); const g60 = at(snap, 60, 'color', 0);
    ok('impl L25（PtClockBehavior）帧35=128 / 帧60=36.571', near(g35, 128) && near(g60, 36.5714), `${g35} / ${g60}`);
  }
  // PtValueGen / PtColorGen 读出侧（忽略 t 的契约；0..255→0..1）
  {
    const c = rows.get('2')!.oracle.check!; const locator: PtBlockLocator = { index: -1 };
    const q: number[] = [];
    const memory: unknown[] = [];
    const clock = new PtClockBehavior(toPtEvents(c), locator, () => (q.length ? q.shift()! : 0.5));
    const particle = { memory } as unknown as Parameters<typeof clock.initialize>[0];
    clock.initialize(particle, {} as never);
    for (let f = 1; f <= 52; f++) clock.update(particle, 1 / 70);
    const gen = new PtValueGen(locator, 'size', 0);
    const v52 = gen.genValue(memory as never, 999);           // t 传无关值 ⇒ 忽略 t 的契约
    const cg = new PtColorGen(locator);
    const colorBox = { x: 0, y: 0, z: 0, w: 0 };
    cg.genColor(memory as never, colorBox as never, 999);
    ok('impl 行[2]/[L4]（PtValueGen 忽略 t / PtColorGen 0..255→0..1）', near(v52, 34.8571) && near(colorBox.x, 1, 1e-6), `size=${v52} colorR=${colorBox.x}`);
  }
  // 行[7]：真实 PtGravityBehavior（u 序列 0.3/0.8；gravity 用 IR 的 tagged Num）
  {
    const c = rows.get('7')!.oracle.check!; const us = c.uSequence ?? [];
    const q = [...us];
    const g = new PtGravityBehavior(
      { x: toNum(0), y: toNum([-100, 0]), z: toNum(0) } as never,
      () => (q.length ? q.shift()! : 0.5),
    );
    const p = { velocity: { x: 0, y: 0, z: 0 } } as unknown as Parameters<typeof g.update>[0];
    g.update(p, 1 / 70);
    const v1 = p.velocity.y;
    g.update(p, 1 / 70);
    const v2 = p.velocity.y;
    ok('impl 行[7]（PtGravityBehavior）v_y(1)=-1.0 / v_y(2)=-1.2857', near(v1, -1.0) && near(v2, -1.285714), `${v1} / ${v2}`);
  }
  // 行[6]：emitFrameArithmetic（零头 + 补整 + 预算夹断）
  {
    const dt = 1 / 70;
    const f1 = emitFrameArithmetic(150, dt, 0, 0, Infinity);
    const f2 = emitFrameArithmetic(180, dt, f1.excess, f1.count, Infinity);
    const f3 = emitFrameArithmetic(200, dt, f2.excess, f1.count + f2.count, Infinity);
    const clamped = emitFrameArithmetic(200, dt, 0, 299, 300);
    ok('impl 行[6]（emitFrameArithmetic）零头/补整/夹断',
      f1.count === 2 && near(f1.excess, 0.1429, 1e-3) && f2.count === 2 && near(f2.excess, 0.7143, 1e-3)
      && f3.count === 3 && near(f3.excess, 0.5714, 1e-3) && clamped.count === 1,
      `${f1.count}/${f2.count}/${f3.count} 夹断=${clamped.count}`);
  }
  console.log(fails === 0 ? '  · 实现符合性全部通过 —— B2/B5 插件与冻结 oracle 一致' : '  · 实现符合性存在不符（见上）');
}
process.exit(fails === 0 ? 0 : 1);
