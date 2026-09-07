/**
 * Animation State Machine — manages state transitions, combo attacks
 *
 * Core logic based on exm Character.cpp:
 *  - animation end → return to Idle (non-looping states)
 *  - distance-driven Walk/Run transitions
 *
 * State transitions:
 *   STAND → WALK/RUN (distance) → STAND (close)
 *   STAND → ATTACK (attack) → STAND (attack ends)
 *   STAND → SKILL (skill) → STAND (skill ends)
 *   Any non-looping state ends → return to STAND
 */

import type { MotionInfo } from './char-format.js';
import { findMotions, findMotionsByType, pickMotion } from './anim-match.js';

export const STATE: Record<string, number> = {
  STAND: 0x0040,
  WALK: 0x0050,
  RUN: 0x0060,
  SPRINT: 0x0070,
  FALLDOWN: 0x0080,
  FALLSTAND: 0x0170,
  FALLDAMAGE: 0x0180,
  ATTACK: 0x0100,
  DAMAGE: 0x0110,
  DEAD: 0x0120,
  EAT: 0x0140,
  SKILL: 0x0150,
  YAHOO: 0x0220,
  TAUNT: 0x0230,
};

export interface AnimStateMachineOpts {
  getMotions: () => MotionInfo[];
  getClassId: () => number;
  /** 当前武器 idcode（null/0=空手） */
  getWeaponIdCode?: () => number | null;
  /** 当前武器类型（'AXE'|'BOW'|...），精确匹配无结果时回退类型匹配 */
  getWeaponType?: () => string | null;
  /** 武器姿态变化：'combat'=武器有匹配动画（手持）；'sheathed'=回退空手动画（应收起） */
  onStanceChange?: (stance: 'combat' | 'sheathed') => void;
  onMotionChange: (motion: MotionInfo) => void;
  log?: (msg: string) => void;
}

export interface AnimStateMachine {
  STATE: typeof STATE;
  triggerAttack: (retry?: boolean) => boolean;
  triggerSkill: (skillIndex?: number | null) => boolean;
  triggerWalk: () => boolean;
  triggerRun: () => boolean;
  triggerIdle: () => boolean;
  triggerFallDown: () => boolean;
  triggerFallStand: () => boolean;
  triggerFallDamage: () => boolean;
  triggerTaunt: () => boolean;
  triggerYahoo: () => boolean;
  onAnimationEnd: () => MotionInfo | null;
  getCurrentState: () => number;
  getCurrentMotion: () => MotionInfo | null;
  playMotion: (motion: MotionInfo | null) => boolean;
}

export function createAnimStateMachine(opts: AnimStateMachineOpts): AnimStateMachine {
  const { getMotions, getClassId, getWeaponIdCode, getWeaponType, onStanceChange, onMotionChange, log: logFn } = opts;
  const log2 = logFn || ((msg: string) => console.log(msg));

  let currentState = STATE.STAND;
  let currentMotion: MotionInfo | null = null;
  let currentStance: 'combat' | 'sheathed' | null = null;

  function setStance(stance: 'combat' | 'sheathed') {
    if (currentStance !== stance) {
      currentStance = stance;
      if (onStanceChange) onStanceChange(stance);
    }
  }

  function findMotionForState(state: number, excludeCurrent: boolean): MotionInfo | null {
    const motions = getMotions();
    const classId = getClassId();
    const weaponId = getWeaponIdCode ? getWeaponIdCode() : null;
    let candidates = findMotions(motions, state, weaponId, classId);
    let weaponMatched = candidates.length > 0;
    // 精确匹配无结果时，回退到类型匹配（对齐 pviewer：新武器无精确索引）
    if (!candidates.length && getWeaponType) {
      const weaponType = getWeaponType();
      if (weaponType) {
        candidates = findMotionsByType(motions, state, weaponType, classId);
        if (candidates.length > 0) weaponMatched = true;
      }
    }
    // 武器类型仍无匹配（如职业拿非本职业武器）时回退空手动画，保证角色有动作
    if (!candidates.length && weaponId != null && weaponId !== 0) {
      candidates = findMotions(motions, state, null, classId);
    }
    // 有武器且未命中武器动画 → 空手姿态，武器应收起；否则战斗姿态
    if (weaponId != null && weaponId !== 0) {
      setStance(weaponMatched ? 'combat' : 'sheathed');
    }
    log2(`[anim] state=0x${state.toString(16)} weapon=${weaponId} type=${getWeaponType ? getWeaponType() : '?'} candidates=${candidates.length} motions=${motions.length} (state-match=${motions.filter(m => m.state === state).length})`);
    if (excludeCurrent && currentMotion && candidates.length > 1) {
      candidates = candidates.filter(m => m !== currentMotion);
    }
    return pickMotion(candidates);
  }

  function applyMotion(motion: MotionInfo | null): boolean {
    if (!motion) return false;
    currentMotion = motion;
    onMotionChange(motion);
    return true;
  }

  function triggerAttack(retry: boolean = false): boolean {
    // retry=true：允许选中与当前相同的攻击动画（怪物每刀重发 ANIM_ATTACK 时从头重播），
    // 不排除 currentMotion，保证周期攻击每刀都有挥击动作。
    const motion = findMotionForState(STATE.ATTACK, !retry);
    if (!motion) { log2('No matching attack animation'); return false; }
    currentState = STATE.ATTACK;
    applyMotion(motion);
    log2('Attack: 0x' + motion.state.toString(16) + ' [' + motion.startFrame + ',' + motion.endFrame + ']');
    return true;
  }

  /**
   * 触发技能动画。
   * @param skillIndex saSkillData 索引（0 起）；匹配 .inx SKILL 条目 skillCodeList。
   *   null/undefined：退化为任意 SKILL 动画（历史行为）。
   *   指定但无专属动画：返回 false，调用方（WorldView）回退普攻动画。
   */
  function triggerSkill(skillIndex?: number | null): boolean {
    let candidates: MotionInfo[] = [];
    if (skillIndex != null) {
      candidates = motionsForSkill(skillIndex);
    }
    if (!candidates.length) {
      const m = findMotionForState(STATE.SKILL, true);
      if (!m) { log2('No matching skill animation'); return false; }
      currentState = STATE.SKILL;
      applyMotion(m);
      log2('Skill(any): 0x' + m.state.toString(16) + ' [' + m.startFrame + ',' + m.endFrame + ']');
      return true;
    }
    const m = pickMotion(candidates);
    if (!m) return false;
    currentState = STATE.SKILL;
    applyMotion(m);
    log2('Skill #' + skillIndex + ': 0x' + m.state.toString(16) + ' [' + m.startFrame + ',' + m.endFrame + ']' + ' items=' + m.itemCodeCount);
    return true;
  }

  /** 收集能播放指定 saSkillData 索引的 SKILL 动画（按 状态+职业+武器+skillCodeList 过滤） */
  function motionsForSkill(skillIndex: number): MotionInfo[] {
    const motions = getMotions();
    const classId = getClassId();
    const weaponId = getWeaponIdCode ? getWeaponIdCode() : null;
    let candidates = findMotions(motions, STATE.SKILL, weaponId, classId)
      .filter(m => Array.from(m.skillCodeList || []).includes(skillIndex));
    if (!candidates.length && getWeaponType) {
      const weaponType = getWeaponType();
      if (weaponType) {
        candidates = findMotionsByType(motions, STATE.SKILL, weaponType, classId)
          .filter(m => Array.from(m.skillCodeList || []).includes(skillIndex));
      }
    }
    // 武器仍无匹配 → 空手候选
    if (!candidates.length && weaponId != null && weaponId !== 0) {
      candidates = findMotions(motions, STATE.SKILL, null, classId)
        .filter(m => Array.from(m.skillCodeList || []).includes(skillIndex));
    }
    return candidates;
  }

  function triggerWalk(): boolean {
    const motion = findMotionForState(STATE.WALK, false);
    if (!motion) return false;
    currentState = STATE.WALK;
    applyMotion(motion);
    return true;
  }

  function triggerRun(): boolean {
    const motion = findMotionForState(STATE.RUN, false);
    if (!motion) return false;
    currentState = STATE.RUN;
    applyMotion(motion);
    return true;
  }

  function triggerIdle(): boolean {
    const motion = findMotionForState(STATE.STAND, false);
    if (!motion) return false;
    currentState = STATE.STAND;
    applyMotion(motion);
    return true;
  }

  function triggerFallDown(): boolean {
    const motion = findMotionForState(STATE.FALLDOWN, false);
    if (!motion) return false;
    currentState = STATE.FALLDOWN;
    applyMotion(motion);
    return true;
  }

  function triggerFallStand(): boolean {
    const motion = findMotionForState(STATE.FALLSTAND, false);
    if (!motion) return false;
    currentState = STATE.FALLSTAND;
    applyMotion(motion);
    return true;
  }

  function triggerFallDamage(): boolean {
    const motion = findMotionForState(STATE.FALLDAMAGE, false);
    if (!motion) return false;
    currentState = STATE.FALLDAMAGE;
    applyMotion(motion);
    return true;
  }

  function triggerTaunt(): boolean {
    const motion = findMotionForState(STATE.TAUNT, false);
    if (!motion) { log2('No matching taunt animation'); return false; }
    currentState = STATE.TAUNT;
    applyMotion(motion);
    return true;
  }

  function triggerYahoo(): boolean {
    const motion = findMotionForState(STATE.YAHOO, false);
    if (!motion) { log2('No matching yahoo animation'); return false; }
    currentState = STATE.YAHOO;
    applyMotion(motion);
    return true;
  }

  function onAnimationEnd(): MotionInfo | null {
    if (currentState === STATE.ATTACK || currentState === STATE.SKILL ||
        currentState === STATE.TAUNT || currentState === STATE.YAHOO ||
        currentState === STATE.FALLSTAND || currentState === STATE.FALLDAMAGE) {
      return triggerIdle() ? currentMotion : null;
    }
    return null;
  }

  function getCurrentState(): number { return currentState; }
  function getCurrentMotion(): MotionInfo | null { return currentMotion; }

  // 直接播放指定动画（调试用），不经过状态机随机选择
  function playMotion(motion: MotionInfo | null): boolean {
    if (!motion) return false;
    currentMotion = motion;
    currentState = motion.state;
    onMotionChange(motion);
    return true;
  }

  return {
    STATE,
    triggerAttack,
    triggerSkill,
    triggerWalk,
    triggerRun,
    triggerIdle,
    triggerFallDown,
    triggerFallStand,
    triggerFallDamage,
    triggerTaunt,
    triggerYahoo,
    onAnimationEnd,
    getCurrentState,
    getCurrentMotion,
    playMotion,
  };
}
