/**
 * **技能 → 原版"用哪条动作 + 事件帧的音从哪来"** 的运行时唯一查表处（AGENTS #15）。
 *
 * 数据 = 生成物 `data/skill-motion-src.generated.json`（`npm run skill-motion-src`），
 * 由 `SkillSub.cpp`（起手动作选择）与 `character.cpp` 的 `EventSkill`（事件帧音效）**机械提取**，
 * 每行带出处行号。这里只做查表，不解释、不兜底。
 *
 * 为什么需要（2026-09-23 用户报"武士技能没音效、枪兵/祭司有"）：
 *   原版在 **SKILL 态的事件帧**也会播**武器挥击音** —— `EventAttack` 的通用分支
 *   （`character.cpp:4207`）在 `EventSkill()` 返回 FALSE 时调 `WeaponPlaySound(this)`（`:4244`）。
 *   我们的客户端只在 ATTACK 态播这一声 ⇒ 事件帧音为空的那批技能**整招一声不响**。
 *   实测（`npm run skill-sfx-matrix` + 本表）：这一批里武士占了 3 个（Raving 14 级 / Impact 17 级 /
 *   Triple Impact 20 级 —— 正好是新号最早能学的三招），而枪兵的 Pike Wind(10) 与祭司的 Healing(10)
 *   是专属 wav ⇒ 听感上"按职业有别"。
 *
 * ⚠ `motionSrc === null` = **参考源里没有这一招**（如 11 职业才有的 Hellion / Flame Vortex），
 * 属"未知"而不是"没有"——调用方**不许**把它当成 `'skill'`，要单独上报（AGENTS #12）。
 */
import SRC from './data/skill-motion-src.generated.json';

export type MotionSrc = 'attack' | 'skill' | 'mixed';
/** 事件帧那一层的音从哪来：`skill`=专属 wav（在 `skill-fx.json` 的 `event.sfx`）、
 *  `weapon`=落回武器挥击音（我们此前没实现）、`none`=事件帧无音（起手音另算） */
export type EventSfxSrc = 'skill' | 'weapon' | 'none';

export interface SkillMotionSrcRow {
  job: number;
  classDir: string;
  icon: string;
  name: string;
  /** `attack`=普攻动作（`SetMotionFromCode(ATTACK)` / `RetryPlayAttack`）·
   *  `skill`=技能动作（`SetMotionFromCode(SKILL)`）· `mixed`=同一 case 内按条件二选一 · `null`=源里没有这一招 */
  motionSrc: MotionSrc | null;
  /** 该结论的出处行号（`SkillSub.cpp`） */
  motionLines: number[];
  motionRetryPlayAttack: boolean;
  eventSfx: EventSfxSrc | null;
  /** `SKILL_SOUND_*` → wav（`src/audio/data/sfx-tables.json` 的映射；未登记文件时 `file: null`） */
  sounds: Array<{ symbol: string; file: string | null }>;
  /** 事件帧要补播**武器挥击音**（本模块存在的理由） */
  weaponSfx: boolean;
  /** `PlayWaponSoundDirect(x,y,z,N)` 的 N；无则 null（当前未使用，留档） */
  weaponDirect: number | null;
  /** `EventSkill` 的 case `return FALSE` ⇒ 落回通用分支 */
  evSkillReturnsFalse: boolean;
  /** 该结论的出处行号（`character.cpp`） */
  soundLines: number[];
}

const ROWS = (SRC as { rows: SkillMotionSrcRow[] }).rows;
const BY_ICON = new Map<string, SkillMotionSrcRow>();
for (const r of ROWS) BY_ICON.set(r.icon.replace(/\.bmp$/i, '').toLowerCase(), r);

/** 图标名（可带 `.bmp`）→ 那一行；查不到返回 null（**不猜**） */
export function skillMotionSrcByIcon(iconFile: string): SkillMotionSrcRow | null {
  return BY_ICON.get(iconFile.replace(/\.bmp$/i, '').toLowerCase()) ?? null;
}

/**
 * 这一招的事件帧要不要补播**武器挥击音**（原版 `EventAttack` 通用分支的 `WeaponPlaySound`）。
 * 查不到 = false（**不放**假定音；会在别处按"数据缺口"上报）。
 */
export function weaponSfxForIcon(iconFile: string): boolean {
  return skillMotionSrcByIcon(iconFile)?.weaponSfx ?? false;
}
