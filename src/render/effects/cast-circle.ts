/**
 * 祭司技能的**起手法阵** —— 两张水平光环（法阵本体是静态模型，在 `static-fx.ts`）。
 *
 * 原版链路（ex-machina，本机可读；行号即该文件）：
 *   `character.cpp:11110`（`BeginSkill_Monster` 的 `case snCHAR_SOUND_REVIVED_PRIESTESS`）
 *     → `sinEffect_StartMagic(&pos, 2)`
 *   `sinSkillEffect.cpp:1695` `sinEffect_StartMagic(pPosi, CharFlag, Type)`，`Type` 默认 0
 *     ⇒ 走 `else` → `CharFlag == 2` 分支（:1730-1743）：
 *
 * | 资产 | 配置 | 全宽（世界单位） |
 * |---|---|---|
 * | `MAAM2.ASE`（资产名 `maam2.smd`） | `AniMaxCount = 20` / `AniDelayTime = 4` | 资产自带，**实测盘面 52.26** |
 * | `maam2.tga` | `FACE_TYPE = ASSAFACE_WORLD`，`Size.w = 4800 * 3` | 14400 / 256 = **56.25** |
 * | `star05Q_03.bmp` | 同上，`Size.w = 6200 * 3`，`MaxAlphaAmount = 120` | 18600 / 256 = **72.66** |
 *
 * 三者共用 `AddHeight = 1500` ⇒ 抬高 **5.86**（`AssaEffect.cpp:371` `Posi.y += AddHeight`）。
 * 混合均为 `SMMAT_BLEND_LAMP`。
 *
 * ## ÷256 的依据（读完整函数得到的，不是推断）
 *
 * `Size.w` 全程只被原样赋给 `Face.width`（`AssaEffect.h:171`，**无除法**），落顶点在绘制处：
 *   - `cASSAFACE::Draw`（`AssaEffect.h:269`）→ `AssaAddFaceWorld(&Face, &Angle)`（:286）
 *   - `AssaUtil.cpp:749` `width = face->width / 2` → `inVertex[].x = ±width`
 *   - `AssaUtil.cpp:827` `outVertex[index].x = outVertex[index].x / fONE + x`  ← **就这里**除 `fONE`
 *   - `smType.h:15` `#define fONE 256`
 *   ⇒ `Size.w / 2 / 256` 是半宽，**全宽 = `Size.w / 256`**。
 *
 * **广告板（火花）同一条尺子**：`smRend3d.cpp:1155` `width = face->width >> 1` 之后直接加在
 * 相机空间定点 `tx` 上（`AddRendVertex` 原样存 `tx`，:1371），而 `smRend3d.cpp:162`
 * `fx = tx / fONE` 才把它变成世界单位 ⇒ 也是 ÷256。
 *
 * ⚠ 独立交叉验证：`AddHeight = 1500` 若不当定点（/256 = 5.86 世界单位）则毫无意义；
 *   尺寸与抬高两处同用 256，互为佐证。
 *
 * ⚠ **本条曾经错过**：早先用 `Size.w = 4800 * 10` / `6200 * 10` 推出 `SIZE_UNIT_DIV = 2560`，
 *   并声称"maam2.smd 约 20 世界单位"来"协调"——两个都是错的：`* 10` 属于 `Type != 0` 的
 *   另一分支（:1704，`sinAssaSkillEffect.cpp:13` 以 `Type=1` 调用），D_PR 走的是 `* 3`；
 *   而那句 20 单位**从未测量**（实测 52.26）。
 *
 * ⚠ `FACE_TYPE = ASSAFACE_WORLD` 的语义是"**面向世界**、不朝相机" —— 对地面光环即
 *   **水平铺开**，故这里用 `particleType: 2`（`HorizontalBillBoard`，水平 XZ 面）表达。
 */

import type { PartSystem } from '../../core/effect/part-script.js';
import { FONE } from '../../core/geom.js';

/**
 * 两个**家族**（原版 `sinEffect_StartMagic` 的 `CharFlag`）与两个**量级**（`Type`）。
 *
 * ```
 * CharFlag == 1 → MAAM1.ASE + mama.dds  + star05C_03.dds
 * CharFlag == 2 → MAAM2.ASE + maam2.dds + star05Q_03.dds    ← 祭司
 * Type != 0     → 恒用 MAAM2 家族，但 Size.w 是 4800*10 / 6200*10（大一圈）
 * Type == 0     → 按 CharFlag（CharFlag=1 时 5300*3 / 6200*3）
 * ```
 * 出处：`sinSkillEffect.cpp:1697-1743`（ex-machina，本机可读）。
 */
export interface CastCircleFamily {
  /** 法阵本体（静态 `.smd`；原版 `MAAM{1,2}.ASE`） */
  mesh: string;
  circleTex: string;
  ringTex: string;
  /** `Size.w` 的**原始实参**（`4800 * 3` 这种）——除以 `FONE` 才是世界单位 */
  circleW: number;
  ringW: number;
}
export function castCircleFamily(charFlag: 1 | 2, type: 0 | 1): CastCircleFamily {
  if (type !== 0 || charFlag === 2) {
    const big = type !== 0;
    return {
      mesh: 'image\\sinimage\\assaeffect\\startmagic\\maam2.smd',
      circleTex: 'image\\sinimage\\assaeffect\\startmagic\\p\\maam2.tga',
      ringTex: 'image\\sinimage\\assaeffect\\startmagic\\p\\star05q_03.bmp',
      circleW: big ? 4800 * 10 : 4800 * 3,
      ringW: big ? 6200 * 10 : 6200 * 3,
    };
  }
  return {
    mesh: 'image\\sinimage\\assaeffect\\startmagic\\maam1.smd',
    circleTex: 'image\\sinimage\\assaeffect\\startmagic\\p\\mama.tga',
    ringTex: 'image\\sinimage\\assaeffect\\startmagic\\p\\star05c_03.bmp',
    circleW: 5300 * 3,
    ringW: 6200 * 3,
  };
}

/** 两张光环的贴图（D_PR 用的那一族：`CharFlag = 2`） */
export const CAST_CIRCLE_TEX = castCircleFamily(2, 0).circleTex;
export const CAST_RING_TEX = castCircleFamily(2, 0).ringTex;

/** 抬高（原版 `AddHeight = 1500`，`AssaEffect.cpp:371` `Posi.y += AddHeight`） */
export const CAST_LIFT = 1500 / FONE;      // ≈ 5.86

/** 内圈光环全宽（`Size.w = 4800 * 3`，`sinSkillEffect.cpp:1737`） */
/** 内圈光环全宽（D_PR：`Size.w = 4800 * 3`） */
export const CAST_CIRCLE_SIZE = (4800 * 3) / FONE;   // = 56.25

/** 外圈星环全宽（D_PR：`Size.w = 6200 * 3`） */
export const CAST_RING_SIZE = (6200 * 3) / FONE;     // = 72.66

/**
 * 法阵本体 `maam2.smd` 的**实测**盘面（x 52.26 / y 51.61 / z 1.25；160 顶点、160 面）。
 * 内圈 56.25 略大于它 ⇒ 光环压在盘沿上，外圈再外扩 1.4 倍 —— 这就是原版的尺寸关系。
 */
export const CAST_MESH_SPAN = 52.26;

/** 原版 `MaxAlphaAmount = 120`（`star05Q_03.bmp` 那张）—— 转成 0-255 的 alpha 上限 */
const RING_ALPHA = 120;

/**
 * 光环的 **alpha 包络**参数（`cASSAFACE::Main`，`AssaEffect.h:179-238`）—— 这是"看起来多久"的真正决定者。
 *
 * ```
 * AlphaStartTime = (int)((float)Max_Time / 100.0f * 25.5f);   // (int)40.8 = 40 帧
 * AlphaAmount    = MaxAlphaAmount ? MaxAlphaAmount / AlphaStartTime : 255.0f / AlphaStartTime;
 * Time <= AlphaStartTime  → Transparency += AlphaAmount;      // 渐显
 * Time >  AlphaStartTime  → Transparency -= AlphaAmount;      // 渐隐（同速率）
 * ```
 * ⚠ **可见时间 ≠ 寿命**：`Max_Time = 160` 只是"实例被释放"（`MainAssaEffect` 的
 * `Time >= Max_Time`，`AssaEffect.cpp:73-82`）；而透明度 255 按 6.25/帧 递减 ⇒ **约 42 帧就全透明**。
 * 所以可见期 ≈ **40 帧渐显 + 42 帧渐隐 ≈ 82 帧**，之后那 78 帧是**全透明的僵尸**，不必表达。
 *
 * ⚠ fps 是**假设**：引擎按帧推进（`cSIN3D::Main` → `MainAssaEffect`），代码里没有秒。
 *   取 60 是折中（另两条线索指向 ≈67：`Max_Time=45` 对 `multispark 1.wav` 的 0.67s；
 *   AGENTS 里 400 帧 ≈ 6s）。差 10%，对这一条观感没有决定性影响。
 */
export const CAST_FADE_FRAMES = Math.trunc(160 / 100 * 25.5);   // = 40（渐显帧数）

/**
 * 每帧的 alpha 步长与**峰值** —— 注意原版用的是 `(int)AlphaAmount`（C 截断到整数）：
 * ```
 * AlphaAmount = MaxAlphaAmount ? MaxAlphaAmount / AlphaStartTime : 255.0f / AlphaStartTime;
 * Transparency += (int)AlphaAmount;      // 渐显（上限 MaxAlphaAmount）
 * Transparency -= (int)AlphaAmount;      // 渐隐（同一步长）
 * ```
 * ⇒ 内圈（无 `MaxAlphaAmount`）：`(int)(255/40) = 6` ⇒ 40 帧渐显只到 **240**（到不了 255）；
 *   外圈（`MaxAlphaAmount = 120`）：`(int)(120/40) = 3` ⇒ 40 帧到 **120**（正好等于上限）。
 * 渐隐步长相同 ⇒ **两张都是 40 帧淡完**（不是我第一版写的 42）。
 */
export function castFadeStep(maxAlphaAmount: number): number {
  return Math.trunc((maxAlphaAmount || 255) / CAST_FADE_FRAMES);
}
/** 渐显结束时真正达到的峰值（`(int)` 截断所致，内圈 240 / 外圈 120） */
export function castPeakAlpha(maxAlphaAmount: number): number {
  const cap = maxAlphaAmount || 255;
  return Math.min(cap, castFadeStep(cap) * CAST_FADE_FRAMES);
}
/** 渐隐帧数 = 峰值 / 步长（两张都是 40） */
export function castFadeOutFrames(maxAlphaAmount: number): number {
  return Math.ceil(castPeakAlpha(maxAlphaAmount) / castFadeStep(maxAlphaAmount));
}
/** 可见总时长（渐显 + 渐隐 = 80 帧）——**这才是"看着有多久"** */
export const CAST_VISIBLE = (CAST_FADE_FRAMES + castFadeOutFrames(120)) / 60;   // ≈ 1.33 s

/**
 * 实例寿命：原版 `SetAssaEffect(160, …)` 的 160 帧（`Max_Time`）⇒ 2.67 s。
 * ⚠ 它**比可见期长得多**（见上）—— 只在需要"照抄实例生命周期"时才用它；
 *   做表现请用 `CAST_VISIBLE`。（我第一版拿它当"可见时长"，于是光环多亮了一倍时间、且从头暗到尾。）
 */
export const CAST_LIFE = 160 / 60;          // ≈ 2.67
/** 法阵本体（`maam2.smd`）：`cASSAMESH::Main` 置 `Max_Time = 20 * 4 = 80` 帧（`AssaEffect.h:309-312`）⇒ 1.33s */
export const CAST_MESH_LIFE = (20 * 4) / 60; // ≈ 1.33
/** 法阵本体自己的包络：`AlphaStartTime = (int)(80/100*25.5) = 20` 帧渐显、20 帧渐隐 ⇒ 可见 ≈0.67s */
export const CAST_MESH_FADE = (20 / 60);
export const CAST_MESH_VISIBLE = (20 + 20) / 60;   // ≈ 0.67 s

/**
 * 造一张水平光环的 spec（`numParticles = 1`：一个实例就是一圈光）。
 *
 * **用两个 emitter 拼出原版的"先渐显、再渐隐"**（峰值按 `(int)` 截断算，见 `castPeakAlpha`）：
 *   · `<name>-in`  ：0 → 峰值，时长 `CAST_FADE_FRAMES`（40 帧 ≈ 0.67s）
 *   · `<name>-out` ：峰值 → 0，`delay` = 渐显时长，时长 `castFadeOutFrames()`（40 帧）
 * ⚠ 这里**分段拼接**是历史遗留：当初自研 emitter 每个 emitter 只有一条线性斜坡，
 *   故用两个 emitter 拼出"先渐显再渐隐"。迁到 quarks（§12）后**关键帧已经可用**
 *   （`part-to-quarks.kfOf` → `Gradient`），单个 emitter 的三点 alpha 轨道就能表达同一条包络
 *   —— 该简化**尚未做**（属"表达方式"变化，需实测确认，故先留着并记在此）。
 *
 * ⚠ 这样总时长是 `CAST_VISIBLE ≈ 1.37s`，**不是** `CAST_LIFE = 2.67s`：原版那 160 帧里
 *   后 78 帧光环已经全透明了（见 `CAST_FADE_FRAMES` 的推导）。
 */
function circleSystem(name: string, texture: string, size: number, alpha: number): PartSystem {
  const num = (v: number) => ({ k: 'n' as const, v });
  const vec = (x: number, y: number, z: number) => ({ x: num(x), y: num(y), z: num(z) });
  const mk = (
    tag: string, delaySec: number, lifeSec: number, a0: number, a1: number,
  ) => ({
    name: name + tag,
    blend: 'lamp' as const,          // 原版 SMMAT_BLEND_LAMP
    particleType: 2,                 // ★ 水平 XZ 面 = ASSAFACE_WORLD 的观感（贴地铺开）
    numParticles: 1,
    emitRate: 60,
    loops: 1,
    delay: delaySec,
    lifetime: num(lifeSec),
    emitRadius: vec(0, 0, 0),
    initialVelocity: vec(0, 0, 0),
    gravity: vec(0, 0, 0),
    texture,
    initialSize: num(size),
    initialSizeExt: num(size),       // 缺失会被当 1 ⇒ 压成细条，必须给
    initialColor: { r: num(255), g: num(255), b: num(255), a: num(a0) },
    initialPartAngle: null,
    initialLocalAngle: null,
    finalColor: { r: num(255), g: num(255), b: num(255), a: num(a1) },
    finalSize: num(size),            // 光环不放大（原版没给尺寸动画）
    finalSizeExt: num(size),
    finalPartAngle: null,
    finalLocalAngle: null,
    finalVelocity: null,
    keyframes: {},
  });
  return {
    name,
    version: 1,
    position: null,
    emitters: [
      mk('-in', 0, CAST_FADE_FRAMES / 60, 0, castPeakAlpha(alpha)),
      mk('-out', CAST_FADE_FRAMES / 60, castFadeOutFrames(alpha) / 60, castPeakAlpha(alpha), 0),
    ],
  };
}

/** 两张光环（内圈 `maam2.tga` + 外圈 `star05Q_03.bmp`）—— 调用方逐张 spawn，位置都抬高 `CAST_LIFT` */
export function castCircleSystems(charFlag: 1 | 2 = 2, type: 0 | 1 = 0): PartSystem[] {
  const f = castCircleFamily(charFlag, type);
  return [
    // 内圈：无 `MaxAlphaAmount`（按 255 算步长，实际峰值 240）
    circleSystem('CastCircle', f.circleTex, f.circleW / FONE, 0),
    // 外圈：`MaxAlphaAmount = 120`（峰值即 120）
    circleSystem('CastRing', f.ringTex, f.ringW / FONE, RING_ALPHA),
  ];
}
