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
  /** 动画区域位（对齐原版 StageVillage）：1=村庄 2=野外 3=任意（默认3，全部放行）。
   *  村庄态禁止战斗姿态：武器代码一律清零 → 只匹配空手动画；type 回退屏蔽；姿态强制 sheathed。 */
  getFieldState?: () => number;
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
  /** 武器更换后按当前状态重选动画实例（STAND/WALK/RUN 立即生效；攻击/技能等一次性状态不打断） */
  reselectForCurrentState: () => void;
}

export function createAnimStateMachine(opts: AnimStateMachineOpts): AnimStateMachine {
  const { getMotions, getClassId, getWeaponIdCode, getWeaponType, getFieldState, onStanceChange, onMotionChange, log: logFn } = opts;
  const log2 = logFn || ((msg: string) => console.log(msg));

  let currentState = STATE.STAND;
  let currentMotion: MotionInfo | null = null;
  let currentStance: 'combat' | 'sheathed' | null = null;

  function fieldState(): number {
    return getFieldState ? getFieldState() : 3;
  }

  function setStance(stance: 'combat' | 'sheathed') {
    if (currentStance !== stance) {
      currentStance = stance;
      if (onStanceChange) onStanceChange(stance);
    }
  }

  function findMotionForState(state: number, excludeCurrent: boolean): MotionInfo | null {
    const motions = getMotions();
    const classId = getClassId();
    const fs = fieldState();
    const village = fs === 1;
    const weaponId = village ? null : (getWeaponIdCode ? getWeaponIdCode() : null);
    let candidates = findMotions(motions, state, weaponId, classId, fs);
    let weaponMatched = candidates.length > 0;
    // 精确匹配无结果时，回退到类型匹配（对齐 pviewer：新武器无精确索引）。村庄态屏蔽类型回退（禁战斗）。
    if (!candidates.length && !village && getWeaponType) {
      const weaponType = getWeaponType();
      if (weaponType) {
        candidates = findMotionsByType(motions, state, weaponType, classId, fs);
        if (candidates.length > 0) weaponMatched = true;
      }
    }
    // 武器类型仍无匹配（如职业拿非本职业武器）时回退空手动画，保证角色有动作
    if (!candidates.length && weaponId != null && weaponId !== 0) {
      candidates = findMotions(motions, state, null, classId, fs);
    }
    // 有武器且未命中武器动画 → 空手姿态，武器应收起；否则战斗姿态。村庄态一律收武器姿态。
    if (village) {
      setStance('sheathed');
    } else if (weaponId != null && weaponId !== 0) {
      setStance(weaponMatched ? 'combat' : 'sheathed');
    }
    log2(`[anim] state=0x${state.toString(16)} field=${fs} weapon=${weaponId} type=${village ? 'null' : (getWeaponType ? getWeaponType() : '?')} candidates=${candidates.length} motions=${motions.length} (state-match=${motions.filter(m => m.state === state).length})`);
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

  /** 收集能播放指定 saSkillData 索引的 SKILL 动画（按 状态+职业+武器+skillCodeList 过滤）。
 *  村庄态武器清零；SKILL 动画多为 mp=2/3，村庄下选区自然为空 → 无技能动画。 */
  function motionsForSkill(skillIndex: number): MotionInfo[] {
    const motions = getMotions();
    const classId = getClassId();
    const fs = fieldState();
    const village = fs === 1;
    const weaponId = village ? null : (getWeaponIdCode ? getWeaponIdCode() : null);
    let candidates = findMotions(motions, STATE.SKILL, weaponId, classId, fs)
      .filter(m => Array.from(m.skillCodeList || []).includes(skillIndex));
    if (!candidates.length && !village && getWeaponType) {
      const weaponType = getWeaponType();
      if (weaponType) {
        candidates = findMotionsByType(motions, STATE.SKILL, weaponType, classId, fs)
          .filter(m => Array.from(m.skillCodeList || []).includes(skillIndex));
      }
    }
    // 武器仍无匹配 → 空手候选
    if (!candidates.length && weaponId != null && weaponId !== 0) {
      candidates = findMotions(motions, STATE.SKILL, null, classId, fs)
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

  /**
   * 武器更换后调用：按当前状态重新选择匹配当前武器的动画实例。
   * STAND/WALK/RUN 是持续姿势，武器不同姿势不同（持剑站姿 vs 持弓站姿）→ 立即重选；
   * ATTACK/SKILL/掉落等一次性动画不打断（播完 onAnimationEnd 回 STAND 时已用新武器重选）。
   */
  function reselectForCurrentState(): void {
    switch (currentState) {
      case STATE.STAND: triggerIdle(); break;
      case STATE.WALK: triggerWalk(); break;
      case STATE.RUN: triggerRun(); break;
      default: break; // 攻击/技能等一次性状态：不打断
    }
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
    reselectForCurrentState,
  };
}
