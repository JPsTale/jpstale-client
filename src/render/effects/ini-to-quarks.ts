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
import type { Behavior, FunctionValueGenerator } from 'quarks.core';
import type { LoadedEffect } from './effect-assets.js';
import { applyBlend } from './part-to-quarks.js';

/** 原版 INI 的时间单位：**70Hz**（`effect-manager` 的 `EFFECT_HZ`，Delay 的步长） */
export const EFFECT_HZ = 70;

/** 帧内坡道因子：t∈[0,1] 时从 1 线性到 to/from（配 startSize=from ⇒ 绝对值 from→to）。
 *  SizeOverLife 是乘法（startSize × factor），乘法因子必须相对化。 */
class FrameRampGen implements FunctionValueGenerator {
  type = 'function' as const;
  constructor(private readonly from: number, private readonly to: number) {}
  startGen(_m: unknown): void { /* 无逐粒子状态 */ }
  genValue(_m: unknown, t = 0): number {
    const ratio = this.to / this.from;
    return 1 + (ratio - 1) * t;
  }
  toJSON(): { type: 'FrameRampGen'; from: number; to: number } { return { type: 'FrameRampGen' as const, from: this.from, to: this.to }; }
  clone(): FrameRampGen { return new FrameRampGen(this.from, this.to); }
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

  for (const f of eff.frames) {
    const dur = Math.max(1, f.delay) / EFFECT_HZ;
    if (!f.tex) { t += dur; continue; }              // 缺贴图的帧跳过（`diag` 里已记）
    // 逐帧坡道（§A5）：alpha 从 runningAlpha 渐变到 f.alpha；宽度从 runningWidth 渐变到 f.size；
    // 角度从 runningAngleDeg 步进到 f.angle——三件同为"线性步进"语义
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
      // 粒子寿命 = **这一帧的时长** ⇒ 到下一帧时刻恰好消失，逐帧精确
      startLife: new ConstantValue(dur),
      startSpeed: new ConstantValue(0),
      // 行 [20] 结构：startSize = **绝对出生尺寸**，SizeOverLife 挂**相对坡道因子**
      // （1 → to/from）⇒ 尺寸从起点渐变到目标。
      // ⚠ startSize 不能放坡道生成器——SizeOverLife 会 ×= startSize，因子×因子 = 尺寸塌陷
      //   （r[B7-5] 实测：全部 INI 只剩几像素）。
      // ⚠ 高度：原版 = 调用方 sizeY（恒定，§A4）；lab 无调用方 sizeY ⇒ 按"宽高同值"
      //   既登记偏差（行 [24]①）播——游戏侧接线（B8）传真实 sizeY 后按原版。
      startSize: new Vector3Function(
        new ConstantValue(widthFrom),
        new ConstantValue(widthFrom),                       // 宽高同值（行 [24]① lab 偏差）
        new ConstantValue(1),
      ),
      startColor: new Gradient([[new QVec3(1, 1, 1), 0]], [[1, 0]]),   // 乘法单位元（行 [L4]）
      behaviors: [
        // alpha 坡道：帧内从 alphaFrom 渐变到 alphaTo（§A5 BlendStep 语义）
        new ColorOverLife(new Gradient(
          [[new QVec3(1, 1, 1), 0]],
          [[alphaFrom, 0], [alphaTo, 1]],
        )),
        ...(omegaRadPerSec !== 0 ? [new RotationOverLife(new ConstantValue(omegaRadPerSec)) as Behavior] : []),
        // 宽高坡道因子（1 → to/from）——乘在 startSize 上
        new SizeOverLife(new Vector3Function(
          new FrameRampGen(widthFrom, widthTo),
          new FrameRampGen(widthFrom, widthTo),
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
