/**
 * 动画匹配器 — 根据 (状态, 职业) 从 .inx 动画条目中筛选适用条目
 *
 * 精确匹配逻辑严格依据 exm Character.cpp。
 */

import type { MotionInfo } from './char-format.js';
import { CLASS_FLAG } from './char-format.js';
import { SITEM_CODE_BY_INDEX } from './sitem-weapon-index.js';
import { getWeaponTypeFromSItemIndex } from './weapon-type.js';

export function classIdToFlag(classId: number): number {
  const map: Record<number, number> = {
    1: CLASS_FLAG.Fighter, 2: CLASS_FLAG.Mechanician, 3: CLASS_FLAG.Archer,
    4: CLASS_FLAG.Pikeman, 5: CLASS_FLAG.Atalanta, 6: CLASS_FLAG.Knight,
    7: CLASS_FLAG.Magician, 8: CLASS_FLAG.Priestess, 9: CLASS_FLAG.Assassin,
    10: CLASS_FLAG.Shaman,
  };
  return map[classId] || 0;
}

function matchClass(motion: MotionInfo, classId: number): boolean {
  if (!motion.dwJobCodeBit) return true;
  const classBit = classIdToFlag(classId);
  return (motion.dwJobCodeBit & classBit) !== 0;
}

/**
 * 按武器精确匹配动画条目的 itemCodeList 白名单（对齐 pviewer anim-match.js）。
 * 空手(weaponIdCode=0/null)：白名单须含空手哨兵 0xFFFF。
 * 具体武器：SITEM_CODE_BY_INDEX[idx] === weaponIdCode 精确命中。
 */
function matchWeapon(motion: MotionInfo, weaponIdCode: number | null): boolean {
  const count = motion.itemCodeCount;
  if (count <= 0) return true;
  if (weaponIdCode == null || weaponIdCode === 0) {
    for (let i = 0; i < count && i < 52; i++) {
      if (motion.itemCodeList[i] === 0xFFFF) return true;
    }
    return false;
  }
  for (let i = 0; i < count && i < 52; i++) {
    const idx = motion.itemCodeList[i];
    if (SITEM_CODE_BY_INDEX[idx] === weaponIdCode) return true;
  }
  return false;
}

/**
 * 按武器类型匹配：动画条目白名单中是否有同类型的武器。
 * 解决新武器无精确索引（SITEM_CODE_BY_INDEX）时的匹配问题。
 */
function matchWeaponByType(motion: MotionInfo, weaponType: string | null): boolean {
  const count = motion.itemCodeCount;
  if (count <= 0) return true;
  if (weaponType == null || weaponType === 'BARE_HAND') {
    for (let i = 0; i < count && i < 52; i++) {
      if (motion.itemCodeList[i] === 0xFFFF) return true;
    }
    return false;
  }
  for (let i = 0; i < count && i < 52; i++) {
    const t = getWeaponTypeFromSItemIndex(motion.itemCodeList[i]);
    if (t === weaponType) return true;
  }
  return false;
}

export function findMotions(
  motions: MotionInfo[],
  state: number,
  weaponIdCode: number | null,
  classId: number,
): MotionInfo[] {
  return motions.filter(m => m.state === state && matchClass(m, classId) && matchWeapon(m, weaponIdCode));
}

/**
 * 按武器类型匹配（语义化）：新武器无精确索引时用类型匹配。
 * @param weaponType 'AXE'|'BOW'|...|'BARE_HAND' 等
 */
export function findMotionsByType(
  motions: MotionInfo[],
  state: number,
  weaponType: string | null,
  classId: number,
): MotionInfo[] {
  return motions.filter(m => m.state === state && matchClass(m, classId) && matchWeaponByType(m, weaponType));
}

export function pickMotion(candidates: MotionInfo[]): MotionInfo | null {
  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}
