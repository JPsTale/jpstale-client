/**
 * **PT 时间轴状态机的算术核对**（离线）—— 把 `pt-timeline.ts` 的每一条语义
 * 按 C++ 原码手算出期望值，逐帧推进后断言（规格见 `docs/PT粒子系统-规格说明书.md` §B5）。
 *
 * 为什么必须这样做：原版的推进是 `X += Step·dt` + 双时钟，期望值可以**手算**；
 * 一旦有人把它改回"曲线插值"，或把 fade 链改成"相邻事件插值"，这里会立刻红。
 *
 * 用法：`npx tsx scripts/verify-pt-timeline.ts`
 */
import {
  buildEvents, createState, stepFrame, quadSize, roll,
  type Num, type PtEvent, type PtTimelineCfg,
} from '../src/core/effect/pt-timeline.js';

const DT = 1 / 70;
const N = (v: number): Num => ({ k: 'n', v });
const R = (a: number, b: number): Num => ({ k: 'r', a, b });
const EV = (time: number, slot: PtEvent['slot'], fade: boolean, value: Num[], next?: Partial<PtEvent>): PtEvent =>
  ({ time, slot, fade, value, next: -1, ...next });

const cfgOf = (events: PtEvent[], over: Partial<PtTimelineCfg> = {}): PtTimelineCfg => ({
  lifetime: N(1),
  emitRadius: { x: N(0), y: N(0), z: N(0) },
  gravity: { x: N(0), y: N(0), z: N(0) },
  events: buildEvents(events),
  ...over,
});

let fails = 0;

function ok(name: string, got: number, want: number, tol = 1e-6): void {
  const pass = Math.abs(got - want) <= tol;
  if (!pass) fails++;
  console.log(`${pass ? '  ✓' : '  ✗'} ${name}：期望 ${want}，实际 ${got}`);
}

console.log('① 端点：initial size=10 + fade so final size=0（寿命 1s）');
{
  const cfg = cfgOf([EV(0, 'size', false, [N(10)]), EV(1, 'size', true, [N(0)])]);
  const rand = (): number => 0;
  const st = createState(cfg, rand);
  ok('t=0 尺寸', st.val.size[0]!, 10);
  for (let f = 0; f < 35; f++) stepFrame(cfg, st, DT, rand);
  ok('t=0.5 尺寸（步长 −10/s）', st.val.size[0]!, 5);
  for (let f = 35; f < 70; f++) stepFrame(cfg, st, DT, rand);
  ok('t=1.0 尺寸', st.val.size[0]!, 0);
}

console.log('② 阶跃 + **重新瞄准**（曲线插值做不到的那条）');
{
  // initial 10 → at 0.5 直接赋值 30 → fade so final 40
  // t=0 那条事件的下一条 fade = t=1 的 final ⇒ Step = (40−10)/1 = 30/s ⇒ t=0.5− 时 25
  // t=0.5 阶跃到 30，且它的下一条 fade 也是 t=1 ⇒ Step 重算 = (40−30)/0.5 = 20/s ⇒ t=1 时 40
  const cfg = cfgOf([EV(0, 'size', false, [N(10)]), EV(0.5, 'size', false, [N(30)]), EV(1, 'size', true, [N(40)])]);
  const rand = (): number => 0;
  const st = createState(cfg, rand);
  for (let f = 0; f < 34; f++) stepFrame(cfg, st, DT, rand);
  ok('t=0.4857（阶跃前，斜坡朝 40 走）', st.val.size[0]!, 10 + 30 * (34 / 70));
  stepFrame(cfg, st, DT, rand);          // 第 35 帧：eventTimer 到 0.5 ⇒ 阶跃
  ok('t=0.5（阶跃那一刻）', st.val.size[0]!, 30);
  for (let f = 35; f < 69; f++) stepFrame(cfg, st, DT, rand);
  ok('t=0.9857（重瞄准后的斜坡 20/s）', st.val.size[0]!, 30 + 20 * ((69 - 35) / 70));
}

console.log('③ eventtimer：时钟跳变 ⇒ 游标重扫、事件重放');
{
  // at 0.2 size = 20（区间 ⇒ 靠 rand 调用次数数"触发了几次"）；at 0.4 eventtimer = 0
  let rolls = 0;
  const rand = (): number => { rolls++; return 0.5; };
  const cfg = cfgOf([
    EV(0.2, 'size', false, [R(20, 40)]),
    EV(0.4, 'eventTimer', false, [N(0)]),
  ]);
  const st = createState(cfg, rand);
  for (let f = 0; f < 28; f++) stepFrame(cfg, st, DT, rand);   // 到 t=0.4
  const rollsAfterFirst = rolls;
  ok('第一次触发（0.2s 那次）', rollsAfterFirst >= 1 ? 1 : 0, 1);
  for (let f = 28; f < 100; f++) stepFrame(cfg, st, DT, rand);
  ok('跳变后**重放**了一次（掷值调用次数 ≥2）', rolls >= 2 ? 1 : 0, 1);
}

console.log('④ SizeExt 零规则（原版 `if (sizeExt != 0) height = sizeExt`）');
{
  const cfg = cfgOf([EV(0, 'size', false, [N(10)]), EV(0, 'sizeExt', false, [N(0)])]);
  const st = createState(cfg, () => 0);
  ok('sizeExt = 0 ⇒ 高度回落 size', quadSize(st).h, 10);
  const cfg2 = cfgOf([EV(0, 'size', false, [N(10)]), EV(0, 'sizeExt', false, [N(4)])]);
  const st2 = createState(cfg2, () => 0);
  ok('sizeExt = 4 ⇒ 高度 4', quadSize(st2).h, 4);
}

console.log('⑤ 单通道颜色：redcolor 只写 .r');
{
  const col = (r: number, g: number, b: number, a: number): Num[] => [N(r), N(g), N(b), N(a)];
  const cfg = cfgOf([EV(0, 'color', false, col(10, 20, 30, 40)), EV(0.5, 'colorR', false, [N(200)])]);
  const st = createState(cfg, () => 0);
  for (let f = 0; f < 40; f++) stepFrame(cfg, st, DT, () => 0);
  ok('r 被改', st.val.color[0]!, 200);
  ok('g 未动', st.val.color[1]!, 20);
  ok('b 未动', st.val.color[2]!, 30);
  ok('a 未动', st.val.color[3]!, 40);
}

console.log('⑥ 逐轴速度：dirY 只写 .y，且 fade 链只串同槽');
{
  const cfg = cfgOf([EV(0, 'dirX', false, [N(1)]), EV(0.5, 'dirY', false, [N(2)]), EV(1, 'dirY', true, [N(6)])]);
  const st = createState(cfg, () => 0);
  // 34 帧 = t 0.4857（阶跃在第 35 帧就发生了，因为判据是 eventTimer >= 事件时间）
  for (let f = 0; f < 34; f++) stepFrame(cfg, st, DT, () => 0);
  ok('dirY 阶跃前（该槽没有 fade 链 ⇒ 0）', st.val.dir[1]!, 0);
  stepFrame(cfg, st, DT, () => 0);           // 第 35 帧 ⇒ t=0.5，阶跃
  ok('dirY 阶跃后 = 2', st.val.dir[1]!, 2);
  ok('dirX 不受影响', st.val.dir[0]!, 1);
}

console.log('⑦ 重力逐粒子逐帧重掷（区间 ⇒ 每帧新掷）');
{
  const cfg = cfgOf([], { gravity: { x: N(0), y: R(-3, 3), z: N(0) } });
  let calls = 0;
  const rand = (): number => { calls++; return calls % 2 === 0 ? 0 : 1; };   // 交替掷出 −3 / +3
  const st = createState(cfg, rand);
  const y0 = st.val.dir[1]!;
  stepFrame(cfg, st, DT, rand);
  const y1 = st.val.dir[1]!;
  stepFrame(cfg, st, DT, rand);
  const y2 = st.val.dir[1]!;
  ok('第一帧加了 ±3·dt（不为 0）', Math.abs(y1 - y0) > 0 ? 1 : 0, 1);
  ok('第二帧与第一帧的增量不同（重掷）', Math.abs((y2 - y1) - (y1 - y0)) > 0 ? 1 : 0, 1);
}

console.log('⑧ 径向速度 velocity = outlength|inlength XYZ(...)');
{
  const mk = (radial: 'out' | 'in'): number => {
    // 径向方向取的是 `LocalPos`，而 `LocalPos` 在**创建时就含发射半径**（`CreateNewParticle` 先加半径、
    // 再跑 ActualTime==0 的事件）⇒ 用 emitRadius 把出生点放到 +X 1 单位处，而不是事后改 pos
    const cfg = cfgOf([EV(0, 'dir', false, [N(10), N(10), N(10)], { radial })],
      { emitRadius: { x: N(1), y: N(0), z: N(0) } });
    const st = createState(cfg, () => 0);
    stepFrame(cfg, st, DT, () => 0);
    return st.val.dir[0]!;
  };
  ok('outlength ⇒ 沿出生点向外（+X）', mk('out'), 10);
  ok('inlength  ⇒ 沿出生点向内（−X）', mk('in'), -10);
}

console.log('⑨ 落地检查：一个真实资产的事件链能建起来（classupweapon2 的三个阶跃）');
{
  const raw = [
    EV(0, 'size', false, [N(3)]),
    EV(0.1, 'size', false, [R(3, 5)]),
    EV(0.2, 'size', false, [R(3, 5)]),
    EV(0.3, 'size', false, [R(3, 5)]),
    EV(1, 'size', true, [N(0)]),
  ];
  const evs = buildEvents(raw);
  ok('第一条的 fade 链指向 t=1 的 final', evs[0]!.next, 4);
  ok('最后一个阶跃的 fade 链也指向 final', evs[3]!.next, 4);
  ok('fade 事件自身没有后续链', evs[4]!.next, -1);
  const st = createState(cfgOf(evs), () => 0.5);
  ok('区间掷中值（rand=0.5 ⇒ 4）', roll(evs[1]!.value[0]!, () => 0.5), 4);
}

console.log(fails === 0
  ? '\n✓ 全部通过 —— 时间轴算术与 C++ 原码一致（阶跃/重瞄准/时钟跳变/零规则/单通道/逐轴/径向）'
  : `\n✗ ${fails} 条不符 —— 别改断言，先对着 docs/PT粒子系统-规格说明书.md §B5 查实现`);
process.exit(fails === 0 ? 0 : 1);
