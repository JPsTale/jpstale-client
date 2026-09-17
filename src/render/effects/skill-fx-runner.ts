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
export const CODE_SKILL_FX: Record<string, (
  ctx: MultiSparkRunnerCtx,
  caster: { x: number; y: number; z: number },
  /** `null` = 没有目标（原版 `sinEffect_MultiSpark(pChar, nullptr, …)` 的情形） */
  target: { x: number; y: number; z: number } | null,
) => void> = {
  multispark: (ctx, caster, target) => { runMultiSpark(ctx, caster, target, 7); },
};

export interface SkillFxFireCtx extends MultiSparkRunnerCtx {
  /** 音效播放（`sfx.play(path, {pos})`） */
  playSound?: (path: string, pos: { x: number; y: number; z: number }) => void;
}

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
    if (!ref.startsWith('code:')) continue;      // ini:/part: 走既有入口（`effects.spawn`）
    const fn = CODE_SKILL_FX[ref.slice(5)];
    if (fn) { fn(ctx, caster, target); fired = true; }
    else ctx.log?.(`  ✗ 技能「${row.name}」的 code 特效「${ref}」未注册`);
  }
  return fired;
}
