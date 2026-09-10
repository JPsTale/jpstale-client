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
  HELD: -1,          // 手持中（本地抽离，不上报；随放下/装备上报其最终格子）
} as const;

export type LocTuple = typeof LOC;

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