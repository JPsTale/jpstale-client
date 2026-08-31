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
import { findMotions, pickMotion } from './anim-match.js';

export const STATE: Record<string, number> = {
  STAND: 0x0040,
  WALK: 0x0050,
  RUN: 0x0060,
  SPRINT: 0x0070,
  FALLDOWN: 0x0080,
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
  onMotionChange: (motion: MotionInfo) => void;
  log?: (msg: string) => void;
}

export interface AnimStateMachine {
  STATE: typeof STATE;
  triggerAttack: () => boolean;
  triggerSkill: () => boolean;
  triggerWalk: () => boolean;
  triggerRun: () => boolean;
  triggerIdle: () => boolean;
  triggerTaunt: () => boolean;
  triggerYahoo: () => boolean;
  onAnimationEnd: () => MotionInfo | null;
  getCurrentState: () => number;
  getCurrentMotion: () => MotionInfo | null;
}

export function createAnimStateMachine(opts: AnimStateMachineOpts): AnimStateMachine {
  const { getMotions, getClassId, onMotionChange, log: logFn } = opts;
  const log2 = logFn || (() => {});

  let currentState = STATE.STAND;
  let currentMotion: MotionInfo | null = null;

  function findMotionForState(state: number, excludeCurrent: boolean): MotionInfo | null {
    const motions = getMotions();
    const classId = getClassId();
    let candidates = findMotions(motions, state, classId);
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

  function triggerAttack(): boolean {
    const motion = findMotionForState(STATE.ATTACK, true);
    if (!motion) { log2('No matching attack animation'); return false; }
    currentState = STATE.ATTACK;
    applyMotion(motion);
    log2('Attack: 0x' + motion.state.toString(16) + ' [' + motion.startFrame + ',' + motion.endFrame + ']');
    return true;
  }

  function triggerSkill(): boolean {
    const motion = findMotionForState(STATE.SKILL, true);
    if (!motion) { log2('No matching skill animation'); return false; }
    currentState = STATE.SKILL;
    applyMotion(motion);
    log2('Skill: 0x' + motion.state.toString(16) + ' [' + motion.startFrame + ',' + motion.endFrame + ']');
    return true;
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
        currentState === STATE.TAUNT || currentState === STATE.YAHOO) {
      return triggerIdle() ? currentMotion : null;
    }
    return null;
  }

  function getCurrentState(): number { return currentState; }
  function getCurrentMotion(): MotionInfo | null { return currentMotion; }

  return {
    STATE,
    triggerAttack,
    triggerSkill,
    triggerWalk,
    triggerRun,
    triggerIdle,
    triggerTaunt,
    triggerYahoo,
    onAnimationEnd,
    getCurrentState,
    getCurrentMotion,
  };
}
