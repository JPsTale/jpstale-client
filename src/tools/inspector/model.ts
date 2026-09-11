/**
 * 资产检查器 —— 数据派生层（纯逻辑：无 DOM、无 three）。
 *
 * 把 ITEM_DEFS / skillData / SKILL_INDEX_BY_ICON / JOB_DATA / sfx 库
 * 组合成检查器各面板需要的选项与"这项资产到底有没有"的判定。
 */
import { ITEM_DEFS, type ItemDef } from '../../game/data/itemDefs.js';
import { CLASS_DIR, SKILLS, type SkillDef } from '../../game/skillData.js';
import { SKILL_INDEX_BY_ICON } from '../../game/data/skillIndexByIcon.js';
import { JOB_DATA } from '../../render/char-loader.js';
import { getWeaponTypeFromIdCode, getHandType } from '../../char/weapon-type.js';
import { weaponSoundCode, sfxBank } from '../../audio/sfx.js';
import type { HandType, MotionState } from '../../audio/sfx.js';

/* ─────────── 职业 ─────────── */

export interface JobInfo {
  id: number;
  classDir: string;
  label: string;
  /** JOB_DATA 是否有该职业的模型（注意：JOB_DATA 只到 10，CLASS_DIR 到 11） */
  hasModel: boolean;
  skillCount: number;
}

export const JOBS: JobInfo[] = Object.keys(CLASS_DIR)
  .map(Number)
  .sort((a, b) => a - b)
  .map((id) => {
    const classDir = CLASS_DIR[id] ?? '?';
    return {
      id,
      classDir,
      label: `${id} · ${classDir}`,
      hasModel: !!JOB_DATA[id],
      skillCount: (SKILLS[classDir] ?? []).length,
    };
  });

/* ─────────── 武器 ─────────── */

export interface WeaponOption {
  def: ItemDef;
  /** 语义武器类型（AXE/SWORD/...），由 idcode 推出 */
  type: string;
  hand: HandType;
  /** 原版攻击音效码（1-18） */
  soundCode: number;
  /** 该码对应的音效文件候选 */
  soundFiles: string[];
}

function buildWeapon(def: ItemDef, isCaster: boolean): WeaponOption {
  const type = getWeaponTypeFromIdCode(def.code) ?? 'UNKNOWN';
  const hand = getHandType(def.class) as HandType;
  const soundCode = weaponSoundCode(type, hand, isCaster);
  return { def, type, hand, soundCode, soundFiles: sfxBank.weaponFiles(soundCode) };
}

/** 全部武器（按类型分组展示用）。isCaster 影响钝器是挥击音还是吟唱音。 */
export function weaponOptions(isCaster: boolean): WeaponOption[] {
  return ITEM_DEFS
    .filter((d) => d.folder === 'weapon')
    .map((d) => buildWeapon(d, isCaster));
}

/** 按类型分组（供 <optgroup>） */
export function groupWeaponsByType(list: WeaponOption[]): Map<string, WeaponOption[]> {
  const m = new Map<string, WeaponOption[]>();
  for (const w of list) {
    const arr = m.get(w.type);
    if (arr) arr.push(w);
    else m.set(w.type, [w]);
  }
  return m;
}

/* ─────────── 防具 / 头脸 ─────────── */

/** 防具 idcode → armorNum 的去重清单（按 armorNum 升序） */
export function armorNumbers(): number[] {
  const set = new Set<number>();
  for (const d of ITEM_DEFS) {
    if (d.folder !== 'defense') continue;
    set.add((d.code >> 8) & 0xff);
  }
  return [...set].sort((a, b) => a - b);
}

export const ARMOR_RANGE = { min: 1, max: 25 };
export const FACE_RANGE = { min: 0, max: 9 };
export const TIER_RANGE = { min: 0, max: 3 };

/* ─────────── 技能 ─────────── */

export interface SkillRow {
  def: SkillDef;
  /** saSkillData 动画索引；null = 无专属动画，运行时回退普攻动画 */
  animIndex: number | null;
}

export function skillsForJob(jobId: number): SkillRow[] {
  const classDir = CLASS_DIR[jobId];
  const list = SKILLS[classDir] ?? [];
  return list.map((def) => ({
    def,
    animIndex: SKILL_INDEX_BY_ICON[def.iconFile] ?? null,
  }));
}

/** 该职业"无专属动画"的技能占比（技能系统落地前必须知道的数字） */
export function skillAnimCoverage(jobId: number): { total: number; withAnim: number } {
  const rows = skillsForJob(jobId);
  return { total: rows.length, withAnim: rows.filter((r) => r.animIndex !== null).length };
}

/* ─────────── 动作 / 音效 ─────────── */

/** 动作态 → 中文说明（检查器显示用） */
export const MOTION_LABEL: Record<string, string> = {
  CHRMOTION_STATE_STAND: '站立',
  CHRMOTION_STATE_WALK: '走',
  CHRMOTION_STATE_RUN: '跑',
  CHRMOTION_STATE_ATTACK: '攻击',
  CHRMOTION_STATE_DAMAGE: '受击',
  CHRMOTION_STATE_DEAD: '死亡',
  CHRMOTION_STATE_SKILL: '技能',
  CHRMOTION_STATE_HAMMER: '锤击',
  CHRMOTION_STATE_WARP: '传送/消失',
  CHRMOTION_STATE_TAUNT: '挑衅',
  CHRMOTION_STATE_YAHOO: '欢呼',
  CHRMOTION_STATE_FALLDOWN: '倒地',
  CHRMOTION_STATE_FALLSTAND: '起身',
  CHRMOTION_STATE_FALLDAMAGE: '倒地受击',
  CHRMOTION_STATE_EAT: '进食',
  CHRMOTION_STATE_RESTART: '重生',
  CHRMOTION_STATE_SOMETIME: '待机动作',
};

/**
 * 玩家角色"核心状态"：缺失即视为动画缺口。
 * 其余状态（HAMMER/WARP/RESTART 等）以怪物/物件为主，玩家职业缺失属正常，不标红。
 */
export const CORE_PLAYER_STATES = new Set([
  'CHRMOTION_STATE_STAND',
  'CHRMOTION_STATE_WALK',
  'CHRMOTION_STATE_RUN',
  'CHRMOTION_STATE_ATTACK',
  'CHRMOTION_STATE_SKILL',
  'CHRMOTION_STATE_DAMAGE',
  'CHRMOTION_STATE_DEAD',
]);

export function motionLabel(state: string): string {
  return MOTION_LABEL[state] ?? state;
}

/** 玩家在某动作态下会播的音效文件（职业目录） */
export function playerMotionFiles(jobId: number, motion: MotionState): string[] {
  return sfxBank.playerFiles(jobId, motion);
}

export { sfxBank };
