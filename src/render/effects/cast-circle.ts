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
 * 三个**家族**（原版 `sinEffect_StartMagic` 的 `CharFlag`）与两个**量级**（`Type`）。
 *
 * ```
 * Type != 0     → 恒用 MAAM2 家族，Size.w = 4800*10 / 6200*10（大一圈）   ← 原版把它排在 CharFlag **之前**
 * Type == 0     → 按 CharFlag：
 *   CharFlag == 1  → MAAM1.ASE + mama.tga       + star05C_03.bmp   （5300*3 / 6200*3）  = 祭司
 *   CharFlag == 2  → MAAM2.ASE + maam2.tga      + star05Q_03.bmp   （4800*3 / 6200*3）  = **法师**
 *   CharFlag == 10 → MAAM6.ASE + ShamanMagic.tga + star05Q_03.bmp  （4800*3 / 6200*3）  = 萨满
 * ```
 * 出处：`sinbaram/sinSkillEffect.cpp:1864-1940`（`sinEffect_StartMagic` 全文，本机可读）。
 *
 * ⚠ **`CharFlag == 2` 是法师，不是祭司** —— 本文件 2026-09-20 前的注释写成"`← 祭司`"，
 *   而那正是"游戏里三个职业都用法师法阵"这个 bug 的源头（见 `castCircleFlagForJob`）。
 * ⚠ 三族的 **`CharFlag` 由职业决定**（不是随便挑外观）：祭司 1 / 法师 2 / 萨满 10，
 *   把 `smCHAR::BeginSkill` 的 36 个调用点逐条映射回技能即得，**无一例外**。
 */
export interface CastCircleFamily {
  /** 法阵本体（静态 `.smd`；原版 `MAAM{1,2,6}.ASE`） */
  mesh: string;
  circleTex: string;
  ringTex: string;
  /** `Size.w` 的**原始实参**（`4800 * 3` 这种）——除以 `FONE` 才是世界单位 */
  circleW: number;
  ringW: number;
  /** 光环的**自转**（度/秒）；`0` = 原版没给 `ARotateSpeed`（只有萨满那一族有，见 `SHAMAN_*`） */
  spinDegPerSec: number;
}

/**
 * `sinEffect_StartMagic` 的 `CharFlag` —— 原版**只实现了这三支**
 * （`sinbaram/sinSkillEffect.cpp:1896` / `:1911` / `:1927` 的 `if(CharFlag == …)`）。
 *
 * ⚠ **值是原版的，不是我们的编号** ⇒ 照抄 `1 / 2 / 10`，**别改成 1/2/3**
 * （`10` 是原版给萨满留的位；改成 3 就对不上源码，也无法与怪物表里的 `castMagic` 互认）。
 */
export const CAST_CIRCLE_PRIESTESS = 1;    // MAAM1.ASE + mama.tga        + star05C_03.bmp（5300*3 / 6200*3）
export const CAST_CIRCLE_MAGICIAN = 2;     // MAAM2.ASE + maam2.tga       + star05Q_03.bmp（4800*3 / 6200*3）
export const CAST_CIRCLE_SHAMAN = 10;      // MAAM6.ASE + ShamanMagic.tga + star05Q_03.bmp（4800*3 / 6200*3，**会自转**）

export type CastCircleFlag =
  | typeof CAST_CIRCLE_PRIESTESS
  | typeof CAST_CIRCLE_MAGICIAN
  | typeof CAST_CIRCLE_SHAMAN;

/** 三个家族的**唯一清单**（类型守卫与"该不该放法阵"都以它为准） */
const ALL_CAST_CIRCLE_FLAGS = [
  CAST_CIRCLE_PRIESTESS, CAST_CIRCLE_MAGICIAN, CAST_CIRCLE_SHAMAN,
] as const;

/**
 * 类型守卫：把"数据里的数字"收窄成 `CastCircleFlag`。
 * 用途：怪物特效表里的 `castMagic` 是**数据**（数字），过一道它再传下去，
 * 免得把不在清单里的值当成某个家族用（那正是旧的"非 1 一律按 2"写法的病根）。
 */
export function isCastCircleFlag(v: number): v is CastCircleFlag {
  return (ALL_CAST_CIRCLE_FLAGS as readonly number[]).includes(v);
}

/**
 * `sinEffect_StartMagic` 的 `Type` 实参 —— 原版只有两档（`if(Type)` / `else`）。
 *
 * ⚠ `Type != 0` 时**完全忽略 `CharFlag`**（原版把它排在前头，见 `castCircleFamily`），
 * 且 `Size.w` 是常规的 10 倍。它是**开发者调试键专用**的取值：
 * `sinAssaSkillEffect.cpp:18` 的 `if(sinGetKeyClick('0'))` → `:21`
 * —— 玩家技能与怪物技能**都不传**（36 个玩家调用点 + 2 个怪物调用点全是 `Type = 0`）。
 */
export const CAST_CIRCLE_TYPE_NORMAL = 0;
export const CAST_CIRCLE_TYPE_LARGE = 1;

export type CastCircleType = typeof CAST_CIRCLE_TYPE_NORMAL | typeof CAST_CIRCLE_TYPE_LARGE;

const STAR05Q = 'image\\sinimage\\assaeffect\\startmagic\\p\\star05q_03.bmp';

/**
 * 萨满法阵的**自转**（三族里**只有它**有）。
 *
 * 原版 `sinbaram/sinSkillEffect.cpp:1934` `cAssaEffect[Assa]->ARotateSpeed.y = 100;`，
 * 而 `sinbaram/AssaEffect.cpp:243-245` 逐帧做
 * ```cpp
 * pEffect->ARotate.y += pEffect->ARotateSpeed.y;
 * pEffect->Angle.y = (pEffect->ARotate.y + ANGLE_90) & ANGCLIP;
 * ```
 * ⇒ **每帧 100 个角单位**。PT 的角单位一圈 = `ANGLE_360 = 4096`
 * （`smLib3d/smSin.h:21`；`:29` `ANGLE_MASK = ANGLE_360-1`，`ANGCLIP` 即它）
 * ⇒ `100 / 4096 × 360 = 8.7890625°`/帧 ⇒ 60fps 下 **≈ 527.34°/s**（约 1.46 圈/秒）。
 *
 * ⚠ `ANGLE_90` 那个 `+ANGLE_90` 是**基准朝向**偏移（四分之一圈），与转速无关，故不计入。
 * ⚠ `ARotateSpeed.y == 10000` 在原版是**哨兵**（"别累加、固定 90°"，见 `:241`）——
 *   萨满用的是 `100`，不是哨兵。
 */
export const SHAMAN_CIRCLE_SPIN_DEG_PER_SEC = (100 / 4096) * 360 * 60;   // ≈ 527.34

export function castCircleFamily(charFlag: CastCircleFlag, type: CastCircleType): CastCircleFamily {
  // ⚠ 原版把 `if(Type)` 排在 `if(CharFlag==…)` **之前**（`sinSkillEffect.cpp:1867`）
  //   ⇒ `Type != 0` 时**完全忽略 CharFlag**，恒用 MAAM2 家族、Size.w ×10
  if (type !== CAST_CIRCLE_TYPE_NORMAL) {
    return {
      mesh: 'image\\sinimage\\assaeffect\\startmagic\\maam2.smd',
      circleTex: 'image\\sinimage\\assaeffect\\startmagic\\p\\maam2.tga',
      ringTex: STAR05Q,
      circleW: 4800 * 10,
      ringW: 6200 * 10,
      spinDegPerSec: 0,
    };
  }
  if (charFlag === CAST_CIRCLE_PRIESTESS) {
    return {
      mesh: 'image\\sinimage\\assaeffect\\startmagic\\maam1.smd',
      circleTex: 'image\\sinimage\\assaeffect\\startmagic\\p\\mama.tga',
      ringTex: 'image\\sinimage\\assaeffect\\startmagic\\p\\star05c_03.bmp',
      circleW: 5300 * 3,
      ringW: 6200 * 3,
      spinDegPerSec: 0,
    };
  }
  if (charFlag === CAST_CIRCLE_SHAMAN) {
    return {
      mesh: 'image\\sinimage\\assaeffect\\startmagic\\maam6.smd',
      circleTex: 'image\\sinimage\\assaeffect\\startmagic\\p\\shamanmagic.tga',
      ringTex: STAR05Q,
      circleW: 4800 * 3,
      ringW: 6200 * 3,
      spinDegPerSec: SHAMAN_CIRCLE_SPIN_DEG_PER_SEC,
    };
  }
  // 剩下的一支 = `CAST_CIRCLE_MAGICIAN`（`CastCircleFlag` 是那三个字面量的联合型，
  // 故这里即"法师"、不是兜底；新增家族时必须同步 `ALL_CAST_CIRCLE_FLAGS`）
  return {
    mesh: 'image\\sinimage\\assaeffect\\startmagic\\maam2.smd',
    circleTex: 'image\\sinimage\\assaeffect\\startmagic\\p\\maam2.tga',
    ringTex: STAR05Q,
    circleW: 4800 * 3,
    ringW: 6200 * 3,
    spinDegPerSec: 0,
  };
}

/**
 * **施法职业 → `CharFlag`** —— 本判定**只有这一份实现**（`skill-fx-runner.fireSkillCast` 调它）。
 *
 * 依据：把 `smCHAR::BeginSkill`（`character.cpp:13156-13950`）里的 **36 个**
 * `sinEffect_StartMagic` 调用点**逐条映射回所属 `case SKILL_PLAY_*`**，`CharFlag` 按职业分、
 * **无一例外**：祭司 = `CAST_CIRCLE_PRIESTESS`（11 个技能）· 法师 = `CAST_CIRCLE_MAGICIAN`（11 个）·
 * 萨满 = `CAST_CIRCLE_SHAMAN`（14 个）。
 * （复算：`grep -a -n sinEffect_StartMagic character.cpp` 后逐条回溯最近的 `case`。）
 *
 * ⚠ **按职业目录名取，不按职业号** —— 号是裸数字（`skillData.ts:23` 的 `CLASS_DIR` 才是权威表），
 *   而 `classDir` 字符串自解释；两处取值已实测逐条一致。
 * ⚠ **其余 8 个职业在原版里根本没有这个调用** ⇒ 返回 `null` 表示"**不放法阵**"。
 *   **不是**"用默认值" —— 别把 `null` 兜底成某一个家族（那正是本函数要修掉的旧 bug）。
 */
export function castCircleFlagForClass(classDir: string): CastCircleFlag | null {
  switch (classDir) {
    case 'priestess': return CAST_CIRCLE_PRIESTESS;
    case 'magician': return CAST_CIRCLE_MAGICIAN;
    case 'shaman': return CAST_CIRCLE_SHAMAN;
    default: return null;   // 战士/机甲/弓箭手/枪兵/女猎/骑士/刺客/格斗家 —— 原版无法阵
  }
}

/** 两张光环的贴图（法师那一族；⚠ 这不是"通用"值，别再拿它当默认） */
export const CAST_CIRCLE_TEX = castCircleFamily(CAST_CIRCLE_MAGICIAN, CAST_CIRCLE_TYPE_NORMAL).circleTex;
export const CAST_RING_TEX = castCircleFamily(CAST_CIRCLE_MAGICIAN, CAST_CIRCLE_TYPE_NORMAL).ringTex;

/** 抬高（原版 `AddHeight = 1500`，`AssaEffect.cpp:371` `Posi.y += AddHeight`） */
export const CAST_LIFT = 1500 / FONE;      // ≈ 5.86

/** 内圈光环全宽（法师族 `Size.w = 4800 * 3`，`sinSkillEffect.cpp:1898`） */
export const CAST_CIRCLE_SIZE = (4800 * 3) / FONE;   // = 56.25

/** 外圈星环全宽（法师族：`Size.w = 6200 * 3`） */
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
function circleSystem(
  name: string, texture: string, size: number, alpha: number, spinDegPerSec = 0,
): PartSystem {
  const num = (v: number) => ({ k: 'n' as const, v });
  const vec = (x: number, y: number, z: number) => ({ x: num(x), y: num(y), z: num(z) });
  /**
   * 自转的**度数值**（`partAngle` 的单位是度，`pt-timeline-behavior.ts:33` `DEG = π/180`）。
   *
   * ⚠ **轴是 `y`**：`particleType: 2` 的实现是 `q = R(partAngle) · Rx(-90°)`
   *   （`pt-timeline-behavior.ts:147-153`）—— 几何先在 XY 面、被 `Rx(-90°)` 放平到 XZ，
   *   再用 `R(partAngle)` 在**世界系**里转 ⇒ 要让已放平的光环**绕竖轴自转**，
   *   必须给 `partAngleY`（给 `z` 会把它**翻倒**、给 `x` 是多余的一次倾角）。
   *   ⇒ 原版 `Angle.y`（`AssaEffect.cpp:245`）↔ 这里的 `partAngleY`。
   */
  const spinAt = (tSec: number) => ({ x: num(0), y: num(spinDegPerSec * tSec), z: num(0) });
  const mk = (
    tag: string, delaySec: number, lifeSec: number, a0: number, a1: number, angleT0: number,
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
    // 自转：`0` 时保持 `null`（= 完全不碰这个字段，与改动前**逐字节一致**）
    initialPartAngle: spinDegPerSec ? spinAt(angleT0) : null,
    initialLocalAngle: null,
    finalPartAngle: spinDegPerSec ? spinAt(angleT0 + lifeSec) : null,
    finalColor: { r: num(255), g: num(255), b: num(255), a: num(a1) },
    finalSize: num(size),            // 光环不放大（原版没给尺寸动画）
    finalSizeExt: num(size),
    finalLocalAngle: null,
    finalVelocity: null,
    keyframes: {},
  });
  // 原版是**一个累加器**（`ARotate.y += ARotateSpeed.y`，`AssaEffect.cpp:243`）走过整段寿命；
  // 而我方把光环拆成 `-in`/`-out` 两个 emitter ⇒ 第二个的**起点必须接上第一个的终点**，
  // 否则每 40 帧会**跳回 0°**（快转时看着像一帧的抖动）。故这里显式传 `angleT0` 续上。
  const t1 = CAST_FADE_FRAMES / 60;
  return {
    name,
    version: 1,
    position: null,
    emitters: [
      mk('-in', 0, t1, 0, castPeakAlpha(alpha), 0),
      mk('-out', t1, castFadeOutFrames(alpha) / 60, castPeakAlpha(alpha), 0, t1),
    ],
  };
}

/** 两张光环（内圈 + 外圈）—— 调用方逐张 spawn，位置都抬高 `CAST_LIFT` */
export function castCircleSystems(
  charFlag: CastCircleFlag = CAST_CIRCLE_MAGICIAN,
  type: CastCircleType = CAST_CIRCLE_TYPE_NORMAL,
): PartSystem[] {
  const f = castCircleFamily(charFlag, type);
  return [
    // 内圈：无 `MaxAlphaAmount`（按 255 算步长，实际峰值 240）
    circleSystem('CastCircle', f.circleTex, f.circleW / FONE, 0, f.spinDegPerSec),
    // 外圈：`MaxAlphaAmount = 120`（峰值即 120）
    circleSystem('CastRing', f.ringTex, f.ringW / FONE, RING_ALPHA, f.spinDegPerSec),
  ];
}
