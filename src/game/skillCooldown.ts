/**
 * **技能冷却的客户端计时**（原版 `UseSkill.GageLength` 0→35 的那套，`sinSkill.cpp:2065-2075`）。
 *
 * ⚠ 说清楚现在的边界：**服务端尚未实现 CD**（设计文档 §10 未决：CD 依赖熟练度增长机制）。
 * 所以这里只是"客户端按原版公式自己计时"⇒ **HUD 的进度与灰化对得上原版手感，但改包可绕过**。
 * 服务端补上 CD 之后，本模块的职责只剩"显示"（判定归服务端），接口不变。
 *
 * 计时起点 = **本机发出 `C2S_UseSkill` 的那一刻**（`bridge.sendUseSkill` 调 `markSkillCast`）——
 * 与原版"起手即进 CD"一致（原版的 gage 也在起手后开始涨）。
 */
import { skillCooldownMs } from './skillCost.js';
import { skillLevelOf, skillMasteryOf } from './skillLevel.js';
import { reportFallback } from '../char/fallback-log.js';

/** skillId → 这次 CD 的起点（毫秒时间戳）与总时长 */
const active = new Map<number, { startMs: number; totalMs: number }>();

/** 记一次出手（`bridge.sendUseSkill` 里调；总时长按当前等级与熟练度算）。 */
export function markSkillCast(skillId: number): void {
  const point = skillLevelOf(skillId);
  if (point == null || point < 1) return;   // 等级未知/未学：算不出 CD（那本来也放不出来）
  const totalMs = skillCooldownMs(skillId, point, skillMasteryOf(skillId));
  if (totalMs == null || totalMs <= 0) {
    // 表取不到 ⇒ **不记 CD**（不是"CD=0"）：宁可少一道本地门，也不编一个时长出来
    reportFallback('skill.cd', `技能 0x${skillId.toString(16)} 的 CD 表取不到（等级 ${point}）⇒ 本次不计 CD`);
    return;
  }
  active.set(skillId, { startMs: Date.now(), totalMs });
}

/** 剩余 CD（毫秒）；0 = 可以出手。到点后自动清账。 */
export function skillCdRemainingMs(skillId: number): number {
  const a = active.get(skillId);
  if (!a) return 0;
  const left = a.startMs + a.totalMs - Date.now();
  if (left <= 0) {
    active.delete(skillId);
    return 0;
  }
  return left;
}

/** CD 进度 0..1（0 = 刚开始，1 = 已就绪）—— HUD 的弧线按它画（原版 `GageLength/35`）。 */
export function skillCdProgress(skillId: number): number {
  const a = active.get(skillId);
  if (!a) return 1;
  const left = skillCdRemainingMs(skillId);
  if (left <= 0) return 1;
  return Math.max(0, Math.min(1, 1 - left / a.totalMs));
}
