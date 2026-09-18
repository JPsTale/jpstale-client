/**
 * `.part` → three.quarks 转换器（**验证用**，2026-09-16）
 *
 * 目的：量出"用现成粒子框架复刻 PT 特效"的真实缺口，而不是把它当正式实现。
 * 依据与结论见 `docs/粒子特效-能力分析与框架选型.md`。
 *
 * 三条已知的**语义差异**（本文件按能跑通的方式处理，逐条标注）：
 *
 * 1. **时间基准**：PT 的关键帧时间是**绝对秒**（`fade so at 0.5 color` = 粒子出生后 0.5 秒），
 *    而 quarks 的 behavior 一律按 `age / life`（归一化寿命比例）求值。
 *    当 PT 的 `lifetime` 是区间随机时，两者**不可能同时成立**。
 *    这里用 lifetime 的中值把秒折算成比例；`lifetime` 为定值时二者等价。
 *
 * 2. **发射位置与速度**：PT 的 `emitradius`（盒内均匀随机）与 `initial velocity` 是**两个独立的键**；
 *    而 quarks 的 `EmitterShape.initialize` 是唯一能写 `particle.velocity` 的地方，其内置形状
 *    （如 RectangleEmitter）会把速度设成"从中心向外"（`velocity = position.normalize() * startSpeed`）。
 *    故这里自带 `PartBoxEmitter`（见下），按 PT 语义分别写位置与速度 —— **缺口可补的证明**。
 *
 * 3. **颜色**：PT 的 `initial color` 与 `fade so at <t> color` 是**绝对色**，
 *    而 quarks 的 `ColorOverLife` 会与 `startColor` **相乘**。故 startColor 传白色，
 *    整条颜色轨道由 Gradient 承担。
 */
import * as THREE from 'three';
// ⚠ 导出面很窄：`three.quarks` 只导出 16 个名字（ParticleSystem / RenderMode / 各 Batch / QuarksUtil…），
// **值发生器与 behaviors 一律在 `quarks.core`**（three.quarks 内部同样 import 自它 ⇒ 同一份类实例）。
// 且 `ContinuousLinearFunction` 是内部类、不公开 —— 线性多关键帧见下面的 LinearTrack。
import { ParticleSystem, RenderMode } from 'three.quarks';
import {
  ConstantValue, IntervalValue, Gradient, Vector3Function,
  SizeOverLife, ColorOverLife, ApplyForce, RotationOverLife,
  Vector3 as QVec3, Quaternion as QQuat,
  type Behavior, type EmitterShape, type RotationGenerator,
  type GeneratorMemory, type Quaternion, type FunctionValueGenerator,
} from 'quarks.core';
import { reportFallback } from '../../char/fallback-log.js';
import {
  roll,
  type PartEmitter, type PartSystem, type Num, type Rgba, type Vec3,
} from '../../core/effect/part-script.js';

/* ─────────── PT 的属性轨道（线性多关键帧） ─────────── */

/**
 * PT 的属性轨道：**相邻关键帧之间线性插值**（原版 `HoNewParticleEvent_*::DoItToIt` 的 Step 机制）。
 *
 * 为什么自己实现：quarks 公开的数值发生器只有 Constant / Interval / Bezier 系，
 * 而 PT 的语义就是**线性**关键帧。用贝塞尔去凑直线是绕路，直接实现 `FunctionValueGenerator`
 * 接口（4 个方法）语义更准。时间单位是归一化的寿命比例（见文件头条 1）。
 */
class LinearTrack implements FunctionValueGenerator {
  type = 'function' as const;
  constructor(private readonly keys: Array<[number, number]>) {}   // [时间 0..1, 值]

  startGen(): void { /* 无内部状态 */ }

  genValue(_memory: unknown, t = 0): number {
    const ks = this.keys;
    if (ks.length === 0) return 0;
    if (t <= ks[0]![0]) return ks[0]![1];
    for (let i = 1; i < ks.length; i++) {
      const [t1, v1] = ks[i]!;
      if (t <= t1) {
        const [t0, v0] = ks[i - 1]!;
        const span = t1 - t0;
        return span <= 0 ? v1 : v0 + (v1 - v0) * ((t - t0) / span);
      }
    }
    return ks[ks.length - 1]![1];
  }

  toJSON(): { type: 'function'; keys: Array<[number, number]> } {
    return { type: 'function', keys: this.keys };
  }

  clone(): LinearTrack { return new LinearTrack(this.keys.map((k) => [k[0], k[1]] as [number, number])); }
}

/* ─────────── 值映射 ─────────── */

/** PT 的标量（定值或区间）→ quarks 的值发生器 */
function numGen(n: Num | null | undefined, fallback = 0): ConstantValue | IntervalValue {
  if (!n) return new ConstantValue(fallback);
  return n.k === 'n' ? new ConstantValue(n.v) : new IntervalValue(n.a, n.b);
}

/** 取一个 Num 的代表值（用于把区间折叠成单点，如归一化时间基准） */
function midOf(n: Num | null | undefined, fallback = 0): number {
  if (!n) return fallback;
  return n.k === 'n' ? n.v : (n.a + n.b) / 2;
}

/** PT 的 rgba（各分量可区间）→ quarks 的 Gradient（颜色 + 独立 alpha 两条轨道） */
function colorToGradient(stops: Array<{ t: number; c: Rgba }>): Gradient {
  const colors: Array<[QVec3, number]> = [];
  const alphas: Array<[number, number]> = [];
  for (const s of stops) {
    // PT 的颜色分量是 0..255，quarks 的 Vector4/Gradient 一律 0..1
    colors.push([new QVec3(midOf(s.c.r) / 255, midOf(s.c.g) / 255, midOf(s.c.b) / 255), s.t]);
    alphas.push([midOf(s.c.a, 255) / 255, s.t]);
  }
  return new Gradient(colors, alphas);
}

/**
 * PT 的"绝对值轨道" → quarks 的**尺寸倍率轨道**。
 *
 * ⚠ 语义差异（实测项之一）：quarks 的 `SizeOverLife` 是**乘法**
 * （`particle.size = startSize × factor(t)`），而 PT 的 `fade so final size` 是**绝对值**。
 * 折法：整体除以 `track(0)` ⇒ `factor(0)=1`、`factor(1)=final/init`，
 * 而出生值仍由 `startSize` 承担（保留 PT 的区间随机）。
 * `initial size` 是**定值**时两者完全等价；是**区间随机**时，每个粒子的终点会按自己的初值等比缩放
 * （PT 是全部落到同一绝对值）。要精确复刻需自定义 behavior —— quarks 的 `Particle.startSize`
 * 是可见的，所以那是可行的，只是不再是"现成能力"。
 */
function factorTrack(
  init: Num | null | undefined,
  kfs: Array<{ t: number; v: Num }>,
  final: Num | null | undefined,
): ConstantValue | IntervalValue | LinearTrack {
  const v0 = midOf(init, 1) || 1;
  const keys: Array<[number, number]> = [[0, 1]];
  for (const k of kfs) if (k.t > 0 && k.t < 1) keys.push([k.t, midOf(k.v) / v0]);
  if (final) keys.push([1, midOf(final) / v0]);
  if (keys.length === 1) return new ConstantValue(1);   // 无终点也无中间帧 ⇒ 尺寸恒定
  return new LinearTrack(keys);
}

/** 白色常量：startColor 传白，颜色轨道全部由 ColorOverLife 的 Gradient 承担（文件头条 3） */
function whiteColor(): Gradient {
  return new Gradient([[new QVec3(1, 1, 1), 0]], [[1, 0]]);
}

/** 由 emitter 的 keyframes 取某属性的**带时间**关键帧（时间已折算为比例） */
function kfOf(em: PartEmitter, prop: string, lifetimeSec: number): Array<{ t: number; c: Rgba }> {
  const out: Array<{ t: number; c: Rgba }> = [];
  const kfs = em.keyframes[prop];
  if (!kfs) return out;
  for (const k of kfs) {
    if (k.value.k !== 'color') continue;
    out.push({ t: Math.min(1, k.time / lifetimeSec), c: k.value.v });
  }
  return out;
}

/** 由 emitter 的 keyframes 取某属性的数值关键帧（时间已归一化为寿命比例） */
function numKfOf(em: PartEmitter, prop: string, lifetimeSec: number): Array<{ t: number; v: Num }> {
  const kfs = em.keyframes[prop];
  if (!kfs) return [];
  const out: Array<{ t: number; v: Num }> = [];
  for (const k of kfs) {
    if (k.value.k !== 'num') continue;
    out.push({ t: Math.min(1, k.time / lifetimeSec), v: k.value.v });
  }
  return out;
}

/**
 * **已应用的时间轴属性**（`fade so at <t> <属性>` 里我们真的落到 quarks 的那些）。
 *
 * ⚠ **唯一出处**：扫描器（`scripts/scan-part-coverage.ts`）与加载器的"未应用即上报"
 * （`part-assets.loadPartFromSystem`）都读这里 —— 别再各自抄一份（AGENTS #15）。
 * 加新轨道时两件事一起做：在 `convertPart` 里实现 + 把属性名加进来。
 */
export const APPLIED_KEYFRAME_PROPS = [
  'size', 'sizeext', 'color', 'velocity',
  'partanglez', 'partanglex', 'partangley',
  'localanglez', 'localanglex', 'localangley',
] as const;

/** 由 emitter 的 keyframes 取某属性的**向量**关键帧（时间已归一化为寿命比例） */
function vecKfOf(em: PartEmitter, prop: string, lifetimeSec: number): Array<{ t: number; v: Vec3 }> {
  const kfs = em.keyframes[prop];
  if (!kfs) return [];
  const out: Array<{ t: number; v: Vec3 }> = [];
  for (const k of kfs) {
    if (k.value.k !== 'vec') continue;
    out.push({ t: Math.min(1, k.time / lifetimeSec), v: k.value.v });
  }
  return out;
}

/** 给一组关键帧补上端点（初值 t=0 / 终点 t=1），按 t 排序；同一 t 保留最后一个（后写覆盖先写） */
function withEnds<K extends { t: number }>(keys: K[], head: K | null, tail: K | null): K[] {
  const all = [...(head ? [head] : []), ...keys, ...(tail ? [tail] : [])].sort((a, b) => a.t - b.t);
  const out: K[] = [];
  for (const k of all) {
    if (out.length && Math.abs(out[out.length - 1]!.t - k.t) < 1e-6) out[out.length - 1] = k;
    else out.push(k);
  }
  return out;
}

/* ─────────── PT 语义的盒形发射器（缺口可补的证明，约 30 行） ─────────── */

/**
 * PT 的发射语义：位置 = `emitradius` 三轴**各自区间**内均匀随机（相对系统原点），
 * 速度 = `initial velocity` 三轴各自区间内均匀随机。
 * quarks 内置形状都不是这个语义（RectangleEmitter 是 2D 边框 + 径向速度），故自定义。
 */
/**
 * **世界朝向面片**的随机朝向发生器 —— 我们只用到它的"随机四元数"行为
 * （原版 `sinPublicEffect.cpp:391-392`：`Angle.x = rand()%4096; Angle.y = rand()%4096` ⇒ 三维随机朝向）。
 *
 * ⚠ 用**自定义**而非内建 `RandomQuatGenerator`：一是只需"均匀随机朝向"这一个语义（Shoemake 法），
 *   二是这样 `genValue` 的写入点在我们手里，日后"让速度与朝向共用同一次随机"时好接。
 */
export class RandomOrientation implements RotationGenerator {
  type = 'rotation' as const;
  startGen(): void { /* 无逐粒子预生成状态 */ }
  genValue(_memory: GeneratorMemory, q: Quaternion): Quaternion {
    // 均匀随机四元数（Shoemake）—— 原版 `Angle.x/y = rand()%4096` 两轴随机的等价物
    const u1 = Math.random(), u2 = Math.random(), u3 = Math.random();
    const r1 = Math.sqrt(1 - u1), r2 = Math.sqrt(u1);
    const x = r1 * Math.sin(2 * Math.PI * u2);
    const y = r1 * Math.cos(2 * Math.PI * u2);
    const z = r2 * Math.sin(2 * Math.PI * u3);
    const w = r2 * Math.cos(2 * Math.PI * u3);
    // quarks 的 Quaternion 是类（字段 `_x..` + 访问器）⇒ 有 set() 就用它，否则按字段写
    const anyQ = q as unknown as { set?: (a: number, b: number, c: number, d: number) => void; x: number; y: number; z: number; w: number };
    if (typeof anyQ.set === 'function') anyQ.set(x, y, z, w);
    else { anyQ.x = x; anyQ.y = y; anyQ.z = z; anyQ.w = w; }
    return q;
  }
  toJSON(): { type: string } { return { type: this.type }; }
  clone(): RotationGenerator { return new RandomOrientation(); }
}

/**
 * **初始面内旋转**：`.part` 的 `initial partAngleZ`（**度**，可 `random(a,b)`）→ 广告板的标量弧度。
 *
 * 为什么必须是 Behavior：广告板的朝向存在 `particle.rotation`（**number**，见 quarks
 * `RotationOverLife.update` 的 `typeof particle.rotation === 'number'` 判据），
 * 而 quarks **没有** `startRotation` 这个字段（`quarks.core` 的导出表里查不到 ——
 * 我们表里那个 `startRotation` 一直是**死参数**，写进去从不生效）。
 * Behavior 的 `initialize(particle)` 由 `three.quarks:1061` 在出生时调用 ⇒ 初值写在这里。
 *
 * ⚠ x/y 分量表达不了（要给广告板加倾斜，quarks 的 billboard 没这个自由度）⇒ `convertPart` 里上报。
 */
export class PtInitialRotation implements Behavior {
  type = 'PtInitialRotation';
  constructor(private degZ: Num) {}
  initialize(p: { rotation?: unknown }): void {
    if (typeof p.rotation === 'number') p.rotation = (roll(this.degZ) * Math.PI) / 180;
  }
  update(): void { /* 只写初值 */ }
  frameUpdate(): void { /* 无 */ }
  toJSON(): { type: string } { return { type: this.type }; }
  clone(): PtInitialRotation { return new PtInitialRotation(this.degZ); }
  reset(): void { /* 无状态 */ }
}

/** 线性采样一组"随时间"的向量键（t 为寿命比例） */
function sampleVec(keys: Array<{ t: number; v: Vec3 }>, t: number): { x: number; y: number; z: number } | null {
  if (keys.length === 0) return null;
  const at = (v: Vec3) => ({ x: midOf(v.x, 0), y: midOf(v.y, 0), z: midOf(v.z, 0) });
  if (t <= keys[0]!.t) return at(keys[0]!.v);
  const last = keys[keys.length - 1]!;
  if (t >= last.t) return at(last.v);
  for (let i = 0; i + 1 < keys.length; i++) {
    const a = keys[i]!, b = keys[i + 1]!;
    if (t >= a.t && t <= b.t) {
      const k = (t - a.t) / Math.max(1e-6, b.t - a.t);
      const pa = at(a.v), pb = at(b.v);
      return { x: pa.x + (pb.x - pa.x) * k, y: pa.y + (pb.y - pa.y) * k, z: pa.z + (pb.z - pa.z) * k };
    }
  }
  return at(last.v);
}

/**
 * **速度随时间变化**（`.part` 的 `fade so at <t> velocity = XYZ(...)`）—— 逐帧**覆盖** `particle.velocity`。
 *
 * 实测：49 个 `.part` 带这条轨道，其中 **22 个与初速不同** ⇒ 不应用就是看得出的差异（此前未应用 ✗）。
 * quarks 的位置推进用的是 `velocity × speedModifier` ⇒ 这里直接给绝对速度、把 `speedModifier` 归 1。
 */
export class VelocityTrack implements Behavior {
  type = 'VelocityTrack';
  constructor(private keys: Array<{ t: number; v: Vec3 }>) {}
  initialize(p: { speedModifier?: number }): void { p.speedModifier = 1; }
  update(p: {
    age?: number; life?: number; speedModifier?: number;
    velocity?: { set(x: number, y: number, z: number): void };
  }): void {
    const v = sampleVec(this.keys, (p.age ?? 0) / Math.max(1e-6, p.life ?? 1));
    if (!v) return;
    p.velocity?.set(v.x, v.y, v.z);
    p.speedModifier = 1;
  }
  frameUpdate(): void { /* 无 */ }
  toJSON(): { type: string } { return { type: this.type }; }
  clone(): VelocityTrack { return new VelocityTrack(this.keys); }
  reset(): void { /* 无状态 */ }
}

/**
 * **面内自转随时间变化**（`.part` 的 `fade so at <t> partAngleZ = <度>`）——
 * 逐帧写 `particle.rotation`（**弧度**；广告板的 rotation 是标量，见 `PtInitialRotation` 的说明）。
 * x/y 分量是"出平面倾斜"，广告板表达不了 ⇒ 由 `convertPart` 上报（AGENTS #12）。
 */
export class PtRotationTrack implements Behavior {
  type = 'PtRotationTrack';
  constructor(private keys: Array<{ t: number; v: number }>) {}
  initialize(): void { /* 逐帧在 update 里写 */ }
  update(p: { age?: number; life?: number; rotation?: unknown }): void {
    if (typeof p.rotation !== 'number' || this.keys.length === 0) return;
    const t = (p.age ?? 0) / Math.max(1e-6, p.life ?? 1);
    const k = this.keys;
    let deg: number;
    if (t <= k[0]!.t) deg = k[0]!.v;
    else if (t >= k[k.length - 1]!.t) deg = k[k.length - 1]!.v;
    else {
      let i = 0;
      while (i + 1 < k.length && !(t >= k[i]!.t && t <= k[i + 1]!.t)) i++;
      const a = k[i]!, b = k[Math.min(i + 1, k.length - 1)]!;
      const f = (t - a.t) / Math.max(1e-6, b.t - a.t);
      deg = a.v + (b.v - a.v) * f;
    }
    p.rotation = (deg * Math.PI) / 180;
  }
  frameUpdate(): void { /* 无 */ }
  toJSON(): { type: string } { return { type: this.type }; }
  clone(): PtRotationTrack { return new PtRotationTrack(this.keys); }
  reset(): void { /* 无状态 */ }
}

/** Mesh（TYPE_FIVE）模式的初始随机朝向 —— 同上，`startRotation` 不生效 ⇒ 用 Behavior 写四元数 */
export class MeshRandomOrientation implements Behavior {
  type = 'MeshRandomOrientation';
  private g = new RandomOrientation();
  initialize(p: { rotation?: unknown }): void {
    const q = p.rotation;
    if (q && typeof q === 'object') {
      this.g.genValue(null as unknown as GeneratorMemory, q as Quaternion);
    }
  }
  update(): void { /* 只写初值 */ }
  frameUpdate(): void { /* 无 */ }
  toJSON(): { type: string } { return { type: this.type }; }
  clone(): MeshRandomOrientation { return new MeshRandomOrientation(); }
  reset(): void { /* 无状态 */ }
}

/** "面向相机"用的相机引用 —— 由渲染侧注册一次（`WorldView` / 实验室各一次）；粒子朝向要用它 */
let billboardCam: THREE.Camera | null = null;
/** 注册"面向相机"的相机（唯一入口；传 null 可注销）。只在建好相机后调一次。 */
export function setBillboardCamera(cam: THREE.Camera | null): void { billboardCam = cam; }

/**
 * **面向相机的基底 + 局部 Y 自转**（`localangleY` 的忠实形态）—— Mesh 模式粒子专用。
 *
 * 为什么需要它：quarks 的 Mesh 是**世界朝向**面片（朝向只由逐粒子四元数决定）⇒
 * 直接切过去会在一些机位**侧立看不见**（用户实测："怎么看不到对应的粒子了"）。
 * 而原版这些粒子是 **billboard**（永远面向相机）+ `localangle` 在相机朝向上再倾斜 ⇒
 * 这里每帧显式写：`q = 相机朝向 × Rot(局部 +Y, θ(t))`，θ 由 `初值 + 角速度 × age` **现算**
 * （不用累加 ⇒ 不受帧率/掉帧影响）。
 */
const AXIS_X = new QVec3(1, 0, 0);
const AXIS_Y = new QVec3(0, 1, 0);
const AXIS_Z = new QVec3(0, 0, 1);

/** 角度轨（t = 寿命比例，v = 度）—— 与 `PtRotationTrack` 同一套采样语义 */
type DegTrack = Array<{ t: number; v: number }>;

/** 采样角度轨（与 `PtRotationTrack` 相同的线性插值；空轨 ⇒ 0） */
function sampleDeg(keys: DegTrack, t: number): number {
  if (!keys.length) return 0;
  if (t <= keys[0]!.t) return keys[0]!.v;
  const last = keys[keys.length - 1]!;
  if (t >= last.t) return last.v;
  let i = 0;
  while (i + 1 < keys.length && !(t >= keys[i]!.t && t <= keys[i + 1]!.t)) i++;
  const a = keys[i]!, b = keys[Math.min(i + 1, keys.length - 1)]!;
  const f = (t - a.t) / Math.max(1e-6, b.t - a.t);
  return a.v + (b.v - a.v) * f;
}

/**
 * **面向相机的基底 + 局部三轴旋转**（`partanglex/y/z` 与 `localanglex/y/z` 的忠实形态）。
 *
 * 为什么必须自带基底：quarks 的 Mesh 是**世界朝向**面片，直接切过去会在某些机位侧立看不见
 * （用户实测）；原版这些粒子是 **billboard**（永远面向相机）+ `LocalAngle/PartAngle` 在相机朝向上再倾斜 ✓。
 * 每帧写 `q = 相机朝向 × Ry(y) × Rx(x) × Rz(z)`；角度取自**关键帧轨**（初值/中间/终值全在内），
 * 与 `PtRotationTrack` 同一套线性采样 ✓。
 */
export class PtCameraFacingSpin implements Behavior {
  type = 'PtCameraFacingSpin';
  private tmp = new QQuat();
  constructor(private tracks: { x?: DegTrack; y?: DegTrack; z?: DegTrack }) {}
  initialize(): void { /* 无状态（逐帧现算，不累加） */ }
  update(p: { age?: number; life?: number; rotation?: unknown }): void {
    const q = p.rotation;
    if (!billboardCam || !(q instanceof QQuat)) return;
    const cq = billboardCam.quaternion;
    (q as unknown as { set(x: number, y: number, z: number, w: number): void })
      .set(cq.x, cq.y, cq.z, cq.w);                       // 基底 = 相机朝向 ⇒ 面片正对相机
    const t = (p.age ?? 0) / Math.max(1e-6, p.life ?? 1);
    const mul = (axis: QVec3, deg: number): void => {
      if (!deg) return;
      this.tmp.setFromAxisAngle(axis, (deg * Math.PI) / 180);
      (q as unknown as { multiply(q2: unknown): void }).multiply(this.tmp);
    };
    mul(AXIS_Y, sampleDeg(this.tracks.y ?? [], t));
    mul(AXIS_X, sampleDeg(this.tracks.x ?? [], t));
    mul(AXIS_Z, sampleDeg(this.tracks.z ?? [], t));
  }
  frameUpdate(): void { /* 无 */ }
  toJSON(): { type: string } { return { type: this.type }; }
  clone(): PtCameraFacingSpin { return new PtCameraFacingSpin(this.tracks); }
  reset(): void { /* 无状态 */ }
}

/** 单向面片的几何：单位平面在**局部 XY**（法线 = 局部 +z），尺寸由粒子 `size` 缩放 ⇒ 与原版 `sinCreateObject` 同构 */
const ORIENTED_UNIT_QUAD = new THREE.PlaneGeometry(1, 1, 1, 1);

/**
 * **世界朝向面片的运动**（原版 `sinPublicEffectMove` 的 `SIN_EFFECT_WIDELINE` 分支，1:1）：
 *   · **沿自身面法线飞**：`GetMoveLocation(0, 0, MoveSpeed.z, Angle.x, Angle.y, 0)`
 *     ⇒ 法线 = 局部 +z ⇒ 世界方向 = 四元数作用于 (0,0,1)（旋转矩阵第 3 列）
 *   · **面内自转**：`Angle.z += 16`/帧 —— 原版累加的是 `Angle` 的 **z 分量**，而复合序 Z 在先
 *     ⇒ 语义是"绕**局部 z**（= 卡片法线）转" ⇒ 这里用**四元数右乘** Δq(轴=(0,0,1), 16 单位/帧)
 *     （右乘 = 绕局部轴 ✓；16/4096 圈/帧 ⇒ 1.472 rad/s @60fps）
 *
 * ⚠ 每帧都设（原版也逐帧从当前 `Angle` 算）⇒ 飞行方向会跟着自转一起转（与源码同构）。
 * ⚠ 读粒子自身的四元数 ⇒ 与 `RandomOrientation` 天然共享同一次随机，不需要额外管线。
 * ⚠ 入参宽松：`Particle.rotation` 是 `number | Quaternion | undefined`（广告板存**标量**）⇒ 标量/缺失直接返回。
 * ⚠ 不用 quarks 的 `RotationOverLife`：它在 Mesh 模式下动的是标量还是四元数未核实（源码只读到签名）。
 */
export class OrientVelocityToNormal implements Behavior {
  type = 'orientVelocityToNormal';
  /** 面内自转角速度：原版 `Angle.z += 16` 单位/帧（4096 = 一圈）⇒ 16/4096×2π×60 ≈ 1.472 rad/s */
  private static readonly SPIN_RAD_PER_SEC = (16 / 4096) * Math.PI * 2 * 60;
  constructor(private speed: number) {}
  initialize(): void { /* 首帧由 update 设定（rotation 可能尚未生成） */ }
  update(particle: unknown, delta: number): void {
    const p = particle as {
      rotation?: unknown;
      velocity?: { x: number; y: number; z: number };
    };
    const q = p.rotation as { x: number; y: number; z: number; w: number } | number | undefined;
    if (!q || typeof q === 'number' || !p.velocity) return;

    // ① 面内自转：绕**局部 +z** 右乘（Δq = (0, 0, sin(θ/2), cos(θ/2))）
    const half = (OrientVelocityToNormal.SPIN_RAD_PER_SEC * (delta || 0)) / 2;
    const sZ = Math.sin(half), cZ = Math.cos(half);
    const { x, y, z, w } = q;
    const nx = x * cZ + y * sZ;
    const ny = -x * sZ + y * cZ;
    const nz = w * sZ + z * cZ;
    const nw = w * cZ - z * sZ;
    const anyQ = q as unknown as { set?: (a: number, b: number, c: number, d: number) => void };
    if (typeof anyQ.set === 'function') anyQ.set(nx, ny, nz, nw);
    else { q.x = nx; q.y = ny; q.z = nz; q.w = nw; }

    // ② 沿（自转后的）面法线飞
    p.velocity.x = 2 * (nx * nz + nw * ny) * this.speed;
    p.velocity.y = 2 * (ny * nz - nw * nx) * this.speed;
    p.velocity.z = (1 - 2 * (nx * nx + ny * ny)) * this.speed;
  }
  frameUpdate(): void { /* 逐粒子在 update 里做 */ }
  toJSON(): { type: string; speed: number } { return { type: this.type, speed: this.speed }; }
  clone(): OrientVelocityToNormal { return new OrientVelocityToNormal(this.speed); }
  reset(): void { /* 无状态 */ }
}

export class PartBoxEmitter implements EmitterShape {
  type = 'partBox';
  constructor(private radius: Vec3, private velocity: Vec3) {}
  initialize(p: { position: QVec3; velocity: QVec3 }): void {
    p.position.x = roll(this.radius.x);
    p.position.y = roll(this.radius.y);
    p.position.z = roll(this.radius.z);
    p.velocity.x = roll(this.velocity.x);
    p.velocity.y = roll(this.velocity.y);
    p.velocity.z = roll(this.velocity.z);
  }
  update(): void { /* 盒是静态的，无需推进 */ }
  toJSON(): { type: string } { return { type: this.type }; }
  clone(): PartBoxEmitter { return new PartBoxEmitter(this.radius, this.velocity); }
}

/* ─────────── 面朝向 / 混合 ─────────── */

/**
 * PT 的 4 种面朝向 → quarks 的 RenderMode。
 * 对应关系（原版 `AddFace*` 见 `plans/2026-09-11-audio-effects.md` §6.3）：
 *   ONE   朝向相机   → BillBoard
 *   TWO   水平 XZ 面 → HorizontalBillBoard
 *   THREE 竖直条带   → VerticalBillBoard
 *   FOUR  拖尾       → Trail
 */
/**
 * 该发射器是否需要**局部轴自转**（`.part` 的 `localangle*`，如 `initial localangleY` /
 * `fade so final localangleY`）—— 样本：`chaoskaraskill.part`（CC 技能，`final localAngleY = random(100,200)`）。
 *
 * ⚠ **这一支必须走 Mesh 模式**，因为"绕局部 Y 轴转"是 3D 姿态：
 *   · 广告板的顶点着色器只吃**标量**面内角（`three.quarks/src/shaders/particle_vert.glsl.ts:33-38`）；
 *   · 而 quarks 的 `Rotation3DOverLife` 只在 `particle.rotation` 是**四元数**时生效
 *     （`quarks.core/src/behaviors/Rotation3DOverLife.ts:22-31`）。
 *   Mesh 模式下 quarks 自己把 `startRotation` 设成 `AxisAngleGenerator`（`ParticleSystem.ts:656`）
 *   ⇒ 逐粒子旋转值就是四元数 ⇒ 能表达。
 */
/**
 * 该发射器是否需要**3D 局部旋转**（`partanglex/y` 或 `localanglex/y` 有非零值）——
 * 需要就必须走 Mesh 模式（广告板只有面内 z，表达不了倾斜），见 `PtCameraFacingSpin`。
 */
export function needs3DRotation(em: PartEmitter): boolean {
  for (const ax of ['x', 'y'] as const) {
    const t = angleTrackOf(em, ax, Math.max(0.05, midOf(em.lifetime, 1)));
    if (t.some((k) => Math.abs(k.v) > 1e-3)) return true;
  }
  return false;
}

/**
 * 取某轴的**局部旋转角度轨**（`partangle*` 与 `localangle*` **合并**；t = 寿命比例、v = 度）。
 *
 * 两族在 `.part` 里是两条独立声明（原版分别是 `PartAngle` 与 `LocalAngle`），
 * 我们按"同轴相加"合成一条 —— 骨架与 `partanglez` 的既有读法一致（初值 + 关键帧 + 终值）。
 */
export function angleTrackOf(em: PartEmitter, axis: 'x' | 'y' | 'z', lifeSec: number): Array<{ t: number; v: number }> {
  const pick = (v: Vec3 | null | undefined): Num | undefined =>
    (!v ? undefined : axis === 'x' ? v.x : axis === 'y' ? v.y : v.z);
  const kfOf = (name: string): Array<{ t: number; v: number }> =>
    numKfOf(em, name, lifeSec).map((k) => ({ t: k.t, v: midOf(k.v, 0) }));
  const ends = (v: Num | undefined, at: number): { t: number; v: number } | null =>
    (v == null ? null : { t: at, v: midOf(v, 0) });
  const part = withEnds(kfOf('partangle' + axis), ends(pick(em.initialPartAngle), 0), ends(pick(em.finalPartAngle), 1));
  const local = withEnds(kfOf('localangle' + axis), ends(pick(em.initialLocalAngle), 0), ends(pick(em.finalLocalAngle), 1));
  const num = (k: Array<{ t: number; v: unknown }>): Array<{ t: number; v: number }> =>
    k.map((x) => ({ t: x.t, v: midOf(x.v as Num, 0) }));
  const a = num(part);
  const b = num(local);
  if (!a.length) return b;
  if (!b.length) return a;
  const ts = [...new Set([...a.map((k) => k.t), ...b.map((k) => k.t)])].sort((x, y) => x - y);
  return ts.map((t) => ({ t, v: sampleDeg(a, t) + sampleDeg(b, t) }));
}

export function renderModeOf(particleType: number): RenderMode {
  switch (particleType) {
    case 1: return RenderMode.BillBoard;
    case 2: return RenderMode.HorizontalBillBoard;
    case 3: return RenderMode.VerticalBillBoard;
    case 4: return RenderMode.Trail;
    // **5 = 世界朝向面片**（我方扩展，不是 PT 的类型；原版这类效果走 `SIN_EFFECT_MESH` 网格子系统）
    // 用 quarks 的 Mesh 模式：几何来自 `instancingGeometry`，朝向是**逐粒子的四元数**
    //（`SpriteBatch.ts:60-64` 的 rotation 是 4 个 float；`local_particle_vert.glsl` 真的用它建旋转矩阵）
    case 5: return RenderMode.Mesh;
    default: return RenderMode.BillBoard;
  }
}

/**
 * PT 的 5 种混合 → three 的混合。
 * LAMP/ALPHA 是一等映射；COLOR/SHADOW/INVSHADOW 是 D3D 的因子组合，
 * 靠 three 的 CustomBlending + blendSrc/blendDst 表达（因子表与我方 `part-emitter` 一致）。
 * 返回 undefined 表示"用默认"，由材质承担具体因子。
 */
/**
 * 混合表 —— **全项目唯一一份**（`part-to-quarks` 与 `ini-to-quarks` 共用；
 * 此前 ini 那条手抄了一份，2026-09-17 合成此处）。
 *
 * ⚠ **遮罩来自贴图**（2026-09-18 起）：解码特效贴图时把**亮度烘进 alpha**
 * （`char-texture-loader.fetchAndDecodeTexture`，仅对"本来没有 alpha 通道"的贴图）——
 * 与粒子颜色无关 ⇒ 任意色相都能出光；不再使用 `USE_COLOR_AS_ALPHA`（那条取颜色红通道会抠掉蓝/青）。
 * 下面是当初那条偏离的理由留存（历史）：
 * 理由与依据：
 *   · 原版 `SMMAT_BLEND_LAMP` = `SRC_ALPHA / ONE`，其语义是"**用 alpha 当光晕遮罩**"
 *     （`Graphics/DeviceRenderState.cpp`，见 `plans/2026-09-11-audio-effects.md` §6）
 *   · 但实测这些特效贴图的 **alpha 全是 255**（`light01.tga` / `m_spark06.tga`；
 *     连 AGENTS 列的独立副本"11 职业私服客户端"也一致）⇒ **遮罩本来就不存在**
 *   · 于是加法加的是**整块 RGB**，而 `m_spark06.tga` 的底噪均值 **45.9**（`maam2.tga` 67.0）
 *     ⇒ 每一颗粒子都在暗背景上留下一块**方形亮斑**（用户实测："闪光看起来是方形的"）
 *   · 用**亮度**当遮罩正好补回该混合式**本来要的东西**：亮心不变（255×1）、
 *     底噪≈0（7×0.03）、边缘按亮度自然柔化 —— 观感与原版"有 alpha 遮罩时"一致
 *   · `color` / `shadow` **不动**：那两种混合用的是 **RGB 因子**（`SRC_COLOR` 等），
 *     本来就不依赖 alpha，背景天然被乘掉（`dust1` 走 `color`，一直正常）
 *   ⇒ 想回到"严格按美术原始值相加"，删掉下面这两行 `defines` 即可。
 */
export function applyBlend(mat: THREE.Material, blend: PartEmitter['blend']): void {
  // ⚠ **`USE_COLOR_AS_ALPHA` 已不再使用**（2026-09-18）：那条 hack 取的是 `diffuseColor.r`
  //   ⇒ 红通道低的颜色（蓝/青/紫）会被整片抠掉，而红通道高的又会把贴图底噪加成方框。
  //   现改为**在贴图解码时把亮度烘进 alpha**（`char-texture-loader.fetchAndDecodeTexture`，
  //   仅对"本来没有 alpha 通道"的特效贴图）⇒ 遮罩来自贴图本身、与颜色无关、无阈值、无方框。
  //   混合因子照旧（`SRC_ALPHA/ONE` 等），alpha 由贴图给出。
  switch (blend) {
    case 'lamp':
    case 'addcolor':   // 原版第 3 种混合（`HoNewParticle.cpp:689` 的 6 模式表）；
      // 因子组合本模块**未核实** ⇒ 先按 lamp 的加法走（与 lamp 同路，但**不静默**：见 convertPart 的 notes）
      mat.blending = THREE.AdditiveBlending;
      break;
    case 'alpha':
      mat.blending = THREE.NormalBlending;
      break;
    case 'color':
      mat.blending = THREE.CustomBlending;
      mat.blendSrc = THREE.SrcColorFactor; mat.blendDst = THREE.OneMinusSrcColorFactor;
      break;
    case 'shadow':
      mat.blending = THREE.CustomBlending;
      mat.blendSrc = THREE.ZeroFactor; mat.blendDst = THREE.SrcColorFactor;
      break;
    case 'invshadow':
      // ⚠ **刻意偏离**（与 lamp/alpha/addcolor 同一类，理由相同）：
      //   原版是 **RGB 因子**混合（`ZERO / INV_SRC_COLOR` = `dst×(1-src)`），
      //   而我们的贴图**没有 alpha 遮罩**（24 位 BMP，alpha 恒 255）⇒ `src` 里的**底噪**
      //   直接参与运算，画面上就是**一整块方框**（用户实测：陨石"淡蓝色正方形（中间是蓝色）"）。
      //   浏览器里做过 A/B：跳过该发射器 ⇒ 方框消失（只剩 lamp 的柔和光团）；
      //   按原因子 ⇒ 方框可见；改成普通透明混合 ⇒ 变成黑方框。
      //   ⇒ 用**遮罩 + 普通透明混合**，观感回到"有遮罩时"的样子。
      //   遮罩现在来自**贴图本身**（解码时把亮度烘进 alpha，见 `char-texture-loader`）——
      //   不再需要 `USE_COLOR_AS_ALPHA`（那条取的是颜色红通道，会把蓝/青系整片抠掉）。
      mat.blending = THREE.NormalBlending;
      break;
  }
}

/* ─────────── 主转换 ─────────── */

export interface ConvertOptions {
  /** 只转前 N 个 emitter（默认全部） */
  maxEmitters?: number;
}

export interface ConvertedEmitter {
  system: ParticleSystem;
  emitterName: string;
  /** 转换过程中的诊断（缺资产、语义近似等），逐条显示在验证页上 */
  notes: string[];
}

/**
 * 把一个 `.part` 系统转成若干 `ParticleSystem`（原版每个 `eventsequence` 一个）。
 * 纹理**由调用方给**（走 client 的 `part-assets.loadPart`：那份 tga/bmp 解码是唯一实现，
 * 浏览器不能直接解码这两种格式）。
 */
export function convertPart(
  sys: PartSystem,
  textures: Array<THREE.Texture | null>,
  opts: ConvertOptions = {},
): ConvertedEmitter[] {
  const out: ConvertedEmitter[] = [];
  const count = Math.min(opts.maxEmitters ?? sys.emitters.length, sys.emitters.length);

  for (let i = 0; i < count; i++) {
    const em = sys.emitters[i]!;
    const notes: string[] = [];
    /** 该发射器是否要"绕局部 Y 自转"（决定渲染模式，见 `hasLocalAngle`） */
    const need3D = needs3DRotation(em);
    const lifeSec = midOf(em.lifetime, 1) || 1;
    const tex = textures[i] ?? null;
    if (em.texture && !tex) notes.push(`贴图未加载：${em.texture}`);
    if (!em.texture) notes.push('该发射器无 texture 键');

    // 材质只承担混合；贴图走 ParticleSystem.texture
    const material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, depthTest: true });
    // Mesh（世界朝向面片 / 相机朝向基底）要**双面**：我们显式写的基底里，面片可能以背面朝相机
    if (need3D) material.side = THREE.DoubleSide;
    applyBlend(material, em.blend);
    // ⚠ **"亮度当遮罩"（`USE_COLOR_AS_ALPHA`）取的是 `diffuseColor.r`（红通道）** ⇒
    //   **蓝/青粒子（红≈0）会被整片抠掉**（红色则安然 —— 实测：CC 吸血技能"只剩红色面片"）。
    //   而原版 `BLEND_LAMP`（`SRC_ALPHA/ONE`，贴图 24 位、alpha 恒 1）是**整块 RGB 相加** ——
    //   用户实证：魔法师"魔法转生命"那招**会飘出蓝色粒子** ⇒ 蓝必须能出光。
    //   ⇒ 红通道极低的颜色**不套这个遮罩**，回落到真实 alpha（= 颜色/贴图 alpha）：
    //     代价是这些粒子会带回"贴图底噪的整块方框" —— **那正是原版的样子**（忠实优先）。
    //   更好的修法（待做）：把遮罩从"颜色的红通道"改成"**贴图的亮度**"（在贴图解码时烘一次），
    //     这样任意色相都能出光、且没有底噪方框。
    // `BLEND_ADDCOLOR`：原版 6 种混合里的第 3 种（`HoNewParticle.cpp:689`），我们按 lamp 的加法走，
    // 但**因子未核实** ⇒ 必须留痕（现有资产里没有任何文件用它；这条是为将来/别的私服副本兜住"不静默"）
    if (em.blend === 'addcolor') {
      notes.push('混合 BLEND_ADDCOLOR：按 lamp 的加法处理（该模式的 D3D 因子本模块未核实）');
    }

    // 尺寸：PT 的 size = 宽、sizeExt = 高（两维独立）
    // ⚠ `sizeExt` **缺失时取 size**（PT/我方 `part-emitter` 的既有规则：`s1 = sizeExt ? roll(sizeExt) : s0`）。
    // 此前我默认给 1 ⇒ 只有宽没有高的粒子被压成 `16×1` 的细条，观感是"只剩一条淡拖尾"（用户实测法球）。
    // startSize = 出生值（保留区间随机）；SizeOverLife = 倍率轨道（语义见 factorTrack）
    const sizeGen = new Vector3Function(
      numGen(em.initialSize, 1),
      numGen(em.initialSizeExt ?? em.initialSize, 1),
      new ConstantValue(1),
    );
    const sizeFactor = new Vector3Function(
      factorTrack(em.initialSize, numKfOf(em, 'size', lifeSec), em.finalSize),
      factorTrack(
        em.initialSizeExt ?? em.initialSize,
        numKfOf(em, 'sizeext', lifeSec),
        em.finalSizeExt ?? em.finalSize,
      ),
      new ConstantValue(1),
    );

    // 颜色：整条轨道交给 Gradient（startColor 传白，见文件头条 3）
    const colorStops = [
      ...(em.initialColor ? [{ t: 0, c: em.initialColor }] : []),
      ...kfOf(em, 'color', lifeSec),
      ...(em.finalColor ? [{ t: 1, c: em.finalColor }] : []),
    ];
    const colorGen = colorStops.length >= 2
      ? colorToGradient(colorStops)
      : colorToGradient([{ t: 0, c: em.initialColor ?? { r: { k: 'n', v: 255 }, g: { k: 'n', v: 255 }, b: { k: 'n', v: 255 }, a: { k: 'n', v: 255 } } }, { t: 1, c: em.finalColor ?? em.initialColor ?? { r: { k: 'n', v: 255 }, g: { k: 'n', v: 255 }, b: { k: 'n', v: 255 }, a: { k: 'n', v: 0 } } }]);

    // 发射时长：PT 是"发够 `Loops × numParticles` 个"⇒ 时长 = 预算 / 速率（之后粒子继续存活）。
    // ⚠ **`Loops` 是总粒子预算，不是"循环次数"**（`HoNewParticle.h:942`：
    //   `if (Loops > 0 && TotalParticleLives + numNewParts > Loops * NumParticles) … SetRunning(false)`）。
    //   我一度把它映射成 quarks 的 `looping: true`（无限重复）⇒ 凡是**没有句柄去 stop** 的那些
    //   （普攻/技能/命中这类 `effects.spawn` 出来的）就**永远发下去**（用户实测"落地后粒子永远不消失"）。
    const budget = em.loops > 0 ? em.loops * em.numParticles : 0;
    const emitDur = Math.max(0.05,
      (budget > 0 ? budget : em.numParticles) / Math.max(1, em.emitRate));

    const behaviors: Behavior[] = [
      new SizeOverLife(sizeFactor),
      new ColorOverLife(colorGen),
    ];
    if (em.particleType === 5) {
      // 沿自身面法线飞：速度 = spec 的 initialVelocity 长度（单位/秒）
      const v = em.initialVelocity;
      const sp = Math.hypot(midOf(v.x, 0), midOf(v.y, 0), midOf(v.z, 0));
      if (sp > 0) behaviors.push(new OrientVelocityToNormal(sp));
    }
    // **重力** —— 原版是逐帧 `vy += g`（我方 `part-emitter` 等价为 `vy += g·dt`，单位/秒²），
    // 而 quarks 用恒定力 behavior 表达：`ApplyForce(方向, 量值)` 逐帧把 `方向×量值` 加进速度。
    // 传原始向量 + 量值 1 即为**精确**的 g（不是近似）。
    // 缺它则 BombParticle 的"先喷后落"变成"一直上飘"（那是它在原版里最显眼的特征）。
    const g = em.gravity;
    const gx = g ? midOf(g.x, 0) : 0, gy = g ? midOf(g.y, 0) : 0, gz = g ? midOf(g.z, 0) : 0;
    if (gx || gy || gz) behaviors.push(new ApplyForce(new QVec3(gx, gy, gz), new ConstantValue(1)));

    // **速度轨**（`fade so at <t> velocity = XYZ(...)`）：逐帧覆盖 `velocity`。
    // 实测 49 个文件带它、其中 **22 个与初速不同** ⇒ 此前未应用是看得出的差异。
    const velKf = vecKfOf(em, 'velocity', lifeSec);
    if (velKf.length) {
      behaviors.push(new VelocityTrack(velKf));
      notes.push(`速度轨 ${velKf.length} 个关键帧（逐帧覆盖 velocity，speedModifier 归 1）`);
    }
    // 逐轴的 `velocityX/Z`（标量）表达不了 —— 必须可见，不静默
    for (const p of ['velocityx', 'velocityy', 'velocityz']) {
      if (em.keyframes[p]?.length) {
        reportFallback('part', `时间轴「${p}」（逐轴速度）未应用 —— 只支持向量的 velocity 轨`);
      }
    }

    // **面内旋转**（`.part` 的 `partAngleZ`，度）：初值 + 随时间变化。
    // 此前**整块被丢掉** ⇒ 每个粒子朝向一样、看着像静止贴片（用户实测："粒子似乎没有序列动画特征"）。
    if (em.particleType === 5) {
      behaviors.push(new MeshRandomOrientation());
    } else {
      const a0 = em.initialPartAngle;
      const a1 = em.finalPartAngle;
      if (a0 && (roll(a0.x) !== 0 || roll(a0.y) !== 0)) {
        notes.push('partAngle 的 x/y 分量非零 ⇒ 广告板只有面内旋转（z 分量）被表达，x/y 未表达');
      }
      const z0 = a0?.z ?? null, z1 = a1?.z ?? null;
      const zKf = numKfOf(em, 'partanglez', lifeSec);
      if (zKf.length) {
        // **有随时间的角度轨** ⇒ 直接用轨道驱动（含端点 = `initial partanglez` / `fade so final partanglez`）
        const keys = withEnds(
          zKf.map((k) => ({ t: k.t, v: midOf(k.v, 0) })),
          z0 ? { t: 0, v: midOf(z0, 0) } : null,
          z1 ? { t: 1, v: midOf(z1, 0) } : null,
        );
        behaviors.push(new PtRotationTrack(keys));
        notes.push(`面内自转轨 ${keys.length} 个关键帧（partAngleZ，度→弧度，逐帧写 rotation）`);
      } else {
        if (z0) behaviors.push(new PtInitialRotation(z0));
        if (z1) {
          // 原版是"朝向沿寿命**线性**变"，而 quarks 只有 `RotationOverLife`（**角速度**）
          // ⇒ 用 Δ角/寿命 折算成匀速自转，等价于那个线性插值
          const life = Math.max(0.05, midOf(em.lifetime, 1));
          const omega = ((midOf(z1) - midOf(z0 ?? { k: 'n', v: 0 })) * Math.PI) / 180 / life;
          if (Math.abs(omega) > 1e-3) {
            behaviors.push(new RotationOverLife(new ConstantValue(omega)));
            notes.push(`partAngleZ 的起止不同 ⇒ 按 Δ/寿命 折算匀速自转 ${((omega * 180) / Math.PI).toFixed(1)}°/s`);
          }
        }
      }
    }

    // **3D 局部旋转**（`partanglex/y` + `localanglex/y` 合并成一条角度轨）——
    // 必须走 Mesh + **自带相机朝向基底**（quarks 的 Mesh 是世界朝向 ⇒ 直接用会侧立看不见）
    if (need3D) {
      const life = Math.max(0.05, midOf(em.lifetime, 1));
      const tracks = {
        x: angleTrackOf(em, 'x', life),
        y: angleTrackOf(em, 'y', life),
        z: angleTrackOf(em, 'z', life),
      };
      behaviors.push(new PtCameraFacingSpin(tracks));
      const sum = (k?: Array<{ t: number; v: number }>): string =>
        (k && k.length ? `${Math.min(...k.map((a) => a.v)).toFixed(0)}~${Math.max(...k.map((a) => a.v)).toFixed(0)}°` : '—');
      notes.push(`3D 局部旋转（partangle/localangle 合并）：x ${sum(tracks.x)} / y ${sum(tracks.y)} / z ${sum(tracks.z)}`
        + '；该发射器因此改用 Mesh 模式（广告板只有面内 z）');
    }

    const system = new ParticleSystem({
      // 有 delay 时发射窗口要覆盖到"延迟 + 一段"，否则 quarks 在 delay 之前就结束系统
      duration: em.delay > 0 ? em.delay + emitDur : emitDur,
      // **不循环**（原版 `Loops` 是总预算，见 `emitDur` 处；系统到时长自己停）
      looping: false,
      shape: new PartBoxEmitter(em.emitRadius, em.initialVelocity),
      startLife: numGen(em.lifetime, 1),
      startSize: sizeGen,
      startColor: whiteColor(),
      startSpeed: new ConstantValue(1),   // 速度已由 PartBoxEmitter 写入，这里不叠加
      // ⚠ `emitRate`/`numParticles`/`loops`/`delay` 在解析器里**已经是数字**（`buildEmitter` 已 roll），
      // 不是 `Num`（{k:'n'|'r'}）⇒ 不能过 `numGen`（那会造出 IntervalValue(undefined,undefined)，
      // genValue 返回 NaN，而 quarks 把它累积进 waitEmiting ⇒ 发射数 NaN ⇒ **一个粒子都不生成**，且不报错）
      emissionOverTime: em.delay > 0 ? new ConstantValue(0) : new ConstantValue(Math.max(1, em.emitRate)),
      // **发射延迟**（原版 `delay`：`sinEffectDefaultSet` 后隔若干帧才开始）——
      // quarks 没有"延迟字段"，但有**带时间的一次性 burst**（`emissionBursts[].time`），
      // 语义正好等价：到 `delay` 那一刻一次性发出 `numParticles` 个。
      // ⚠ 我方所有用到 delay 的发射器都是 `numParticles = 1`（法阵的渐显/渐隐两段、Light5 的五帧），
      //   故"一次性 burst"是**精确**映射；若日后有多颗粒子带 delay，那是"整批同帧发出"、
      //   与"按 emitRate 铺开"不同 —— 届时要在 notes 里标注（不静默）。
      emissionBursts: em.delay > 0
        ? [{
            time: em.delay,
            count: new ConstantValue(Math.max(1, Math.round(em.numParticles))),
            cycle: 1, interval: 0, probability: 1,
          }]
        : [],
      renderMode: need3D ? RenderMode.Mesh : renderModeOf(em.particleType),
      // Trail（PT 的 TYPE_FOUR）**必须**给 `startLength`：否则 quarks 在 `spawn` 的 Trail 分支
      // 直接读 `rendererEmitterSettings.startLength.startGen` → undefined 抛错（实测踩到）。
      // ⚠ 语义近似：PT 的 AddFaceTrace 没有"长度"这个字段，这里取 `sizeExt`（高）当拖尾长度 ——
      // 属我方决定，与 PT 参数不是一对一。
      // Mesh 模式（我方扩展 = 世界朝向面片）：几何取单位平面 + 逐粒子随机四元数朝向
      instancingGeometry: em.particleType === 5 || need3D ? ORIENTED_UNIT_QUAD : undefined,
      // ⚠ `startRotation` **不是 quarks 的字段**（导出表里没有 ⇒ 死参数，从不生效）：
      // 朝向改由 behaviors 里的 `MeshRandomOrientation` / `PtInitialRotation` 写（见下）
      rendererEmitterSettings: em.particleType === 4
        ? { startLength: numGen(em.initialSizeExt ?? em.initialSize, 20) }
        : undefined,
      material,
      behaviors,
      worldSpace: false,
    });
    if (tex) system.texture = tex;

    if (em.delay > 0 && em.numParticles > 1) {
      notes.push(`delay=${em.delay} 配 ${em.numParticles} 颗粒子 ⇒ 按"整批同帧发出"映射（与按 emitRate 铺开不同）`);
    }
    if (g && (roll(g.x) || roll(g.y) || roll(g.z))) {
      notes.push(`gravity 为区间 ⇒ 恒力取中值 (${gx},${gy},${gz})`);
    }
    if (em.lifetime && em.lifetime.k === 'r') notes.push('lifetime 为区间 ⇒ 关键帧时间按中值折算（见文件头条 1）');

    out.push({ system, emitterName: em.name, notes });
  }
  return out;
}
