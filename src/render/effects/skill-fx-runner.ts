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
import { runMonsterFly, type FlyDeps } from './monster-fly-runner.js';
import { FX_VIGOR_BALL, pickMonsterFxAsset } from './monster-attack-fx.js';
import { runGlacialSpike } from './glacial-spike.js';
import { reportFallback } from '../../char/fallback-log.js';

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
  // ⚠ 调用方给不出技能等级时按 1 级算，并**说明**（不静默）—— 1 级 = "3-4 颗"。
  multispark: (ctx, caster, target) => {
    const lv = ctx.skillLevel ?? 1;
    if (ctx.skillLevel == null) ctx.log?.('    ⚠ 未提供技能等级 ⇒ 按 1 级取颗数（3-4 颗）');
    const num = playerSparkCount(lv);
    ctx.log?.(`    ✦ MultiSpark：${num} 颗（等级 ${lv}）`);
    runMultiSpark(ctx, caster, target, num);
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
    runMonsterFly(
      {
        spawn: ctx.spawnAsset,
        addToScene: (o) => ctx.scene.add(o),
        dynLight: ctx.dynLights,
        log: ctx.log,
      },
      pickMonsterFxAsset(FX_VIGOR_BALL, 0), fly,
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
  // **起手法阵**。玩家侧没有可引用的原版出处（`sinEffect_StartMagic` 全树 25 个调用者全在
  //   `character.cpp` 的怪物 BeginSkill 里；玩家侧只剩一个**调试键**
  //   `sinAssaSkillEffect.cpp:13` `sinEffect_StartMagic(&Posi, 2, 1)`，而 ex-machina 缺玩家侧
  //   技能调度器 —— `skill-fx.json` 的注释亦记"调用点在反编译中丢失"）。
  // 取值依据（按证据强弱）：
  //   · `CharFlag = 2`：**两个证人一致**（调试键是玩家对象；D_PR 原型即祭司、用的就是 2）✓
  //   · `Type = 0`：**祭司的强证人**是 D_PR（同 CharFlag、走默认 Type=0 ⇒ 56.25/72.66，
  //     正好贴合 52 单位的法阵盘面）；而 `Type = 1` 只在那处**调试键**里出现（187.5/242 = 盘面
  //     的 3.6 倍，观感上光环远在纹样之外 ⇒ 更像开发者试大号的开关，不是玩家取值）。
  //     我起初按调试键取了 1，用户实测"这个法阵怎么这么大" ⇒ 改回 0。
  //     `Type=1` 那条分支留在 `castCircleFamily` 里（源码确实有），需要时可传参启用。
  runCastCircle(ctx, pos, { charFlag: 2, type: 0 });
}

/** 事件帧：原版 `EventSkill` 那一刻 —— 播技能音 + 起特效 */
export function fireSkillEvent(
  row: SkillFxRow | null, ctx: SkillFxFireCtx,
  caster: { x: number; y: number; z: number },
  target: { x: number; y: number; z: number } | null,
): boolean {
  if (!row) return false;
  for (const s of row.event.sfx) ctx.playSound?.(s, caster);
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
