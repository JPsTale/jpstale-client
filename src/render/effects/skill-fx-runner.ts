/**
 * **玩家技能 → 特效** 的派发（原版是 `sinSkillEffect.cpp` 里一个 `switch (skillIndex)`）。
 *
 * 数据侧已有 `src/game/data/skill-fx.json`（220 行，104 行有 `fx`）：`fx` 条目是
 * `ini:<名>` / `part:<名>` 这类**带前缀的引用**。本文件补上第三类前缀 **`code:<名>`** ——
 * 给"由代码组合、不是单个资产文件"的技能特效用（MultiSpark 就是：5 颗主火花 + 每帧拖尾 +
 * 命中三件套，原版也不是一个 `.part`）。
 *
 * 原版权威依据：
 *   · `sinSkill.h:85`  `SKILL_MULTISPARK = GROUP_PRIESTESS | CHANGE_JOB1 | SKILL_3`
 *   · `sinSkillEffect.cpp:139`  玩家侧 `case 3: sinEffect_MultiSpark(lpCurPlayer, lpCharSelPlayer, 7)`
 *   · `character.cpp`          怪物侧 `sinEffect_MultiSpark(this, chrAttackTarget, 5)`
 *   ⇒ 同一函数，只有 `Num` 与"谁在放"不同 ⇒ 粒子本体与装配**全复用**，本文件只补"谁触发"。
 */

import skillFx from '../../game/data/skill-fx.json';
import { runMultiSpark, type MultiSparkRunnerCtx } from './multi-spark-runner.js';
import { runCastCircle } from './cast-circle-runner.js';
import { castCircleFlagForClass, CAST_CIRCLE_TYPE_NORMAL } from './cast-circle.js';
import { runHealingOrbit } from './healing-orbit.js';
import { runMonsterFly, type FlyDeps } from './monster-fly-runner.js';
import { FX_VIGOR_BALL, pickMonsterFxAsset } from './monster-attack-fx.js';
import { runGlacialSpike } from './glacial-spike.js';
import { runDivineLightning, configureDivineLightning } from './divine-lightning.js';
import { reportFallback } from '../../char/fallback-log.js';
import { skillRowBySkillId } from '../../game/skillIdentity.js';
import { PT_ANGLE_FULL, FONE, ptAngleToRad } from '../../core/geom.js';

/** 技能表的一行（`skill-fx.json` 的形状） */
export interface SkillFxRow {
  job: number;
  classDir: string;
  icon: string;
  name: string;
  fx: string[];
  sfx: string[];
  cast: { fx?: string[]; sfx: string[] };
  event: { fx?: string[]; sfx: string[] };
  confidence: string;
  code: string | null;
  animIndex: number | null;
  /**
   * **多段音时下标从哪来**（与 `monster-attack-fx.ts` 的 `MonsterAttackFxDef.soundPick` **同一套语义**）。
   *
   * Chain Lancer 就是：原版按 `MotionEvent` 1/2/3 各响一条（`character.cpp:15585-15598`）
   * ⇒ `'motionEvent'` = 下标取 `事件帧序号 − 1`；**越界不响**（原版 `switch` 无 `default`）。
   */
  soundPick?: 'motionEvent';
}

const ROWS: SkillFxRow[] = (skillFx as { rows: SkillFxRow[] }).rows;

/** 按**动画索引**取行（`skillData` 的技能与动画是靠它对应的） */
export function skillFxRowByAnimIndex(index: number | null): SkillFxRow | null {
  if (index == null) return null;
  return ROWS.find((r) => r.animIndex === index) ?? null;
}

/** 按**图标名**取行（`playSkillByIcon` 手里是图标名） */
export function skillFxRowByIcon(iconFile: string): SkillFxRow | null {
  const norm = iconFile.replace(/\.bmp$/i, '').toLowerCase();
  return ROWS.find((r) => r.icon.replace(/\.bmp$/i, '').toLowerCase() === norm) ?? null;
}

/**
 * 按**数字 `skillId`**取行 —— **旁观者那条路**用它（`S2C_SkillStart` 带的是 `skillId`）。
 *
 * ⚠ 别用 `skillFxRowByAnimIndex` 代替：那是**动画条目号**（`skillData.animIndex`），
 * 与"播哪一条动作"不是同一个编号空间 —— 实测 Healing 播的条目是 **58**（`SkillSub` 侧的 SKILL 索引），
 * 而它在技能表里的 `animIndex` 是 **123** ⇒ 按 animIndex 查会查不到、特效整条静默不播
 * （用户 2026-09-27 报"别人看不到我的施法动作和粒子特效"时，这就是第二处原因）。
 * 这里走**身份桥**（`skillRowBySkillId` → `iconFile` → 本表），与自机取法共享同一份数据。
 */
export function skillFxRowBySkillId(skillId: number): SkillFxRow | null {
  const id = skillRowBySkillId(skillId);
  if (!id) return null;
  return skillFxRowByIcon(id.iconFile);
}

/**
 * `code:<名>` 注册表 —— 每个条目负责"放这一招"。
 *
 * 参数写在这里而不是数据里：`num = 7` 是**原版玩家侧调用点的取值**（怪物侧是 5，
 * 走 `monster-attack-fx.ts` 那张表），两者是**不同调用点**而不是"同一特效的两个档位"。
 */
export interface SkillFxFireCtx extends MultiSparkRunnerCtx {
  /** 技能等级（原版 `lpSkill->Point`）—— 颗数由它查表（`M_SPARK_NUM`） */
  skillLevel?: number | null;
  /**
   * **服务端掷定的本次道数**（`S2C_SkillStart.spark_count`，Multi Spark = 光弹数）。
   * `0/undefined` = 还没收到起手 ack ⇒ 视觉不放并上报（与服务端结算对不上就宁可不放，
   * AGENTS #14：同步结果，不各掷各的随机）。
   */
  sparkCount?: number;
  /**
   * **效果所锚定的那个角色的实时位置**（原版每帧读 `pChar->pX/pY/pZ` 定位效果 —— Healing 的天使
   * 因此**跟着人走**）。⚠ Healing 的 `pChar` 是**被治疗者**（`lpTarChar ?: this`，
   * `character.cpp:13588-13598`）⇒ 治别人时要传**目标**的位置，不是施法者的。
   * 缺它时用起手快照（会停在原地）。
   */
  anchorPos?: () => { x: number; y: number; z: number };
  /** 世界坐标 → 屏幕坐标（诊断用；`WorldView` 用真相机算） */
  project?: ((p: { x: number; y: number; z: number }) => { x: number; y: number; onScreen: boolean } | null) | null;
  /** 音效播放（`sfx.play(path, {pos})`） */
  playSound?: (path: string, pos: { x: number; y: number; z: number }) => void;
  /**
   * 按**资产名**起粒子并拿可停止句柄 = `EffectManager.spawnStoppable`（飞出物要用）。
   *
   * 与 `effects.spawnSystem`（内存里的 `PartSystem`）不是一回事：这条是"按名字加载 `.part`"。
   * 缺它时 Vigor Ball 这类飞出物技能**不播并上报**（不静默退化成原地爆一坨）。
   */
  spawnAsset?: FlyDeps['spawn'];
  /**
   * **攻击落点**（原版 `GetAttackPoint`，`character.cpp:1795-1858`）—— 由调用方在**当前帧**算好。
   *
   * ⚠ 玩家与怪物取值**不同**，别互相套：`tz = ChrTool->PatTool ? SizeMax/2 : 0`（`:1813-1816`）——
   *   怪物没有 `dwItemCode`（武器是模型自带的）⇒ `tz = 0` = 握持点；**玩家有武器道具 ⇒ 半个武器长**。
   *   骨也不能混：原版用 `HvRightHand.ObjBip`（右手工具骨），`AttackObjBip` 只在 `!tz && !ShootingMode` 时顶替。
   * 缺它时**不放并上报**（不退回脚下）—— 与怪物侧 `anchor:'weapon'` 同一条纪律。
   */
  weaponBase?: { x: number; y: number; z: number } | null;
  /**
   * **起一个 ASE/INI 动画网格**（原版 `StartAni(x,y,z, …, PatObj[i])` 那一族）—— 交给调用方转交
   * `cast-circle-runner.spawnAssaMesh`（**唯一实现**，与起手法阵/怪物侧的 `mesh` 同一条路）。
   * `at` = 落点（世界坐标），`spec.rotY` = 绕 Y 的朝向（弧度）。
   */
  fireMesh?: (
    spec: { path: string; aniMaxCount: number; aniDelayTime: number; scale?: number;
            rotY?: number; delaySec?: number; upAxis?: 'z' | 'y'; note: string },
    at: { x: number; y: number; z: number },
  ) => void;
  /**
   * **按资产名起 `.part`**（= `EffectManager.spawn`）—— 与 `spawnAsset`（`spawnStoppable`，飞出物用）
   * 不是一回事：这个是一次性粒子，不需要"停下"的句柄。
   */
  spawnPart?: (name: string, opts: { pos: { x: number; y: number; z: number } }) => Promise<boolean> | null;
  /**
   * 本条动作的**第几个事件帧**（1 起，= 原版 `MotionEvent`）。
   * 有的技能按它分左右（Vigor Ball：第 1 个事件帧 −45°、其后 +45°）—— 不给会**上报**。
   */
  motionEvent?: number | null;
  /** 施法者朝向（弧度，原版 `Angle.y`）—— 定向特效的基准；不给会**上报** */
  casterYaw?: number | null;
  /**
   * 目标**每帧现取**（目标会走动；定点飞行会落在它身后 —— 箭那次的教训）。
   * 只给 `target`（快照）时用它兜底并**上报**。
   */
  targetGetter?: () => { x: number; y: number; z: number } | null;
  /**
   * **整体缩放**（诊断用，默认 1）—— 给"数字对不对"这类问题一个可拧的旋钮：
   * 用户拧到像原版，把倍数报回来，再把数字**固化进数据**（而不是留个运行时缩放）。
   */
  fxScale?: number;
}

export const CODE_SKILL_FX: Record<string, (
  ctx: SkillFxFireCtx,
  caster: { x: number; y: number; z: number },
  /** `null` = 没有目标（原版 `sinEffect_MultiSpark(pChar, nullptr, …)` 的情形） */
  target: { x: number; y: number; z: number } | null,
) => void> = {
  // 颗数 = **等级表 + 随机区间**（原版 `M_Spark_Num[Point-1]` → `GetRandomPos(cnt/2+1, cnt)`）。
  // ⚠ 等级必须由调用方给（`M_Spark_Num` 按 `Point-1` 取，等级错 ⇒ 颗数错）。
  // 早先这里写的是 `ctx.skillLevel ?? 1`（"按 1 级算"）—— 那是**猜一个值**，AGENTS #12 禁；现改为
  // **本次不放**并上报（与 Pike Wind 同一条口径）。
  multispark: (ctx, caster, target) => {
    // 道数 = **服务端起手掷定**（`S2C_SkillStart.spark_count`）—— 结算与视觉共用同一个 N；
    // 客户端不再自己 `playerSparkCount` 掷（两个随机源必然对不上，用户 2026-09-26 实测抓出）。
    const num = ctx.sparkCount ?? 0;
    if (num < 1) {
      reportFallback('skillfx', 'MultiSpark 的道数 = 服务端起手掷定（`S2C_SkillStart.spark_count`），'
        + '本次没收到 ⇒ **不放**（与服务端各掷各的必然对不上）');
      return;
    }
    ctx.log?.(`    ✦ MultiSpark：${num} 道光弹（服务端掷定）`);
    runMultiSpark(ctx, caster, target, num);
  },
  // **Pike Wind**（pikeman 一转·1，`SKILL_PLAY_PIKEWIND` / 下标 41）——
  // 原版 `HoEffect.cpp:6291-6346`（`case SKILL_PIKE_WIND`）**整段逐字**：
  //
  // ```c
  // SetDynLight(x, y, z, 50,50,200, 255, 200+level*10, 3);
  // for (index = 0; index < 15+level; index++) {                       // ① 环：ASE 网格
  //     int ang = ANGLE_360/(15+level/2)*index;                        //    ⚠ 分母是 15+level/2（整除）
  //     pat->StartAni(x+(GetCos[ang]/65536.f)*(level*650), y, z+(GetSin[ang]/65536.f)*(level*650),
  //                   0, ANGLE_180-ang, 0, PatObj[3]);                 //    PatObj[3] = PikeWind/bong.ini
  //     pat->AnimationEnd = PatAnimationEnd[3];                        //    = `bong.ini` 的 AnimationEnd = 20
  //     AddObject(pat, 8);                                             //    第 2 参 = **起始帧**（第 8 帧才出现）
  // }
  // y = y+500;
  // for (index = 0; index < 15+level; index++) {                       // ② 地面环粒子（**未做**）
  //     int ang = ANGLE_360/(15+level)*index;                          //    ⚠ 这里分母是 15+level（与①不同）
  //     particleDest->Start(内圈 8000+level*325 → 外圈 18000+level*325 …, MaterialNum[0], 1);
  //     AddObject(particleDest, 10);
  // }
  // ```
  // ⚠ ② 段**没做**：`MaterialNum[0]` 的材质清单**未逐项取证**（`docs/技能系统-pikeman.md` §2.1 ① 明记
  //   "留空 —— 待查"）⇒ 按纪律不编，播放时逐条上报。
  // ⚠ 环的元素数/半径/角度都**随等级**变（`15+level` / `level*650`），所以等级必须由调用方给。
  pikewind: (ctx, caster) => {
    const level = ctx.skillLevel ?? null;
    if (level == null) {
      reportFallback('skillfx', 'Pike Wind 的环随技能等级变（元素数 15+level、半径 level*650），'
        + '但调用方没给 skillLevel ⇒ **本次不放**（不按 1 级猜）');
      return;
    }
    // 动态光：`SetDynLight(x,y,z, 50,50,200, 255, 200+level*10, 3)`（:6293）
    ctx.dynLights?.set(caster.x, caster.y, caster.z, 50, 50, 200, 255, 200 + level * 10, 3);
    if (!ctx.fireMesh) {
      reportFallback('skillfx', 'Pike Wind 的 ASE 环（`bong`）没起：调用方没给 fireMesh');
      return;
    }
    const n = 15 + level;
    const div = 15 + Math.floor(level / 2);              // ⚠ 源码 `15+level/2` 是**整除**
    for (let i = 0; i < n; i++) {
      const ang = Math.floor((PT_ANGLE_FULL / div) * i); // 原版 `ANGLE_360/(15+level/2)*index`
      const th = ptAngleToRad(ang);
      // ⚠ **不除 FONE**（2026-09-21 依据三条实测改）：源语把 `(level*650)` **直接加在 x/z 上**
      //   （`HoEffect.cpp:6302` 客户端/服务端逐字相同），而 x/z 就是世界坐标 ⇒ 同一个空间。
      //   证据链：① `.smd` 的**顶点**不除时刀光长度（≈38）与画面相符；② L0 实测的可见环半径
      //   （27.7→74.2）= 面片自身偏移，**不除**才对得上；③ 两者同出一份文件 ⇒ 同一单位。
      //   ⇒ 我此前把半径 ÷256（25.4 单位）⇒ **比面片自身的 77 摆动还小** ⇒ 环被甩乱（用户实测
      //   "越高等级越不圆"）。改回不除后：半径 650·level ≫ 偏移 77 ⇒ 任何等级都是干净的圆。
      //   ⚠ **副作用（源码如此，非我方选择）**：该常数每级 +650，而本技能同源的击退表
      //   `Pike_Wind_Push_Lenght[10]={70..120}` 每级只 +5 ⇒ **高等级时环会非常大**（L10 = 6500 单位）。
      //   两条都照源码，不替它做平衡。
      // ⚠ **两个极端的量级都实测过了，都不对，所以这里保持 ÷FONE（原来的值）不再动**：
      //   · ÷256 ⇒ 25.4 单位：比面片自身偏移（≤77）还小 ⇒ 被偏移盖住、环乱（用户 2026-09-21 第一次实测）；
      //   · 不除 ⇒ 650 单位：虽然环稳，但**大得离谱**（用户第二次实测："level=1 时距离已经非常离谱"、
      //     "4 级快超出摄像机视锥"）。
      //   ⇒ 真值在两者之间，**两个极端都是我调出来的** ⇒ **不再调第三个数字**（AGENTS #62）。
      //   收口只能靠"那层换算的出处"：①`.ase→.smd` 转换器（有没有 ÷256）；②`GetCos/GetSin` 在**效果模块**
      //   里的索引范围（`smSin.h` 里 `ANGLE_360` 有 8192/4096 两个变体）。两者都还没查到。
      const r = (level * 650) / FONE;
      const at = { x: caster.x + Math.cos(th) * r, y: caster.y, z: caster.z + Math.sin(th) * r };
      ctx.fireMesh({
        path: 'effect/objanimationdata/pikewind/bong.smd',
        // ⚠ **轴向试过 `'y'`，是错的，已回退**（用户 2026-09-21 实测："旋风直接看不见了，似乎埋到地里
        //   还被压缩了"）：按 Y-up 解释虽然让面片法线与"上"的夹角从 65° 改成 27°，但这份网格的**长轴**
        //   正是原始 Y 轴（跨度 ≈48）⇒ 一旦不换算，长轴就立起来、还伸到地面以下 ⇒ 埋进地里。
        //   ⇒ **顶点是 Z-up（长轴水平）无疑**；"斜"来自面片自身的倾角（65°），而源码里没有任何放平步骤
        //   （`HoEffectPat::Draw` 世界空间 + 只给 Y 角）⇒ 这一处**仍未解决**，见文档 §9.10 的"未决"。
        upAxis: 'z',
        // `bong.ini` 的 `[3DANIMATION] AnimationEnd = 20`；`HoEffectPat::Main` 每游戏帧推进 1 帧
        //（`CurrentFrame > AnimationEnd*160-1` ⇒ 播完 `ANI_ONE` 即销毁）
        aniMaxCount: 20, aniDelayTime: 1,
        // 朝向：**净角度 = `ang` 本身** —— ⚠ 源码里 `ANGLE_180` 被减了**两次**：
        //   调用点 `StartAni(…, ANGLE_180-ang, …)`（`HoEffect.cpp:6303`）
        //   而 `StartAni` 内部又做 `Angle.y = (ANGLE_180-angleY)&ANGCLIP`（`:1993`）
        //   ⇒ 净 = `180-(180-ang)` = `ang` ⇒ **每个面片沿圆周切向**（整圈才转得起来）。
        //   ⚠ 我第一版只按调用点字面写 `ANGLE_180-ang` ⇒ 整圈差 180° ⇒ 看起来是"放射/展开"
        //   而不是"转圈"（用户 2026-09-21 实测："原版能感觉到粒子在转圈，你这更像展开"）。
        // ⚠ **符号必须与"环位怎么铺"一致**：环位用 `(cos·r, sin·r)` 铺在 **(x, z)** 上，
        //   而 three 绕 Y 旋转把局部 +x 转向 **−z**（右手系）⇒ 若 rotY 直接用 +ang，则
        //   **朝向与位置角的转向相反** ⇒ 位移不沿径向 ⇒ 同一圈的半径逐片不同（实测 3.98~86.47）。
        //   取负号后二者同向 ⇒ 位移沿径向 ⇒ 半径全等（模拟：离散度 0%）。
        rotY: ptAngleToRad(-ang),
        delaySec: 8 / 60,                                 // `AddObject(pat, 8)` = 第 8 帧起
        note: 'HoEffect.cpp:6291-6322（环网格 15+level 个）',
      }, at);
    }
    reportFallback('skillfx', `Pike Wind 的地面环粒子（${15 + level} 颗，\`MaterialNum[0]\`）未做 —— `
      + '该材质清单未逐项取证（docs/技能系统-pikeman.md §2.1 ①）');
  },

  // **Chain Lancer**（pikeman 三转·4，`SKILL_PLAY_CHAIN_LANCE` / 下标 52）—— 也**复用**给
  // Shadow Master 的命中（`SkillShadowMasterHit`）⇒ 所以它是**共享** code，不绑在某个职业的技能表上。
  //
  // 原版（逐字，`character.cpp:15578-15624` 玩家 `EventSkill`）：
  //   `if (chrAttackTarget && GetAttackPoint(&x,&y,&z)) { Pos1 = 落点;
  //      if (lpCurPlayer->AttackCritcal >= 0) { AssaParticle_ChainLance(&Pos1); … } }`
  // 粒子本体（`hoAssaParticleEffect.cpp:3416-3428`）：`Pos1.y += 3000` → `.part` 裸名 **`Skill3Hit3`**
  //   → `SetDynLight(x,y,z, 100,50,0,0, 250,5)`。
  //
  // ⚠ 仍未做（见 `docs/技能系统-pikeman.md` §2.12 ⑥ / `U-K-18`）：①`AttackCritcal >= 0` 那道闸
  //   （原版"**任一段未命中 ⇒ 后续段不再出粒子**"，要服务端逐段结算的结果）；②`MotionEvent < 3`
  //   的 3 段伤害；③残影染色（`SetSkillMotionBlurColor` 红）。这三条**不在**本函数里假装做掉。
  chainlance: (ctx, _caster) => {
    const at = ctx.weaponBase;
    if (!at) {
      reportFallback('skillfx', 'Chain Lancer 的粒子落点是**攻击骨**（原版 `GetAttackPoint`），'
        + '但调用方没给 `weaponBase` ⇒ 本次不放（不退回脚下）');
      return;
    }
    // `pPosi->y += 3000`（定点数，fONE = 256）—— 与怪物侧 0x1950 的 `'Z'` 同一个数
    const p = { x: at.x, y: at.y + 3000 / 256, z: at.z };
    ctx.dynLights?.set(p.x, p.y, p.z, 100, 50, 0, 0, 250, 5);
    if (!ctx.spawnPart) {
      reportFallback('skillfx', 'Chain Lancer 的粒子 Skill3Hit3 没起：调用方没给 spawnPart');
      return;
    }
    void ctx.spawnPart('Skill3Hit3', { pos: p });
    ctx.log?.('    ✦ Chain Lance：Skill3Hit3 @ 攻击骨 + 动态光 100,50,0 power250/dec5');
  },

  // **Vigor Ball**（`SKILL_PLAY_VIGOR_BALL`，祭司 `mp40 v_ball.bmp`）——
  // 与怪物 D_PR 的 `'H'` **同一招、同一个原版函数**（`character.cpp:16338` 玩家 / `:14912` 怪物
  // 都调 `AssaParticle_VigorBall`）⇒ **共用 spec**（`FX_VIGOR_BALL`）与共用驱动（`monster-fly-runner`）。
  vigorball: (ctx, caster, target) => {
    const fly = FX_VIGOR_BALL.fly;
    if (!fly) { ctx.log?.('  ✗ Vigor Ball：spec 里没写 fly（配置错误）'); return; }
    if (!ctx.spawnAsset) {
      // 不静默退化成"原地爆一坨"——那会让人以为技能做完了
      ctx.log?.('  ✗ Vigor Ball：ctx 没给 spawnAsset（= EffectManager.spawnStoppable）⇒ 不播');
      return;
    }
    if (ctx.motionEvent == null) {
      ctx.log?.('  ⚠ Vigor Ball：没给 motionEvent ⇒ 两颗球都按第 1 个事件帧出（原版第 1 帧 −45°、其后 +45°）');
    }
    if (ctx.casterYaw == null) ctx.log?.('  ⚠ Vigor Ball：没给 casterYaw ⇒ 出手方向按 0（跟踪弹会自己修正）');
    // 目标：优先**每帧现取**；只有快照时用它兜底并说明（飞行最长 100 帧，目标走动时不跟随会看得见）
    if (!ctx.targetGetter && target) {
      ctx.log?.('  ⚠ Vigor Ball：只给了目标快照 ⇒ 目标走动时飞行终点不跟随（应传 targetGetter）');
    }
    const getTarget = ctx.targetGetter ?? (target ? () => target : () => null);
    const vigorAsset = pickMonsterFxAsset(FX_VIGOR_BALL, 0);
    if (!vigorAsset) {
      // 单值 asset **不可能**越界 ⇒ 走到这里说明数据被改成了数组且下标错，必须看得见
      ctx.log?.('  ✗ Vigor Ball：资产下标越界（spec 的 asset 被改过？）⇒ 不播');
      return;
    }
    runMonsterFly(
      {
        spawn: ctx.spawnAsset,
        addToScene: (o) => ctx.scene.add(o),
        dynLight: ctx.dynLights,
        log: ctx.log,
      },
      vigorAsset, fly,
      {
        pos: { x: caster.x, y: caster.y + (fly.lift ?? 0), z: caster.z },
        yaw: ctx.casterYaw ?? 0,
        target: getTarget,
        // 目标"一开始就取不到"（或发射瞬间已死）时的兜底落点 —— 用调用方给的快照
        aimFallback: target ?? null,
        motionEvent: ctx.motionEvent ?? 1,
      },
    );
  },
  // **Glacial Spike**（`SKILL_PLAY_GLACIAL_SPIKE`，祭司 `mp60 g_spike.bmp`）——
  // 与怪物 D_PR 的 `'Z'`（`character.cpp:14926`）**同一招同一个函数**（`SkillCelestialGlacialSpike`）
  // ⇒ 共用 `glacial-spike.ts`（那里面是从 NewEffect Lua 移植的参数与寿命/alpha 语义）。
  // 它是**朝向前方**的地面效果（近身 → 前方 100，越远越大），只依赖 `casterYaw`，不需要目标。
  glacialspike: (ctx, caster) => {
    // **只在第 1 个事件帧放一次** —— 原版玩家侧就是 `if (point && MotionEvent == 1)`
    //（`character.cpp:16997`；怪物侧那个 `case 'Z'` **没有**这条守卫）。
    // ⚠ 判据用 `> 1` 而不是 `!== 1`：动作**没有事件帧**时调用方按原版兜底在起点触发，
    //   那时 `motionEvent` 会是 0 —— 用 `!== 1` 会把它**静默吞掉**（AGENTS #12 禁止的那类）。
    if (ctx.motionEvent != null && ctx.motionEvent > 1) {
      ctx.log?.(`    ⏭ Glacial Spike：本招原版只在第 1 个事件帧触发（当前第 ${ctx.motionEvent} 个）`);
      return;
    }
    if (ctx.casterYaw == null) {
      ctx.log?.('  ⚠ Glacial Spike：没给 casterYaw ⇒ 只会朝 +z 放（应传角色朝向）');
    }
    runGlacialSpike(
      { effects: ctx.effects, scene: ctx.scene, dynLights: ctx.dynLights, log: ctx.log },
      caster, ctx.casterYaw ?? 0, ctx.fxScale ?? 1,
    );
  },
  // **Healing**（priestess T1.1，`SKILL_PLAY_HEALING`）—— 事件帧视觉逐字 `character.cpp:11526-11544`：
  // 被治疗者身上 `sinEffect_Healing2(...)`（`sinSkillEffect.cpp:1632-1668`）= 白动态光
  // `SetDynLight(255,255,255, 255,200,1)` + 一份可见的 `HIALTEST.ASE` 网格。
  // 2026-09-26 用户实测指正（"应该是在目标或自己头上有**旋转的粒子**表示恢复的，但是现在没有"）
  // ⇒ 补齐该份网格的完整语义（`RotateAngle 256`/`RotateDistance.z 256*16`/`MoveSpeed.y 200`/
  //   `Max_Time 250`/末 20 帧淡出 + 自身 30 帧动画）= **绕头 r=16 旋转、逐帧上升、末段淡出、自带扇翅**，
  //   由 `healing-orbit.ts` 每帧驱动（静态 `fireMesh` 表达不了这些）。
  // 落点 = `target ?? caster`：治目标时在目标身上、自施在自己身上（与原版 `lpTarChar ?: this` 同语义）。
  healing: (ctx, caster, target) => {
    const at = target ?? caster;
    ctx.dynLights?.set(at.x, at.y, at.z, 255, 255, 255, 255, 200, 1);
    if (!ctx.scene) {
      reportFallback('skillfx', 'Healing 效果没起：调用方没给 scene');
      return;
    }
    runHealingOrbit({ scene: ctx.scene, log: ctx.log, project: ctx.project, targetPos: ctx.anchorPos },
      at, ctx.fxScale ?? 1);
  },
  // **Holy Mind**（priestess T1.4，`SKILL_PLAY_HOLY_MIND`）—— 事件帧视觉逐字两段：
  //   · `AssaParticle_HolyMind_Attack(lpTarChar, cnt)`（`hoAssaParticleEffect.cpp:2149-2162`）：
  //     `StartEffectMonster(..., MONSTER_SERQBUS_MAGIC3)` + 贴身 Billboard 群（`HOLY_MIND_ATTACK`，
  //     `AssaParticle.cpp:1577/1936`，存活 `liveCount*70` 帧 —— liveCount 由目标**生物抗性**缩放，
  //     我们没有怪物抗性模型 ⇒ 贴身群不放，见下）。
  //   · `HoEffect.cpp:9218-9232`（`MONSTER_SERQBUS_MAGIC3`）：紫动态光
  //     `SetDynLight(108,8,136, 255,250,1)` + `g_NewParticleMgr.Start("SerqbusMagic3", pos.y+5000)`。
  // 我方：动态光 + **`part:serqbusmagic3`**（在库里，目标头顶 +5000/256 ≈ +19.5 世界单位）；
  // ⚠ 贴身群与抗性缩放未做 ⇒ `reportFallback` 显式可见（缺口与 Holy Mind 服务端的抗性缺口同源）。
  holymind: (ctx, caster, target) => {
    const at = target ?? caster;
    ctx.dynLights?.set(at.x, at.y, at.z, 108, 8, 136, 255, 250, 1);
    reportFallback('skillfx', 'Holy Mind：贴身 Billboard 群（HOLY_MIND_ATTACK）未移植（依赖怪物抗性模型）⇒ 只放 SerqbusMagic3');
    if (!ctx.spawnPart) {
      reportFallback('skillfx', 'Holy Mind 的 SerqbusMagic3 没起：调用方没给 spawnPart');
      return;
    }
    void ctx.spawnPart('serqbusmagic3', { pos: { x: at.x, y: at.y + 5000 / FONE, z: at.z } });
  },
  // **Holy Reflection**（priestess T2.3，`SKILL_PLAY_HOLY_REFLECTION`）—— 事件帧视觉逐字
  // `sinAssaSkillEffect.cpp:625-660`（`sinSkillEffect_Holy_Reflection(this, Holy_Reflection_Time[p-1])`）：
  // 紫动态光 `SetDynLight(100,50,100, 150,200,1)` + **两份** `2HolyReflection.ASE`（`AniMaxCount 30 /
  // AniDelayTime 4`，一左一右：`StartPosi.x = -256*10` + 两个互反的 Angle.y）+ `Bone`/`flare.tga`
  // 广告板若干，`CODE = SKILL_HOLY_REFLECTION`（存活 = 持续时间，由 `..._Defense` 按 Time 维护）。
  // 我方：动态光 + **两份网格**（`b_2holyreflection.smd`，在库；第二份 rotY 转 π 表达"一左一右"）；
  // ⚠ 广告板与"持续 Time 秒的贴身维护"没做（网格按自身动画寿命播完即逝）⇒ 显式上报。
  holyreflection: (ctx, caster) => {
    ctx.dynLights?.set(caster.x, caster.y, caster.z, 100, 50, 100, 150, 200, 1);
    reportFallback('skillfx', 'Holy Reflection：Bone/flare 广告板与"持续整段时长"未移植 ⇒ 两份网格按自身动画寿命播放');
    if (!ctx.fireMesh) {
      reportFallback('skillfx', 'Holy Reflection 的圣盾网格没起：调用方没给 fireMesh');
      return;
    }
    for (const rotY of [0, Math.PI]) {
      ctx.fireMesh({
        path: 'image/sinimage/assaeffect/holyr/b_2holyreflection.smd',
        aniMaxCount: 30, aniDelayTime: 4, upAxis: 'z', rotY,
        note: 'sinSkillEffect_Holy_Reflection 的 2HolyReflection.ASE ×2（sinAssaSkillEffect.cpp:632-650）',
      }, caster);
    }
  },
  // **Grand Healing**（priestess T2.4，`SKILL_PLAY_GREAT_HEALING`）—— 事件帧视觉逐字
  // `sinAssaSkillEffect.cpp:327-360`：橙动态光 `SetDynLight(255,150,100, 150,180,1)` + 两份
  // `GH.ASE`（AniMaxCount 30 / AniDelayTime 4，错帧起放）+ 20 张 `star04Y_01.bmp` 广告板。
  // ⚠ **`GH.ASE` 不在我方资产根**（find 全库无 gh.sm*）⇒ 按纪律**不放、上报**（不拿别的网格顶）；
  //   动态光照放（它不是资产，是渲染指令）。法阵与音效走既有链路（cast 圆 / evtSfx）。
  grandhealing: (ctx, caster) => {
    ctx.dynLights?.set(caster.x, caster.y, caster.z, 255, 150, 100, 150, 180, 1);
    reportFallback('skillfx', 'Grand Healing：GH.ASE 不在资产根（全库无 gh.sm*）⇒ 网格与 star04 广告板不放，只放动态光');
  },
  // **Chain Lightning**（priestess J4·S3，`SKILL_PLAY_CHAIN_LIGHTNING`）—— 原版事件帧视觉 =
  // `SkillCelestialChainLighting(lpSelected_Char, dmSelected_CharCnt)`（`character.cpp:17082`，
  // 逐字 `hoAssaParticleEffect.cpp:674-693`）：一道 **ASSA_SHOT_SPARK 从天上（y+100000）落到主目标**
  // （y+5000），再 `SetChainLighting` 逐段连到后续目标 —— **多目标链表在服务端**，客户端只上报了
  // 主目标 ⇒ 忠实的链式视觉要等"链表随结算下发"。现以**同族同名资产**先起主目标那份：
  // `part:skill4celestialchainlightinglight`（`skill4*` = 祭司四转资产族，本技能 = J4·S3，名字直配）；
  // ⚠ 天降闪 + 逐段链未移植 ⇒ `reportFallback` 显式可见。音效照既有数据（两条 rand 变体）。
  chainlightning: (ctx, caster, target) => {
    const at = target ?? caster;
    reportFallback('skillfx', 'Chain Lightning：天降闪 + 逐段链（ASSA_SHOT_SPARK/SetChainLighting）未移植（需服务端下发链表）⇒ 只放主目标处的 skill4 同族粒子');
    if (!ctx.spawnPart) {
      reportFallback('skillfx', 'Chain Lightning 的链光粒子没起：调用方没给 spawnPart');
      return;
    }
    void ctx.spawnPart('skill4celestialchainlightinglight', { pos: at });
  },
  // **Divine Lightning**（priestess T2.2，`SKILL_PLAY_DIVINE_LIGHTNING`）—— 事件帧视觉 =
  // `SkillPlay_DivineLightning_Effect`（`netplay.cpp:12463`）对**每个目标**调
  // `AssaParticle_DivineLighting`（`hoAssaParticleEffect.cpp:654`）：一道 **ASSA_SHOT_SPARK
  // 从天上（pY+100000）落到目标头顶（pY+5000）**，到达时 `AssaParticle_Sprak` 三件套
  // （5 颗溅射火花 + 白动态光 + `part:divinelightning`）。完整移植见 `divine-lightning.ts`
  // （文件头有逐字出处）。目标列表 = **服务端结算下发的 `S2C_AttackResult` 逐条**
  // （`WorldView` 在 `applyMonsterHit` 那条链上按 `attacker/skill` 派发）—— 与自机共用一份，
  // 不重跑本地选敌（AGENTS #14：同步结果）。
  divinelightning: (ctx, caster, target) => {
    const at = target ?? caster;
    configureDivineLightning({ dynLights: ctx.dynLights, spawnPart: ctx.spawnPart });
    runDivineLightning({ scene: ctx.scene, dynLights: ctx.dynLights, spawnPart: ctx.spawnPart, log: ctx.log }, at);
  },
};


/** 起手（技能动画开始那一刻）：原版 `SkillPlaySound(…)` + 起手法阵 */
/**
 * **起手特效派发**（`cast.fx`）—— 施法者与旁观者共用这一份（AGENTS #15：同一判定只有一份实现）。
 * 只支持 `code:`（其余**显式上报**不静默）。返回是否派发过（法阵那条只在施法者侧走，见调用方）。
 */
function dispatchCastFx(row: SkillFxRow, ctx: SkillFxFireCtx, caster: { x: number; y: number; z: number },
                        target: { x: number; y: number; z: number } | null): boolean {
  let fired = false;
  for (const ref of row.cast.fx ?? []) {
    if (!ref.startsWith('code:')) {
      reportFallback('skillfx', `技能「${row.name}」的起手特效引用「${ref}」没有可用加载器（只实现了 code:）⇒ 本次不播`);
      continue;
    }
    const fn = CODE_SKILL_FX[ref.slice(5)];
    if (fn) { fn(ctx, caster, target); fired = true; }
    else ctx.log?.(`  ✗ 技能「${row.name}」的起手 code 特效「${ref}」未注册`);
  }
  return fired;
}

/**
 * **旁观者侧的起手表现** —— 对应原版 `RecvProcessSkill`（`netplay.cpp:12734`）：它按技能码逐条分派
 * **该技能自己的特效**（如 `case SKILL_PLAY_HEALING: sinEffect_Healing2(lpChar)` + `SkillPlaySound`）。
 *
 * <p>⚠ 用户 2026-09-27 实测："在网络上的其他玩家眼里，看不到我的施法动作和粒子特效" ——
 * 此前我们只在**自机**的起手路径派发特效，旁观者那条链没接。
 *
 * <h3>起手法阵：**我方明确改动**（原版旁观者看不到）</h3>
 * 原版 `sinEffect_StartMagic` 全树 39 个调用点里 36 个在 `smCHAR::BeginSkill`、2 个在
 * `BeginSkill_Monster`，而 `BeginSkill` **只被 `lpCurPlayer->BeginSkill(...)` 调用**（`SkillSub.cpp` 全篇），
 * 旁观侧 `RecvProcessSkill` 也从不调它 ⇒ **原版里别人的法阵你看不到**（你看到的是"他的动画 +
 * 事件帧特效 + 命中/受击特效"）。
 * 用户 2026-09-27 两次指出"远端看不到祭司脚下的法阵" ⇒ 这里**有意补上**：落点 = **施法者脚下**
 * （法阵是施法者的起手表现，与治疗锚点落在被治疗者身上是两件事），家族仍走 `castCircleFlagForClass`
 * （按职业取，取不到就不放 —— 与原版同一份判据）。
 */
export function fireObserverCast(row: SkillFxRow | null, ctx: SkillFxFireCtx,
                                caster: { x: number; y: number; z: number },
                                target: { x: number; y: number; z: number } | null): void {
  if (!row) return;
  // 音效按**原版位置**播（在目标处：`SkillPlaySound(..., lpChar->pX…)`）
  for (const s of row.cast.sfx) ctx.playSound?.(s, target ?? caster);
  dispatchCastFx(row, ctx, caster, target);
  fireObserverCastCircle(row, ctx, caster);
}

/**
 * **只起起手法阵**（旁观者侧）—— 落点 = **施法者**脚下，家族按职业取（与原版同一判据）。
 *
 * 单独成函数的原因：法阵**与目标无关**（它长在施法者脚下），所以"目标在本地视野里认不出"时
 * 它照样该放 —— 而"技能自身那个目标锚定的特效"（如治疗的天使落在被治疗者身上）这时**不能放**，
 * 否则会悄悄落到施法者身上（正是用户报过的"别人眼里天使绕祭司转"）。
 */
export function fireObserverCastCircle(row: SkillFxRow | null, ctx: SkillFxFireCtx,
                                      caster: { x: number; y: number; z: number }): void {
  if (!row) return;
  const charFlag = castCircleFlagForClass(row.classDir);
  if (charFlag == null) return;   // 该职业在原版里没有起手法阵（取不到 = 不放）
  runCastCircle(ctx, caster, { charFlag, type: CAST_CIRCLE_TYPE_NORMAL });
}

/** 旁观者侧这一招**有没有起手表现**（技能自己的起手特效/音效，或我们补的起手法阵） */
export function hasObserverCastVisual(row: SkillFxRow | null): boolean {
  if (!row) return false;
  if ((row.cast.fx?.length ?? 0) + row.cast.sfx.length > 0) return true;
  // ⚠ 只有法阵、没有 cast.fx/sfx 的技能（法师/祭司/萨满的多数招）也要走旁观者这条路 ——
  //    否则"远端的法阵"对它们仍然看不到（用户 2026-09-27 报的就是祭司施法时的法阵）。
  return castCircleFlagForClass(row.classDir) != null;
}

export function fireSkillCast(row: SkillFxRow | null, ctx: SkillFxFireCtx, pos: { x: number; y: number; z: number },
                              target: { x: number; y: number; z: number } | null = null): void {
  if (!row) return;
  for (const s of row.cast.sfx) ctx.playSound?.(s, pos);
  if (!dispatchCastFx(row, ctx, pos, target)) return;
  // **起手法阵** —— 玩家侧**有**权威出处  // **起手法阵** —— 玩家侧**有**权威出处（原注释称"玩家侧没有、25 个调用者全在怪物 BeginSkill"，
  //   2026-09-20 逐行核实：**这句是错的**，它写于 monster-lab 调 D_PR 期间，只看了怪物那一侧）。
  //   `sinEffect_StartMagic` 全树 **39 个调用点**（`grep -a -rn` 实测）：
  //     · **36 个在玩家可达的 `smCHAR::BeginSkill`**（`character.cpp:13156-13950`，36 个技能各 1 处）
  //     · **2 个**在 `BeginSkill_Monster`（`:13951+`）—— `:14046` 与 `:14073`（后者就是怪物 D_PR）
  //     · **1 个**在 `sinAssaSkillEffect.cpp:21`：开发者调试键（见下）
  //   ⇒ 玩家侧 36 个调用点**逐技能**给出了 `CharFlag`，不需要靠怪物外推。
  //   · `Type` 默认 0（`sinSkillEffect.h:58`）⇒ **36 个玩家调用点全是 `Type = 0`**（本函数取 0 ✓）。
  //   · `Type = 1` **只在开发者调试键里出现**：`sinAssaSkillEffect.cpp:18` 的 `if(sinGetKeyClick('0'))`
  //     → `:21` `sinEffect_StartMagic(&Posi, 2, 1)`（187.5/242 = 盘面的 3.6 倍，观感上光环远在纹样
  //     之外 ⇒ 是"试大号"的开关，不是玩家取值。我起初按它取了 1，用户实测"这个法阵怎么这么大"
  //     ⇒ 改回 0）。`Type=1` 那条分支仍在 `castCircleFamily` 里（源码确实有），需要时可传参启用。
  //   · `CharFlag` **按职业分**，36 个玩家调用点**无一例外**（`character.cpp` 逐行核对）：
  //       priestess(8) = **1**（**11 个**技能）· magician(7) = **2**（11 个）· shaman(10) = **10**（14 个）
  //     （HAUNT / JUDGE 归 10 —— 与"这两条住在法师区段里"一致，见 `docs/技能系统-magician.md`）
  //     ⚠ **祭司段共 15 个 `case`，只有 11 个调本函数** —— 另 4 个（`HOLY_BOLT` `:13627`、
  //       `VIGOR_BALL` `:13655`、`RESURRECTION` `:13656`、`EXTINCTION` `:13657`）**没有起手法阵**。
  //   ⚠ **其余 8 个职业在原版里根本没有这个调用** ⇒ 它们**不该有法阵**（此前不分职业一律给，
  //     等于给战士/骑士/弓箭手…都画了法师的法阵）。
  // ⇒ 家族**按职业**取（`castCircleFlagForClass`，唯一实现）；取不到 = 不放法阵。
  const charFlag = castCircleFlagForClass(row.classDir);
  if (charFlag == null) return;
  runCastCircle(ctx, pos, { charFlag, type: CAST_CIRCLE_TYPE_NORMAL });
}

/** 事件帧：原版 `EventSkill` 那一刻 —— 播技能音 + 起特效 */
export function fireSkillEvent(
  row: SkillFxRow | null, ctx: SkillFxFireCtx,
  caster: { x: number; y: number; z: number },
  target: { x: number; y: number; z: number } | null,
): boolean {
  if (!row) return false;
  // **多段音**（`soundPick: 'motionEvent'`，如 Chain Lancer 1/2/3 段）⇒ **只响当前这一段那一条**。
  // 下标 = 事件帧序号 − 1；越界**不响**（原版 `switch` 无 `default`），不取模、不取最后一条。
  if (row.soundPick === 'motionEvent') {
    if (ctx.motionEvent == null) {
      reportFallback('skillfx', `技能「${row.name}」的音效按事件帧分（原版 \`switch (MotionEvent)\`），`
        + '但调用方没给 motionEvent ⇒ 这一段**不响**（不猜）');
    } else {
      const pick = row.event.sfx[ctx.motionEvent - 1];
      if (pick) ctx.playSound?.(pick, caster);
    }
  } else {
    for (const s of row.event.sfx) ctx.playSound?.(s, caster);
  }
  let fired = false;
  for (const ref of [...(row.fx ?? []), ...(row.event.fx ?? [])]) {
    if (!ref.startsWith('code:')) {
      // ⚠ 这条**不会**被播放：玩家技能这条链只实现了 `code:`（`CODE_SKILL_FX`）。
      //   `ini:` / `part:` / `lua:` 各自需要加载器（`.part` 能加载，但"放哪儿、跟不跟随、何时停"
      //   是每个技能自己的事，不能一概 `effects.spawn` 到脚下）。
      //   此前这里是**静默** `continue` ⇒ 祭司的 Resurrection / Extinction / Glacial Spike 等
      //   "声明了特效却什么都没播、也没人报警"（AGENTS #12）。
      reportFallback('skillfx', `技能「${row.name}」的特效引用「${ref}」没有可用加载器（只实现了 code:）⇒ 本次不播`);
      continue;
    }
    const fn = CODE_SKILL_FX[ref.slice(5)];
    if (fn) { fn(ctx, caster, target); fired = true; }
    else ctx.log?.(`  ✗ 技能「${row.name}」的 code 特效「${ref}」未注册`);
  }
  return fired;
}
