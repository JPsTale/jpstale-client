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
  };
}

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
      H: {
        // 原版 `character.cpp:14912` `case 'H': AssaParticle_VigorBall(this, chrAttackTarget);`
        //   + `switch (rand() % 2)` 播 `SKILL_VIGOR_BALL1/2`（`effectsnd.cpp:682-683`）
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
        note: "character.cpp:14912 case 'H' / hoAssaParticleEffect.cpp:4152-4200 / AssaParticle.cpp:5465(Main),5551(Start),5597-5598; dpr.inx idx17 事件帧 4640+7040",
      },
      // `'Z'`（GlacialSpike / `HoNewEffectFunction.cpp:590` 的 Lua 脚本）**尚未提取** ⇒ **不登记**。
      // 调用方拿到 `undefined` 就是"这一招还没核验"，不静默兜底成别的招。
    },
    note: 'character.cpp:14903 `switch (MotionInfo->KeyCode)`；动作表 dpr.inx idx16=\'O\' 事件帧3360 / idx17=\'H\' / idx18=\'Z\'',
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
   * 按动作 `KeyCode` 分派（键为**大写字母**；原版 `MotionInfo->KeyCode` 就是 ASCII）。
   * **没登记的键 = 那一招还没核验** ⇒ 什么都不放（原版 switch 没有 default，本来也不放）。
   */
  skillByKeyCode: Record<string, MonsterAttackFxDef>;
  note: string;
}

export type MonsterFxEntry = MonsterAttackFxDef | MonsterSkillSet;

/** 多技能怪？—— 判据是 `skillByKeyCode` 存在（唯一判定处） */
export function isSkillSet(e: MonsterFxEntry): e is MonsterSkillSet {
  return (e as MonsterSkillSet).skillByKeyCode !== undefined;
}

/**
 * 由 `effectId` + **动作的 KeyCode** 解出"这一帧该放哪一条"。
 *
 * **唯一实现**（AGENTS #15）：实验室的显示与实际播放必须走同一份判断，
 * 否则"日志说 MultiSpark、画面里放的是别的"这种分叉会同时污染两边。
 *
 * @param keyCode 原版 `MotionInfo->KeyCode`（ASCII 码）；单效果怪忽略它
 * @returns `null` = 这一招没登记（或该怪无核验条目）
 */
export function resolveMonsterFx(effectId: number, keyCode?: number | null): MonsterAttackFxDef | null {
  const entry = MONSTER_ATTACK_FX[effectId];
  if (!entry) return null;
  if (!isSkillSet(entry)) return entry;
  if (keyCode == null) return null;            // 多技能怪但不知道在播哪招 ⇒ 无法决定
  return entry.skillByKeyCode[String.fromCharCode(keyCode).toUpperCase()] ?? null;
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
   * **飞出物**（`MonsterAttackFxDef.fly`）交给调用方放出 —— 与 `fireSparks` 同理由：
   * 驱动要碰 three（载体节点 + 粒子跟随），而"目标是谁、站在哪"是调用方的场景知识。
   * 调用方应转交 `monster-fly-runner.runMonsterFly`（**唯一驱动**，游戏与实验室同一份）。
   */
  fireFly?: (asset: string, fly: MonsterFlySpec, motionEvent: number) => void;
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

export function fireMonsterAttackEvent(ctx: MonsterAttackEventCtx): Promise<boolean> | null {
  // 射击怪：原版在这个事件帧设 `ShootingFlag`（而不是起粒子）⇒ 交给调用方发射，本函数不返回特效句柄。
  // ⚠ **音效照旧**：射不射箭与"播不播动作音"是两条轴（音效 ∉ 特效分派）。
  if (MONSTER_RANGED[ctx.effectId]) {
    playMotionSound(ctx);
    ctx.fireRanged?.();
    return null;
  }

  const entry = MONSTER_ATTACK_FX[ctx.effectId];
  if (!entry || !ctx.effects) {
    // 无核验条目 ≠ 无音效：纯物理怪原版就只有这一记动作音
    playMotionSound(ctx);
    return null;
  }
  // **多技能怪**：由**正在播的那条动作的 KeyCode** 决定放哪一招
  //（原版 `switch (MotionInfo->KeyCode)`）。缺 keyCode 或该键未登记都**不猜**：
  //  前者是调用方没给（上报），后者是那一招还没核验（原版 switch 无 default ⇒ 本就不放特效）。
  //  ⚠ 但**音效照旧**（上面那条）—— 把两者一起吞掉是我犯过的错。
  if (isSkillSet(entry)) {
    const key = ctx.keyCode == null ? null : String.fromCharCode(ctx.keyCode).toUpperCase();
    const sub = key ? entry.skillByKeyCode[key] : undefined;
    if (!sub) {
      reportFallback('fx', key == null
        ? `怪 #${ctx.effectId} 是多技能怪，但调用方没给动作 KeyCode ⇒ 无法决定放哪一招（本次不放特效，动作音照旧）`
        : `怪 #${ctx.effectId} 的动作 KeyCode '${key}' 未登记特效 ⇒ 这一招不放特效（原版 switch 无 default；动作音照旧）`);
      playMotionSound(ctx);
      return null;
    }
    return fireDef(sub, ctx, ctx.effects);
  }
  return fireDef(entry, ctx, ctx.effects);
}

/** 单条效果的实际播放（音效 + 落点 + 动态光 + 起粒子）—— 条目解析之后的一切 */
function fireDef(
  def: MonsterAttackFxDef, ctx: MonsterAttackEventCtx, effects: FxSpawner,
): Promise<boolean> | null {
  // **两条音效都播，不是二选一**（原版 `character.cpp:14903` 那一支里 `sinEffect_XXX(...)` 与
  // `SkillPlaySound(...)` 各一句；通用动作音另有 `CharPlaySound`，见 `:4236`）：
  //   ① 动作音 = 按**动作态**取桶（技能动作 ⇒ `skill N.wav`，普攻 ⇒ `attack N.wav`）
  //   ② 技能音 = 这一招自己的音（`def.sound`，如 `VigorBall 1/2`）
  playMotionSound(ctx);
  const skillSound = pickMonsterSound(def, ctx.variant);
  if (skillSound) ctx.sfx?.play?.(skillSound, { pos: ctx.pos });

  // **多火花**：发射几颗是**本特效自己的属性**（`sparks.num`）—— 直接交给调用方，
  // 本模块不解析、不裁剪、不让调用方再选（那是把技能机制混进特效层，层级错了）。
  if (def.sparks) {
    ctx.fireSparks?.(def.sparks);
    return null;
  }
  // **飞出物**（原版 `AssaParticle_*`，如 VigorBall）：驱动在 `monster-fly-runner.ts`
  // —— 游戏与实验室**共用同一份**（此前只有实验室实现 ⇒ 游戏里根本不飞）
  if (def.fly) {
    ctx.fireFly?.(pickMonsterFxAsset(def, ctx.variant), def.fly, ctx.motionEvent ?? 1);
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
  const at = {
    x: ctx.pos.x + off.x,
    // `height` 为 'geoY' 时用偏移结果的 y（原版 `pY + GeoResult_Y` 那种写法）
    y: ctx.pos.y + (def.height === 'geoY' ? off.y : def.height),
    z: ctx.pos.z + off.z,
  };
  // 原版在同一个 case 里**先 SetDynLight 再起粒子**（`HoEffect.cpp:11723` 是 case 的第一行），
  // 两件事同源 ⇒ 这里也一起做，且用**同一个落点**。
  if (def.dynLight) {
    const d = def.dynLight;
    ctx.dynLights?.set(at.x, at.y, at.z, d.r, d.g, d.b, d.a, d.power, d.decPower);
  }
  const name = pickMonsterFxAsset(def, ctx.variant);
  const label = `${name}（effectId=0x${ctx.effectId.toString(16).toUpperCase()}，出处 ${def.note}）`;
  return Promise.resolve(effects.spawn(name, {
    pos: at,
    size: def.size,
  }))
    .then((ok) => {
      if (!ok) reportFallback('fx', `怪物攻击特效 ${label} 起不来（effects.spawn 返回 false）`);
      return ok;
    })
    .catch((e: unknown) => {
      reportFallback('fx', `怪物攻击特效 ${label} 抛错：${String(e)}`);
      return false;
    });
}
