/**
 * 资产检查器 —— 数据派生层（纯逻辑：无 DOM、无 three）。
 *
 * 把 ITEM_DEFS / skillData / SKILL_INDEX_BY_ICON / JOB_DATA / sfx 库
 * 组合成检查器各面板需要的选项与"这项资产到底有没有"的判定。
 */
import { ITEM_DEFS, type ItemDef } from '../../game/data/itemDefs.js';
import { CLASS_DIR, SKILLS, type SkillDef } from '../../game/skillData.js';
import { SKILL_INDEX_BY_ICON } from '../../game/data/skillIndexByIcon.js';
import skillIndexFromIn from '../../game/data/anim-in/skill-index-map.generated.json';
import itemsSupplementRaw from '../../game/data/items-supplement.generated.json';
import { JOB_DATA } from '../../render/char-loader.js';
import { getWeaponTypeFromIdCode, getHandType, getHandTypeFromIdCode } from '../../char/weapon-type.js';
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
  // 手别**优先读语义表**（honors 人工覆盖，与匹配器同源）；DB 的 class 只作兜底。
  // 曾直接用 def.class（DB 原始值）→ 选择器显示 2H 而匹配器按 1H（WS118 实测不一致）。
  const hand = (getHandTypeFromIdCode(def.code) ?? getHandType(def.class)) as HandType;
  const soundCode = weaponSoundCode(type, hand, isCaster, def.code);   // idcode：剑族判短剑要用低字
  return { def, type, hand, soundCode, soundFiles: sfxBank.weaponFiles(soundCode) };
}

/**
 * 补充物品（我方 ITEM_DEFS 缺失、来自 11 职业服务端 OpenItem 扫描的部分，
 * 含格斗家的 WV 拳套 36 条）。`class`/`pos` 等为派生值，见生成物里的 derived 标注。
 */
const ITEM_SUPPLEMENT = (itemsSupplementRaw as unknown as {
  items: Array<{ code: number; name: string; icon: string; folder: string; w: number; h: number; class: number; pos: number; sound: number; reqLv: number }>;
}).items;

/** 补充物品 → ItemDef 形状（id 用负值，避免与我方真实 uid 冲突） */
const SUPPLEMENT_DEFS: ItemDef[] = ITEM_SUPPLEMENT.map((o, i) => ({
  id: -(i + 1), code: o.code, name: o.name, icon: o.icon, folder: o.folder,
  w: o.w, h: o.h, class: o.class, pos: o.pos, sound: o.sound, reqLv: o.reqLv,
}));

/** 全部武器（按类型分组展示用）。含 .in/OpenItem 补出的新武器族（WV 拳套等）。 */
export function weaponOptions(isCaster: boolean): WeaponOption[] {
  return [...ITEM_DEFS, ...SUPPLEMENT_DEFS]
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
// 脸/档位范围由 char-loader 依**头部资产**推导（那里是唯一来源）。
// 曾在此各自写死 0..9 / 0..3 → 缺脸 11~13 与第 5 档（用户实测）。
export { FACE_RANGE, TIER_RANGE } from '../../render/char-loader.js';

/* ─────────── 技能 ─────────── */

export interface SkillRow {
  def: SkillDef;
  /** saSkillData 动画索引；null = 无专属动画，运行时回退普攻动画 */
  animIndex: number | null;
  /**
   * 该 animIndex 的证据来源：
   *   'runtime'  = 来自 skillIndexByIcon（现有运行时表）
   *   '/in-name' = 来自 .in 提案，且技能名匹配（强）
   *   'positional' = 来自 .in 提案，按职业代码块顺序推（中）
   */
  animIndexSrc: 'runtime' | '/in-name' | 'positional';
}

/** `.in` 提案：classDir → iconFile → { code, src } */
const IN_PROPOSAL = (skillIndexFromIn as unknown as {
  classes: Record<string, Array<{ iconFile: string; code: number | null; src: string }>>;
}).classes;

export function skillsForJob(jobId: number): SkillRow[] {
  const classDir = CLASS_DIR[jobId];
  const list = SKILLS[classDir] ?? [];
  const proposal = new Map((IN_PROPOSAL[classDir] ?? []).map((r) => [r.iconFile, r]));
  return list.map((def) => {
    // 现有表优先（运行时行为不变），缺的用 .in 提案补 —— 否则技能面板会把
    // 「表未覆盖到 198 以后」误报成「无专属动画」。
    const rt = SKILL_INDEX_BY_ICON[def.iconFile];
    if (rt != null) return { def, animIndex: rt, animIndexSrc: 'runtime' as const };
    const p = proposal.get(def.iconFile);
    if (p && p.code != null) {
      return { def, animIndex: p.code, animIndexSrc: p.src === '/in-name' ? '/in-name' as const : 'positional' as const };
    }
    return { def, animIndex: null, animIndexSrc: 'runtime' as const };
  });
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
