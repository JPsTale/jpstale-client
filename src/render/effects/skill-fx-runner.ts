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
import { playerSparkCount } from './multi-spark.js';
import { runCastCircle } from './cast-circle-runner.js';
import { castCircleFlagForClass, CAST_CIRCLE_TYPE_NORMAL } from './cast-circle.js';
import { runMonsterFly, type FlyDeps } from './monster-fly-runner.js';
import { FX_VIGOR_BALL, pickMonsterFxAsset } from './monster-attack-fx.js';
import { runGlacialSpike } from './glacial-spike.js';
import { reportFallback } from '../../char/fallback-log.js';
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
 * `code:<名>` 注册表 —— 每个条目负责"放这一招"。
 *
 * 参数写在这里而不是数据里：`num = 7` 是**原版玩家侧调用点的取值**（怪物侧是 5，
 * 走 `monster-attack-fx.ts` 那张表），两者是**不同调用点**而不是"同一特效的两个档位"。
 */
export interface SkillFxFireCtx extends MultiSparkRunnerCtx {
  /** 技能等级（原版 `lpSkill->Point`）—— 颗数由它查表（`M_SPARK_NUM`） */
  skillLevel?: number | null;
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
    const lv = ctx.skillLevel;
    if (lv == null) {
      reportFallback('skillfx', 'MultiSpark 的颗数按技能等级取（`M_Spark_Num[Point-1]`），'
        + '但调用方没给 skillLevel ⇒ **本次不放**（不按 1 级猜）');
      return;
    }
    const num = playerSparkCount(lv);
    ctx.log?.(`    ✦ MultiSpark：${num} 颗（等级 ${lv}）`);
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
};


/** 起手（技能动画开始那一刻）：原版 `SkillPlaySound(…)` + 起手法阵 */
export function fireSkillCast(row: SkillFxRow | null, ctx: SkillFxFireCtx, pos: { x: number; y: number; z: number }): void {
  if (!row) return;
  for (const s of row.cast.sfx) ctx.playSound?.(s, pos);
  // **起手法阵** —— 玩家侧**有**权威出处（原注释称"玩家侧没有、25 个调用者全在怪物 BeginSkill"，
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
