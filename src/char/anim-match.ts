/**
 * 动画匹配器 — 根据 (状态, 职业) 从 .inx 动画条目中筛选适用条目
 *
 * 精确匹配逻辑严格依据 exm Character.cpp。
 */

import type { MotionInfo } from './char-format.js';
import { CLASS_FLAG } from './char-format.js';

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

export function findMotions(
  motions: MotionInfo[],
  state: number,
  classId: number,
): MotionInfo[] {
  return motions.filter(m => m.state === state && matchClass(m, classId));
}

export function pickMotion(candidates: MotionInfo[]): MotionInfo | null {
  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}
