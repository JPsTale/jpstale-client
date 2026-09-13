/**
 * classItem（`gamedb.itemlist.classItem`）——**槽位位掩码**。
 *
 * 语义：**该物品能放进哪些槽位**的位集合（不是职业许可、不是堆叠标志、不是"装备大类"）。
 *
 * ⚠ 这是 **Java 侧 `org.jpstale.server.game.item.ItemClass` 的同一份定义**（改一边要改另一边）。
 * 权威来源：`NewSourcePT-2023/SrcGame/src/sinbaram/sinItem.h:16-32`（`INVENTORY_POS_*`）
 * 与同文件 `:35-46` 的原版语义别名（`ITEM_CLASS_WEAPON_ONE = RHAND`、
 * `ITEM_CLASS_WEAPON_TWO = RHAND|LHAND`、`ITEM_CLASS_POTION = POTION`）。
 *
 * 用途：① 判定物品能进哪个槽（服务端 `EquipSlots` / 客户端 `ItemPanel.slotAllows`）；
 *      ② 原版还用它做"位值 → 屏幕矩形"（`sinInvenTory.cpp:167-169` 的药水槽三格 =
 *         `(495,565)` 起、每格 26px，HUD 药水槽照此实现）。
 */
export const ITEM_CLASS = {
  // ---- 位值（与原版 sinItem.h:16-32 逐位一致；十六进制便于看出是哪一位）----
  BOX: 0x0001,          // 背包盒（原版保留位，无使用点）
  LHAND: 0x0002,        // 左手（副手）
  RHAND: 0x0004,        // 右手（主手）
  ARMOR: 0x0008,        // 铠甲/法袍
  BOOTS: 0x0010,        // 靴子
  GLOVES: 0x0020,       // 护手
  LRING: 0x0040,        // 左戒指
  RRING: 0x0080,        // 右戒指
  SHELTOM: 0x0100,      // 宝石
  AMULET: 0x0200,       // 项链
  ARMLET: 0x0800,       // 护腕/臂环（命中 + 药水槽容量）
  TWO_HAND_FLAG: 0x1000,// 原版保留位（**不是**双手判据！）
  POTION: 0x2000,       // 药水（快捷槽 ITEMSLOT 11/12/13）
  COSTUME: 0x4000,      // 时装
  WING_RIGHT: 0x8000,   // 右翼（原版保留，未启用）
  EARRING_L: 0x10000,   // 左耳环（原版保留，未启用）
  EARRING_R: 0x20000,   // 右耳环（原版保留，未启用）

  // ---- 语义别名（沿用原版命名与组合方式）----
  OFF_HAND: 0x0002,               // 副手 = LHAND
  ONE_HAND_WEAPON: 0x0004,        // 单手武器 = RHAND
  TWO_HAND_WEAPON: 0x0002 | 0x0004, // 双手武器 = RHAND|LHAND（同时占两格）
  RING: 0x0040 | 0x0080,          // 戒指（左或右）
  GEM: 0x0100,                    // 宝石 = SHELTOM
} as const;

export type ItemClassValue = (typeof ITEM_CLASS)[keyof typeof ITEM_CLASS];

/** 武器（单手或双手）。 */
export function isWeaponClass(c: number | undefined | null): boolean {
  return c === ITEM_CLASS.ONE_HAND_WEAPON || c === ITEM_CLASS.TWO_HAND_WEAPON;
}

/** 双手武器（副手必须空）。 */
export function isTwoHandWeaponClass(c: number | undefined | null): boolean {
  return c === ITEM_CLASS.TWO_HAND_WEAPON;
}

/** 药水（负重按瓶数、药水槽按瓶数堆叠）。 */
export function isPotionClass(c: number | undefined | null): boolean {
  return c === ITEM_CLASS.POTION;
}

/**
 * 能否堆叠 —— 与 Java `ItemClass.isStackable` **同一判据**：
 * 无槽位位值（0/1，材料/任务）与**药水**可堆叠，其余（装备类）不可。
 * ⚠ 药水**有**槽位位值但那是快捷槽，不是装备槽；漏判它曾导致背包药水无法合并。
 */
export function isStackable(c: number | undefined | null): boolean {
  return c == null || c === 0 || c === 1 || c === ITEM_CLASS.POTION;
}
