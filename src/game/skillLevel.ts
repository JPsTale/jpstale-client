/**
 * **技能当前等级** —— 唯一实现（AGENTS #15）。
 *
 * 此前这份推导只写在 `ui/react/SkillPanel.tsx` 里（面板显示用），于是**特效层拿不到等级**：
 * `skill-fx-runner` 的 `ctx.skillLevel` 一直是 undefined ⇒ Multi Spark 只能按 1 级取颗数
 * （自己打一行"⚠ 未提供技能等级"）、Pike Wind 的环（元素数 `15+level`、半径 `level*650`）
 * 更是**没法放**。收成一份，面板与特效读同一个值。
 *
 * 口径：服务端原版技能表同步前，用**角色等级**推断占位（PT 掌握规则 ≈ 每超 `reqLv` 10 级可练高 1 级）；
 * 熟练度（mastery）暂为 0，待服务端推送。`SKILL_DEBUG` 打开时**手动等级优先**（调试用）。
 */
import { CLASS_DIR, SKILLS } from './skillData.js';
import { SKILL_DEBUG, dbgLevel } from './skillDbg.js';

/** 学习等级：角色等级 → 技能等级（0 = 还没学会） */
export function learnedLevel(charLevel: number, reqLv: number): number {
  if (charLevel < reqLv) return 0;
  return Math.min(20, Math.floor((charLevel - reqLv) / 10) + 1);
}

/**
 * 按**技能图标**取该技能的当前等级（图标是面板、动作表、特效表三处共用的键）。
 *
 * @returns `null` = 取不到（角色等级未知 / 该图标不在技能表里）—— 调用方**不要猜一个值**，
 *   按各自的纪律处理（`skill-fx-runner` 的多 Spark 会按 1 级并上报；Pike Wind 直接不放并上报）。
 */
export function skillLevelByIcon(iconFile: string, charLevel: number | null | undefined): number | null {
  const dbg = dbgLevel(iconFile);
  if (SKILL_DEBUG && dbg != null) return dbg;
  if (charLevel == null) return null;
  const norm = (s: string): string => s.replace(/\.bmp$/i, '').toLowerCase();
  for (const dir of Object.values(CLASS_DIR)) {
    for (const s of SKILLS[dir] ?? []) {
      if (norm(s.iconFile) === norm(iconFile)) return learnedLevel(charLevel, s.reqLv);
    }
  }
  return null;
}
