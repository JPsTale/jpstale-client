// 网络 → 状态 store 桥接：订阅 transport 的 proto 消息，映射进 gameStore。
// 这里不直接依赖 React；React 面板层通过 gameStore 只读。
import { onMessage, send } from './transport.js';
import { setShop, openPanel, setBuffs, setCraftOpen, setCraftPreview } from '../app/gameStore.js';
import {
  allocateStat,
  useSkill,
  inventoryMove,
  takeToHand,
  bagSwap,
  equipItem,
  dropItem,
  switchWeapon,
  pickupItem,
  bagLayout,
  stackMerge,
  useItem,
  npcInteract,
  shopBuy,
  shopSell,
  mixItem,
  ageItem,
  forceOrbItem,
  mixPreview,
  learnSkill,
  resetSkillPoints,
  setSkillBinding,
} from './protocol.js';
import type { jpt } from './proto/base_message.js';
import {
  setGameCharacter,
  setGamePlayer,
  setInventory,
  upsertInventoryItem,
  applyItemRemoved,
  setInventoryGold,
  setSkillList,
  setSkillBindings,
  getGameSnapshot,
  type GameCharacter,
  type GamePlayer,
  type GameItem,
} from '../app/gameStore.js';
import {
  BIND_KIND_FIST, BIND_KIND_QUICK, FIST_INDEX, QUICK_SLOT_COUNT, quickFistOf, quickSkillIdOf,
  type FistSlot,
} from '../game/skillBinding.js';
import { reportFallback } from '../char/fallback-log.js';

export function toGameCharacter(e: jpt.base.S2C_CharacterStatus.$Properties): GameCharacter {
  return {
    playerId: Number(e.playerId),
    name: e.name || '',
    job: e.job || 0,
    level: e.level || 1,
    exp: Number(e.exp) || 0,
    nextExp: Number(e.nextExp) || 0,
    levelExp: Number(e.levelExp) || 0,
    gold: Number(e.gold) || 0,
    strength: e.strength || 0,
    spirit: e.spirit || 0,
    talent: e.talent || 0,
    agility: e.agility || 0,
    health: e.health || 0,
    statePoint: e.statePoint || 0,
    skillPoint: e.skillPoint ?? 0,
    specialSkillPoint: e.specialSkillPoint ?? 0,
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
    currentWeight: e.currentWeight ?? 0,
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
    resEarth: e.resEarth || 0,
    resWater: e.resWater || 0,
    resWind: e.resWind || 0,
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
    kindCode: e.kindCode || 0,
    craftMask: e.craftMask || 0,
    mixEffects: (e.mixEffects || []).map((m) => ({
      key: m.key || '',
      value: Number(m.value) || 0,
      flat: !!m.flat,
    })),
    agingExp: Number(e.agingExp) || 0,
    agingExpMax: Number(e.agingExpMax) || 0,
    mixUniqueId: e.mixUniqueId || 0,
    agingProtect: e.agingProtect || 0,
    critical: e.critical || 0,
    range: e.range || 0,
    attackSpeed: e.attackSpeed || 0,
    manaRegen: e.manaRegen || 0,
    lifeRegen: e.lifeRegen || 0,
    staminaRegen: e.staminaRegen || 0,
    specAbsorb: e.specAbsorb || 0,
    specDefence: e.specDefence || 0,
    specSpeed: e.specSpeed || 0,
    specBlockRating: e.specBlockRating || 0,
    specAttackSpeed: e.specAttackSpeed || 0,
    specCritical: e.specCritical || 0,
    specShootingRange: e.specShootingRange || 0,
    specMagicMastery: e.specMagicMastery || 0,
    specResBionic: e.specResBionic || 0,
    specResEarth: e.specResEarth || 0,
    specResFire: e.specResFire || 0,
    specResIce: e.specResIce || 0,
    specResLighting: e.specResLighting || 0,
    specResPoison: e.specResPoison || 0,
    specResWater: e.specResWater || 0,
    specResWind: e.specResWind || 0,
    specLevMana: e.specLevMana || 0,
    specLevLife: e.specLevLife || 0,
    specLevAttackRating: e.specLevAttackRating || 0,
    specLevDamageMax: e.specLevDamageMax || 0,
    specLevResBionic: e.specLevResBionic || 0,
    specLevResEarth: e.specLevResEarth || 0,
    specLevResFire: e.specLevResFire || 0,
    specLevResIce: e.specLevResIce || 0,
    specLevResLighting: e.specLevResLighting || 0,
    specLevResPoison: e.specLevResPoison || 0,
    specLevResWater: e.specLevResWater || 0,
    specLevResWind: e.specLevResWind || 0,
    specPerManaRegen: e.specPerManaRegen || 0,
    specPerLifeRegen: e.specPerLifeRegen || 0,
    specPerStaminaRegen: e.specPerStaminaRegen || 0,
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
    if (msg.itemRemove) applyItemRemoved(Number(msg.itemRemove.uid) || 0);
    if (msg.itemRemovedUids && msg.itemRemovedUids.uids) {
      const ids = msg.itemRemovedUids.uids.map((u) => Number(u) || 0);
      for (const id of ids) applyItemRemoved(id);
    }
    if (msg.goldChange) setInventoryGold(Number(msg.goldChange.newGold) || 0);
    // 已学技能表（登录/学习/洗点后各来一次，**整表替换**）：面板的等级/熟练度只认这一份（AGENTS #12：
    // 表没到 ≠ 什么都没学 —— 存 null，面板据此**不点亮**，不拿角色等级推一个等级出来）
    if (msg.skillList) {
      const learned: Record<number, { point: number; mastery: number }> = {};
      for (const s of msg.skillList.skills || []) learned[Number(s.skillId) || 0] = { point: s.point || 0, mastery: s.mastery || 0 };
      setSkillList({
        learned,
        skillPoint: msg.skillList.skillPoint || 0,
        specialSkillPoint: msg.skillList.specialSkillPoint || 0,
      });
    }
    // 技能绑定表（登录/选角、学技能后、改绑定后）：**整表替换**，而且只认这一条消息
    // —— 客户端没有任何本地持久化，`null`（还没到）就是显式未知（AGENTS #12）。
    if (msg.skillBindings) {
      const b = msg.skillBindings;
      const quick = (b.quick || []).map((v) => Number(v) || 0);
      // 服务端**定长 8**（0 = 未绑）。长度不对 = 协议出问题 ⇒ 整表按未知处理并上报，
      // **不许**用 0 补长（那会把"服务端少发了几项"画成"这几个 F 键没绑"）。
      if (quick.length !== QUICK_SLOT_COUNT) {
        reportFallback('skill.bind.length',
          `S2C_SkillBindings.quick 长度 ${quick.length} ≠ ${QUICK_SLOT_COUNT} ⇒ 整表按未知处理（不补齐）`);
        setSkillBindings(null);
      } else {
        setSkillBindings({
          fistLeft: Number(b.fistLeft) || 0,
          fistRight: Number(b.fistRight) || 0,
          quick,
        });
      }
    }
    // buff 条（左上角）：整表替换；`at` 记本地接收时刻，倒计时以它为基准（见 BuffEntry 注释）
    if (msg.buffState) {
      const at = Date.now();
      setBuffs((msg.buffState.buffs || []).map((b) => ({
        itemCode: Number(b.itemCode) || 0,
        itemlistId: Number(b.itemlistId) || 0,
        remainingMs: Number(b.remainingMs) || 0,
        totalMs: Number(b.totalMs) || 0,
        stack: Number(b.stack) || 1,
        at,
      })));
    }
    // NPC 的打造窗口（合成/锻造/力量石）：由服务端指明这个 NPC 提供哪几档服务
    if (msg.craftOpen) {
      const c = msg.craftOpen;
      setCraftOpen(Number(c.entityId) || 0, (c.modes || []).map((m) => Number(m) || 0));
      openPanel('craft');
    }
    // 合成预览（服务端算好的 before/after；客户端只显示）
    if (msg.mixPreview) {
      const pv = msg.mixPreview;
      setCraftPreview({
        matched: !!pv.matched,
        reasonKey: pv.reasonKey || '',
        recipeName: pv.recipeName || '',
        effects: (pv.effects || []).map((e) => ({
          bit: Number(e.bit) || 0,
          key: e.key || '',
          value: Number(e.value) || 0,
          flat: !!e.flat,
          before: Number(e.before) || 0,
          after: Number(e.after) || 0,
          intField: !!e.intField,
        })),
      });
    }
    if (msg.shopOpen) {
      const o = msg.shopOpen;
      const items = (o.items || []).map((it) => ({
        itemlistId: Number(it.itemlistId) || 0,
        code: it.code || '',
        name: it.name || '',
        price: Number(it.price) || 0,
        kind: Number(it.kind) || 0,
      }));
      setShop(Number(o.entityId) || 0, items);
      openPanel('shop');
    }
  });
}

/** 角色属性分配（服务端权威）：stat ∈ strength/spirit/talent/agility/health/undo */
export function sendAllocateStat(stat: string, points = 1): void {
  send(allocateStat(stat, points));
}

/** 释放技能（服务端权威）：`skillId` = **数字技能 id**（`iconFile → skillId` 查表得来，见
 *  `game/skillIdentity.ts`）；`targetId` 默认 0，见 `protocol.useSkill`。 */
export function sendUseSkill(skillId: number, targetId = 0): void {
  send(useSkill(skillId, targetId));
}

/** 学/升级技能（服务端权威：判定 + 扣钱扣点；结果由 `S2C_SkillList`/`S2C_Error` 回来）。 */
export function sendLearnSkill(skillId: number): void {
  send(learnSkill(skillId));
}

/** 洗点（服务端权威：退点 + 清零；**会话内一次**，被拒回 `skill.op.resetUsed`）。 */
export function sendResetSkillPoints(): void {
  send(resetSkillPoints());
}

/* ─────────── 技能绑定（拳位 / F1~F8）：只发包，界面等 `S2C_SkillBindings` 回推 ─────────── */

/**
 * 改一个绑定（服务端权威）。`skillId` 0 = 解绑。
 * **不做乐观更新**：本地状态只由 `S2C_SkillBindings` 改（与学技能同口径）——
 * 服务端会校验（本职业/`useCode` 是否允许该位置），被拒回 `S2C_Error.key = skill.bind.*`。
 */
export function sendSkillBinding(kind: number, index: number, skillId: number): void {
  send(setSkillBinding(kind, index, skillId));
}

/** 把某技能装到某只拳（或 `0` = 恢复普通攻击）。 */
export function equipFistSkill(slot: FistSlot, skillId: number): void {
  sendSkillBinding(BIND_KIND_FIST, FIST_INDEX[slot], skillId);
}

/** 记录 F 键绑定（`index0` 0=F1；`skillId` 0 = 解掉该键）。 */
export function bindQuickKey(index0: number, skillId: number): void {
  sendSkillBinding(BIND_KIND_QUICK, index0 + 1, skillId);
}

/**
 * 按下 F1~F8（`index0` 0=F1）：把该键绑的技能装到它的拳上（**唯一实现**，`main.ts` 的按键分派调它）。
 *
 * 目标拳由 `game/skillBinding.quickFistOf` 判定；判不出来（`ALL` 类技能 / 表没到 / 未绑）⇒
 * **什么都不做**（返回 false，内部已上报）——不猜一只拳、不退化成"恢复普攻"。
 */
export function pressQuickKey(index0: number): boolean {
  const snap = getGameSnapshot();
  const skillId = quickSkillIdOf(snap.skillBindings, index0);
  if (skillId == null || skillId === 0) return false;   // 未知 / 该键未绑：都没有"要装的东西"
  const slot = quickFistOf(skillId, snap.skillBindings, snap.character?.job ?? null);
  if (slot == null) return false;
  equipFistSkill(slot, skillId);
  return true;
}

// —— 物品操作（服务端权威：位图校验 + DB 事务）——

export function sendInventoryMove(uid: number, toLocation: number, toSlot: number): void {
  send(inventoryMove(uid, toLocation, toSlot));
}

/** **换手**：手上那件 ↔ 背包里某件（原子）。A 还在手上时"先放下再拿起 B"在任何顺序下都会撞死，
 *  所以换手必须是一条消息。 */
export function sendBagSwap(handUid: number, targetUid: number, toLocation: number, toSlot: number): void {
  send(bagSwap(handUid, targetUid, toLocation, toSlot));
}

/** 点击世界里的 NPC（只报**实体 id**；服务端据此查定义/校验距离）。 */
export function sendNpcInteract(entityId: number): void {
    send(npcInteract(entityId));
}

export function sendShopBuy(entityId: number, itemlistId: number, count = 1): void {
    send(shopBuy(entityId, itemlistId, count));
}

export function sendShopSell(entityId: number, uid: number, count = 1): void {
    send(shopSell(entityId, uid, count));
}

/** 拿起。`count > 0` 且小于现有量 = **拆分**（只拿 count 个，余数留在原格，用户 2026-09-14）。 */
export function sendTakeToHand(uid: number, count = 0): void {
  send(takeToHand(uid, count));
}

export function sendEquipItem(uid: number, equipSlot: number): void {
  send(equipItem(uid, equipSlot));
}

/** 使用背包里的消耗品（右键）：服务端权威，客户端不做本地预扣 */
export function sendUseItem(uid: number, quantity = 1): void {
  send(useItem(uid, quantity));
}

export function sendDropItem(uid: number, count = 1): void {
  send(dropItem(uid, count));
}

/** 拾取地面物品。toHand 由调用方按"背包面板是否打开"给出（= 原版 `cInvenTory.OpenFlag` 的那个分支）：
 *  开着 → 拾取物直接上手（不等背包空格）；关着 → 自动进背包空格。 */
export function sendPickupItem(groundItemId: number, toHand: boolean): void {
  send(pickupItem(groundItemId, toHand));
}

/** 物品布局上报序号（客户端全局单调递增；服务端丢弃 seq<=lastSeq 的乱序/重放包） */
let bagLayoutSeq = 0;

/** 背包布局上报（客户端网格权威，全量快照 + 单调递增 seq）：
 * entries 为该次手势后的全部物品最终格子（含跨容器），seq 每次自增。 */
export function sendBagLayout(entries: { uid: number; location: number; slot: number }[]): void {
  send(bagLayout(++bagLayoutSeq, entries));
}

/** 药水堆叠合并 */
export function sendStackMerge(srcUid: number, dstUid: number): void {
  send(stackMerge(srcUid, dstUid));
}

export function sendSwitchWeapon(): void {
  send(switchWeapon());
}

// —— 打造（合成 / 锻造 / 力量石）：服务端权威 ——

/** 合成：目标装备 + 材料石（配方匹配与效果应用全在服务端）。 */
export function sendMixItem(targetUid: number, stoneUids: readonly number[]): void {
  send(mixItem(targetUid, stoneUids));
}

/** 锻造投石：目标装备 + 一颗材料石。 */
export function sendAgeItem(targetUid: number, stoneUid: number): void {
  send(ageItem(targetUid, stoneUid));
}

/** 力量大师：材料石 → 力量石。 */
export function sendForceOrbItem(stoneUids: readonly number[]): void {
  send(forceOrbItem(stoneUids));
}

/** 合成预览请求（服务端权威：配方匹配与数值都在服务端算）。 */
export function sendMixPreview(targetUid: number, stoneUids: readonly number[]): void {
  send(mixPreview(targetUid, stoneUids));
}
