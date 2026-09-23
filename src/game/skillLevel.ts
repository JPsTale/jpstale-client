/**
 * **技能当前等级 / 熟练度** —— 唯一实现（AGENTS #15）。
 *
 * 真值 = **服务端下发的 `S2C_SkillList`**（`gameStore.skillList`）：
 * 键不存在 = 未学（`point == 0`）；整张表没到 = `null`（**未知**，调用方各自处理，不猜 —— AGENTS #12）。
 * 客户端**不再**用角色等级推一个等级（旧占位推导已删：那会让面板与特效层显示服务端没给过的等级）。
 * 也没有"手动等级覆盖"这一层（那个调试控件已按用户 2026-09-23 要求移除）。
 */
import { getGameSnapshot } from '../app/gameStore.js';
import { reportFallback } from '../char/fallback-log.js';
import { skillIdByIcon } from './skillIdentity.js';

/**
 * 按数字 `skillId` 取等级。
 * @returns `null` = 未知（`S2C_SkillList` 还没到）；`0` = 服务端明确说**没学**。
 */
export function skillLevelOf(skillId: number): number | null {
  const list = getGameSnapshot().skillList;
  if (!list) {
    reportFallback('skill.level', 'S2C_SkillList 还没到 ⇒ 技能等级未知（按未学处理，不猜）');
    return null;
  }
  return list.learned[skillId]?.point ?? 0;
}

/** 按数字 `skillId` 取熟练度 0..10000（表没到 / 没学 → 0）。 */
export function skillMasteryOf(skillId: number): number {
  return getGameSnapshot().skillList?.learned[skillId]?.mastery ?? 0;
}

/**
 * 按**技能图标**取当前等级（图标是面板、动作表、特效表三处共用的键）。
 * 图标 → `skillId` 的查表只在 `skillIdentity.ts`（查不到即上报并返回 null）。
 */
export function skillLevelByIcon(iconFile: string): number | null {
  const id = skillIdByIcon(iconFile);
  if (id == null) return null;
  return skillLevelOf(id);
}
