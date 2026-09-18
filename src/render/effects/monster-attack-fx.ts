/**
 * 怪物攻击的**事件帧编排** —— 游戏（WorldView）与怪物实验室（efria-studio）共用的唯一实现。
 *
 * 原版在 `EventAttack` 的 `switch (dwCharSoundCode)` 里，**同一个事件帧**既播音效也起特效
 * （`character.cpp:2715+`）。两件事同源 ⇒ 必须落在同一处，否则"实验室里看到的"与
 * "游戏里跑的"会各演化一份（AGENTS #15：同一判定在仓库里出现第二份就是 bug 的种子）。
 *
 * 这里的边界刻意选成**不含**"事件帧怎么算出来的"—— 那是动画状态机的职责
 * （`MotionInfo.eventFrame`，见 char/anim-state-machine）。本模块只回答
 * "事件帧到了，这一刻该发生什么"。
 */

import { reportFallback } from '../../char/fallback-log.js';
import { getMoveLocation, radToPtAngle, FONE } from '../../core/geom.js';
// 只 import 类型：本模块刻意**不依赖 three**（游戏与实验室各自把池传进来）
import type { DynLightSink } from './dyn-light.js';

/** 攻击特效定义。 */
export interface MonsterAttackFxDef {
  /**
   * 资产名。给**数组**表示原版有多个候选（它用 `rand()` 从中挑一个）。
   *
   * ⚠ 我们**不在库里随机**：取哪个由调用方的 `ctx.variant` 决定（AGENTS #12 ——
   * 表现层随机会让"看到的是否为真"无法复现；将来要随机也应由服务端下发索引）。
   */
  asset: string | string[];
  /** 原版 `StartBillRectPrimitive` 的宽高（两轴同值时为方框） */
  size?: number;
  /**
   * 落点偏移 —— **原样照抄原版 `GetMoveLocation(x, y, z, angX, angY, angZ)` 的参数**
   * （`smLib3d/smgeosub.cpp:151`），由 `core/geom.getMoveLocation` 算出实际偏移。
   *
   * ⚠ 为什么存"参数"而不是"翻译好的结果"：我当初把 `pX + GeoResult_X` 直接翻译成
   * `forward: 54`，就漏掉了"它取决于上一行的 `GetMoveLocation` 调用"这件事，
   * 于是粒子落在怪物身上而不是身前（用户实测发现）。**存参数、原样搬运**，
   * 就不需要我理解语义 —— 而 `getMoveLocation` 是纯函数，可以单测钉死。
   *
   * `angY` 不在这里：它是**怪物的朝向**（原版 `Angle.y`，运行时给），见 `ctx.facing`。
   */
  move?: { x: number; y: number; z: number; angX?: number; angZ?: number };
  /**
   * 高度偏移（world 单位）。
   *
   * 原版有两种写法，都见过（`character.cpp` 的怪物 switch）：
   *   · `pY + 48 * fONE`        → 固定值（HULK）
   *   · `pY + GeoResult_Y`      → 用偏移结果的 y（DMACHINE：`GetMoveLocation(0, 30*fONE, 10*fONE, …)`）
   * 用 `'geoY'` 表示后者。
   */
  height: number | 'geoY';
  /**
   * **飞出物**：这个特效不是原地播，而是从怪物飞向目标（原版 `AssaParticle_*Shot` 那类，
   * 类里持有 `Posi` 并在 `Main()` 每帧沿方向推进）。
   *
   * 这里只给**速度**（世界单位/秒）。飞行的驱动由调用方做 —— 本模块不依赖 three，
   * 而"推进一个载体节点 + 让粒子跟随它"要用 `effects.spawn(name, { attach })`
   * 那个现成能力（`EffectManager.SpawnOpts.attach`）。
   *
   * 依据：`AssaParticle.cpp:7474` `Main()` 每帧 `step = 5*fONE + 100`（≈5.39 世界单位/帧），
   * 按 60fps 约 **323/秒**。
   */
  fly?: MonsterFlySpec;
  /**
   * **多火花**（原版 `sinEffect_MultiSpark`）：一次发射 `num` 颗，横向散开后朝目标飞。
   *
   * ⚠ `num` 是**这个特效自己的发射数** —— 与技能表里那个 `Amount Sparks`（伤害机制数值，
   *   随等级 3-4 ~ 5-8）**无关**：那是技能系统的事，特效层不该过问也没必要知道。
   *   **想发 100 颗就把 `num` 写 100**，本字段就是"这个特效发几颗"的唯一出处。
   *
   * （原版怪物在 case 里传 5，那是它的取值，不是特效的限制。）
   *
   * 偏移公式（第 i 颗 `±(10 + 1 + i*12)`、奇数颗时最后一颗抬高 26）**不在这里** ——
   * 那是机制常量，唯一出处是 `multi-spark.ts` 的 `multiSparkLateral` / `MULTI_SPARK_LAST_LIFT`
   * （曾在本表里抄过一份 `base/step/lift`，属重复定义，已删）。
   */
  sparks?: {
    /** 发射几颗（本特效自身的参数，对应原版调用点 `sinEffect_MultiSpark(..., 5)` 的那个 5） */
    num: number;
  };
  /**
   * **同帧的另外几个粒子系统** —— 原版一个 case 里常连着 `Start` 好几个 `.part`，
   * 各有各的高度/缩放（CC 普攻：两个系统 + 一个网格，见 `0x1670`）。
   *
   * 与 `asset` 数组的区别：数组是**多候选（挑一个）**，这里几个是**同时放**。
   * `height` 是**世界单位**（原版 `pY + N * fONE` 的 N）—— 原版写的是裸数（没乘 fONE）时要折算。
   */
  parts?: Array<{ asset: string; height: number; scale?: number; delaySec?: number }>;
  /**
   * **同帧的 ASE/静态网格**（原版 `SetAssaEffect(0, "xxx.ASE", …)` 那一族，如 CC 普攻的
   * `chao_glacial`）—— 由调用方转交 `cast-circle-runner.spawnAssaMesh`（**唯一实现**，
   * 与起手法阵共用：帧动画 = 每 `aniDelayTime` 帧推进一格、整段 `aniMaxCount × aniDelayTime` 帧）。
   *
   * `path` 是本仓资产路径（原版写 `.ASE`，同族资产见 note）。
   */
  mesh?: { path: string; aniMaxCount: number; aniDelayTime: number; scale?: number; note: string };
  /**
   * **落点基准**：缺省 `'caster'` = 以**怪物自己**为原点（原版 `pX/pY/pZ`）；
   * `'target'` = 以**被打的那个单位**为原点（原版 `pDest->pX/pY/pZ`）。
   *
   * ⚠ 这个字段是踩出来的：CC 普攻在 `ParkAssaParticle_ChaosKara1(chrAttackTarget)` 里传的是
   * **目标**，我却按"怪物身上"登记了 ⇒ 粒子长在自己脚下而不是被打的人身上（用户 2026-09-18 实测）。
   * 判据：看那个 case 把**谁**传给了 `ParkAssaParticle_*` —— 传 `chrAttackTarget` 就是目标。
   */
  anchor?: 'caster' | 'target';
  /**
   * **范围内的单位各挂一份**（原版 `SkillPlay_Monster_Effect(char, code, range)`，`netplay.cpp:12685`）——
   * 它不是音效（那个 code 参数在函数体里根本没被用到）：扫**所有玩家**，距离小于 `range` 的
   * （**世界单位**、平方比较）各起一份粒子 @ 该单位 `pY + height`。
   *
   * 例：CC 技能给 220 单位内的玩家各挂 `ChaosKaraSkillUser`（scale 0.1）—— 那一招的"吸血"落点。
   */
  onUnitsInRange?: { range: number; asset: string; height: number; scale?: number; delaySec?: number };
  /**
   * **同一颗"天降物"一次放几颗** —— 配合 `fly.fromTargetSky`（起点在目标上空）。
   * 每颗自己的落点偏移与**延迟帧**（原版 `ParkAssaChaosKaraMeteo` 一次 4 颗：
   * `dz ±10000` / `dx ±10000`，延迟 0/30/60/90；`AssaParticle.cpp:9908`）。
   *
   * ⚠ 延迟是"**连粒子都不生成**"（原版 `Delay` 递减到 0 才 `Start`，且 `Pos` 在此期间不动）。
   */
  skyDrops?: Array<{ dx?: number; dz?: number; delayFrames: number }>;
  /**
   * **什么时候放**：缺省 `'event'` = 事件帧（原版 `EventAttack` / `EventSkill_Monster`）；
   * `'cast'` = 技能**起手**那一刻（原版 `BeginSkill_Monster`）。
   *
   * 两种都有实例：CC 的技能在起手（`character.cpp:13985`）、普攻在事件帧（`:4679`）。
   * 由 `resolveMonsterFx(effectId, keyCode, phase)` 过滤，**不要在调用方自己判**。
   */
  timing?: 'event' | 'cast';
  /**
   * **这一招原版还有、我们还没做的部分** —— 播放时逐条 `reportFallback`
   * （同 kind+detail 合并计数，不会刷屏）。写在数据里而不是注释里：
   * 注释只有读代码的人看得到，而"少了一块"必须能被看见（AGENTS #12）。填"缺什么 + 源码行号"。
   */
  unhandled?: string[];
  /**
   * **技能音**（事件帧播）—— 原版 `SkillPlaySound(SKILL_SOUND_*)`，如
   * `wav/effects/skill/morion/vigorball 1.wav`（`effectsnd.cpp:682`）。
   *
   * ⚠ 它与**动作音**（`playMotionSound`：按动作态取 `skill N.wav` / `attack N.wav`）
   *   **两条路都播**，不是二选一 —— 原版 `character.cpp:14903` 那一支里
   *   `sinEffect_XXX(...)` 与 `SkillPlaySound(...)` 各一句，而通用动作音在事件帧块里
   *   另有 `CharPlaySound(this)`（`:4236`）。
   * 给数组 = 原版有多个候选（如 `VigorBall 1/2` 的 `rand()%2`）⇒ 由 `ctx.variant` 选，库内不随机。
   */
  sound?: string | string[];
  /**
   * **代码内组合的特效**（键 = `skill-fx-runner.CODE_SKILL_FX`）—— 一个技能由"网格 + 若干粒子系统 +
   * 动态光"组合而成、没有单一资产文件时用它（如 Glacial Spike：从 NewEffect 的 Lua 脚本移植而来）。
   *
   * 本模块**不执行**它（要碰 three）——只声明，由调用方转交 `CODE_SKILL_FX`（与玩家技能同一个注册表）。
   * 有 `code` 时 `asset` 只当显示名用（日志/检查器）。
   */
  code?: string;
  /**
   * **起手音**（技能动画开始时播，不是事件帧）—— 原版 `character.cpp:14070`
   *   `BeginSkill_Monster` 里的 `SkillPlaySound(SKILL_SOUND_SKILL_CASTING_MAGICIAN, …)`
   *   = `wav/effects/skill/morion/casting_m.wav`（`effectsnd.cpp:537`）。
   */
  castSound?: string;
  /**
   * 同一个 case 里原版还会起一盏**动态光**（`SetDynLight`）—— 有就一起起，别落下。
   * 参数原样照抄源码（0-255 颜色 / power / 每帧衰减 decPower）。
   */
  dynLight?: { r: number; g: number; b: number; a: number; power: number; decPower: number };
  /** 取证出处（源码文件:行号）。**每条必填**：填错不会报错，只会静默播成别人的特效 */
  note: string;
}

/**
 * **飞出物**的规格（原版 `AssaParticle_*` 那一族）—— 驱动的**唯一实现**在
 * `monster-fly-runner.ts`（游戏与实验室共用）。本模块只持数据、不碰 three。
 *
 * 起点/目标/朝向由调用方给（那个模块的 `FlyLaunch`）：本模块不知道"目标是谁"。
 */
export interface MonsterFlySpec {
  /**
   * **附加**粒子系统（原版 `AssaParticle_VigorBall`：`hoAssaParticleEffect.cpp:4181`
   * `ParticleIDExt1 = g_NewParticleMgr.Start("Skill3PriestessVigorBall2", pos)`）——
   * 与主粒子**同时在飞**（不是"多候选挑一个"，那才是 `asset` 数组的语义）。
   */
  systems?: Array<{
    asset: string;
    /**
     * 该系统是否**整团跟随**载体 —— 照抄原版的两种调用（别一刀切）：
     * `SetAttachPos` ⇒ `true`（粒子随载体平移）；`SetPos` ⇒ `false`（只移发射点，
     * 已发射的**粒子留在原地** ⇒ 拖尾）。缺省 `false`。
     */
    follow?: boolean;
  }>;
  /**
   * **主粒子**是否整团跟随载体（原版对主系统的那一次调用）：`SetAttachPos` ⇒ `true`、
   * `SetPos` ⇒ `false`（拖尾）。缺省 `false`（拖尾是更常见的设计，但**每个条目都显式写**）。
   */
  follow?: boolean;
  /** **直线**模式：世界单位/秒（原版 `AssaParticle.cpp:7474` 每帧 `step = 5*fONE + 100` ⇒ ≈323/秒） */
  speed?: number;
  /**
   * **跟踪**模式（原版 `AssaSkill3VigorBall::Main`，`AssaParticle.cpp:5465`）——
   * 每帧 `Velocity += 指向目标的单位向量`（加速度 1 单位/帧²）；下列量都是"每帧"的。
   */
  homing?: {
    /** 到达距离（原版 `length < 15`） */
    arriveDist: number;
    /** 超时帧数（原版 `Time > 100`） */
    arriveFrames: number;
    /** 近距阻尼起点（原版 `length < 100`） */
    dampDist: number;
    /** 阻尼系数（原版 `*0.85`） */
    damp: number;
    /** 速度软上限（原版 `|Velocity| > 10` 时 `*0.9`） */
    maxSpeedPerFrame: number;
    softClamp: number;
  };
  /** 起点抬高（世界单位；原版 `curPos.y = pY + 5000` ⇒ 5000/256 ≈ 19.5） */
  lift?: number;
  /**
   * **起点在目标上空**（世界单位）—— 原版 `ParkAssaChaosKaraMeteo::Start`：
   * `curPos = destPos + (0, 130000, 50000)`（⇒ 上 507.8、后 195.3，**world 轴、不随怪物朝向转**）。
   * 给了它 ⇒ 调用方给的那个起点（射手身上 + `lift`）只作"取不到目标"时的兜底。
   */
  fromTargetSky?: { up: number; back: number };
  /** **落点**相对目标的偏移（世界单位）—— 原版 `attackPos = destPos + (0, 0, ±10000)` */
  targetOffset?: { x?: number; y?: number; z?: number };
  /** 延迟多少帧才**生成粒子**并开始移动（原版 `Delay`；期间 `Pos` 不动） */
  delayFrames?: number;
  /** 直线模式的最长帧数（原版这里 `TimeCount = 700`；缺省 60 —— `AssaParticle.cpp:7492`） */
  maxFrames?: number;
  /**
   * 直线模式的**到达距离**（世界单位；缺省 25 —— `AssaParticle.cpp:7492` 的 `length < 25`）。
   *
   * ⚠ 天降那类要**落到地面**的把这里写小：原版是"撞地判定"（`mapY > Pos.y`）⇒ 等价于
   * "到达落点"，用缺省 25 会**停在离地二十几单位处**（我实测到了：y=22.5 就停了）。
   */
  arriveDist?: number;
  /** **起飞音**（原版 `esPlaySound(20, 音量=400-距离/100)`；`AssaParticle.cpp:9960`） */
  sound?: string;
  /** 初速（世界单位/**帧**，方向 = 射手朝向 ± `yawOffsetDeg`）—— 原版 `GeoResult * 2` */
  initialSpeedPerFrame?: number;
  /** 发射偏航偏移（度） */
  yawOffsetDeg?: number;
  /** 按事件帧镜像：第 1 个事件帧取负、其后取正（原版 `MotionEvent == 1 ? -45 : +45`） */
  mirrorByMotionEvent?: boolean;
  /** 到达（原版 `SetStop` + `Start("…Hit1")`）：命中资产 + 动态光 */
  hit?: {
    asset?: string;
    dynLight?: { r: number; g: number; b: number; a: number; power: number; decPower: number };
    /** **命中音**（原版 `esPlaySound(21, 400-距离/10)`；`AssaParticle.cpp:9832`） */
    sound?: string;
    /**
     * **命中时的屏幕震动** —— 原版 `EffectWaveCamera((maxDist - 距离) / div, delay)`，
     * 距离 = 爆点与本地玩家的世界单位距离（`AssaParticle.cpp:9824`）。
     * 这里是原样搬参数，由 `render/wave-camera.ts` 算（那块是唯一实现，含全局开关）。
     */
    shake?: { maxDist: number; div: number; delay: number };
  };
}

/**
 * **Vigor Ball**（祭司技能）—— 玩家与怪物**同一招**。
 *
 * 原版两边调的是**同一个函数**（`AssaParticle_VigorBall`，`hoAssaParticleEffect.cpp:4152`）：
 *   · 怪物（D_PR `'H'`）：`character.cpp:14912` `case 'H': AssaParticle_VigorBall(this, chrAttackTarget);`
 *   · 玩家（`SKILL_PLAY_VIGOR_BALL`）：`character.cpp:16338` 同一个 `AssaParticle_VigorBall`
 *     （玩家侧另加服务端伤害 `dm_SendTransDamage`，`MotionEvent < 3` 那几帧；音效两边都是
 *     `switch (rand() % 2)` 选 `SKILL_VIGOR_BALL1/2`）
 * ⇒ **spec 只写一份**：怪物派表（下面的 `'H'`）与 `CODE_SKILL_FX.vigorball`（`skill-fx-runner.ts`）共用。
 */
export const FX_VIGOR_BALL: MonsterAttackFxDef = {
  asset: 'Skill3PriestessVigorBall1',   // 主粒子（`AssaParticle.cpp:5597` Start("…VigorBall1")）
  height: 0,                            // 起点抬高走 `fly.lift`（原版 `curPos.y = pY + 5000`）
  // ⚠ 同目录另有 2 号系统（`AssaParticle.cpp:5598` `Start("…VigorBall2")`），**两个同时在飞**
  //   ⇒ 用 `systems` 附加，**不是**把 asset 写成数组（数组的语义是"多候选、挑一个"）
  sound: ['wav/effects/skill/morion/vigorball 1.wav',
    'wav/effects/skill/morion/vigorball 2.wav'],
  fly: {
    // 跟随语义照抄原版那两次调用（`AssaParticle.cpp:5510-5520` 的 Main）：
    //   主 `SetPos` ⇒ 只移发射点、已发射的**粒子留在原地 = 拖尾**；
    //   附加 `SetAttachPos` ⇒ 整团搬运（贴体光晕）。
    follow: false,
    systems: [{ asset: 'Skill3PriestessVigorBall2', follow: true }],
    lift: 5000 / FONE,                  // ≈19.5 世界单位
    yawOffsetDeg: 45,
    mirrorByMotionEvent: true,          // 两个事件帧各一颗，左右各一（`MotionEvent == 1` 取负）
    initialSpeedPerFrame: 6,            // 侧偏量 3*fONE 的中值 × 2（`GeoResult * 2`）⇒ 6/帧
    homing: {
      arriveDist: 15, arriveFrames: 100, dampDist: 100, damp: 0.85,
      maxSpeedPerFrame: 10, softClamp: 0.9,
    },
    hit: { asset: 'Skill3PriestessVigorBallHit1' },
  },
  note: "character.cpp:14912(怪物 case 'H') / :16338(玩家 SKILL_PLAY_VIGOR_BALL) / "
    + 'hoAssaParticleEffect.cpp:4152-4200 / AssaParticle.cpp:5465(Main),5551(Start),5597-5598; '
    + 'dpr.inx idx17 事件帧 4640+7040',
};

/**
 * **Glacial Spike** —— 玩家（`SKILL_PLAY_GLACIAL_SPIKE`）与怪物 D_PR `'Z'` **同一招**。
 *
 * 实现是**代码内组合**（1 个静态网格 + 5 个粒子系统 + 一盏正前方蓝光，全部来自 NewEffect 的
 * Lua 脚本）⇒ 声明 `code: 'glacialspike'`，由调用方转交 `CODE_SKILL_FX`
 * （与玩家技能**同一个注册表**，实现在 `glacial-spike.ts`）。
 */
export const FX_GLACIAL_SPIKE: MonsterAttackFxDef = {
  asset: 'GlacialSpike',        // 显示名（真身是 `code`，见字段说明）
  height: 0,
  code: 'glacialspike',
  sound: ['wav/effects/skill/morion/glacialspike 01.wav',
    'wav/effects/skill/morion/glacialspike 02.wav'],
  note: "character.cpp:14926 怪物 case 'Z'（另含 SetDynLight 正前方 64、蓝 power 700）"
    + ' / 玩家 SKILL_PLAY_GLACIAL_SPIKE / HoNewEffectFunction.cpp:590 SkillCelestialGlacialSpike'
    + '（Lua: Effect/NewEffect/SkillCelestialGlacialSpike.lua）',
};

/** 已上报过的 `unhandled` 条目（`effectId:文本`）—— 缺口清单**一次会话报一次**，不逐次刷屏 */
const reportedUnhandled = new Set<string>();

/**
 * 派发表：键 = 服务端下发的 `monster_effect_id`（= 原版 `dwCharSoundCode` / `EMonsterEffectID`）。
 *
 * ⚠ **只放核验过的条目**，每条注明出处。表里没有 = 未核验，**不猜**：
 * 特效填错不会报错，只会静默播成别人的特效，事后极难发现（AGENTS #12 的精神）。
 *
 * ⚠ 但"表里没有"**不等于降级**：绝大多数纯物理攻击的怪本来就没有攻击特效
 * （原版 `switch` 里相当多的 case 只播音效）。所以要区分的是"核验过 = 无特效"
 * 与"还没核验"，实验室界面把这两种显示成不同状态，不去污染降级清单。
 *
 * ⚠ **值有两型**：单效果条目（`MonsterAttackFxDef`）与**多技能怪**（`MonsterSkillSet`）——
 * 后者一个 `effectId` 下按动作 `KeyCode` 分派多招（原版 `switch (MotionInfo->KeyCode)`）。
 * 用 `resolveMonsterFx(effectId, keyCode)` 取实际该放的那一条，**不要在调用方自己拆**。
 */
export const MONSTER_ATTACK_FX: Record<number, MonsterFxEntry> = {
  // 0x10B0 = snCHAR_SOUND_MUSHROOM（蘑菇精）：向周围释放粉色的有毒孢子气体
  //   `NewSourcePT-2023/SrcGame/src/character.cpp:4277` `case snCHAR_SOUND_MUSHROOM:`
  //      → `StartEffect(pX, pY + (24 * fONE), pZ, EFFECT_GAS1);`（调用在 :4279）
  //   `NewSourcePT-2023/SrcGame/src/HoBaram/HoEffect.cpp:7997` `case EFFECT_GAS1:`
  //      → `StartBillRectPrimitive(x, y, z, 120, 120, "Gas1.ini");`（调用在 :7999-8000）
  //   ⚠ 曾误写为 `character.cpp:2719 / HoEffect.cpp:7262` —— 后者其实是 `"Return1.ini"`
  //     的 `StartDestPath`，与 Gas1 无关。行号是唯一能复核的凭据，写错比不写更危险。
  0x10B0: { asset: 'Gas1', size: 120, height: 24, note: 'character.cpp:4279 / HoEffect.cpp:7999-8000' },

  // 0x12B0 = snCHAR_SOUND_HULK：命中特效，原版从**三个候选**里 `rand()%3` 挑一个
  //   `character.cpp:4459-4466` `case snCHAR_SOUND_HULK:`
  //      → `GetMoveLocation(0, 0, 54 * fONE, 0, Angle.y, 0);`（:4463）⇒ **前向 54 单位**
  //      → `StartEffectMonster(pX + GeoResult_X, pY + 48 * fONE, pZ + GeoResult_Z, MONSTER_HULK_HIT1);`（:4464）
  //   `HoEffect.cpp:11721-11732` `case MONSTER_HULK_HIT1:`
  //      → `SetDynLight(pos, …)` + `int i = rand() % 3;` → `g_NewParticleMgr.Start("HulkHit1"|"HulkHit2"|"HulkHit3", pos)`
  //   ⚠ 同一常量还被 OMICRON/STRIDER/IGOLATION/DARKPHALANX/BLOODYKNIGHT/CHIMERA/HELLHOUND/
  //     KINGSPIDER/S_METALGOLEM 复用，但那些 case 的**前向/高度偏移各不相同**（实测 22 / 42 / 48）
  //     ⇒ 它们 effectId 不同，要**各自登记**，不能共用这一条。
  0x12B0: {
    asset: ['HulkHit1', 'HulkHit2', 'HulkHit3'],
    // `character.cpp:4463` `GetMoveLocation(0, 0, 54 * fONE, 0, Angle.y, 0);` —— 原样搬参数
    //（54 = 身前，绕 Y 用怪物朝向；不是"落在身上"）
    move: { x: 0, y: 0, z: 54 },
    height: 48,           // `:4464` `pY + 48 * fONE`（固定值，非 GeoResult_Y）
    // `HoEffect.cpp:11723`（case 的第一行）：`SetDynLight(pos.x, pos.y, pos.z, 100, 255, 100, 255, 100, 1)`
    //   → 绿色（r=100,g=255,b=100）、a=255、power=100、每帧衰减 1 ⇒ 生命期 100 帧 ≈ 1.67s
    //   → `Range = max(64, 100>>1) = 64`（世界单位，见 dyn-light.ts）
    dynLight: { r: 100, g: 255, b: 100, a: 255, power: 100, decPower: 1 },
    note: 'character.cpp:4463-4464 / HoEffect.cpp:11721-11732（rand()%3 + SetDynLight）',
  },

  // 0x1580 = snCHAR_SOUND_RUNICGUARDIAN：走的是 `AssaParticle_*` **别名函数**，不是 `StartEffect`
  //   常量表（这类入口在首版索引里被**整族漏掉**，见 output/monster-attack-index.md）
  //   `character.cpp:4603-4608` `case snCHAR_SOUND_RUNICGUARDIAN:`
  //      → `AssaParticle_MonsterRunicGuardianShot(this, chrAttackTarget);`
  //   `hoAssaParticleEffect.cpp:5525-5541`：起点 = 怪物 `pY + 30*fONE`、终点 = 目标 `pY + 24*fONE`
  //      → `new AssaRunicGuardianShot; shot->Start(&curPos, &desPos);`
  //   `AssaParticle.cpp:7443` `Start()` → `g_NewParticleMgr.Start("IronMonsterRunicGuardianShot1", Posi)`
  //     资产 = `effect/particle/script/ironmonsterrunicguardianshot1.part`
  //   `AssaParticle.cpp:7474` `Main()` → 每帧沿 `ShootingAngle` 前进 `5*fONE + 100`（**朝目标飞**）
  //   ⚠ 原版这是**飞出物**。这里先按**原地粒子**登记（先把粒子本身做出来），
  //     飞行轨迹留作下一步。
  // ⚠ 到达时才起那盏橙色动态光（`AssaParticle.cpp:7495` `SetDynLight(pos, 255,150,50,255,200,2)`）
  0x1580: {
    asset: 'IronMonsterRunicGuardianShot1',
    height: 30,
    // 原版是**飞出物**：`AssaParticle.cpp:7474` `Main()` 每帧 `step = 5*fONE + 100`
    //   （≈5.39 世界单位/帧）⇒ 60fps 下约 323/秒。终点 = 目标 `pY + 24*fONE`。
    fly: {
      speed: 323,
      // 原版 `AssaRunicGuardianShot::Main`（`AssaParticle.cpp:7516`）用 `SetAttachPos` ⇒ 整团搬运
      follow: true,
      hit: { dynLight: { r: 255, g: 150, b: 50, a: 255, power: 200, decPower: 2 } },
    },
    note: 'character.cpp:4606 / hoAssaParticleEffect.cpp:5530-5539 / AssaParticle.cpp:7443,7474,7495',
  },

  // 0x1960 = snCHAR_SOUND_REVIVED_PRIESTESS（被复活的祭司 / 死亡祭司）—— **多技能怪**。
  //
  // ⚠⚠ **特效挂在动作的 `KeyCode` 上，不是挂在 effectId 上。**
  //   原版 `smCHAR::EventSkill_Monster`（`character.cpp:11916` 起）是
  //   `case snCHAR_SOUND_REVIVED_PRIESTESS: if (chrAttackTarget) switch (MotionInfo->KeyCode)`，
  //   三个分支各是一招，各有各的**动作**与**事件帧**（动作表 `char/monster/d_pr/dpr.inx` 实测）：
  //
  //   | 条目 | KeyCode | 事件帧 | 原版调用 |
  //   |---|---|---|---|
  //   | idx 15 | `'I'` | 3200 | **普攻**（`EventAttack` 里**没有她** ⇒ 无特效） |
  //   | **idx 16** | **`'O'`** | **3360** | `sinEffect_MultiSpark(this, chrAttackTarget, 5)` |
  //   | idx 17 | `'H'` | 4640 / 7040 | `AssaParticle_VigorBall(this, chrAttackTarget)` |
  //   | idx 18 | `'Z'` | 7200 | `SkillCelestialGlacialSpike(this)` |
  //
  //   **实测反例（我第一版就是这样错的）**：只看 effectId ⇒ 播着 idx 17（`'H'` = VigorBall）的
  //   动作，却在它的 4640/7040 上放 **MultiSpark**。用户实测："技能动画和特效完全不匹配。"
  //   ⇒ 派表按 keyCode 分派；**键没登记 = 那一招还没核验**（原版 switch 无 default ⇒ 什么都不做）。
  //
  // · 普攻无特效：全文件 `grep -n REVIVED_PRIESTESS character.cpp` 只有两处（14070 / 14903），
  //   都在 `BeginSkill_Monster` / `EventSkill_Monster` 内；`EventAttack`（switch 4275~5321）
  //   **既没有她的 case、也没有 default**。
  // · 起手（`character.cpp:14070` `BeginSkill_Monster`）有**脚下法阵**，**所有技能共用**：
  //   `sinEffect_StartMagic(&pos, 2)` → `MAAM2` 模型 + `maam2.tga` + `star05Q_03.bmp`。
  0x1960: {
    // 起手音：`effectsnd.cpp:537` `Casting_M.wav → SKILL_SOUND_SKILL_CASTING_MAGICIAN`
    //   —— 跟在 `BeginSkill_Monster`（动画开始）上，**不是事件帧**
    castSound: 'wav/effects/skill/morion/casting_m.wav',
    castMagic: 2,                      // `sinEffect_StartMagic(&pos, 2)` 的 CharFlag
    skillByKeyCode: {
      O: {
        asset: 'MultiSpark',           // 自建代码内 spec（`multi-spark.ts`）；原版是裸贴图 `m_spark06.tga`
        height: 0,                     // 起点 = 怪物原点（源码用 `pChar->pX/pY/pZ`，无高度偏移）
        // 5 = 原版**怪物 case 的取值**（`sinEffect_MultiSpark(..., 5)`），不是特效的限制：
        // `num` 就是这个特效发几颗，改成 100 也完全没问题。
        // 技能音：`effectsnd.cpp:551` `{ "…\Morion\MultiSpark 1.wav", SKILL_SOUND_SKILL_MULTISPARK }`
        sound: 'wav/effects/skill/morion/multispark 1.wav',
        sparks: { num: 5 },
        // ⚠ 这盏白光**不是"起手"** —— 它在 `sinEffect_MultiSpark` 的**发射**里
        //   （`sinSkillEffect.cpp:813` `SetDynLight(pChar->pX, pChar->pY, pChar->pZ, 255,255,255,255,140,1)`）
        //   ⇒ 属于 `'O'` 这一招，不属于宿主条目。（早先我记成"起手"是错的。）
        dynLight: { r: 255, g: 255, b: 255, a: 255, power: 140, decPower: 1 },
        note: "character.cpp:14903 case 'O' / sinSkillEffect.cpp:813 动态光,881 发射,244 驱动,1766 命中；动作 dpr.inx idx16 事件帧 3360",
      },
      // 祭司的 Vigor Ball —— 与**玩家技能** `SKILL_PLAY_VIGOR_BALL` 同一招（共用 spec 见上）
      H: FX_VIGOR_BALL,
      // 祭司的 Glacial Spike（冰枪）—— 与**玩家技能** `SKILL_PLAY_GLACIAL_SPIKE` 同一招：
      // 原版两边都调 `SkillCelestialGlacialSpike`（NewEffect 的 Lua）⇒ 走代码内组合
      // （`code: 'glacialspike'`，实现在 `glacial-spike.ts`），见 `FX_GLACIAL_SPIKE`
      Z: FX_GLACIAL_SPIKE,
    },
    note: 'character.cpp:14903 `switch (MotionInfo->KeyCode)`；动作表 dpr.inx idx16=\'O\' 事件帧3360 / idx17=\'H\' / idx18=\'Z\'',
  },

  // 0x1670 = snCHAR_SOUND_CHAOSCARA（混沌卡拉 / CC）—— **普攻在事件帧、技能在起手**，两种时机都占
  //
  // · 普攻：`character.cpp:4679-4685` `case snCHAR_SOUND_CHAOSCARA:` → `ParkAssaParticle_ChaosKara1(chrAttackTarget)`
  //     → `hoAssaParticleEffect.cpp:1426` → `ParkAssaParticle_Normal1_1`（`:1332`）：
  //       ① `ChaosKaraNormal1_1` @ `pY + 500`（源码写的是**裸数、没乘 fONE** ⇒ 500/256 ≈ 1.95 世界单位）
  //       ② `SetAssaEffect(0, "chao_glacial.ASE", …)`（`AniMaxCount = 25` / `AniDelayTime = 2`）
  //       ③ `ChaosKaraNormal1_2` @ `pY + 1500`，`Start(name, pos, 0.3f)` ⇒ **scale 0.3**
  //     ①③ 同帧同点（无 GetMoveLocation）⇒ 两个系统一起放，用 `parts`；② 还没接，见 `unhandled`
  //
  // · 技能：`character.cpp:13985-14003` 在 **`BeginSkill_Monster`（起手那一刻）**，不在事件帧：
  //     `KeyCode == 'J'` → `ParkAssaParticle_ChaosKara2`（`:1436`）→ `ChaosKaraMeteo`（`:1384`）：
  //        4 颗陨石从天上砸向目标四周（`AssaParticle.cpp:9908` `ParkAssaChaosKaraMeteo`，8 单位/帧、延迟 0/30/60/90）
  //        ⇒ **未实现**，故 'J' 键**不登记**（实验室/日志会明确说"该招未登记"，不会拿别招顶上）
  //     else（动作**没有** KeyCode ⇒ 派表键 `''`）→ `ParkAssaParticle_ChaosKaraSkill_Monster`（`:1447`）
  //        → `ChaosKaraSkill` @ `pY + 2500`；紧接着
  //        `SkillPlay_Monster_Effect(this, SKILL_PLAY_CHAOSCARA_VAMP, 220)` —— **那不是音效，是范围效果**
  //        （`netplay.cpp:12685`，第 2 个参数在函数体里根本没被用到）：给 220 单位内的**玩家**各挂一份
  //        `ChaosKaraSkillUser`（@ 该玩家 `pY + 2500`，scale 0.1）⇒ 我们这侧未接，见 `unhandled`
  0x1670: {
    // 普攻（`EventAttack`，与技能是**两个函数**，故分开放）
    attack: {
      asset: 'ChaosKaraNormal1_1',
      // ⚠ 落点 = **被打的那个单位**，不是自己：`ParkAssaParticle_ChaosKara1(chrAttackTarget)`
      //   → `ParkAssaParticle_Normal1_1(pChar)`，里面写的是 `pDest->pX/pY/pZ`（我第一版按怪物身上登记过）
      anchor: 'target',
      height: 500 / 256,               // `:1337` `charPos.y = pDest->pY + 500`（裸数，未乘 fONE）
      // `:1349` 同一个 case 里第二个系统（`charPos.y += 1000` ⇒ pY + 1500），第三个参数 = **延迟 0.3s**
      //   ⚠ `Start(name, pos, X)` 的 X 是 `startDelay`（`HoNewParticleMgr.h:86`）**不是缩放** ——
      //     我第一版写成 `scale: 0.3`；同理 `ChaosKaraSkillUser` 的 0.1 也是延迟
      parts: [{ asset: 'ChaosKaraNormal1_2', height: 1500 / 256, delaySec: 0.3 }],
      // `:1341` `SetAssaEffect(0, "chao_glacial.ASE", 0, &charPos, 0, 0)` + `AniMaxCount=25 / AniDelayTime=2`
      // （配合 `[fxdbg]` 断点排查"挂上就卡"到底卡在哪一步 —— 定位完删掉断点）
      mesh: {
        path: 'effect/assaeffect/chaoskara/chao_glacial.smd',
        aniMaxCount: 25, aniDelayTime: 2,
        note: '原版资产名 chao_glacial.ASE（hoAssaParticleEffect.cpp:1341）',
      },

      note: 'character.cpp:4679-4685 / hoAssaParticleEffect.cpp:1332-1350（事件帧，chaoscara.inx idx12 事件帧 800）',
    },
    skillByKeyCode: {
      // 原版 else 分支（动作无 KeyCode）——与 'J' 那颗陨石同一层，故时机是**起手**
      '': {
        timing: 'cast',
        asset: 'ChaosKaraSkill',
        height: 2500 / 256,            // `:1356` `posi.y = pChar->pY + 2500`（裸数）
        // **"群体吸血"就是这一段**：`character.cpp:13998` 随后调
        // `SkillPlay_Monster_Effect(this, SKILL_PLAY_CHAOSCARA_VAMP, 220)` ——
        // 扫 220 单位内的**玩家**，每人各挂一份 `ChaosKaraSkillUser`
        //（@ 该玩家 pY+2500；`:1374` `Start(name, posi, 0.1f)` 的 0.1 是**延迟 0.1s**，不是缩放）
        onUnitsInRange: { range: 220, asset: 'ChaosKaraSkillUser', height: 2500 / 256, delaySec: 0.1 },
        note: 'character.cpp:13996-13998 / hoAssaParticleEffect.cpp:1447,1353,1367；范围效果 netplay.cpp:12685',
      },
      // `'J'` = `ParkAssaParticle_ChaosKara2` → `ChaosKaraMeteo`（`:1436`→`:1384`）：
      // **4 颗陨石从目标上空砸下**，落点/延迟各不相同，到地出 `ChaosKaraMeteoHit` + 蓝白动态光
      J: {
        timing: 'cast',
        asset: 'ChaosKaraMeteo',
        height: 0,                     // 起点在目标上空，不走 caster 高度
        fly: {
          speed: 480,                  // `AssaParticle.cpp:9929` `Velocity = 方向 * 8`（世界单位/帧 ⇒ 480/秒）
          maxFrames: 700,              // `:9945` `TimeCount = 70 * 10`（超时才停；正常是撞地）
          // 原版撞地即停（`:9958` `mapY > Pos.y`）⇒ 到达距离取小值，别停在半空（缺省 25 会停在离地 25 处）
          arriveDist: 4,
          follow: false,               // `:9927` `SetPos`（只移发射点 ⇒ 粒子留尾）
          // `:9908` `curPos = destPos + (0, 130000, 50000)`（world 轴）：上 507.8 / 后 195.3
          fromTargetSky: { up: 130000 / 256, back: 50000 / 256 },
          // 起飞音 `:9960` `esPlaySound(20, 400 - 距离/100)` = `esSoundWav[20]` =
          // `game\Audio\Effects\Menu\Event\meteo 1.wav`（`effectsnd.cpp:394`，资产在位）
          sound: 'wav/effects/menu/event/meteo 1.wav',
          hit: {
            asset: 'ChaosKaraMeteoHit',      // `:9834` `Start("ChaosKaraMeteoHit", hitPos)`
            // `:9833` `SetDynLight(hit, 100,200,255,255,250,2)` —— 蓝白、每帧衰减 2
            dynLight: { r: 100, g: 200, b: 255, a: 255, power: 250, decPower: 2 },
            // 命中音 `:9832` `esPlaySound(21, …)` = `esSoundWav[21]` = `meteo 2.wav`
            sound: 'wav/effects/menu/event/meteo 2.wav',
            // `:9824` `EffectWaveCamera((500 - 距离)/15, 2)` —— 屏幕震动（参数原样搬）
            shake: { maxDist: 500, div: 15, delay: 2 },
          },
        },
        // `ChaosKaraMeteo(&pChar->Posi)`（`:1384`）里的 4 次 `ParkAssaParticle_ChaosKaraTerrainFire`：
        // `attackPos = destPos + (0,0,±10000)` / `(±10000,0,0)`，延迟 0 / 30 / 60 / 90 帧
        skyDrops: [
          { dz: 10000 / 256, delayFrames: 0 },
          { dz: -10000 / 256, delayFrames: 30 },
          { dx: 10000 / 256, delayFrames: 60 },
          { dx: -10000 / 256, delayFrames: 90 },
        ],
        note: 'character.cpp:13985-13992 / hoAssaParticleEffect.cpp:1436,1380-1395 / AssaParticle.cpp:9908-9960',
      },
    },
    note: '技能 character.cpp:13985-14003（起手）；普攻 character.cpp:4679-4685（事件帧，落点=被打的单位）',
  },
};

/** 特效管理器的最小契约 —— 结构化类型，避免与本模块耦合到具体实现类。 */
export interface FxSpawner {
  spawn(asset: string, opts: { pos: { x: number; y: number; z: number }; size?: number }): Promise<boolean>;
}

/**
 * **多技能怪**：一个 `effectId` 下按动作的 `KeyCode` 分派多招。
 *
 * 原版 `smCHAR::EventSkill_Monster` 长这样（`character.cpp:11916` 起）：
 * ```cpp
 * case snCHAR_SOUND_REVIVED_PRIESTESS:
 *   if (chrAttackTarget) {
 *     switch (MotionInfo->KeyCode) {      // ← 一招一个 KeyCode
 *       case 'O': sinEffect_MultiSpark(this, chrAttackTarget, 5); …   break;
 *       case 'H': AssaParticle_VigorBall(this, chrAttackTarget); …    break;
 *       case 'Z': SkillCelestialGlacialSpike(this); …                 break;
 *     }
 *   }
 *   break;
 * ```
 * 所以"放哪一招"由**正在播的那条动作**决定 —— 动作表里 `KeyCode` 是 `smMOTIONINFO` 的字段
 * （我们解析在 `char-parser.ts:58`，`offset + 164`，uint8），三招各有自己的**事件帧**。
 */
export interface MonsterSkillSet {
  /** **起手音**（技能动画开始时播，不是事件帧）—— 原版 `BeginSkill_Monster` 里的 `SkillPlaySound` */
  castSound?: string;
  /** **起手法阵**：原版 `sinEffect_StartMagic(&pos, CharFlag)` 的 `CharFlag`（D_PR = 2） */
  castMagic?: number;
  /**
   * **普攻**的特效 —— 原版普攻与技能是**两个不同的函数**（`EventAttack` / `EventSkill_Monster`），
   * 各有各的 case；一只怪两样都有时必须分开登记，否则"这一帧是普攻还是技能"根本分不出来
   * （CC 就是：普攻两个粒子系统、技能另两套）。
   *
   * `timing` 在它身上无意义 —— 普攻恒在事件帧（`EventAttack`）。
   */
  attack?: MonsterAttackFxDef;
  /**
   * 按动作 `KeyCode` 分派（键为**大写字母**；原版 `MotionInfo->KeyCode` 就是 ASCII）。
   * **没登记的键 = 那一招还没核验** ⇒ 什么都不放（原版 switch 没有 default，本来也不放）。
   *
   * 键 `''`（空串）= 原版那条分支的 `else` —— 动作**没有** KeyCode 时走的兜底
   * （CC 的技能就是这么分的：`KeyCode == 'J'` 一颗招、其余走 else，见 `0x1670`）。
   * 原版 else 分支只该在确实读到了 `else` 时才登记，别拿它当"什么都能放"的通配。
   */
  skillByKeyCode: Record<string, MonsterAttackFxDef>;
  note: string;
}

export type MonsterFxEntry = MonsterAttackFxDef | MonsterSkillSet;

/** 多技能怪？—— 判据是 `skillByKeyCode` 存在（唯一判定处） */
export function isSkillSet(e: MonsterFxEntry): e is MonsterSkillSet {
  return (e as MonsterSkillSet).skillByKeyCode !== undefined;
}

/** `KeyCode` → 派表键：0 = 动作没有 KeyCode ⇒ `''`（原版走 `else` 分支的情形） */
function keyOf(keyCode: number): string {
  return keyCode === 0 ? '' : String.fromCharCode(keyCode).toUpperCase();
}

/** 阶段：`'event'` = 事件帧（`EventAttack`/`EventSkill_Monster`）／`'cast'` = 技能起手（`BeginSkill_Monster`） */
export type FxPhase = 'event' | 'cast';

/**
 * 正在播的那条动作是**普攻**还是**技能** —— 原版这是**两个不同的函数**
 * （`EventAttack` / `EventSkill_Monster`，各有一套 case），**光看 KeyCode 分不出来**
 * （两边的动作都可能没有 KeyCode）。所以调用方必须说清，别让我们猜。
 */
export type MotionKind = 'attack' | 'skill';

/**
 * 由 `effectId` + **动作的 KeyCode** + **阶段**（+ 普攻/技能）解出"这一刻该放哪一条"。
 *
 * **唯一实现**（AGENTS #15）：实验室的显示与实际播放必须走同一份判断，
 * 否则"日志说 MultiSpark、画面里放的是别的"这种分叉会同时污染两边。
 *
 * @param keyCode 原版 `MotionInfo->KeyCode`（ASCII 码；0 = 没有 ⇒ 查 `''` 键）；普攻忽略它
 * @param phase 缺省 `'event'`；`timing` 与阶段不符 ⇒ `null`（那一刻本来就不该放，不是"没核验"）
 * @param kind 缺省按阶段推：起手一定是技能，事件帧按普攻打（**技能动作必须显式传 `'skill'`**）
 * @returns `null` = 这一刻没有该放的东西（或该怪无核验条目）
 */
export function resolveMonsterFx(
  effectId: number, keyCode?: number | null, phase: FxPhase = 'event',
  kind: MotionKind = phase === 'cast' ? 'skill' : 'attack',
): MonsterAttackFxDef | null {
  const entry = MONSTER_ATTACK_FX[effectId];
  if (!entry) return null;
  if (!isSkillSet(entry)) return (entry.timing ?? 'event') === phase ? entry : null;
  if (kind === 'attack') {
    // 普攻走**另一个函数**（`EventAttack`），它的 case 不看 KeyCode —— 只在 `attack` 上找
    const a = entry.attack;
    return a && (a.timing ?? 'event') === phase ? a : null;
  }
  if (keyCode == null) return null;            // 多技能怪但不知道在播哪招 ⇒ 无法决定
  const sub = entry.skillByKeyCode[keyOf(keyCode)];
  if (!sub) return null;                       // 未登记（原版 switch 无 default）/ 无 `''` 兜底
  return (sub.timing ?? 'event') === phase ? sub : null;
}

/** 取某条目的"起手"信息（多技能怪才有）—— 实验室/游戏用它决定起手音与法阵 */
export function monsterCastOf(effectId: number): { castSound?: string; castMagic?: number } | null {
  const entry = MONSTER_ATTACK_FX[effectId];
  if (!entry || !isSkillSet(entry)) return null;
  return { castSound: entry.castSound, castMagic: entry.castMagic };
}

/**
 * 走**箭矢射击系统**的怪 —— 与 `MONSTER_ATTACK_FX` **分开登记**。
 *
 * 原版这 3 个 case 里**没有粒子特效调用**，而是设 `ShootingFlag = TRUE` 并把
 * `dwActionItemCode` 硬写成 `sinWS1`（弓）来复用玩家那套射击系统：
 *
 * ```
 * ShootingPosi = (pX, pY + N*fONE, pZ);                    // N 每只怪不同（28 / 38）
 * GetRadian3D(起点, 目标->pY + 24*fONE);   ShootingFlag = TRUE;   dwActionItemCode = sinWS1;
 * ```
 *
 * 我们复用 `projectile.ts` 的箭链路。**不需要登记起点高度**：原版那个 `pY + N*fONE`
 * 是在近似"出手高度"，而我们走 `mount = null` 时会自然落到**手骨**（`Bip weapon01`）
 * —— 与"空手施法"同一条路径，比硬编码高度更准。
 *
 * key = 服务端下发的 `monster_effect_id`。
 */
export const MONSTER_RANGED: Record<number, { note: string; launchLift: number }> = {
  // `launchLift` = 原版 `ShootingPosi.y = pY + N * fONE` 的 N（**逐怪不同**，与玩家的 34 也不同）
  0x11C0: { note: 'SKELETONRANGE character.cpp:4379-4390（sinWS1；起点 pY+28）', launchLift: 28 },
  0x1890: { note: 'DARKGUARD    character.cpp:4855-4866（sinWS1；起点 pY+38）', launchLift: 38 },
  0x1910: { note: 'REVIVED_ARCHER character.cpp:5094-5105（sinWS1；起点 pY+38）', launchLift: 38 },
};

/**
 * 怪物射击用的武器码 —— 原版在怪物的 case 里**硬写** `dwActionItemCode = sinWS1`（弓），
 * 因为怪物没有武器数据（`character.cpp:4390 / 4866 / 5105`）。
 * `ws101` = Short Bow（`itemDefs.ts` 的 `code: 17170688`），用它复用玩家那套箭链路。
 */
export const MONSTER_BOW_IDCODE = 17170688;

/** 音效播放器的最小契约（`audio/sfx.ts` 的 `playSoundByName`）。 */
export interface SfxPlayer {
  /**
   * 按**资产相对路径**播（不带 `/res/` 前缀）—— 技能音走这条。
   *
   * 为什么需要它：怪物的攻击/受击音走 `playSoundByName`（按 `wav/effects/monster/<dir>/` 解析），
   * 而**技能音**在原版是 `effectsnd.cpp` 里的一张**逐条路径表**
   * （如 `game\Audio\Effects\Skill\Morion\MultiSpark 1.wav`），没有"按怪物目录"的结构。
   */
  play?(path: string, opts?: { pos?: { x: number; y: number; z: number } }): void;
  playSoundByName(
    modelKey: string, motion: string,
    pos: { x: number; y: number; z: number },
    effectId: number,
  ): void;
}

export interface MonsterAttackEventCtx {
  /** 模型 key —— 音效目录按它解析（`sfx.ts`） */
  modelKey: string;
  /** 服务端下发的 `monster_effect_id` */
  effectId: number;
  /**
   * **正在播的那条动作的 `KeyCode`**（ASCII 码，原版 `MotionInfo->KeyCode`）。
   *
   * 多技能怪**必须给**：同一个 `effectId` 下三招各挂各的特效，由这个键选
   * （原版 `switch (MotionInfo->KeyCode)`）。不给 ⇒ 多技能怪无法决定放哪一招，上报后不放。
   * 单效果怪忽略此字段。我们的动作表里有这个值：`char-parser.ts:58`（`smMOTIONINFO` offset+164）。
   */
  keyCode?: number | null;
  /**
   * **这一帧是普攻还是技能** —— 原版是两个不同的函数（`EventAttack` / `EventSkill_Monster`），
   * 一只怪两样都有特效时（CC）靠它分开取。由调用方按**正在播的动作的 state** 给：
   * `CHRMOTION_STATE_ATTACK` ⇒ `'attack'`、`CHRMOTION_STATE_SKILL` ⇒ `'skill'`。
   *
   * ⚠ 必填：缺了它多技能怪只能猜（而"猜错"的表现是**默默放了另一招的特效**）。
   */
  motionKind: MotionKind;
  /** 怪物**世界坐标**（`root.position`）；特效按上面的 height / forward 偏移 */
  pos: { x: number; y: number; z: number };
  /**
   * 怪物**朝向**（弧度，绕 Y）—— 供 `forward` 前向偏移使用。
   * 与 `ctx.pos` 一样由调用方给（`root.rotation.y`）；不传则前向偏移按"未提供"跳过。
   */
  facing?: number;
  /**
   * 多候选时取第几个（**调用方决定**，缺省 0）。
   *
   * 原版这里是 `rand() % 3` —— 我们把它提到调用方：实验室用它做"3 选 1"的下拉，
   * 将来若要有服务端权威的随机，换成下发索引即可（字段与链路不动，同动画变体）。
   */
  variant?: number;
  /**
   * 本次事件帧的**音效桶** —— 原版 `CharPlaySound`（`effectsnd.cpp:1336`）用**正在播的那条动作**
   * 的 `MotionInfo->State` 选桶，于是**技能动作播 `skill N.wav`、普攻播 `attack N.wav`**。
   *
   * 由调用方用 `sfx.eventFrameSoundState(motion.state)` 解析后传入（那一份是唯一实现，
   * 本模块刻意不依赖 `audio/sfx.ts`，只认它的桶名字符串）。
   *
   * 传 null = 该动作态在原版 `snEffect[]` 里本就没有匹配（`CharPlaySound` 返回 FALSE）⇒ 不播 + 记降级。
   */
  motionSound: 'CHRMOTION_STATE_ATTACK' | 'CHRMOTION_STATE_SKILL' | null;
  effects: FxSpawner | null;
  sfx: SfxPlayer | null;
  /** 动态光池（原版 `SetDynLight`）。没传则跳过 —— 游戏与实验室传的是同一份实现 */
  dynLights?: DynLightSink | null;
  /**
   * 这只怪的攻击是**射击**时（见 `MONSTER_RANGED`），由调用方负责发射。
   *
   * 用回调而不是在本模块里发射：本模块刻意**不依赖 three**（发射要碰 Vector3/模型），
   * 且"从哪出手、打向谁"是调用方的场景知识（游戏里是 AOI 里的目标，实验室里是假人）。
   */
  fireRanged?: () => void;
  /**
   * 这只怪的这次攻击是**多火花**时，由调用方负责把它们放出来（见 `MonsterAttackFxDef.sparks`）。
   *
   * 只传 `spec`（含 `num` = 本特效发几颗）—— 调用方不需要也**不应该**再决定数量：
   * 数量是特效的属性，不是调用方的选择。
   */
  fireSparks?: (spec: NonNullable<MonsterAttackFxDef['sparks']>) => void;
  /**
   * 本条动作的**第几个事件帧**（1 起，= 原版 `MotionEvent`）。
   *
   * 有的飞出物按它分左右：`AssaParticle_VigorBall`（`hoAssaParticleEffect.cpp:4170/4188`）
   * 第 1 个事件帧走 `Angle.y - ANGLE_45`，其后走 `+ANGLE_45`。不给按 1 算。
   */
  motionEvent?: number;
  /**
   * 这一招的**目标位置**（身体中部；原版 `chrAttackTarget->pY + PatHeight/2` 那类）。
   *
   * 由调用方给（它才知道"怪物在打谁"）——目前只被 `code` 类特效用（如 Glacial Spike 其实
   * 不需要目标，但"朝目标方向"的招会有用）。缺省 = 没有目标。
   */
  aim?: { x: number; y: number; z: number } | null;
  /**
   * 被打的那个**单位脚下**（原版 `pDest->pX/pY/pZ`）—— `anchor: 'target'` 的条目以它为原点。
   *
   * 与 `aim` 的分工：`aim` 是**身体中部**（飞出物/代码特效瞄的点），这里是**脚下**
   * （原版那些 `pDest->pY + 500` 的写法都是相对脚下）。缺了会**上报**并按怪物自己算。
   */
  targetBase?: { x: number; y: number; z: number } | null;
  /**
   * **范围内有哪些玩家**（`onUnitsInRange` 用）—— 只列玩家，由调用方给（它才知道场上有谁）。
   * 原版 `SkillPlay_Monster_Effect` 扫的是 `lpCurPlayer` + `chrOtherPlayer[]`，**不含怪物**。
   */
  unitsInRange?: (range: number) => Array<{ x: number; y: number; z: number }>;
  /**
   * **起一个 ASE/静态网格**（`def.mesh`）—— 由调用方转交 `cast-circle-runner.spawnAssaMesh`
   * （要碰 three，本模块不执行；与起手法阵同一份实现）。
   */
  fireMesh?: (spec: NonNullable<MonsterAttackFxDef['mesh']>,
              at: { x: number; y: number; z: number }) => void;
  /**
   * **飞出物**（`MonsterAttackFxDef.fly`）交给调用方放出 —— 与 `fireSparks` 同理由：
   * 驱动要碰 three（载体节点 + 粒子跟随），而"目标是谁、站在哪"是调用方的场景知识。
   * 调用方应转交 `monster-fly-runner.runMonsterFly`（**唯一驱动**，游戏与实验室同一份）。
   */
  fireFly?: (asset: string, fly: MonsterFlySpec, motionEvent: number) => void;
  /**
   * **代码内组合特效**（`MonsterAttackFxDef.code`）交给调用方执行 —— 与 `fireSparks`/`fireFly` 同理由：
   * 它要碰 three（网格/场景），而"目标是谁"是调用方的场景知识。
   * 调用方应转交 `skill-fx-runner.CODE_SKILL_FX`（**与玩家技能同一个注册表**）。
   */
  fireCode?: (code: string, target: { x: number; y: number; z: number } | null) => void;
}

/**
 * 多候选时按 `variant` 取一个资产名。
 *
 * **唯一实现**：实验室的日志显示与实际播放必须走同一份判断，否则"日志说播的是 A、
 * 画面里是 B"这种分叉会同时污染两边（AGENTS #15）。
 */
export function pickMonsterFxAsset(def: MonsterAttackFxDef, variant = 0): string {
  const list = Array.isArray(def.asset) ? def.asset : [def.asset];
  return list[Math.abs(variant) % list.length]!;
}

/**
 * 技能音的候选选择（规则与 `pickMonsterFxAsset` 一致：**调用方给 `variant`，库内不随机**）。
 *
 * 原版这里是 `switch (rand() % 2)`（`character.cpp:14915` 的 `VigorBall 1/2`）——
 * 我们把它提到调用方：实验室用它做"2 选 1"，将来要服务端权威随机就换成下发索引。
 */
export function pickMonsterSound(def: MonsterAttackFxDef, variant = 0): string | null {
  if (!def.sound) return null;
  const list = Array.isArray(def.sound) ? def.sound : [def.sound];
  return list[Math.abs(variant) % list.length]!;
}

/**
 * 攻击事件帧到达 → 播挥击音 + 起攻击特效。
 *
 * 原版同帧两件事（`character.cpp:2687` 拍事件帧、`2715+` 起特效），故这里不拆。
 *
 * @returns 本怪**有**核验特效时返回启动结果的 Promise（`false` = 声明了却起不来）；
 *   本怪没有核验条目时返回 `null`（正常，不是失败 —— 多数纯物理怪原版就只有音效）。
 *
 *   ⚠ 起不来一律走 `reportFallback`，**绝不静默**：写成 `void spawn(...)` 会把
 *   "素材解析失败/没渲染出来"伪装成"特效正常播放"，于是"看不到粒子"到底是没数据、
 *   还是没渲染，永远查不出来（AGENTS #12）。实验室与游戏共用这条上报路径。
 */
/**
 * **事件帧的动作音**（原版 `CharPlaySound`，`effectsnd.cpp:1336`）—— 游戏与实验室共用的唯一实现。
 *
 * ⚠⚠ 它**与"这一招有没有登记特效"完全无关** —— 特效是我们核验出来的表，而动作音是原版按
 *   怪物目录 + **动作态**解析的。**任何"没特效就提前 return"的写法都会把它连带吞掉。**
 *   实测**三次**踩到同一处：
 *     · 表里没有条目的怪（多数纯物理怪原版就只有音效）原来在 `!entry` 处 return ⇒ 静音
 *     · 多技能 KeyCode 分派在"该键未登记"处 return ⇒ **D_PR 普攻静音**
 *       （用户报"攻击没声音了"；而 `d_pr/attack 1.wav` 确实在资产里）
 *     · 射击怪分支（`MONSTER_RANGED`，"设 `ShootingFlag`"）也在它**之前** return ⇒ **所有弓怪静音**
 *       （用户 2026-09-17 实测"听不到攻击音效"）
 *   ⇒ 故 `fireMonsterAttackEvent` **第一件事**就是播它（在一切 return 之前）。
 *
 * 桶由 `ctx.motionSound` 给：技能动作 ⇒ `skill N.wav`、普攻 ⇒ `attack N.wav`
 * （这条原先被写死成 ATTACK，Dark Guard 的技能因此在播普攻音 —— 用户 2026-09-17 报）。
 * `fireDef` 里 `def.sparks.sound` 那套是"技能自己的音"（原版 `SkillPlaySound`，另一条路径）——
 * 原版两者**都播**，不是二选一。
 */
function playMotionSound(ctx: MonsterAttackEventCtx): void {
  if (!ctx.motionSound) {
    // 原版这种情况也不播（`snEffect[]` 无匹配 ⇒ `CharPlaySound` 返回 FALSE），但要**说出来**（AGENTS #12）
    reportFallback('sfx', `怪 #${ctx.effectId} 的事件帧动作态没有对应音效桶 ⇒ 本次不播音`);
    return;
  }
  ctx.sfx?.playSoundByName(ctx.modelKey, ctx.motionSound, ctx.pos, ctx.effectId);
}

/**
 * 【临时】卡死排查用的控制台断点（定位完删）。
 * ⚠ **同一行只打一次**：否则每次攻击都打一串，Chrome 会给每条附上几百层 rAF 异步栈 ⇒ 控制台被刷爆
 *（用户 2026-09-18 明确要求干掉）。诊断需要的"执行顺序"第一次就完整给出 ✓。
 */
const fxdbgSeen = new Set<string>();
const fxdbg = (m: string): void => {
  if (fxdbgSeen.has(m)) return;
  fxdbgSeen.add(m);
  console.log(`[fxdbg] ${m}`);
};

export function fireMonsterAttackEvent(ctx: MonsterAttackEventCtx): Promise<boolean> | null {
  fxdbg('enter effectId=0x' + ctx.effectId.toString(16) + ' key=' + (ctx.keyCode ?? '-') + ' kind=' + ctx.motionKind);
  // **第一件事就是动作音**（在一切 return 之前）—— 见 `playMotionSound` 上那三条踩坑记录。
  // 以前它在每个分支里各写一次，正是"新加一条分支就漏一处"的来源；现在只有这一句。
  playMotionSound(ctx);

  // 射击怪：原版在这个事件帧设 `ShootingFlag`（而不是起粒子）⇒ 交给调用方发射，本函数不返回特效句柄。
  if (MONSTER_RANGED[ctx.effectId]) {
    ctx.fireRanged?.();
    return null;
  }

  const entry = MONSTER_ATTACK_FX[ctx.effectId];
  if (!entry || !ctx.effects) {
    // 无核验条目 ≠ 无音效：纯物理怪原版就只有这一记动作音
    return null;
  }
  // **多技能怪**：由**正在播的那条动作的 KeyCode** 决定放哪一招
  //（原版 `switch (MotionInfo->KeyCode)`）。缺 keyCode 或该键未登记都**不猜**：
  //  前者是调用方没给（上报），后者是那一招还没核验（原版 switch 无 default ⇒ 本就不放特效）。
  if (isSkillSet(entry)) {
    const sub = resolveMonsterFx(ctx.effectId, ctx.keyCode, 'event', ctx.motionKind);
    if (!sub) {
      const keyTxt = ctx.keyCode == null ? '未给' : `'${keyOf(ctx.keyCode) || '(无 KeyCode → else 分支)'}'`;
      reportFallback('fx', `怪 #${ctx.effectId} 的`
        + `${ctx.motionKind === 'attack' ? '普攻' : `技能（KeyCode ${keyTxt}）`}`
        + `未登记特效 ⇒ 不放特效（原版 switch 无 default；动作音照旧）`);
      return null;
    }
    // 这一招的特效在**起手**放（`timing: 'cast'`）⇒ 事件帧本来就没事做，**不报降级**
    if ((sub.timing ?? 'event') !== 'event') return null;
    return fireDef(sub, ctx, ctx.effects);
  }
  return (entry.timing ?? 'event') === 'event' ? fireDef(entry, ctx, ctx.effects) : null;
}

/**
 * **起手阶段的特效**（`MonsterAttackFxDef.timing = 'cast'`，原版 `BeginSkill_Monster` 里那一句
 * `ParkAssaParticle_*`）—— 与事件帧**共用 `fireDef`**（AGENTS #15：只此一份）。
 *
 * 由 `cast-circle-runner.fireMonsterSkillCast` 调用 —— 于是游戏与实验室都走同一条路。
 * 起手没有"动作音"这回事（那是事件帧的 `CharPlaySound`），故不传 `motionSound`。
 *
 * @param keyCode 正在起手的那条技能的 KeyCode（0/缺省 = 查 `''` 键，即原版 else 分支）
 */
export function fireMonsterCastFx(
  effectId: number, keyCode: number | null | undefined, pos: { x: number; y: number; z: number },
  effects: FxSpawner | null,
  extras?: Partial<MonsterAttackEventCtx> & { log?: (m: string) => void },
): Promise<boolean> | null {
  const def = resolveMonsterFx(effectId, keyCode, 'cast');
  if (!def) return null;
  if (!effects) {
    reportFallback('fx', `怪 #${effectId} 的起手特效 ${def.asset} 起不来：未接渲染器`);
    return null;
  }
  extras?.log?.(`  ✦ 起手特效 ${pickMonsterFxAsset(def)}（effectId=0x${effectId.toString(16).toUpperCase()}，出处 ${def.note}）`);
  // 固定的几项放在最后（调用方不能覆盖 effectId/pos/阶段）
  return fireDef(def, {
    modelKey: '',
    ...extras,
    effectId, pos, effects, motionKind: 'skill', motionSound: null,
    sfx: extras?.sfx ?? null, dynLights: extras?.dynLights ?? null,
  }, effects);
}

/** 单条效果的实际播放（技能音 + 落点 + 动态光 + 起粒子）—— 条目解析之后的一切 */
function fireDef(
  def: MonsterAttackFxDef, ctx: MonsterAttackEventCtx, effects: FxSpawner,
): Promise<boolean> | null {
  // 技能音 = 这一招自己的音（`def.sound`，如 `VigorBall 1/2`；原版 `SkillPlaySound`）。
  // ⚠ **动作音不在这里** —— 它由 `fireMonsterAttackEvent` 在一切分支之前播（见那里的说明）：
  //   起手阶段没有动作音，而事件帧的每个分支都要有 ⇒ 放在这里就会逼出"每个分支各写一次"。
  const skillSound = pickMonsterSound(def, ctx.variant);
  if (skillSound) ctx.sfx?.play?.(skillSound, { pos: ctx.pos });

  // **原版还有、我们还没做的部分** —— 逐条上报（AGENTS #12：少一块必须看得见）。
  // ⚠ **同一条只在本次会话报一次**：这是"缺口清单"，不是运行期事件 —— 每次攻击都打会把控制台淹掉
  //（用户实测：连点后 console 里同一条带几百层 rAF 异步栈的消息刷屏 ✗）。清单本身仍保留每条 ✓。
  for (const u of def.unhandled ?? []) {
    const key = `${ctx.effectId}:${u}`;
    if (reportedUnhandled.has(key)) continue;
    reportedUnhandled.add(key);
    reportFallback('fx', `怪 #${ctx.effectId} 的 ${pickMonsterFxAsset(def, ctx.variant)}：${u}`);
  }

  // **代码内组合特效**（`def.code`，如 Glacial Spike）：交给调用方转交 `CODE_SKILL_FX`
  // —— 与玩家技能**同一个注册表**，于是两边同一招只需要一份实现。
  if (def.code) {
    // 回调缺失一律**上报**：一句 `?.()` 会把"这一招根本没放"伪装成"放过了"（AGENTS #12）
    if (ctx.fireCode) ctx.fireCode(def.code, ctx.aim ?? null);
    else reportFallback('fx', `怪 #${ctx.effectId} 的代码特效「${def.code}」没放：调用方没给 fireCode`);
    return null;
  }
  // **多火花**：发射几颗是**本特效自己的属性**（`sparks.num`）—— 直接交给调用方，
  // 本模块不解析、不裁剪、不让调用方再选（那是把技能机制混进特效层，层级错了）。
  if (def.sparks) {
    if (ctx.fireSparks) ctx.fireSparks(def.sparks);
    else reportFallback('fx', `怪 #${ctx.effectId} 的多火花没放：调用方没给 fireSparks`);
    return null;
  }
  // **飞出物**（原版 `AssaParticle_*`，如 VigorBall）：驱动在 `monster-fly-runner.ts`
  // —— 游戏与实验室**共用同一份**（此前只有实验室实现 ⇒ 游戏里根本不飞）
  if (def.fly) {
    const flyAsset = pickMonsterFxAsset(def, ctx.variant);
    const ev = ctx.motionEvent ?? 1;
    if (!ctx.fireFly) {
      reportFallback('fx', `怪 #${ctx.effectId} 的飞出物 ${flyAsset} 没放：调用方没给 fireFly`);
      return null;
    }
    // **天降多颗**（`skyDrops`）：每颗是同一个 `fly`，只是落点偏移与**延迟帧**不同
    //（原版 `ChaosKaraMeteo` 一次 4 颗）。逐颗派生一份 spec 交给同一个驱动，不另写一套。
    const drops = def.skyDrops;
    if (drops?.length) {
      for (const d of drops) {
        ctx.fireFly(flyAsset, {
          ...def.fly,
          targetOffset: { x: d.dx ?? 0, z: d.dz ?? 0 },
          delayFrames: d.delayFrames,
        }, ev);
      }
      return null;
    }
    ctx.fireFly(flyAsset, def.fly, ev);
    return null;
  }
  // 落点 = 怪物原点 + 原版 `GetMoveLocation(...)` 算出的偏移。
  // **照抄参数、由等价函数算**（`core/geom.getMoveLocation`）—— 不做语义翻译：
  // 当初把 `GeoResult_*` 翻译成"前方 N 单位"，就漏掉了它来自上一行调用，于是粒子落在身上。
  let off = { x: 0, y: 0, z: 0 };
  if (def.move) {
    const m = def.move;
    // 绕 Y 的角 = 怪物朝向（原版 `Angle.y`）；调用方给的是弧度，这里换成 PT 制式
    off = getMoveLocation(m.x, m.y, m.z, m.angX ?? 0, radToPtAngle(ctx.facing ?? 0), m.angZ ?? 0);
  }
  // **落点基准**：`anchor: 'target'` 的条目以**被打的那个单位**为原点（原版 `pDest->pX/pY/pZ`）
  // —— CC 普攻就是这样，我第一版按"怪物身上"登记，粒子于是长在自己脚下（用户实测）。
  let base = { x: ctx.pos.x, y: ctx.pos.y, z: ctx.pos.z };
  if (def.anchor === 'target') {
    if (ctx.targetBase) base = ctx.targetBase;
    else reportFallback('fx', `怪 #${ctx.effectId} 的 ${pickMonsterFxAsset(def, ctx.variant)} `
      + '以**目标**为落点，但调用方没给 targetBase ⇒ 本次按怪物自己算（位置会偏）');
  }
  fxdbg('落点算完，准备起粒子');
  const at = {
    x: base.x + off.x,
    // `height` 为 'geoY' 时用偏移结果的 y（原版 `pY + GeoResult_Y` 那种写法）
    y: base.y + (def.height === 'geoY' ? off.y : def.height),
    z: base.z + off.z,
  };
  // 原版在同一个 case 里**先 SetDynLight 再起粒子**（`HoEffect.cpp:11723` 是 case 的第一行），
  // 两件事同源 ⇒ 这里也一起做，且用**同一个落点**。
  if (def.dynLight) {
    const d = def.dynLight;
    ctx.dynLights?.set(at.x, at.y, at.z, d.r, d.g, d.b, d.a, d.power, d.decPower);
  }
  fxdbg('fireDef 开始：asset=' + pickMonsterFxAsset(def, ctx.variant) + ' parts=' + (def.parts?.length ?? 0)
    + ' fly=' + !!def.fly + ' code=' + (def.code ?? '-') + ' mesh=' + (def.mesh ? def.mesh.path : '-'));
  // ↑ 去掉模板字符串：同一只怪的这条内容固定 ⇒ 去重后只打一次 ✓
  // **同帧的 ASE 网格**（原版 `SetAssaEffect("xxx.ASE", …)`）：与粒子同源、同帧起
  if (def.mesh) {
    fxdbg('进入 mesh 分支：回调存在=' + !!ctx.fireMesh);
    if (ctx.fireMesh) { fxdbg('调用 ctx.fireMesh …'); ctx.fireMesh(def.mesh, at); fxdbg('ctx.fireMesh 返回'); }
    else reportFallback('fx', `怪 #${ctx.effectId} 的 ASE 网格 ${def.mesh.path} 没起：调用方没给 fireMesh`);
  }
  const name = pickMonsterFxAsset(def, ctx.variant);
  const label = `${name}（effectId=0x${ctx.effectId.toString(16).toUpperCase()}，出处 ${def.note}）`;
  fxdbg('主系统 spawn 已发起');
  // **同帧的其余系统**（`def.parts`）：各自的高度/缩放，落点与主系统一致
  const spawnOne = (asset: string, at: { x: number; y: number; z: number },
                    opts: { size?: number; scale?: number; delaySec?: number },
                    tag: string): Promise<boolean> =>
    Promise.resolve(effects.spawn(asset, { pos: at, ...opts }))
      .then((ok) => {
        if (!ok) reportFallback('fx', `怪物攻击特效 ${tag} 起不来（effects.spawn 返回 false）`);
        return ok;
      })
      .catch((e: unknown) => {
        reportFallback('fx', `怪物攻击特效 ${tag} 抛错：${String(e)}`);
        return false;
      });
  const tasks = [spawnOne(name, at, { size: def.size }, label)];
  for (const p of def.parts ?? []) {
    tasks.push(spawnOne(p.asset, { x: base.x, y: base.y + p.height, z: base.z },
      { scale: p.scale, delaySec: p.delaySec }, `${p.asset}（同帧第二系统，出处 ${def.note}）`));
  }
  // **范围内每个玩家各一份**（原版 `SkillPlay_Monster_Effect`，范围用世界单位、平方比较）
  const area = def.onUnitsInRange;
  if (area) {
    const units = ctx.unitsInRange?.(area.range);
    if (!units) {
      reportFallback('fx', `怪 #${ctx.effectId} 的 ${label} 有一段范围效果`
        + `（${area.range} 单位内的玩家各挂 ${area.asset}），但调用方没给 unitsInRange ⇒ 这一段没放`);
    } else {
      for (const u of units) {
        tasks.push(spawnOne(area.asset, { x: u.x, y: u.y + area.height, z: u.z },
          { scale: area.scale, delaySec: area.delaySec },
          `${area.asset}（范围 ${area.range} 内的单位，出处 ${def.note}）`));
      }
    }
  }
  // 全部起完再回一个结果：任一个起不来都算 false（降级已在上面逐条上报）
  return tasks.length === 1 ? tasks[0]! : Promise.all(tasks).then((rs) => rs.every(Boolean));
}
