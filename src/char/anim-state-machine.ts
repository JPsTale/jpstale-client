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
import { findMotions, findMotionsByType, pickMotion, pickSemanticMotion, type SemanticEntry } from './anim-match.js';
import { reportFallback } from './fallback-log.js';

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
  /** 当前武器单双手（语义匹配必需；缺省则按未知处理） */
  getHandType?: () => '1H' | '2H' | null;
  /** 该模型的**语义描述条目**（sidecar）。提供时优先走语义匹配（唯一实现）；
   *  未提供（如怪物/NPC 尚未迁移）则退回旧的 idcode/类型匹配路径。 */
  getSemanticEntries?: () => SemanticEntry[];
  /** 动画区域位（对齐原版 StageVillage）：1=村庄 2=野外 3=任意（默认3，全部放行）。
   *  村庄态禁止战斗姿态：武器代码一律清零 → 只匹配空手动画；type 回退屏蔽；姿态强制 sheathed。 */
  getFieldState?: () => number;
  /**
   * 变体选择种子（**实体级**，状态由本机混入）。
   *
   * 用途：**没有上报者的实体**（怪物/NPC —— 它们的动画是各客户端自己选的，没人能"上报自己播了哪条"），
   * 必须由"所有客户端都相同的输入"决定变体，否则同一只怪在每人屏幕上动作都不一样。
   * 玩家角色**不要**用它：玩家的动画条目由其客户端上报、服务端透传（见 WorldView.setRemoteAnim）。
   */
  getAnimSeed?: () => number;
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
  triggerIdle: (excludeCurrent?: boolean) => boolean;
  triggerDamage: () => boolean;
  /** 死亡：播 DEAD 动画并**停在末帧**（原版 `frame = (EndFrame-1)*160`），直到 resurrect() */
  triggerDead: () => boolean;
  /** 复活：解除死亡态回到站立（DEAD 是唯一需要"强制解除"的状态） */
  resurrect: () => boolean;
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
  const { getMotions, getClassId, getWeaponIdCode, getWeaponType, getHandType, getSemanticEntries, getFieldState, getAnimSeed, onStanceChange, onMotionChange, log: logFn } = opts;
  const log2 = logFn || ((_msg: string) => { /* 调试期日志默认关闭 */ });

  let currentState = STATE.STAND;
  let currentMotion: MotionInfo | null = null;
  let currentStance: 'combat' | 'sheathed' | null = null;

  function fieldState(): number {
    return getFieldState ? getFieldState() : 3;
  }

  /** 本次选择的变体种子（未提供 getAnimSeed → undefined = 随机，检查器/自机路径） */
  function variantSeed(state: number): number | undefined {
    if (!getAnimSeed) return undefined;
    return (getAnimSeed() ^ state) >>> 0;
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
    // ① 语义匹配优先（唯一实现在 anim-match.pickSemanticMotion）——
    //    玩家侧已有 sidecar；怪物/NPC 尚未迁移，entries 为空时走下面的旧链。
    const semEntries = getSemanticEntries ? getSemanticEntries() : [];
    const seed = variantSeed(state);
    if (semEntries.length) {
      const pick = pickSemanticMotion(motions, semEntries, {
        state,
        // 村庄 = 收械态：原版 `village → weaponId=null`，且 .in 里村庄条目 0 条列过武器。
        // 于是"收械"就是空手查询，不是"持械换姿势"——匹配器内部也会按 loc 再强制一次。
        weaponType: village ? null : (getWeaponType ? getWeaponType() : null),
        hand: village ? null : (getHandType ? getHandType() : null),
        classId,
        location: village ? 'village' : 'field',
        random: true,          // 在同等候选间取一条变体（原版行为）
        seed,                  // 有种子 → 确定性（无上报者的实体必须给，见 getAnimSeed）
      });
      if (pick.motion) {
        if (village) setStance('sheathed');
        else if (weaponId != null && weaponId !== 0) setStance('combat');
        log2(`[anim] 语义 state=0x${state.toString(16)} ${pick.why}`);
        let c = [pick.motion];
        if (excludeCurrent && currentMotion && c.length > 1) c = c.filter((m) => m !== currentMotion);
        return c[0] ?? null;
      }
      log2(`[anim] 语义未命中（${pick.why}）→ 回退旧链`);
      reportFallback('anim', `state=0x${state.toString(16)} 语义未命中（${pick.why}）→ 回退旧 idcode 匹配链`);
    }
    let candidates = findMotions(motions, state, weaponId, classId, fs);
    let weaponMatched = candidates.length > 0;
    const tag = `state=0x${state.toString(16)} weapon=${weaponId} type=${village ? 'null' : (getWeaponType ? getWeaponType() : '?')}`;
    // 精确匹配无结果时，回退到类型匹配（对齐 pviewer：新武器无精确索引）。村庄态屏蔽类型回退（禁战斗）。
    if (!candidates.length && !village && getWeaponType) {
      const weaponType = getWeaponType();
      if (weaponType) {
        candidates = findMotionsByType(motions, state, weaponType, classId, fs);
        if (candidates.length > 0) {
          weaponMatched = true;
          reportFallback('anim', `${tag} 无该 idcode 的精确条目 → 按类型 ${weaponType} 匹配`);
        }
      }
    }
    // 武器类型仍无匹配（如职业拿非本职业武器）时回退空手动画，保证角色有动作
    if (!candidates.length && weaponId != null && weaponId !== 0) {
      candidates = findMotions(motions, state, null, classId, fs);
      reportFallback('anim', `${tag} 该武器类型也无条目 → 回退空手动画`);
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
    return pickMotion(candidates, seed);
  }

  function applyMotion(motion: MotionInfo | null): boolean {
    if (!motion) return false;
    currentMotion = motion;
    onMotionChange(motion);
    return true;
  }

  /**
   * 不可被"站姿同步"打断的状态：一次性动画 + **死亡**。
   * DEAD 比一次性更强 —— 它不是"播完回站"，而是**停住等复活消息**（见 onAnimationEnd）。
   */
  function isOneShotState(state: number): boolean {
    return state === STATE.ATTACK || state === STATE.SKILL ||
      state === STATE.DAMAGE || state === STATE.TAUNT || state === STATE.YAHOO ||
      state === STATE.FALLSTAND || state === STATE.FALLDAMAGE ||
      state === STATE.DEAD;
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
   * @param skillIndex saSkillData 索引（0 起）；匹配 `.inx` SKILL 条目的 skillCodeList。
   * @returns true = 已播该技能的**专属**动画；false = 没有专属动画（调用方按原版行为播普攻）。
   *
   * ⚠ 这里**不再**"随便挑一条 SKILL 动画"充数：那会把"无专属动画"伪装成"正常播放"，
   *   让人无法判断看到的是不是真的（用户实测的误解来源）。两种情况分开处理：
   *     · `skillIndex == null`（调用方没给索引）→ 取该状态任一条，并**上报降级**；
   *     · 给了索引但查不到专属动画 → **返回 false**，由调用方播普攻（原版行为，且会上报）。
   */
  function triggerSkill(skillIndex?: number | null): boolean {
    if (skillIndex == null) {
      const m = findMotionForState(STATE.SKILL, false);
      if (!m) { reportFallback('skill', '未给技能索引且该状态下无任何 SKILL 动画'); return false; }
      currentState = STATE.SKILL;
      applyMotion(m);
      reportFallback('skill', `未给技能索引 → 任取一条 SKILL 动画（${m.startFrame}-${m.endFrame}）`);
      return true;
    }
    const candidates = motionsForSkill(skillIndex);
    if (!candidates.length) {
      reportFallback('skill', `技能 #${skillIndex} 无专属动画 → 交给调用方播普攻（原版行为）`);
      return false;
    }
    // 取候选里 index 最小的一条（**确定性**，便于复现；变体随机是服务端职责，见 plans）
    const m = candidates.reduce((a, b) => (b.index < a.index ? b : a));
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

  function triggerIdle(excludeCurrent = false): boolean {
    // 一次性态（ATTACK/SKILL/DAMAGE 等）不回 STAND：STAND 同步包/自然停步不掐断挥拳与受击
    if (isOneShotState(currentState)) return false;
    const motion = findMotionForState(STATE.STAND, excludeCurrent);
    if (!motion) return false;
    currentState = STATE.STAND;
    applyMotion(motion);
    return true;
  }

  /**
   * 受击硬直（对齐 exm character.cpp:8459）：
   * 伤害>1 且当前状态 ∉ {DAMAGE, EAT, ATTACK, SKILL} → 切到 DAMAGE；
   * 攻击/技能/吃喝中不打断，已在受击中不重播；无 DAMAGE 动画数据则安全回退（不播）。
   */
  function triggerDamage(): boolean {
    if (currentState === STATE.DAMAGE || currentState === STATE.EAT ||
        currentState === STATE.ATTACK || currentState === STATE.SKILL) {
      return false;
    }
    const motion = findMotionForState(STATE.DAMAGE, false);
    if (!motion) { log2('No matching damage animation'); return false; }
    currentState = STATE.DAMAGE;
    applyMotion(motion);
    log2('Damage: 0x' + motion.state.toString(16) + ' [' + motion.startFrame + ',' + motion.endFrame + ']');
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

  /**
   * 死亡：播 DEAD 动画并**停在末帧**（原版 `playsub.cpp` 死亡分支
   * `frame = (MotionInfo->EndFrame - 1) * 160`）—— 尸体不起身，等复活消息。
   * 找不到 DEAD 条目时**不静默播别的动作**（纠错 #12），返回 false 由调用方决定。
   */
  function triggerDead(): boolean {
    const motion = findMotionForState(STATE.DEAD, false);
    if (!motion) {
      reportFallback('anim', '该模型没有 DEAD 动画条目 → 死亡无躺下动作（仅停止操作）');
      return false;
    }
    currentState = STATE.DEAD;
    applyMotion(motion);
    return true;
  }

  /** 复活：强制回到站立（DEAD 不走 triggerIdle 的守卫，必须显式解除） */
  function resurrect(): boolean {
    if (currentState !== STATE.DEAD) return true;
    return toStand();
  }

  function onAnimationEnd(): MotionInfo | null {
    // 死亡：停在末帧（原版把 frame 钉在 EndFrame-1），不自动回 STAND
    if (currentState === STATE.DEAD) return null;
    if (isOneShotState(currentState)) { // 含 DAMAGE（受击播完回 STAND）
      return toStand() ? currentMotion : null;
    }
    return null;
  }

  /** 内部专用：从任意一次性态回 STAND（不走 triggerIdle 的守卫） */
  function toStand(): boolean {
    const motion = findMotionForState(STATE.STAND, false);
    if (!motion) return false;
    currentState = STATE.STAND;
    applyMotion(motion);
    return true;
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
    triggerDamage,
    triggerDead,
    resurrect,
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
