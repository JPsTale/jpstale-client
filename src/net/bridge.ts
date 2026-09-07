// 网络 → 状态 store 桥接：订阅 transport 的 proto 消息，映射进 gameStore。
// 这里不直接依赖 React；React 面板层通过 gameStore 只读。
import { onMessage, send } from './transport.js';
import { allocateStat, useSkill } from './protocol.js';
import type { jpt } from './proto/base_message.js';
import {
  setGameCharacter,
  setGamePlayer,
  type GameCharacter,
  type GamePlayer,
} from '../app/gameStore.js';

export function toGameCharacter(e: jpt.base.S2C_CharacterStatus.$Properties): GameCharacter {
  return {
    playerId: Number(e.playerId),
    name: e.name || '',
    job: e.job || 0,
    level: e.level || 1,
    exp: Number(e.exp) || 0,
    nextExp: Number(e.nextExp) || 0,
    gold: Number(e.gold) || 0,
    strength: e.strength || 0,
    spirit: e.spirit || 0,
    talent: e.talent || 0,
    agility: e.agility || 0,
    health: e.health || 0,
    statePoint: e.statePoint || 0,
    hp: e.hp || 0,
    maxHp: e.maxHp || 0,
    mp: e.mp || 0,
    maxMp: e.maxMp || 0,
    sp: e.sp || 0,
    maxSp: e.maxSp || 0,
    attackMin: e.attackMin || 0,
    attackMax: e.attackMax || 0,
    attackRating: e.attackRating || 0,
    defense: e.defense || 0,
    absorption: e.absorption || 0,
    moveSpeed: e.moveSpeed || 0,
    walkSpeed: e.walkSpeed || 0,
    runSpeed: e.runSpeed || 0,
    attackSpeed: e.attackSpeed || 0,
    critical: e.critical || 0,
    block: e.block || 0,
    avoid: e.avoid || 0,
    shootingRange: e.shootingRange || 0,
    maxWeight: e.maxWeight || 0,
    resBionic: e.resBionic || 0,
    resPoison: e.resPoison || 0,
    resFire: e.resFire || 0,
    resLightning: e.resLightning || 0,
    resIce: e.resIce || 0,
    regenHp: typeof e.hpRegen === 'number' ? e.hpRegen : 0,
    regenMp: typeof e.mpRegen === 'number' ? e.mpRegen : 0,
    regenStm: typeof e.stmRegen === 'number' ? e.stmRegen : 0,
  };
}

export function toGamePlayer(e: jpt.base.S2C_PlayerState.$Properties): GamePlayer {
  return {
    name: e.playerName || '',
    level: Number(e.level) || 1,
    hp: e.hp || 0,
    maxHp: e.maxHp || 0,
    mp: e.mp || 0,
    maxMp: e.maxMp || 0,
    sp: e.sp || 0,
    maxSp: e.maxSp || 0,
    exp: Number(e.exp) || 0,
    nextExp: Number(e.nextExp) || 0,
    walkSpeed: typeof e.walkSpeed === 'number' ? e.walkSpeed : 0,
    runSpeed: typeof e.runSpeed === 'number' ? e.runSpeed : 0,
  };
}

export function installBridge(): void {
  onMessage((msg) => {
    if (msg.characterStatus) setGameCharacter(toGameCharacter(msg.characterStatus));
    if (msg.playerState) setGamePlayer(toGamePlayer(msg.playerState));
  });
}

/** 角色属性分配（服务端权威）：stat ∈ strength/spirit/talent/agility/health/undo */
export function sendAllocateStat(stat: string, points = 1): void {
  send(allocateStat(stat, points));
}

/** 释放技能（服务端权威）：skillId 见 protocol.useSkill 注释（当前为技能列表下标）；targetId 默认 0 */
export function sendUseSkill(skillId: number, targetId = 0): void {
  send(useSkill(skillId, targetId));
}