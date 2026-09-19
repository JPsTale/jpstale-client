/**
 * **INI 广告板特效 → quarks** —— "全用 quark"的最后一条路。
 *
 * ## 为什么要一帧一个系统
 *
 * INI 动画的每帧带**自己的** `(贴图, Delay, BlendValue, Size, Angle)`（`effect-assets.ts` 的
 * `EffectFrameTex`）。而 `Delay` **可以不等长** —— 实测 `returnparticle1.ini`：
 *
 * ```
 * ImageNum  = 0,1,2,0,0
 * Delay     = 20,5,5,5,30      ← 不等长
 * BlendValue= 50,255,255,225,0
 * ```
 *
 * quarks 的帧动画（`FrameOverLife` + sprite sheet）**按寿命均分**格子，表达不了不等长 Delay；
 * 而"**一帧一个单粒子系统、各自带 delay + 寿命**"是**逐帧精确**的（同一手法见
 * `multi-spark` 里 Light5 的 5 帧展开）。1 帧 = 1 个 `ParticleSystem`，代价可接受
 * （dust1 6 帧 / gas1 8 帧 / returnparticle1 5 帧）。
 *
 * ⚠ 每帧的**贴图各自成为该系统的 `texture`** ⇒ **不需要拼 sprite sheet**
 *   （药水那条要拼，是因为 quarks 的帧动画要求一张图；这里不用帧动画）。
 *
 * ## 帧时长
 *
 * `Delay` 以 **70Hz** 计（`effect-manager` 原来的 `EFFECT_HZ`）⇒ 一帧的秒数 = `Delay / 70`，
 * 该帧的**起始时刻** = 前面所有帧的秒数之和。
 *
 * ## 尚未表达（不静默）
 *
 * 每帧的 `Angle`（度）：这三份 INI 都没有该段；若某帧给了角度，走 `reportFallback` 上报
 * 而不是悄悄丢掉（quarks 广告板的**初始面内角**用哪个发生器还没查证，不为一个未用到的
 * 字段先猜）。
 */

import * as THREE from 'three';
import { ParticleSystem, RenderMode } from 'three.quarks';
import {
  ColorOverLife, ConstantValue, Gradient, PointEmitter, RotationOverLife,
  SizeOverLife, Vector3Function, Vector3 as QVec3,
} from 'quarks.core';
import type { Behavior, FunctionColorGenerator, FunctionValueGenerator, Vector4 } from 'quarks.core';
import type { LoadedEffect } from './effect-assets.js';
import { applyBlend } from './part-to-quarks.js';

/** 原版 INI 的时间单位：**70Hz**（`effect-manager` 的 `EFFECT_HZ`，Delay 的步长） */
export const EFFECT_HZ = 70;

/**
 * 帧粒子寿命的 ε（秒）——quarks 的死亡判定发生在**当帧 `age += delta` 之后、渲染之前**
 * （`ParticleSystem.update` 尾部的 die 清理）：寿命恰等于帧时长时，单 tick 帧的粒子在**出生帧
 * 就被移除**，一个像素都没画过（r[B7-8] 实测：`levelupparticle1` 三帧全 Delay=1 ⇒ 存活数恒 0）。
 * ε 取 0.1ms（比一 tick 14.3ms 小三个数量级）⇒ 只让"最后一帧能被画到"，不产生可见重叠。
 * 对多 tick 帧同样是净收益：此前末帧也不显示（N tick 的帧只画 N−1 次）。
 */
const LIFE_EPS = 1e-4;

/** 帧内坡道因子：t∈[0,1] 时从 1 线性到 to/from（配 startSize=from ⇒ 绝对值 from→to）。
 *  SizeOverLife 是乘法（startSize × factor），乘法因子必须相对化。
 *  `phase` = 1/ticks：原版是"**步进后**再绘制"（§A5 `Xxx += Step` 在 draw 之前），故第 k 个 tick
 *  显示 from + k·step；t=0（首个行为回调时 age=0）对应 **k=1** ⇒ 相位整体前移 1/ticks。
 *  1 tick 的帧因此恒显示目标值（原版正是"一 tick 到位"）；缺相位时它恒显示起点值。 */
class FrameRampGen implements FunctionValueGenerator {
  type = 'function' as const;
  constructor(
    private readonly from: number,
    private readonly to: number,
    private readonly phase = 0,
  ) {}
  startGen(_m: unknown): void { /* 无逐粒子状态 */ }
  genValue(_m: unknown, t = 0): number {
    const ratio = this.to / this.from;
    return 1 + (ratio - 1) * Math.min(1, t + this.phase);
  }
  toJSON(): { type: 'FrameRampGen'; from: number; to: number; phase: number } { return { type: 'FrameRampGen' as const, from: this.from, to: this.to, phase: this.phase }; }
  clone(): FrameRampGen { return new FrameRampGen(this.from, this.to, this.phase); }
}

/** INI 高度坡道 —— **带 Size 的序列（`INFO_ONESIZE` 与 `INFO_ONESIZEANGLE`）宽高都步进**
 *  （`HoEffect.cpp:700-712` 两个分支各写着 `SizeWidth += SizeStep; **SizeHeight += SizeStep**;`，
 *  逐字已核 —— 见复核记录 r[B7-19]）。
 *  ⚠ 原版给宽高**同一步长**（`SizeStep = (帧 SizeWidth − SizeWidth)/Delay` 的**绝对增量**，不是同一比例）
 *  ⇒ 高 = 调用方 sizeY + (本帧当前宽 − 起步宽)。只有当序列**没有 Size 段**（`INFO_DEFAULT`）时
 *  两个尺寸都不动（仍是 `:1075-1076` 的 sizeX/sizeY）——那时本生成器退化成常量，故可无条件挂。 */
class FrameHeightRampGen implements FunctionValueGenerator {
  type = 'function' as const;
  constructor(
    private readonly from: number,      // 宽起步（调用方 sizeX·scale）
    private readonly to: number,        // 本帧宽目标（帧 Size·scale）
    private readonly base: number,      // 调用方 sizeY（高起步）
    private readonly phase = 0,
  ) {}
  startGen(_m: unknown): void { /* 无逐粒子状态 */ }
  genValue(_m: unknown, t = 0): number {
    const sRatio = 1 + ((this.to / this.from) - 1) * Math.min(1, t + this.phase);
    const width = this.from * sRatio;
    return (this.base + (width - this.from)) / this.base;
  }
  toJSON(): { type: 'FrameHeightRampGen' } { return { type: 'FrameHeightRampGen' as const }; }
  clone(): FrameHeightRampGen { return new FrameHeightRampGen(this.from, this.to, this.base, this.phase); }
}

/** alpha 坡道（同相位语义）：alpha(t) = from + (to−from)·min(1, t + phase)，写进 Vector4.w */
class FrameAlphaGen implements FunctionColorGenerator {
  type = 'function' as const;
  constructor(
    private readonly from: number,
    private readonly to: number,
    private readonly phase = 0,
  ) {}
  startGen(_m: unknown): void { /* 无逐粒子状态 */ }
  genColor(_m: unknown, color: Vector4, t = 0): Vector4 {
    color.x = 1; color.y = 1; color.z = 1;
    color.w = this.from + (this.to - this.from) * Math.min(1, t + this.phase);
    return color;
  }
  toJSON(): { type: 'FrameAlphaGen' } { return { type: 'FrameAlphaGen' as const }; }
  clone(): FunctionColorGenerator { return new FrameAlphaGen(this.from, this.to, this.phase); }
}

export interface IniToQuarksOpts {
  /** INI **没有 Size 段**时用的尺寸（世界单位）—— 原版在调用处显式给（`StartBillRectPrimitive` 的 sizeX/sizeY） */
  size: number;
  /** 整体倍率 */
  scale?: number;
  /** 粒子是否随载体走（见 `QuarksSpawnOpts.follow`） */
  follow?: boolean;
}

/**
 * 把一份已载入的 INI 特效转成**每帧一个** quarks 系统（按帧序返回，调用方逐个登记）。
 *
 * 返回的系统**已经**设好 `emitter.position`（世界坐标）与混合，调用方只管挂载/推进。
 */
export function iniToQuarks(eff: LoadedEffect, opts: IniToQuarksOpts): ParticleSystem[] {
  const out: ParticleSystem[] = [];
  const scale = opts.scale ?? 1;
  let t = 0;                       // 累积起始时刻（秒）
  let runningAngleDeg = 0;         // 角度链：本帧起点 = 上一帧目标（首帧 0，§A4 缺省）
  let runningAlpha = 0;            // BlendValue 链：起步 = StartBlendValue（§A4 缺省 0；IR 未携带、缺省）
  let runningWidth = opts.size;    // 宽度链：起步 = 调用方 sizeX（§A5 `SizeWidth = sizeX`）
  // 序列是否带 Size 段 ⇒ `INFO_ONESIZE` / `INFO_ONESIZEANGLE`（两者**宽高都步进**，`:700-712`）；
  // 没有 Size 段的就是 `INFO_DEFAULT` ⇒ 宽高都保持调用方给的 sizeX/sizeY（`:1075-1076`）。
  const sizeSeq = eff.frames.some((f) => f.size !== null);
  const heightBase = Math.max(0.05, opts.size * scale);   // 调用方 sizeY（lab 无调用方 ⇒ 与 sizeX 同值）

  for (const f of eff.frames) {
    const dur = Math.max(1, f.delay) / EFFECT_HZ;
    if (!f.tex) { t += dur; continue; }              // 缺贴图的帧跳过（`diag` 里已记）
    // 逐帧坡道（§A5）：alpha 从 runningAlpha 渐变到 f.alpha；宽度从 runningWidth 渐变到 f.size；
    // 角度从 runningAngleDeg 步进到 f.angle——三件同为"线性步进"语义
    const ticks = Math.max(1, Math.round(dur * EFFECT_HZ));   // 本帧的 tick 数（Delay 帧数）
    // §A5 语义："固定步长步进 Delay 拍 ⇒ **最后一拍恰好落在本帧目标值**"（原版 `Xxx += Step`，Step 由
    // (目标 − 起点)/Delay 一次算出）。我们的坡道是按**寿命归一化**的，而寿命被 LIFE_EPS 拉长成
    // `dur + ε` ⇒ 直接写 1/ticks 会永远差 ε 那一口（实测帧末 69.96 而非 70，r[B7-18]）。
    // ⚠ quarks 的行为在**自增 age 之前**跑（`SizeOverLife` 收到 `age/life`，首拍 age=0）⇒
    // 第 k 拍的归一化时刻 = (k−1)·(dur/ticks)/(dur+ε)；令**最后一拍 k = ticks** 恰好到 1 即得相位：
    const phase = 1 - ((ticks - 1) * (dur / ticks)) / (dur + LIFE_EPS);
    const alphaFrom = Math.min(1, Math.max(0, runningAlpha / 255));
    const alphaTo = Math.min(1, Math.max(0, f.alpha / 255));
    const widthFrom = Math.max(0.05, runningWidth * scale);
    const widthTo = Math.max(0.05, (f.size ?? runningWidth) * scale);
    const startAngleRad = runningAngleDeg * (Math.PI / 180);
    const targetAngleDeg = f.angle ?? runningAngleDeg;   // null = 本帧目标不变（角速度 0）
    const omegaRadPerSec = dur > 0
      ? ((targetAngleDeg - runningAngleDeg) * (Math.PI / 180)) / dur
      : 0;
    runningAlpha = f.alpha; runningWidth = f.size ?? runningWidth; runningAngleDeg = targetAngleDeg;

    const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, depthTest: true });
    // 混合：**共享表**（`part-to-quarks.applyBlend` —— 含"亮度当 alpha 遮罩"的说明）
    applyBlend(mat, eff.blend);


    const ps = new ParticleSystem({
      // 系统活到这一帧结束（`delay` 之前不发射，`delay + dur` 之后结束）
      duration: t + dur,
      looping: false,
      emissionBursts: [{
        time: t, count: new ConstantValue(1), cycle: 1, interval: 0, probability: 1,
      }],
      emissionOverTime: new ConstantValue(0),
      shape: new PointEmitter(),
      // 粒子寿命 = 这一帧的时长 + ε ⇒ 到下一帧时刻消失，逐帧精确且**末帧能被画到**（见 LIFE_EPS）
      startLife: new ConstantValue(dur + LIFE_EPS),
      startSpeed: new ConstantValue(0),
      // 行 [20] 结构：startSize = **绝对出生尺寸**，SizeOverLife 挂**相对坡道因子**
      // （1 → to/from）⇒ 尺寸从起点渐变到目标。
      // ⚠ startSize 不能放坡道生成器——SizeOverLife 会 ×= startSize，因子×因子 = 尺寸塌陷
      //   （r[B7-5] 实测：全部 INI 只剩几像素）。
      // §A4/§A5：宽起步 = 调用方 sizeX、高起步 = 调用方 sizeY（`HoEffect.cpp:1075-1076`）；
      // lab 没有调用方 ⇒ 传进来的 `opts.size` 同时当 sizeX/sizeY（行 [24]① 的已登记偏差）。
      startSize: new Vector3Function(
        new ConstantValue(widthFrom),
        new ConstantValue(heightBase),
        new ConstantValue(1),
      ),
      startColor: new Gradient([[new QVec3(1, 1, 1), 0]], [[1, 0]]),   // 乘法单位元（行 [L4]）
      behaviors: [
        // alpha 坡道（§A5 BlendStep + "步进后绘制"的相位）
        new ColorOverLife(new FrameAlphaGen(alphaFrom, alphaTo, phase)),
        ...(omegaRadPerSec !== 0 ? [new RotationOverLife(new ConstantValue(omegaRadPerSec)) as Behavior] : []),
        // 宽高坡道因子（1 → to/from）——乘在 startSize 上；两个分量都是**绝对同一步长**语义
        new SizeOverLife(new Vector3Function(
          new FrameRampGen(widthFrom, widthTo, phase),
          // 高：带 Size 段 ⇒ 与宽同一步长（r[B7-19] 逐字核过）；`INFO_DEFAULT` ⇒ 恒 = sizeY
          sizeSeq
            ? new FrameHeightRampGen(widthFrom, widthTo, heightBase, phase)
            : new ConstantValue(1),
          new ConstantValue(1),
        )),
      ],
      startRotation: new ConstantValue(startAngleRad),
      renderMode: RenderMode.BillBoard,
      material: mat,
      // 粒子留在世界空间（INI 特效不随载体走；载体跟随由 emitter 挂载表达）
      worldSpace: true,
    });
    ps.texture = f.tex;
    out.push(ps);
    t += dur;
  }
  return out;
}
