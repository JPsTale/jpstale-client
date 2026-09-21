/**
 * 回归：**循环驱动**（`src/app/loop-driver.ts`）—— 前台 rAF ↔ 后台闹钟的切换与生命周期。
 *
 * 依据：`src/app/loop-driver.ts` 的四条硬约束（文件头注释）；背景见 `core/keepalive-timer.ts`
 * （浏览器停掉隐藏页的 rAF、节流主线程定时器 ⇒ 切 tab 后世界停摆 + 心跳掉线，用户 2026-09-21 实测）。
 *
 * 验哪几件事（每条都是**可推翻**的：实现退化时对应断言立刻红）：
 *   ① 前台：一条自续的 rAF 链（+ 一个看门狗闹钟），模式 'foreground'
 *   ② 隐藏：rAF 与会话链被换掉、**一条**后台闹钟接管，帧模式 'background'
 *   ③ 恢复可见：闹钟停、回到一条 rAF 链
 *   ④ **过期回调必须被丢掉**（世代号按值快照）：隐藏期间排下的 rAF 事后被投递 ⇒ 不产生帧、不产生第二条链
 *      —— 世代号写成 `(ts) => tick(ts, gen)`（按引用）时这条就红（真踩过）
 *   ⑤ `stop()` 之后投递任何回调 ⇒ 零帧，且可见性监听已解绑
 *   ⑥ `start()` 时**已经隐藏** ⇒ 直接落后台（会话恢复的后台标签页可无手势进世界，等不到 visibilitychange）
 *   ⑦ 同状态重复触发（隐藏两次 / 可见两次 / start 两次）⇒ 永远只有一条链
 *   ⑧ `stop()` 之后能再次 `start()`（"进游戏 → 回选角 → 再进游戏"；WIP 的 `worldActive` 曾漏掉这条）
 *   ⑨ `onFrame` 里 `stop()`（重入）⇒ 不再排下一帧
 *   ⑩ 模式切换通知（`onModeChange`）序列正确 —— WorldView 靠它释放"按住的输入"
 *   ⑪ 后台间隔默认 30Hz、可注入
 *   ⑫ 接线：WorldView 自己不再排 rAF（循环只由驱动拥有）；transport 里不再有 window 定时器
 *   ⑬ **看门狗**：rAF 因**与可见性无关**的原因停掉/饿死（隐藏其实只是原因之一）时，
 *      前台超时无帧 ⇒ 自己切后台并**上报**（别把它写成"实测某浏览器会撒谎"）
 *   ⑭ 后台每 ~0.5s 探一次 rAF：探测回调被执行（rAF 恢复）⇒ 自愈回前台
 *
 * 用法：`npm run verify-loop-driver`
 */
import { readFileSync } from 'node:fs';
import { createLoopDriver, type LoopDriverDeps } from '../src/app/loop-driver.js';

let fails = 0;
const ok = (name: string, pass: boolean, detail = ''): void => {
  console.log(`  ${pass ? '✓' : '✗'} ${name}${detail ? '  〔' + detail + '〕' : ''}`);
  if (!pass) fails++;
};

// ---------- 假环境（注入面，见 LoopDriverDeps）：只模拟"调度器"语义，不碰真 DOM ----------

const WD_MS = 250;        // 测试用的看门狗周期
const STALL_MS = 2000;    // 测试用的"rAF 已被停"阈值
const BG_MS = 1000 / 30;  // 默认后台窗格

function makeEnv() {
  const e = {
    hidden: false, clock: 0,
    rafQueue: new Map<number, (ts: number) => void>(),
    bgQueue: new Map<number, () => void>(),
    bgMs: new Map<number, number>(),
    frames: [] as { ts: number; mode: string }[],
    modeLog: [] as string[], warns: [] as string[],
    visListeners: [] as (() => void)[], unsubscribed: 0,
  };
  let id = 0;
  const deps: LoopDriverDeps = {
    isHidden: () => e.hidden,
    raf: (cb) => { const i = ++id; e.rafQueue.set(i, cb); return i; },
    cancelRaf: (i) => { e.rafQueue.delete(i); },
    scheduleBackground: (cb, ms) => { const i = ++id; e.bgQueue.set(i, cb); e.bgMs.set(i, ms); return i; },
    cancelBackground: (i) => { e.bgQueue.delete(i); e.bgMs.delete(i); },
    now: () => e.clock,
    subscribeVisibility: (cb) => {
      e.visListeners.push(cb);
      return () => { e.unsubscribed++; e.visListeners = e.visListeners.filter((x) => x !== cb); };
    },
    onFrame: (ts, mode) => { e.frames.push({ ts, mode }); },
    onModeChange: (m) => { e.modeLog.push(m); },
    onWarn: (d) => { e.warns.push(d); },
    watchdogMs: WD_MS,
    stallMs: STALL_MS,
  };
  return { e, deps };
}

const bgIds = (e: ReturnType<typeof makeEnv>['e']): number[] => [...e.bgQueue.keys()];
const bgIdsAt = (e: ReturnType<typeof makeEnv>['e'], ms: number): number[] => bgIds(e).filter((i) => e.bgMs.get(i) === ms);
/** 自动推进时钟后投递一次 rAF；返回被投递的那个回调（供"过期回调"用例复用） */
function fireRaf(e: ReturnType<typeof makeEnv>['e'], advance = 16): ((ts: number) => void) | null {
  e.clock += advance;
  const first = [...e.rafQueue.entries()][0];
  if (!first) return null;
  e.rafQueue.delete(first[0]);
  first[1](e.clock);
  return first[1];
}
/** 投递指定周期的后台回调（帧闹钟 ms=BG_MS / 看门狗 ms=WD_MS） */
function fireBgAt(e: ReturnType<typeof makeEnv>['e'], ms: number): void {
  for (const i of bgIdsAt(e, ms)) e.bgQueue.get(i)?.();
}
const visibility = (e: ReturnType<typeof makeEnv>['e']): void => { for (const cb of [...e.visListeners]) cb(); };
const r = (v: unknown): string => JSON.stringify(v);

// ---------- ① 前台：一条自续的 rAF 链 + 一个看门狗 ----------
{
  const { e, deps } = makeEnv();
  const d = createLoopDriver(deps);
  d.start();
  ok('① start（可见）→ 1 条 rAF + 1 个看门狗（不排帧闹钟）',
    e.rafQueue.size === 1 && bgIdsAt(e, WD_MS).length === 1 && bgIdsAt(e, BG_MS).length === 0,
    `raf=${e.rafQueue.size} wd=${bgIdsAt(e, WD_MS).length} bg=${bgIdsAt(e, BG_MS).length}`);
  ok('① 模式 = foreground', d.mode === 'foreground', d.mode);
  fireRaf(e);
  ok('① 一帧以 foreground 送达', e.frames.length === 1 && e.frames[0]!.mode === 'foreground', r(e.frames));
  ok('① 帧后**自续**下一条 rAF（且仍只有一条）', e.rafQueue.size === 1);
  fireRaf(e);
  ok('① 连续两帧、仍只有一条链', e.frames.length === 2 && e.rafQueue.size === 1);
  ok('① 有帧在跑 ⇒ 看门狗不误判', e.warns.length === 0 && d.mode === 'foreground', r(e.warns));
  d.stop();
}

// ---------- ②③ 隐藏 ↔ 可见 ----------
{
  const { e, deps } = makeEnv();
  const d = createLoopDriver(deps);
  d.start();
  fireRaf(e);
  e.hidden = true;
  visibility(e);
  ok('② 隐藏 → rAF 换掉、排下 1 条帧闹钟（看门狗也撤）',
    e.rafQueue.size === 0 && bgIdsAt(e, BG_MS).length === 1 && bgIdsAt(e, WD_MS).length === 0,
    `raf=${e.rafQueue.size} bg=${bgIdsAt(e, BG_MS).length} wd=${bgIdsAt(e, WD_MS).length}`);
  ok('② 模式 = background', d.mode === 'background');
  fireBgAt(e, BG_MS); fireBgAt(e, BG_MS);
  ok('② 后台帧模式 = background', e.frames.length === 3 && e.frames.slice(1).every((f) => f.mode === 'background'),
    r(e.frames.map((f) => f.mode)));
  ok('② 隐藏期间**不排帧链 rAF**（只有恢复探测，至多 1 条在飞）', e.rafQueue.size === 0, `raf=${e.rafQueue.size}`);
  ok('② 隐藏期间仍只有 1 条帧闹钟（自重复，不叠）', bgIdsAt(e, BG_MS).length === 1);
  e.hidden = false;
  visibility(e);
  ok('③ 恢复可见 → 闹钟撤、回到 1 条 rAF + 看门狗',
    e.rafQueue.size === 1 && bgIdsAt(e, BG_MS).length === 0 && bgIdsAt(e, WD_MS).length === 1,
    `raf=${e.rafQueue.size} bg=${bgIdsAt(e, BG_MS).length} wd=${bgIdsAt(e, WD_MS).length}`);
  fireRaf(e);
  ok('③ 前台帧继续（模式 = foreground）', e.frames[e.frames.length - 1]!.mode === 'foreground');
  d.stop();
}

// ---------- ④ 过期回调必须被丢掉（世代号按值快照） ----------
{
  const { e, deps } = makeEnv();
  const d = createLoopDriver(deps);
  d.start();
  const stale = [...e.rafQueue.values()][0]!;
  e.hidden = true;
  visibility(e);
  const framesAfterSwitch = e.frames.length;
  stale(9999);
  ok('④ 过期 rAF 回调被丢掉（不产生帧）', e.frames.length === framesAfterSwitch, `frames=${e.frames.length}`);
  ok('④ 过期回调**不产生第二条链**', e.rafQueue.size === 0 && bgIdsAt(e, BG_MS).length === 1);
  d.stop();
}

// ---------- ⑤ stop 之后零回调 + 解绑 ----------
{
  const { e, deps } = makeEnv();
  const d = createLoopDriver(deps);
  d.start();
  const stale = [...e.rafQueue.values()][0]!;
  d.stop();
  const before = e.frames.length;
  stale(1);
  fireBgAt(e, BG_MS);
  fireBgAt(e, WD_MS);
  ok('⑤ stop 后投递任何回调 → 零帧', e.frames.length === before, `frames=${e.frames.length}`);
  ok('⑤ stop 后不再排任何链', e.rafQueue.size === 0 && e.bgQueue.size === 0);
  ok('⑤ stop 解绑了可见性监听', e.unsubscribed === 1 && e.visListeners.length === 0, `unsub=${e.unsubscribed}`);
  e.hidden = true;
  visibility(e);
  ok('⑤ 解绑后可见性事件不再起链', e.rafQueue.size === 0 && e.bgQueue.size === 0);
  d.stop();
  ok('⑤ stop 幂等（重复调用不炸、不重复解绑）', e.unsubscribed === 1, `unsub=${e.unsubscribed}`);
}

// ---------- ⑥ start 时已经隐藏（后台标签页无手势进世界） ----------
{
  const { e, deps } = makeEnv();
  e.hidden = true;
  const d = createLoopDriver(deps);
  d.start();
  ok('⑥ 隐藏中 start → 直接落后台（不排帧链 rAF）', e.rafQueue.size === 0 && bgIdsAt(e, BG_MS).length === 1,
    `raf=${e.rafQueue.size} bg=${bgIdsAt(e, BG_MS).length}`);
  fireBgAt(e, BG_MS);
  ok('⑥ 隐藏中 start 也能出帧（模式 background）', e.frames.length === 1 && e.frames[0]!.mode === 'background');
  e.hidden = false;
  visibility(e);
  ok('⑥ 之后转前台：闹钟停、rAF 起', e.rafQueue.size === 1 && bgIdsAt(e, BG_MS).length === 0);
  d.stop();
}

// ---------- ⑦ 同状态重复触发 → 永远只有一条链 ----------
{
  const { e, deps } = makeEnv();
  const d = createLoopDriver(deps);
  d.start();
  d.start();
  ok('⑦ start 两次 → 1 条 rAF', e.rafQueue.size === 1, `raf=${e.rafQueue.size}`);
  e.hidden = true;
  visibility(e); visibility(e);
  ok('⑦ 隐藏事件两次 → 1 条帧闹钟', bgIdsAt(e, BG_MS).length === 1 && e.rafQueue.size === 0,
    `bg=${bgIdsAt(e, BG_MS).length}`);
  e.hidden = false;
  visibility(e); visibility(e);
  ok('⑦ 可见事件两次 → 1 条 rAF', e.rafQueue.size === 1 && bgIdsAt(e, BG_MS).length === 0, `raf=${e.rafQueue.size}`);
  d.stop();
}

// ---------- ⑧ stop 之后能再 start（进游戏 → 回选角 → 再进游戏） ----------
{
  const { e, deps } = makeEnv();
  const d = createLoopDriver(deps);
  d.start();
  fireRaf(e);
  d.stop();
  const before = e.frames.length;
  d.start();
  ok('⑧ 再 start → 重新排链', e.rafQueue.size === 1, `raf=${e.rafQueue.size}`);
  fireRaf(e);
  ok('⑧ 再 start 后帧照常送达', e.frames.length === before + 1, `frames=${e.frames.length}`);
  d.stop();
}

// ---------- ⑨ onFrame 里 stop()（重入） ----------
{
  const { e, deps } = makeEnv();
  let d!: ReturnType<typeof createLoopDriver>;
  d = createLoopDriver({ ...deps, onFrame: (ts, mode) => { e.frames.push({ ts, mode }); d.stop(); } });
  d.start();
  fireRaf(e);
  ok('⑨ onFrame 里 stop ⇒ 不再排下一帧', e.rafQueue.size === 0 && e.bgQueue.size === 0, `raf=${e.rafQueue.size}`);
  ok('⑨ onFrame 里 stop ⇒ 模式 stopped', d.mode === 'stopped', d.mode);
  fireRaf(e);
  ok('⑨ stop 后投递 → 仍只有那一帧', e.frames.length === 1, `frames=${e.frames.length}`);
}

// ---------- ⑩ 模式切换通知 ----------
{
  const { e, deps } = makeEnv();
  const d = createLoopDriver(deps);
  d.start();
  e.hidden = true; visibility(e);
  e.hidden = false; visibility(e);
  d.stop();
  ok('⑩ onModeChange 序列 = foreground→background→foreground→stopped',
    r(e.modeLog) === r(['foreground', 'background', 'foreground', 'stopped']), r(e.modeLog));
}

// ---------- ⑪ 间隔：默认 30Hz、可注入 ----------
{
  const { e, deps } = makeEnv();
  e.hidden = true;
  const d = createLoopDriver(deps);
  d.start();
  ok('⑪ 后台间隔默认 30Hz（=1000/30ms）', Math.abs((e.bgMs.get(bgIdsAt(e, BG_MS)[0]!) ?? 0) - 1000 / 30) < 1e-9,
    String(e.bgMs.get(bgIdsAt(e, BG_MS)[0]!)));
  d.stop();
  const { e: e2, deps: deps2 } = makeEnv();
  e2.hidden = true;
  const d2 = createLoopDriver({ ...deps2, backgroundIntervalMs: 250 });
  d2.start();
  ok('⑪ 后台间隔可注入（250ms）', bgIdsAt(e2, 250).length === 1, String([...e2.bgMs.values()]));
  d2.stop();
}

// ---------- ⑬ 看门狗：可见性 API 撒谎时自己纠正（rAF 停了但 hidden=false） ----------
{
  const { e, deps } = makeEnv();
  const d = createLoopDriver(deps);
  d.start();
  fireRaf(e);                                 // 正常来一帧
  ok('⑬ 判据是"帧有没有真的来"，不是 hidden', d.mode === 'foreground' && e.warns.length === 0);
  // 此后 rAF 再不回调（模拟被浏览器停掉），但 hidden 一直是 false
  for (let i = 0; i < 12; i++) { e.clock += 250; fireBgAt(e, WD_MS); }
  ok('⑬ 前台超时无帧 ⇒ 切到后台闹钟', d.mode === 'background', d.mode);
  ok('⑬ 且**上报**了原因（不静默）', e.warns.length === 1 && /没有帧/.test(e.warns[0]!), r(e.warns));
  ok('⑬ 纠正后帧继续以 background 送达', (() => {
    const n = e.frames.length;
    fireBgAt(e, BG_MS);
    return e.frames.length === n + 1 && e.frames[e.frames.length - 1]!.mode === 'background';
  })());
  d.stop();
}

// ---------- ⑭ 后台探测 rAF：恢复了就自愈回前台 ----------
{
  const { e, deps } = makeEnv();
  const d = createLoopDriver(deps);
  d.start();
  e.hidden = true;                             // 直接进后台
  visibility(e);
  let probe: ((ts: number) => void) | null = null;
  // 后台帧闹钟跑够 RECOVER_PROBE_EVERY 次（16）后会排一条 rAF 探测
  for (let i = 0; i < 16 && !probe; i++) {
    fireBgAt(e, BG_MS);
    probe = [...e.rafQueue.values()][0] ?? null;
  }
  ok('⑭ 后台会排 rAF 探测（恢复检测）', probe !== null, `raf=${e.rafQueue.size}`);
  if (probe) {
    e.rafQueue.clear();                        // 探测回调被浏览器执行（= rAF 恢复了）
    probe(e.clock);
    ok('⑭ 探测被执行 ⇒ 自愈回前台', d.mode === 'foreground', d.mode);
    ok('⑭ 自愈后回到 rAF 链 + 看门狗', e.rafQueue.size === 1 && bgIdsAt(e, WD_MS).length === 1);
  }
  d.stop();
}

// ---------- ⑫ 接线（源码级）：循环只由驱动拥有；transport 不再用 window 定时器 ----------
{
  const wv = readFileSync(new URL('../src/ui/WorldView.ts', import.meta.url), 'utf8');
  const tr = readFileSync(new URL('../src/net/transport.ts', import.meta.url), 'utf8');
  const countOf = (s: string, re: RegExp): number => (s.match(re) ?? []).length;
  ok('⑫ WorldView 不再自己排 rAF 链（`requestAnimationFrame(renderLoop` 出现 0 次）',
    countOf(wv, /requestAnimationFrame\(renderLoop/g) === 0, String(countOf(wv, /requestAnimationFrame\(renderLoop/g)));
  ok('⑫ WorldView 只建 1 个驱动', countOf(wv, /createLoopDriver\(/g) === 1, String(countOf(wv, /createLoopDriver\(/g)));
  ok('⑫ WorldView 的 start/stop 各就位（start 1 次、stop 2 次 = hide+destroy）',
    countOf(wv, /loopDriver\.start\(\)/g) === 1 && countOf(wv, /loopDriver\.stop\(\)/g) === 2,
    `start=${countOf(wv, /loopDriver\.start\(\)/g)} stop=${countOf(wv, /loopDriver\.stop\(\)/g)}`);
  // 判"散装状态"要看**声明/赋值**，不能看注释 —— 注释里点名这些旧变量是有价值的（说明为什么抽走）
  const scatter = /(let|const)\s+(worldActive|bgTimerId)\b|\b(worldActive|bgTimerId)\s*=(?!=)|function\s+onVisibilityChange\b/g;
  ok('⑫ WorldView 不再有散装的 worldActive/bgTimerId/onVisibilityChange（只看声明与赋值）',
    countOf(wv, scatter) === 0, String(countOf(wv, scatter)));
  ok('⑫ transport 里不再有 window 定时器（全部走 keepalive）',
    countOf(tr, /window\.(setTimeout|setInterval)\(/g) === 0, String(countOf(tr, /window\.(setTimeout|setInterval)\(/g)));
  ok('⑫ transport 不用原生 clear 清 keepalive 句柄（`clearTimeout(rcTimer)` 0 次）',
    countOf(tr, /clear(Timeout|Interval)\(rcTimer\)/g) === 0, String(countOf(tr, /clear(Timeout|Interval)\(rcTimer\)/g)));
  ok('⑫ 隐藏帧跳过 GPU 提交（WorldView.ts 里有 `!bg && firstFramePending`）',
    /!bg && firstFramePending/.test(wv));
}

console.log(fails === 0 ? '\nPASS' : `\nFAIL (${fails})`);
console.log('（实现退化时先看 src/app/loop-driver.ts 头注释的四条硬约束，别改断言）');
process.exit(fails === 0 ? 0 : 1);
