// 物品容器/槽位常量（对齐服务端 ItemLocations，design-背包装备系统 v0.2）
// location 十进制分段：0=装备栏 1=副装备栏 10=背包页(12×12) 30=仓库页(9×9)
// v1 只启用：0 / 1 / 10 / 30

export const LOC = {
  EQUIP: 0,          // 装备栏：slot 1~13 命名槽
  BACKUP_EQUIP: 1,   // 副装备栏（第二套武器）：slot 与装备栏一致，不计负重
  BAG: 10,           // 背包页1：12×12，slot 0~143（y*12+x）
  BAG_W: 12,
  BAG_H: 12,
  WAREHOUSE: 30,     // 仓库页1：9×9，slot 0~80（y*9+x）
  WH_W: 9,
  WH_H: 9,
} as const;

export type LocTuple = typeof LOC;

/**
 * **鼠标位（手持位）**：`装备栏(location = LOC.EQUIP) 的 slot = -1`。
 *
 * 与服务端 `ItemLocations.HELD_SLOT` 同一个值、同一套语义（改一边要改另一边）：
 * "鼠标拿起来还没放下"的那一件就存在这里 —— 它**不是**一个槽位（真实装备槽是 1~13），
 * 也不占背包格。服务端因此能在拿起瞬间就撤掉装备效果，并且断线重连后原样恢复"手上还拿着它"。
 */
export const HELD_SLOT = -1;

/** 这件物品是否正被鼠标拿着（= 装备栏的 -1 号槽）。**唯一判据**，别在别处再写一遍。 */
export function isHeldItem(it: { location: number; slot: number } | null | undefined): boolean {
  return !!it && it.location === LOC.EQUIP && it.slot === HELD_SLOT;
}

export function isBag(location: number): boolean {
  return location >= 10 && location < 20;
}

export function isWarehouse(location: number): boolean {
  return location >= 30 && location < 40;
}

export function isEquip(location: number): boolean {
  return location === LOC.EQUIP || location === LOC.BACKUP_EQUIP;
}

/** 画布宽平方：背包 12×12 / 仓库 9×9；非画布返回 0 */
export function canvasDim(location: number): { w: number; h: number } | null {
  if (isBag(location)) return { w: LOC.BAG_W, h: LOC.BAG_H };
  if (isWarehouse(location)) return { w: LOC.WH_W, h: LOC.WH_H };
  return null;
}