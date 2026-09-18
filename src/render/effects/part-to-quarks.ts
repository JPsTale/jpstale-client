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
import { ParticleSystem, RenderMode, PointEmitter } from 'three.quarks';
import { buildEvents, slotOf, type PtEvent, type PtSlot } from '../../core/effect/pt-timeline.js';
import { PtTimeline, setTimelineCamera } from './pt-timeline-behavior.js';
import {
  ConstantValue, IntervalValue, Gradient, Vector3Function,
  Vector3 as QVec3,
  type Behavior, type RotationGenerator, type GeneratorMemory, type Quaternion,
} from 'quarks.core';
import type { Num } from '../../core/effect/pt-value.js';
import { reportFallback } from '../../char/fallback-log.js';
import {
  type PartEmitter, type PartSystem, type Rgba, type Vec3,
} from '../../core/effect/part-script.js';

/* ─────────── PT 的属性轨道（线性多关键帧） ─────────── */

/* ─────────── 值映射 ─────────── */

/** PT 的标量（定值或区间）→ quarks 的值发生器 */

function numGen(n: Num | null | undefined, fallback = 0): ConstantValue | IntervalValue {
  if (!n) return new ConstantValue(fallback);
  return n.k === 'n' ? new ConstantValue(n.v) : new IntervalValue(n.a, n.b);
}

/** 白色常量：startColor 传白，颜色轨道全部由 ColorOverLife 的 Gradient 承担（文件头条 3） */
function whiteColor(): Gradient {
  return new Gradient([[new QVec3(1, 1, 1), 0]], [[1, 0]]);
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
  'partangle', 'localangle',
  // 时间轴层接上后新增（2026-09-18）：单通道颜色、逐轴速度、事件时钟
  'redcolor', 'greencolor', 'bluecolor', 'alpha',
  'velocityx', 'velocityy', 'velocityz', 'eventtimer',
] as const;

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

/** "面向相机"用的相机引用 —— 由渲染侧注册一次（`WorldView` / 实验室各一次）；粒子朝向要用它 */
export function setBillboardCamera(cam: THREE.Camera | null): void {
  setTimelineCamera(cam);          // 时间轴行为的朝向要用相机（TYPE_ONE / TYPE_THREE）
}

/**
 * **面向相机的基底 + 局部 Y 自转**（`localangleY` 的忠实形态）—— Mesh 模式粒子专用。
 *
 * 为什么需要它：quarks 的 Mesh 是**世界朝向**面片（朝向只由逐粒子四元数决定）⇒
 * 直接切过去会在一些机位**侧立看不见**（用户实测："怎么看不到对应的粒子了"）。
 * 而原版这些粒子是 **billboard**（永远面向相机）+ `localangle` 在相机朝向上再倾斜 ⇒
 * 这里每帧显式写：`q = 相机朝向 × Rot(局部 +Y, θ(t))`，θ 由 `初值 + 角速度 × age` **现算**
 * （不用累加 ⇒ 不受帧率/掉帧影响）。
 */

/** 单向面片的几何：单位平面在**局部 XY**（法线 = 局部 +z），尺寸由粒子 `size` 缩放 ⇒ 与原版 `sinCreateObject` 同构 */
const ORIENTED_UNIT_QUAD = new THREE.PlaneGeometry(1, 1, 1, 1);

/** TYPE_TWO 的几何：**世界 XZ 平面**上的四边形（`AddFace2dPlane` 的顶点是 `(±w, 0, ±h)`） */
const HORIZONTAL_UNIT_QUAD = new THREE.PlaneGeometry(1, 1, 1, 1).rotateX(-Math.PI / 2);

/** `.part` 的属性名 → 事件槽（唯一出处；`redcolor` 这类单通道属性在此落到对应分量） */
const PT_SLOT_OF_PROP: Record<string, PtSlot> = {
  size: 'size', sizeext: 'sizeExt', eventtimer: 'eventTimer',
  color: 'color', redcolor: 'colorR', greencolor: 'colorG', bluecolor: 'colorB', alpha: 'colorA',
  velocity: 'dir', velocityx: 'dirX', velocityy: 'dirY', velocityz: 'dirZ',
  partangle: 'partAngle', partanglex: 'partAngleX', partangley: 'partAngleY', partanglez: 'partAngleZ',
  localangle: 'localAngle', localanglex: 'localAngleX', localangley: 'localAngleY', localanglez: 'localAngleZ',
};

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
    const tex = textures[i] ?? null;
    if (em.texture && !tex) notes.push(`贴图未加载：${em.texture}`);
    if (!em.texture) notes.push('该发射器无 texture 键');

    // 材质只承担混合；贴图走 ParticleSystem.texture
    const material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, depthTest: true });
    // Mesh 一律**双面**：朝向由 `PtTimeline` 逐帧写四元数，某些机位会以背面朝相机
    material.side = THREE.DoubleSide;
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

    // ── 事件表：照 PT 的三种时间规格建成事件（`initial X` = t=0、`final X` = t=**寿命上限**、`at <t>` 中间）──
    // 槽的对应见 `pt-timeline.slotOf`；fade 链由 `buildEvents` 按"同槽向后找第一条 fade"串好
    // （= 装载期的 `SortEvents` + `CreateFadeLists`）。规格见 docs/PT粒子系统-规格说明书.md §B4/B5。
    const lifeMax = em.lifetime.k === 'n' ? em.lifetime.v : em.lifetime.b;   // 原版 `FinalTime = Lifetime.Max`
    const rawEvents: PtEvent[] = [];
    const addEvent = (time: number, slot: PtSlot, fade: boolean, value: Num[]): void => {
      rawEvents.push({ time, slot, fade, value, next: -1 });
    };
    const n1 = (n: Num): Num[] => [n];
    const v3 = (v: Vec3): Num[] => [v.x, v.y, v.z];
    const c4 = (c: Rgba): Num[] => [c.r, c.g, c.b, c.a];
    if (em.initialSize) addEvent(0, 'size', false, n1(em.initialSize));
    if (em.finalSize) addEvent(lifeMax, 'size', true, n1(em.finalSize));
    if (em.initialSizeExt) addEvent(0, 'sizeExt', false, n1(em.initialSizeExt));
    if (em.finalSizeExt) addEvent(lifeMax, 'sizeExt', true, n1(em.finalSizeExt));
    if (em.initialColor) addEvent(0, 'color', false, c4(em.initialColor));
    if (em.finalColor) addEvent(lifeMax, 'color', true, c4(em.finalColor));
    if (em.initialVelocity) addEvent(0, 'dir', false, v3(em.initialVelocity));
    if (em.finalVelocity) addEvent(lifeMax, 'dir', true, v3(em.finalVelocity));
    if (em.initialPartAngle) addEvent(0, 'partAngle', false, v3(em.initialPartAngle));
    if (em.finalPartAngle) addEvent(lifeMax, 'partAngle', true, v3(em.finalPartAngle));
    if (em.initialLocalAngle) addEvent(0, 'localAngle', false, v3(em.initialLocalAngle));
    if (em.finalLocalAngle) addEvent(lifeMax, 'localAngle', true, v3(em.finalLocalAngle));
    for (const [prop, list] of Object.entries(em.keyframes)) {
      const slot = PT_SLOT_OF_PROP[prop];
      if (!slot) { reportFallback('part', `「${em.name}」的时间轴「${prop}」没有事件槽 ⇒ 未应用`); continue; }
      const comp = slotOf(slot).comp;
      for (const k of list) {
        const v = k.value;
        const wide = v.k === 'num' ? n1(v.v) : v.k === 'vec' ? v3(v.v) : v.k === 'color' ? c4(v.v) : null;
        if (!wide) continue;
        // 整组槽带全部分量；单分量槽只带**它的那一个**载荷：
        //   · 值是标量（`k.value.k === 'num'`）⇒ 载荷就在 `wide[0]`（**不能按分量下标取** ——
        //     曾经 `partanglez = 5` 这种取到 `wide[2]` = undefined ⇒ 时间轴 `roll(undefined)` 崩）
        //   · 值是向量/颜色 ⇒ 按分量下标取
        addEvent(k.time, slot, k.fade,
          comp < 0 ? wide : (v.k === 'num' ? [wide[0]!] : [wide[comp]!]));
      }
    }
    const ptEvents = buildEvents(rawEvents);

    // 发射时长：PT 是"发够 `Loops × numParticles` 个"⇒ 时长 = 预算 / 速率（之后粒子继续存活）。
    // ⚠ **`Loops` 是总粒子预算，不是"循环次数"**（`HoNewParticle.h:942`：
    //   `if (Loops > 0 && TotalParticleLives + numNewParts > Loops * NumParticles) … SetRunning(false)`）。
    //   我一度把它映射成 quarks 的 `looping: true`（无限重复）⇒ 凡是**没有句柄去 stop** 的那些
    //   （普攻/技能/命中这类 `effects.spawn` 出来的）就**永远发下去**（用户实测"落地后粒子永远不消失"）。
    const budget = em.loops > 0 ? em.loops * em.numParticles : 0;
    const emitDur = Math.max(0.05,
      (budget > 0 ? budget : em.numParticles) / Math.max(1, em.emitRate));

    const behaviors: Behavior[] = [
      new PtTimeline({
        lifetime: em.lifetime,
        emitRadius: em.emitRadius,
        gravity: em.gravity ?? { x: { k: 'n', v: 0 }, y: { k: 'n', v: 0 }, z: { k: 'n', v: 0 } },
        events: ptEvents,
      }, em.particleType),
    ];
    // 如实记：`LocalAngle` 原版**只被 TYPE_FOUR 拖尾使用**（`AddFaceTrace`），ONE/TWO/THREE 用 `PartAngle`
    if (em.particleType !== 4 && (em.initialLocalAngle || em.finalLocalAngle
      || Object.keys(em.keyframes).some((k) => k.startsWith('localangle')))) {
      notes.push('写了 localangle*，但原版 LocalAngle **只喂 TYPE_FOUR**（ONE/TWO/THREE 用 PartAngle）'
        + ' ⇒ 按原版忽略（我方此前对 billboard 做的"局部旋转"是发明）');
    }
    if (em.particleType === 4) {
      notes.push('TYPE_FOUR 拖尾走 quarks Trail（位置历史条带）近似：横截面朝向本应用 LocalAngle，未表达');
    }
    if (em.particleType === 5) notes.push('TYPE_FIVE 是我方扩展（原版无此类型）：面片法线对齐速度方向');

    const system = new ParticleSystem({
      // 有 delay 时发射窗口要覆盖到"延迟 + 一段"，否则 quarks 在 delay 之前就结束系统
      duration: em.delay > 0 ? em.delay + emitDur : emitDur,
      // **不循环**（原版 `Loops` 是总预算，见 `emitDur` 处；系统到时长自己停）
      looping: false,
      shape: new PointEmitter(),          // 出生位置由 PtTimeline 按 `emitradius` 盒掷（照 `CreateNewParticle`）
      startLife: numGen(em.lifetime, 1),  // 逐粒子掷；`PtTimeline.initialize` 会用状态里那一掷覆盖（同分布）
      startSize: new Vector3Function(new ConstantValue(1), new ConstantValue(1), new ConstantValue(1)),
      startColor: whiteColor(),           // 颜色由 PtTimeline 逐帧写（白是乘法单位元）
      startSpeed: new ConstantValue(0),   // 位置由状态机积分（`LocalPos += Dir·dt`）
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
      // 1/2/3/5 走 Mesh（朝向由 PtTimeline 逐帧写四元数）；4 走 Trail（位置历史条带）
      renderMode: em.particleType === 4 ? RenderMode.Trail : RenderMode.Mesh,
      // Trail（PT 的 TYPE_FOUR）**必须**给 `startLength`：否则 quarks 在 `spawn` 的 Trail 分支
      // 直接读 `rendererEmitterSettings.startLength.startGen` → undefined 抛错（实测踩到）。
      // ⚠ 语义近似：PT 的 AddFaceTrace 没有"长度"这个字段，这里取 `sizeExt`（高）当拖尾长度 ——
      // 属我方决定，与 PT 参数不是一对一。
      // Mesh 模式（我方扩展 = 世界朝向面片）：几何取单位平面 + 逐粒子随机四元数朝向
      // TWO 是**世界 XZ 面**（`AddFace2dPlane`），几何用水平四边形；其余用 XY 面片
      instancingGeometry: em.particleType === 4 ? undefined
        : em.particleType === 2 ? HORIZONTAL_UNIT_QUAD : ORIENTED_UNIT_QUAD,
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
    if (em.gravity && [em.gravity.x, em.gravity.y, em.gravity.z].some((c) => c.k === 'r')) {
      notes.push('gravity 是区间 ⇒ 按原版**逐粒子逐帧重掷**（不是恒定加速度）');
    }

    out.push({ system, emitterName: em.name, notes });
  }
  return out;
}
