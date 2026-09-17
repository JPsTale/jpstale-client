/**
 * 祭司技能 **MultiSpark**（原版 `SKILL_MULTISPARK`）—— 完整规格 + 逐帧驱动器。
 *
 * 触发链（ex-machina，本机可读；行号即该文件）：
 *   `character.cpp:11916`（`smCHAR::EventSkill_Monster` 的 `case snCHAR_SOUND_REVIVED_PRIESTESS`）
 *     → `case 'O': sinEffect_MultiSpark(this, chrAttackTarget, 5); SkillPlaySound(SKILL_SOUND_SKILL_MULTISPARK)`
 *   （起手法阵与起手音在**另一处**：`character.cpp:11110` `BeginSkill_Monster` → `sinEffect_StartMagic(&pos, 2)`）
 *
 * 一个技能 = 四段，本文覆盖 ②③④，①见 `cast-circle.ts`：
 *   ② **发射 5 颗** —— `sinSkillEffect.cpp:808` `sinEffect_MultiSpark(pChar, desChar, Num)`
 *   ③ **每帧驱动** —— `sinSkillEffect.cpp:220-247` `case SKILL_MULTISPARK`
 *   ④ **命中三件套** —— `sinSkillEffect.cpp:1618-1624` `sinEffect_SkillHit` + `sinPublicEffect.cpp:379,500,533`
 *
 * ## ③ 每帧做什么（`sinSkillEffectMove` 的 SKILL_MULTISPARK 分支，逐行照抄）
 * ```
 * sinEffect_MultiSpark_Particle2(&Posi);      // ① 每帧在当前位置生成 1 颗拖尾（:221）
 * if (ActionTime[0] == Time) {                // ② 第 30 帧**重算速度**指向真目标（:222-230）
 *   MoveSpeed.x = (des.x - Posi.x) / 15;      //    x/z 除以 15
 *   MoveSpeed.y = (des.y - Posi.y) / 22;      //    y 除以 22（更慢，抛物线感）
 *   MoveSpeed.z = (des.z - Posi.z) / 15;
 * }
 * Posi += MoveSpeed;  sinFace = Posi;         // ③ 位移（:231-237）
 * if (Time == Max_Time - 1 && Index == 1)     // ④ 第 44 帧、**只由第 1 颗**触发命中（:239-245）
 *   sinEffect_SkillHit(CODE, &Posi);
 * ```
 * 第 1 段速度在发射时算好（`sinEffect_MultiSpark` :861-866）：
 * `DesPosi = (目标 - 施法者) / 4`，汇合点 = `施法者 + DesPosi`，y 再 `+ 7000`；
 * `MoveSpeed = (汇合点 - 起点) / 20`。
 *
 * ## ★ 关键：这 5 颗是"**从一个点散开**"，不是"从 5 个点收拢"
 *
 * 两条代码事实合起来才看得出（我第一版做反了，用户指出；本机可复读）：
 *
 * ① **起点只有一个**。`sinEffectDefaultSet(Index, Kind, pChar, nullptr, 7000)`
 *    （`sinEffect2.cpp:1079-1088`）在 `pChar` 非空时把 `Posi` 与 `sinFace` 一并写成
 *    `(pX, pY + Y, pZ)` —— `Y = 7000` 是**抬高**（27.3 世界单位），**5 颗全在同一点**。
 *
 * ② **横向偏移被写进 `sinFace`，而每帧 `sinFace = Posi` 会把它抹掉**（`:235-237`）。
 *    所以偏移只在**算速度那一次**起作用（:864 用 `sinFace` 算 `MoveSpeed`）：
 *    ```
 *    MoveSpeed = (汇合点 − (起点 + 偏移)) / 20 = 基础速度 − 偏移/20
 *    ```
 *    即偏移转化为**一个横向速度分量**（`±(11+12i)/20 = ±0.55 ~ ±2.35 单位/帧`），
 *    基础速度 5 颗相同 ⇒ **同一个点出发、因速度差而扇开成锥形**。
 *
 * ③ 奇数颗时**最后一颗**走 `GetMoveLocation(0, fONE*26, 0, …)` 分支，但那次调用的结果
 *    **没有被加回 `sinFace`**（对比 `else` 分支的三行 `+=`）⇒ 该颗**偏移为 0**，
 *    正好是扇形的**中轴**。（`MULTI_SPARK_LAST_LIFT = 26` 因此不产生任何位移 ——
 *    照抄行为，不做"修正"；它可能只是原版漏写，但"漏写"也是它的行为。）
 *
 * ⇒ 观感：**同一点起爆 → 扇开（横向 ±11~±47）→ 第 30 帧各自改瞄目标 → 第 44 帧由
 *   第 1 颗触发命中**。（`Index == 1` 给的是 `i == 0`，即偏移 **−11** 那颗 —— 五颗的 x 相同，
 *   差别只在横向，故"谁触发命中"不影响飞得多远。）
 *
 * ## 随机量
 * 原版大量 `rand()`（拖尾尺寸/寿命/角度、命中粒子角度与初速）。这里**从外部注入** `rnd`
 * 而不是内部 `Math.random()`：跨客户端播同一动作时按 AGENTS #14 要同步的是**结果**，
 * 注入点让"改成确定性种子 / 服务端下发"只动一处。
 */

import type { PartSystem } from '../../core/effect/part-script.js';
import { FONE, getMoveLocation, faceAngleOf, radToPtAngle } from '../../core/geom.js';

/* ───────────────── ② 发射：主火花 ───────────────── */

/** `MatMultiSpark[6]`（`sinSkillEffect.cpp:65-67`：`MultiSpark\m_spark0%d.dds`，i=0..8） */
export const MULTI_SPARK_TEX = 'image\\sinimage\\effect\\skilleffect\\multispark\\m_spark06.tga';

/** `sinFace.height = width = 3000`（`sinSkillEffect.cpp:819-820`）⇒ 3000/256 ≈ **11.72** */
export const MULTI_SPARK_SIZE = 3000 / FONE;

/** `Max_Time = 45`（:823）——单位是**帧** */
export const MULTI_SPARK_MAX_FRAMES = 45;
/** `ActionTime[0] = 30`（:825）——第 1 段转第 2 段的帧号 */
export const MULTI_SPARK_REAIM_FRAME = 30;
/** 命中帧 = `Max_Time - 1`（:239） */
export const MULTI_SPARK_HIT_FRAME = MULTI_SPARK_MAX_FRAMES - 1;

/** 汇合点抬高 `+ 7000`（:865）⇒ ≈ **27.34** 世界单位 */
export const MULTI_SPARK_RISE = 7000 / FONE;

/**
 * 第 i 颗的横向偏移（**世界单位**）—— ⚠ 它**不是起点位置**，而是"**速度的横向分量来源**"
 * （见模块头 ★ 一节）：
 *
 * · 常规（:848-853）：`±(10 + 1 + i*12)`，左右交替（`(i+1) % 2 == 0` 取正）
 * · `num` 为奇数时**最后一颗**（:842-845）：源码走 `GetMoveLocation(0, fONE*26, 0, …)`
 *   分支，但**结果没有加回 `sinFace`** ⇒ **偏移为 0**（该颗是扇形中轴）。
 *   `MULTI_SPARK_LAST_LIFT` 里的 26 因此**不产生位移**，仅作记录。
 *
 * ⚠ 偏移经由 `GetMoveLocation(l, 0, 0, Angle.x, Angle.y, 0)` 转到世界空间。代数可证：
 *   输入为纯 x 向量时结果 = `(l·cos(angY), 0, −l·sin(angY))`，与朝向 `(sin, cos)` **点积为 0**
 *   ⇒ 确是**水平横向**；且 `angX`/`angZ` 对纯 x 输入无影响（① 绕 Z、② 绕 X 都保持 x 分量），
 *   故只需 `angY` = 施法者→目标 的水平朝向（`getMoveLocation` 已由单测钉死）。
 */
export function multiSparkLateral(i: number, num: number): number {
  if (num % 2 === 1 && i === num - 1) return 0;
  const sign = ((i + 1) % 2 === 0) ? 1 : -1;
  return sign * (10 + 1 + i * 12);
}

/** 奇数颗时最后一颗走的分支里的抬高量（源码算了但**没加回去** ⇒ 不产生位移，仅记录） */
export const MULTI_SPARK_LAST_LIFT = 26;

/** 发射时给的初速分母（:864-866 的 `/ 20`） */
export const MULTI_SPARK_LAUNCH_DIV = 20;
/** 第 2 段速度分母（:226-228）—— x/z 用 15、y 用 22 */
export const MULTI_SPARK_REAIM_DIV_XZ = 15;
export const MULTI_SPARK_REAIM_DIV_Y = 22;

/**
 * 单颗主火花 —— 1 颗粒子的 LAMP 广告板。
 * 位移**不在 spec 里**（原版是逐帧改实例的 `Posi`），由 `createMultiSpark` 驱动载体。
 */
export function multiSparkSystem(): PartSystem {
  const num = (v: number) => ({ k: 'n' as const, v });
  const vec = (x: number, y: number, z: number) => ({ x: num(x), y: num(y), z: num(z) });
  return {
    name: 'MultiSpark',
    version: 1,
    position: null,
    emitters: [{
      name: 'Spark',
      blend: 'lamp',                 // 原版 SMMAT_BLEND_LAMP（sinSkillEffect.cpp:66-67）
      particleType: 1,               // TYPE_ONE = 朝向相机的公告牌（原版 SIN_EFFECT_FACE）
      numParticles: 1,
      emitRate: 60,
      loops: 1,
      delay: 0,
      lifetime: num(MULTI_SPARK_MAX_FRAMES / 60),
      emitRadius: vec(0, 0, 0),
      initialVelocity: vec(0, 0, 0),
      gravity: vec(0, 0, 0),
      texture: MULTI_SPARK_TEX,
      initialSize: num(MULTI_SPARK_SIZE),
      initialSizeExt: num(MULTI_SPARK_SIZE),   // 缺失会被当 1 ⇒ 压成细条，必须给
      initialColor: { r: num(255), g: num(255), b: num(255), a: num(255) },
      initialPartAngle: null,
      initialLocalAngle: null,
      // ⚠ **不淡出**：原版 `sinEffect_MultiSpark` 没有设 `AlphaTime`/`AlphaAmount`/`AlphaCount`
      //   （`sinEffectDefaultSet` 也不设）⇒ `MainSinEffect2` 里那段渐变**门控恒假**
      //   （`if (Time >= AlphaTime && AlphaCount)`）⇒ `Transparency` 全程 255，
      //   到 `Time > Max_Time` 时被 `memset` **直接消失**（无过渡）。
      //   我第一版写了 `a: 0`（线性淡出）—— 那是**偏离**，已按源码改回恒定。
      finalColor: { r: num(255), g: num(255), b: num(255), a: num(255) },
      finalSize: num(MULTI_SPARK_SIZE),
      finalSizeExt: num(MULTI_SPARK_SIZE),
      finalPartAngle: null,
      finalLocalAngle: null,
      finalVelocity: null,
      keyframes: {},
    }],
  };
}

/* ───────────────── ③ 拖尾：每帧 1 颗 ───────────────── */

/**
 * `sinEffect_MultiSpark_Particle2`（`sinSkillEffect.cpp:774-806`）—— 每帧在火花当前位置生成 **1 颗**：
 * ```
 * Size = rand() % 1500 + 1500;            // 5.86 ~ 11.71 世界单位（与主火花同量级）
 * Max_Time = rand() % 3 + 10;             // 10 ~ 12 帧
 * AlphaAmount = 10;  Transparency = 80;   // 逐帧 -10 ⇒ 约 8 帧淡完
 * SizeDecreTime = 1; SizeAmount = 150;    // 从第 2 帧起逐帧缩 150/256 ≈ 0.586
 * Angle.x = (rand() % 2048) - 1024; Angle.y = rand() % 4096;
 * MoveSpeed.z = 64;  GetMoveLocation(0,0,64, Angle.x, Angle.y, 0);   // 随机方向偏 0.25 单位
 * CODE = SIN_PARTICLE_FIREBOLT;           // 该 case 只抄位置、**不产生位移**（:469-474）
 * ```
 * ⚠ 公告板绘制走 `AddFace2D(face)`（无角度参数，`sinDrawTexture2` 仅在 `FaceAngleY` 非 0 时传角度，
 *   而这里没设）⇒ 那些随机 `Angle` **对广告板朝向没有视觉效果**，实际只贡献那 0.25 单位的随机偏移。
 *
 * ⚠ 尺寸/寿命的随机范围**只在这里写一次**（`sizeMin/sizeMax/lifeMinFrames/lifeMaxFrames`），
 *   调用方按这三个值取随机 —— 别在调用处再写一份 `1500 + Math.random()*1500`。
 */
export const MULTI_SPARK_TRAIL = {
  /** `rand() % 1500 + 1500`（:781）⇒ 5.86 ~ 11.71 世界单位 */
  sizeMin: 1500 / FONE,
  sizeMax: 2999 / FONE,
  /** **实例**寿命 `rand() % 3 + 10`（:785）—— ⚠ 见 `visibleFrames`：可见期比它短 */
  lifeMinFrames: 10,
  lifeMaxFrames: 12,
  alpha: 80,                       // 创建时显式 `Transparency = 80`（:802）
  fadeStep: 10,                    // AlphaAmount（:786）
  shrinkPerFrame: 150 / FONE,      // SizeAmount（:801，SizeDecreTime = 1）
  offset: 64 / FONE,               // GetMoveLocation(0,0,64, ...)
} as const;

/**
 * 拖尾的**可见帧数** = `floor(alpha / fadeStep)` = 8 帧。
 *
 * 原版：`AlphaTime = Max_Time - 10`（:799）配 `AlphaCount = 1`、`AlphaAmount = 10`，
 * 门控是 `Time >= AlphaTime && Time % AlphaCount == 0` ⇒ 从 `AlphaTime` 起每帧减 10，
 * `Transparency = 80` ⇒ **8 帧后归零**；而实例要到 `Time > Max_Time`（10~12 帧）才 `memset`。
 * ⇒ 那 2~4 帧是**全透明的僵尸**（`CODE = SIN_PARTICLE_FIREBOLT` 也不产生位移，:469-474）。
 * 故表现上按 8 帧建粒子即可，与"活 10~12 帧但后段不可见"逐帧等价。
 */
export const MULTI_SPARK_TRAIL_VISIBLE_FRAMES = Math.floor(MULTI_SPARK_TRAIL.alpha / MULTI_SPARK_TRAIL.fadeStep);

export function multiSparkTrailSystem(size: number): PartSystem {
  const num = (v: number) => ({ k: 'n' as const, v });
  const vec = (x: number, y: number, z: number) => ({ x: num(x), y: num(y), z: num(z) });
  // 逐帧缩 150，但不小于 0（原版无下限，靠淡出先把它抹掉；这里不制造负尺寸）
  const lifeFrames = MULTI_SPARK_TRAIL_VISIBLE_FRAMES;
  const endSize = Math.max(0, size - MULTI_SPARK_TRAIL.shrinkPerFrame * lifeFrames);
  return {
    name: 'MultiSparkTrail',
    version: 1,
    position: null,
    emitters: [{
      name: 'Trail',
      blend: 'lamp',
      particleType: 1,
      numParticles: 1,
      emitRate: 60,
      loops: 1,
      delay: 0,
      lifetime: num(lifeFrames / 60),
      emitRadius: vec(0, 0, 0),
      initialVelocity: vec(0, 0, 0),   // 静止（SIN_PARTICLE_FIREBOLT 不产生位移）
      gravity: vec(0, 0, 0),
      texture: MULTI_SPARK_TEX,
      initialSize: num(size),
      initialSizeExt: num(size),
      initialColor: { r: num(255), g: num(255), b: num(255), a: num(MULTI_SPARK_TRAIL.alpha) },
      initialPartAngle: null,
      initialLocalAngle: null,
      finalColor: { r: num(255), g: num(255), b: num(255), a: num(0) },
      finalSize: num(endSize),
      finalSizeExt: num(endSize),
      finalPartAngle: null,
      finalLocalAngle: null,
      finalVelocity: null,
      keyframes: {},
    }],
  };
}

/* ───────────────── ④ 命中三件套 ───────────────── */

/**
 * `sinEffect_BombParticle(pPosi, MatMultiSpark[6], 1000, 35)`（`sinPublicEffect.cpp:500-531`）
 * —— **35 颗**广告板，尺寸 1000 ⇒ 3.91 世界单位。
 *
 * 逐帧（`sinPublicEffect.cpp:118-127`）：
 * ```
 * RotatePosi = (cos(RotateAngle) + 128*sin(RotateAngle), -sin(RotateAngle) + 128*cos(RotateAngle)) >> 16
 * sinFace += RotatePosi                 // 径向**匀速**外飞（RotateDistance.z = 128 ⇒ 0.5/帧）
 * Gravity -= 4;                          // 逐帧累积的下坠
 * sinFace.y += MoveSpeed.y + Gravity;    // 初速上飘 rand()%100+50 ⇒ 0.195~0.582/帧
 * ```
 * ⇒ **先向四周喷出并上飘、再被重力拉回**的爆开感。寿命 `rand()%20 + 50`（50~69 帧）。
 *
 * 实现映射：每颗**独立 spawn 一个单粒子系统**（各自方向不同，故不能在 spec 里共享初速），
 * 径向速度与上飘初速合并进 `velocity`，下坠用 `gravity` 表达。
 */
export const MULTI_SPARK_BOMB = {
  num: 35,
  size: 1000 / FONE,                 // 3.91
  lifeMinFrames: 50,
  lifeMaxFrames: 69,
  radialSpeedPerFrame: 128 / FONE,   // 0.5 世界单位/帧
  riseMinPerFrame: 50 / FONE,        // 0.195
  riseMaxPerFrame: 149 / FONE,       // 0.582
  gravityPerFrame2: 4 / FONE,        // Gravity -= 4 逐帧
  /** `RotateAngle = (rand() % 256) * i + Num`（:517）——角度随 i 递增，故 35 颗铺满一圈 */
  angleStepRandom: 256,
} as const;

/**
 * `sinEffect_Light5(pPosi, 13000)`（`sinPublicEffect.cpp:533-553`）—— 命中处的**大闪光**：
 * `MatLight5[0]`（`PublicEffect/Light/Light0N.dds`，**5 张**），尺寸 `Size * 2 = 26000` ⇒ **101.6**；
 * `Max_Time = 50`；`SizeIncreTime = 1 / SizeAmount = 100` ⇒ 逐帧长大 0.39；
 * 贴图序列 `lpMatAni = MatLight5 / AniMax = 5 / AniTime = 10` ⇒ **5 帧 × 每帧 10 = 50 帧正好一轮**。
 *
 * ⚠ **贴图序列动画是本实现表达不了的**（自研 emitter 每个 emitter 只有一张 `texture`，见
 *   当时自研 emitter 的多关键帧缺口；迁到 quarks（§12）后贴图序列仍**不能**用关键帧表达
 *   —— quarks 的帧动画是 UV 图集 `FrameOverLife`，而我们手里是 5 张独立贴图，
 *   故这条"错开发射"保留）。这里用**等价展开**：发 **5 个错开 10 帧的
 *   单粒子 emitter**，逐个换成 `light0{i+1}`，尺寸按原版的连续增长取各段端点
 *   ⇒ 位置/尺寸/时序与"5 帧序列 + 逐帧长大"逐段一致。**这是展开，不是降级**。
 */
export const MULTI_SPARK_LIGHT = {
  /** `PublicEffect/Light/Light0{1..5}`（`sinPublicEffect.cpp:51`）——我们的资产是 .tga */
  frames: [
    'image\\sinimage\\effect\\publiceffect\\light\\light01.tga',
    'image\\sinimage\\effect\\publiceffect\\light\\light02.tga',
    'image\\sinimage\\effect\\publiceffect\\light\\light03.tga',
    'image\\sinimage\\effect\\publiceffect\\light\\light04.tga',
    'image\\sinimage\\effect\\publiceffect\\light\\light05.tga',
  ],
  size: 26000 / FONE,                // 101.56 —— 注意是 width = Size * 2
  framesPerTex: 10,                  // AniTime
  lifeFrames: 50,                    // Max_Time
  growPerFrame: 100 / FONE,          // SizeAmount（SizeIncreTime = 1）
  /** 淡出从 `AlphaTime = Max_Time - 22 = 28` 帧起（:545），速率 AlphaAmount = 10/帧 */
  fadeStartFrame: 28,
  fadeStep: 10,
} as const;

/** 命中时的动态光（`sinSkillEffect.cpp:1622`）——淡青 */
export const MULTI_SPARK_HIT_DYN_LIGHT = {
  r: 179, g: 255, b: 229, a: 255, power: 180, decPower: 1,
} as const;

/**
 * 一颗 BombParticle 的 spec（**每颗单独 spawn** —— 35 颗的方向各不相同，不能共享一个初速）。
 * 径向速度与上飘初速由调用方经 `velocity` 传入；下坠用 `gravity` 表达（原版逐帧 `Gravity -= 4`）。
 * 淡出：`AlphaTime = Max_Time - 22` / `AlphaAmount = 10` ⇒ 末段 22 帧从 255 降到 ≈35。
 */
export function multiSparkBombSystem(lifeFrames: number): PartSystem {
  const num = (v: number) => ({ k: 'n' as const, v });
  const vec = (x: number, y: number, z: number) => ({ x: num(x), y: num(y), z: num(z) });
  const B = MULTI_SPARK_BOMB;
  const endAlpha = Math.max(0, 255 - 10 * 22);
  return {
    name: 'MultiSparkBomb',
    version: 1,
    position: null,
    emitters: [{
      name: 'Bomb',
      blend: 'lamp',
      particleType: 1,               // 原版 SIN_EFFECT_FACE（广告板）
      numParticles: 1,
      emitRate: 60,
      loops: 1,
      delay: 0,
      lifetime: num(lifeFrames / 60),
      emitRadius: vec(0, 0, 0),
      initialVelocity: vec(0, 0, 0), // 被调用方的 `velocity` 覆盖（每颗方向不同）
      gravity: vec(0, -B.gravityPerFrame2 * 60 * 60, 0),   // 逐帧量 → 每秒量
      texture: MULTI_SPARK_TEX,      // `sinFace.MatNum = Mat` = MatMultiSpark[6]
      initialSize: num(B.size),
      initialSizeExt: num(B.size),
      initialColor: { r: num(255), g: num(255), b: num(255), a: num(255) },
      initialPartAngle: null,
      initialLocalAngle: null,
      finalColor: { r: num(255), g: num(255), b: num(255), a: num(endAlpha) },
      finalSize: num(B.size),
      finalSizeExt: num(B.size),
      finalPartAngle: null,
      finalLocalAngle: null,
      finalVelocity: null,
      keyframes: {},
    }],
  };
}

/** 命中时的一道大闪光（展开成 5 个错帧 emitter，见 `MULTI_SPARK_LIGHT` 说明） */
export function multiSparkLightSystems(): PartSystem[] {
  const num = (v: number) => ({ k: 'n' as const, v });
  const vec = (x: number, y: number, z: number) => ({ x: num(x), y: num(y), z: num(z) });
  const L = MULTI_SPARK_LIGHT;
  const out: PartSystem[] = [];
  for (let f = 0; f < L.frames.length; f++) {
    const startFrame = f * L.framesPerTex;
    const endFrame = startFrame + L.framesPerTex;
    const size0 = L.size + L.growPerFrame * startFrame;
    const size1 = L.size + L.growPerFrame * endFrame;
    // 淡出：整段都在 fadeStart 之前 ⇒ 不淡（末态 alpha 与初态同，等于恒定）
    const a0 = startFrame >= L.fadeStartFrame
      ? Math.max(0, 255 - L.fadeStep * (startFrame - L.fadeStartFrame))
      : 255;
    const a1 = endFrame >= L.fadeStartFrame
      ? Math.max(0, 255 - L.fadeStep * (endFrame - L.fadeStartFrame))
      : a0;
    out.push({
      name: 'MultiSparkLight' + (f + 1),
      version: 1,
      position: null,
      emitters: [{
        name: 'Light' + (f + 1),
        blend: 'lamp',
        particleType: 1,
        numParticles: 1,
        emitRate: 60,
        loops: 1,
        delay: startFrame / 60,        // 原版靠 `AniTime` 切帧，这里靠错开发射时刻
        lifetime: num(L.framesPerTex / 60),
        emitRadius: vec(0, 0, 0),
        initialVelocity: vec(0, 0, 0),
        gravity: vec(0, 0, 0),
        texture: L.frames[f]!,
        initialSize: num(size0),
        initialSizeExt: num(size0),
        initialColor: { r: num(255), g: num(255), b: num(255), a: num(a0) },
        initialPartAngle: null,
        initialLocalAngle: null,
        finalColor: { r: num(255), g: num(255), b: num(255), a: num(a1) },
        finalSize: num(size1),
        finalSizeExt: num(size1),
        finalPartAngle: null,
        finalLocalAngle: null,
        finalVelocity: null,
        keyframes: {},
      }],
    });
  }
  return out;
}

/**
 * ⚠ **本技能里尚未表达的一件**：`sinEffect_WideLine(pPosi, MatMultiSpark[6], 128, 30)`
 * （`sinPublicEffect.cpp:379-402`）—— **30 条刚体细长线片**：
 * `Size.x = 512`（2 单位）× `Size.y = 40 * Lenght = 5120`（20 单位），
 * `Angle.x/Angle.y = rand() % 4096`（**三维**随机朝向）、沿自身 +z 以 128/帧 飞出、`Angle.z += 16` 自转，
 * 寿命 `rand()%20 + 50`。它走的是 `SIN_EFFECT_MESH` + `sinCreateObject` 那条**网格**路径，
 * 而我们的特效系统目前只能表达粒子/广告板 —— 与"箭"是同一个缺口（**刚体网格**）。
 * 未实现，不静默：调用方按 `MULTI_SPARK_HIT.wideLineMissing` 决定是否上报降级。
 */
export const MULTI_SPARK_HIT = {
  wideLineMissing: {
    count: 30, lenPerUnit: 40, lengthArg: 128, sizeX: 512 / FONE, speedPerFrame: 128 / FONE,
    lifeMinFrames: 50, lifeMaxFrames: 69, spinPerFrame: 16,
  },
} as const;

/* ───────────────── 逐帧驱动器 ───────────────── */

export interface Vec3 { x: number; y: number; z: number }

export interface MultiSparkDeps {
  /** 第 i 颗主火花的**当前位置**（调用方负责把载体挪过去、并让粒子跟随它） */
  moveMain(i: number, pos: Vec3): void;
  /**
   * 每帧每颗的拖尾。位置、尺寸、寿命**都已按原版公式算好**（随机量在本模块内取，见 `rnd`）。
   *
   * ⚠ 传进来的是**新建的对象**，不是主火花那个会被原地修改的 `pos` —— 因为
   * `effects.spawnSystem` 内部**先 await 载入 spec、之后才读 `opts.pos`**，
   * 若把可变对象交出去，读到的会是"这一帧移动之后"的位置（拖尾沿轨迹前移一帧）。
   * 这类"await 之后读可变对象"已经在本项目出现过三次（AGENTS #11 / #25），
   * 所以守卫放在**产生位置的那一层**：可变对象不外传。
   */
  spawnTrail(pos: Vec3, size: number): void;
  /** 第 44 帧、由第 1 颗触发的命中（调用方负责三件套 + 动态光） */
  onHit(pos: Vec3): void;
  /** 第 45 帧结束（调用方负责收尾：撤载体等） */
  onEnd(): void;
}

export interface MultiSparkHandle {
  /** 推进 `frames` 帧（调用方按 dt 折算；原版是逐帧，故这里以**帧**为单位） */
  update(frames: number): void;
  readonly done: boolean;
}

/**
 * 建一个 MultiSpark 的实例组（原版是 `Num` 个独立 `cSinEffect2` 实例）。
 *
 * @param caster 施法者位置（`pChar->pX/pY/pZ`）
 * @param target 目标位置（`desChar->pX/pY/pZ`）
 * @param num    颗数（D_PR 的原版调用是 **5**）
 */
export function createMultiSpark(
  /**
   * `null` = **没有目标**（原版 `sinEffect_MultiSpark(pChar, nullptr, …)`：
   * `if (cSinEffect2[Index].DesChar)` 两处守卫都不成立 ⇒ **不收敛、不改瞄**，
   * 只剩发射时留下的 `MoveSpeed = (0,0,256)` = 沿世界 +z 每帧 1 单位；命中仍在第 44 帧触发）。
   */
  caster: Vec3, target: Vec3 | null, num: number, deps: MultiSparkDeps,
  /** 随机源（拖尾的尺寸/寿命/偏移方向）—— 跨客户端要同步"结果"时换成确定性种子，见模块头 */
  rnd: () => number = Math.random,
): MultiSparkHandle {
  const pos: Vec3[] = [];
  const vel: Vec3[] = [];
  let frame = 0;
  let done = false;

  // ① **起点只有一个**（`sinEffectDefaultSet` :1081-1088）：施法者 + 抬高 7000 ⇒ 27.3
  const start: Vec3 = { x: caster.x, y: caster.y + MULTI_SPARK_RISE, z: caster.z };
  // ② 第 1 段的**汇合点** = 施法者 + (目标-施法者)/4，y 再 +7000（:861-863）
  //    ⚠ 无目标时**整段不成立**（原版 `if (DesChar)` 守卫）⇒ 用发射时留下的 `MoveSpeed = (0,0,256)`
  const baseV: Vec3 = target
    ? {
        x: ((caster.x + (target.x - caster.x) / 4) - start.x) / MULTI_SPARK_LAUNCH_DIV,
        y: ((caster.y + (target.y - caster.y) / 4 + MULTI_SPARK_RISE) - start.y) / MULTI_SPARK_LAUNCH_DIV,
        z: ((caster.z + (target.z - caster.z) / 4) - start.z) / MULTI_SPARK_LAUNCH_DIV,
      }
    : { x: 0, y: 0, z: 256 / FONE };      // 原版 `MoveSpeed.z = 256`（定点）⇒ 1 单位/帧
  // ④ 偏移 **只进速度**：`MoveSpeed = (汇合点 − (起点+偏移))/20 = 基础速度 − 偏移/20`
  //    偏移在世界空间里是"水平横向"（见 `multiSparkLateral` 的代数说明）
  // 无目标时朝向角也**不设**（原版只在 `if (DesChar)` 里 `GetRadian3D`）⇒ 保持 0
  const angY = target ? radToPtAngle(faceAngleOf(caster, target)) : 0;
  for (let i = 0; i < num; i++) {
    pos.push({ ...start });
    const off = getMoveLocation(multiSparkLateral(i, num), 0, 0, 0, angY, 0);
    vel.push({
      x: baseV.x - off.x / MULTI_SPARK_LAUNCH_DIV,
      y: baseV.y - off.y / MULTI_SPARK_LAUNCH_DIV,
      z: baseV.z - off.z / MULTI_SPARK_LAUNCH_DIV,
    });
    deps.moveMain(i, pos[i]!);
  }

  return {
    get done() { return done; },
    update(frames: number) {
      if (done) return;
      // 原版每帧做一次，故按整数帧推进（不足一帧的余量由调用方累积后再传）
      for (let n = 0; n < frames; n++) {
        for (let i = 0; i < num; i++) {
          const p = pos[i]!;
          // ① 拖尾：在**位移之前**用当前位置（原版 :221 在位移之前）。
          //    尺寸/寿命/偏移都在这里按原版公式取（调用方只管 spawn），且位置是**新对象**。
          const T = MULTI_SPARK_TRAIL;
          const trSize = T.sizeMin + rnd() * (T.sizeMax - T.sizeMin);
          // 偏移：`Angle.x = (rand()%2048) - 1024`、`Angle.y = rand()%4096`、`MoveSpeed.z = 64`，
          // 然后**两次**用同一个向量 —— `sinGetMoveLocation2` 推 `Posi`、`GetMoveLocation` 加给 `sinFace`
          // （拖尾画的是 `sinFace`，故净效果 = 起点 + 该向量一次）。
          // ⚠ 因 `Angle.x ∈ [-90°, +90°)` ⇒ `cos ≥ 0` ⇒ 该向量的 **y 恒 ≥ 0**（永远略朝上，0~0.25）。
          const offAngX = Math.floor(rnd() * 2048) - 1024;
          const offAngY = Math.floor(rnd() * 4096);
          const ov = getMoveLocation(0, 0, T.offset, offAngX, offAngY, 0);
          deps.spawnTrail({ x: p.x + ov.x, y: p.y + ov.y, z: p.z + ov.z }, trSize);
          // ② 第 30 帧重算速度指向真目标（无目标时原版的 `if (DesChar)` 守卫不成立 ⇒ 不改瞄）
          if (target && frame === MULTI_SPARK_REAIM_FRAME) {
            vel[i] = {
              x: (target.x - p.x) / MULTI_SPARK_REAIM_DIV_XZ,
              y: (target.y - p.y) / MULTI_SPARK_REAIM_DIV_Y,
              z: (target.z - p.z) / MULTI_SPARK_REAIM_DIV_XZ,
            };
          }
          // ③ 位移
          p.x += vel[i]!.x; p.y += vel[i]!.y; p.z += vel[i]!.z;
          deps.moveMain(i, p);
        }
        // ④ 第 44 帧、只由第 1 颗触发命中
        if (frame === MULTI_SPARK_HIT_FRAME) deps.onHit(pos[0]!);
        frame++;
        if (frame >= MULTI_SPARK_MAX_FRAMES) { done = true; deps.onEnd(); break; }
      }
    },
  };
}
