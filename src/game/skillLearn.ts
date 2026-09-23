/**
 * 学技能（加点）的**客户端预判** —— 唯一实现（AGENTS #15）。
 *
 * 权威在服务端（`SkillRules.judge`：职业门 → 槽位开放 → 前置槽 → 等级 → 上限 → 技能点 → 钱）。
 * 这里只回答"加点按钮能不能按"，**不复制**服务端的任何规则表：价目表、等级门、前置、池归属都在
 * 服务端那侧判，面板也**不显示金额**（抄一份价目表就会在服务端调价时静默漂开）。
 * 判错的最大代价只是发出一次会被拒的请求 —— 服务端回 `S2C_Error.key = skill.op.*`。
 *
 * 两个点池**分别**求值、不合并（与 `SkillPointService.free(Pool)` 的两个池同源）：
 * tier 1..3 → `skillPoint`；tier 4 → `specialSkillPoint`；tier 5 **不属任何池**（服务端 `slotLocked`）。
 */
import { getGameSnapshot } from '../app/gameStore.js';
import { skillIdByIcon, skillRowBySkillId } from './skillIdentity.js';

/** 技能等级上限（= 服务端 `SkillRules.MAX_POINT`；只用于"到顶即禁用"的预判）。 */
export const MAX_SKILL_POINT = 10;

/** 点池：1–3 转池 / 4 转池。 */
export type SkillPool = 'one' | 'four';

/** 不可按的原因；`null` = 可以按。 */
export type LearnBlock = 'noList' | 'unknownSkill' | 'noPool' | 'maxPoint' | 'noPoint';

export interface LearnGate {
  /** 数字技能 id（= `C2S_LearnSkill` 要发的那个）；`null` = 该图标查不到身份 */
  skillId: number | null;
  pool: SkillPool | null;
  /** 该池剩余点；`null` = **未知**（表还没到）或该档不属任何池 —— 不假装 0 */
  free: number | null;
  /** 已学等级；`null` = 未知（表还没到） */
  level: number | null;
  canLearn: boolean;
  block: LearnBlock | null;
}

/** 转职档 → 点池（5 转无池，与"没有价目表"是同一件事）。 */
export function skillPoolOfTier(tier: number): SkillPool | null {
  if (tier >= 1 && tier <= 3) return 'one';
  if (tier === 4) return 'four';
  return null;
}

/** 池 → 剩余点；`null` = 表还没到（AGENTS #12：不拿别的数字顶上）。 */
export function poolFreePoints(pool: SkillPool | null): number | null {
  if (pool == null) return null;
  const list = getGameSnapshot().skillList;
  if (!list) return null;
  return pool === 'one' ? list.skillPoint : list.specialSkillPoint;
}

/**
 * 按**技能图标**判定能否加点（图标 = 面板/动作表/特效表共用的键）。
 * 判定顺序：表没到 → 身份未知 → 无池（5 转）→ 已满级 → 该池没点。
 */
export function learnGate(iconFile: string): LearnGate {
  const list = getGameSnapshot().skillList;
  const skillId = skillIdByIcon(iconFile);   // 查不到/多候选：内部已 reportFallback
  const row = skillId != null ? skillRowBySkillId(skillId) : null;
  const pool = row ? skillPoolOfTier(row.tier) : null;
  const free = poolFreePoints(pool);
  const level = list != null && skillId != null ? (list.learned[skillId]?.point ?? 0) : null;

  const block: LearnBlock | null =
    list == null ? 'noList'
      : skillId == null || row == null ? 'unknownSkill'
        : pool == null ? 'noPool'
          // ⚠ 不用 `level ?? 0` / `free ?? 0`：那两个 `??` 是"拿一个值顶上"（AGENTS #12）。
          // 走到这里时 level/free **必非 null**（表没到在上面已挡、pool 为 null 也在上面已挡），
          // 所以缺席分支写成"不满足即往下走"，不给任何默认值。
          : (level != null && level >= MAX_SKILL_POINT) ? 'maxPoint'
            : (free != null && free <= 0) ? 'noPoint'
              : null;

  return { skillId, pool, free, level, canLearn: block === null, block };
}
