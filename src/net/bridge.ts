// 网络 → 状态 store 桥接：订阅 transport 的 proto 消息，映射进 gameStore。
// 这里不直接依赖 React；React 面板层通过 gameStore 只读。
import { onMessage, send } from './transport.js';
import {
  allocateStat,
  useSkill,
  inventoryMove,
  equipItem,
  unequipItem,
  dropItem,
  switchWeapon,
  pickupItem,
} from './protocol.js';
import type { jpt } from './proto/base_message.js';
import {
  setGameCharacter,
  setGamePlayer,
  setInventory,
  upsertInventoryItem,
  removeInventoryItem,
  setInventoryGold,
  type GameCharacter,
  type GamePlayer,
  type GameItem,
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
    skillPoint: (e as unknown as { skillPoint?: number }).skillPoint ?? 0,
    specialSkillPoint: (e as unknown as { specialSkillPoint?: number }).specialSkillPoint ?? 0,
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

export function toGameItem(e: jpt.base.ItemProto.$Properties): GameItem {
  return {
    uid: Number(e.uid) || 0,
    itemlistId: e.itemlistId || 0,
    itemCode: e.itemCode || 0,
    location: e.location || 0,
    slot: e.slot || 0,
    count: e.count || 1,
    durability: e.durability || 0,
    durabilityMax: e.durabilityMax || 0,
    damageMin: e.damageMin || 0,
    damageMax: e.damageMax || 0,
    attackRating: e.attackRating || 0,
    defence: e.defence || 0,
    blockRating: e.blockRating || 0,
    absorb: e.absorb || 0,
    speed: e.speed || 0,
    resBionic: e.resBionic || 0,
    resFire: e.resFire || 0,
    resIce: e.resIce || 0,
    resLightning: e.resLighting || 0,
    resPoison: e.resPoison || 0,
    increaseLife: e.increaseLife || 0,
    increaseMana: e.increaseMana || 0,
    increaseStamina: e.increaseStamina || 0,
    reqLevel: e.reqLevel || 0,
    reqStrength: e.reqStrength || 0,
    reqSpirit: e.reqSpirit || 0,
    reqTalent: e.reqTalent || 0,
    reqAgility: e.reqAgility || 0,
    reqHealth: e.reqHealth || 0,
    price: e.price || 0,
    jobCodeMask: e.jobCodeMask || 0,
    agingLevel: e.agingLevel || 0,
    critical: e.critical || 0,
    range: e.range || 0,
  };
}

export function installBridge(): void {
  onMessage((msg) => {
    if (msg.characterStatus) setGameCharacter(toGameCharacter(msg.characterStatus));
    if (msg.playerState) setGamePlayer(toGamePlayer(msg.playerState));
    // 物品：进图快照 / 单件增量 / 移除 / 金币
    if (msg.inventorySnapshot) {
      const it = msg.inventorySnapshot;
      setInventory({
        items: (it.items || []).map(toGameItem),
        gold: Number(it.gold) || 0,
      });
    }
    if (msg.itemUpdate && msg.itemUpdate.item) upsertInventoryItem(toGameItem(msg.itemUpdate.item));
    if (msg.itemRemove) removeInventoryItem(Number(msg.itemRemove.uid) || 0);
    if (msg.goldChange) setInventoryGold(Number(msg.goldChange.newGold) || 0);
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

// —— 物品操作（服务端权威：位图校验 + DB 事务）——

export function sendInventoryMove(uid: number, toLocation: number, toSlot: number): void {
  send(inventoryMove(uid, toLocation, toSlot));
}

export function sendEquipItem(uid: number, equipSlot: number): void {
  send(equipItem(uid, equipSlot));
}

export function sendUnequipItem(equipSlot: number): void {
  send(unequipItem(equipSlot));
}

export function sendDropItem(uid: number, count = 1): void {
  send(dropItem(uid, count));
}

export function sendPickupItem(groundItemId: number): void {
  send(pickupItem(groundItemId));
}

export function sendSwitchWeapon(): void {
  send(switchWeapon());
}