/**
 * 回复类物品（药水）的使用数值 —— 由 `scripts/extract-potion-effects.ts`（`npm run potions`）
 * 从 `gamedb.itemlist` 的 `recovery*` 三列生成。
 *
 * 为什么要单独一张表：物品实例（proto）只带攻击/防御/耐久这类**实例**字段，
 * 而"恢复多少"是**模板**字段（`ItemList.recoveryHpMin/Max…`），服务端使用时才读；
 * 客户端要在物品信息里显示，就得有一份同源的模板数据。
 * 判据与服务端 `ItemNetworkHandler.rollRecovery` 一致：三对列至少一个有值。
 */
import raw from './potion-effects.generated.json';

export interface PotionEffect {
  id: number;
  code: number;
  name: string;
  /** [min, max]；缺项 = 该资源不回复 */
  hp?: [number, number];
  mp?: [number, number];
  stm?: [number, number];
}

/** 生成的 JSON 里区间是普通数组（JSON 没有元组）→ 这里显式收成 [min, max] */
interface RawRow { id: number; code: number; name: string; hp?: number[]; mp?: number[]; stm?: number[]; }
const pair = (v?: number[]): [number, number] | undefined =>
  v && v.length >= 2 ? [v[0]!, v[1]!] : undefined;

const table = new Map<number, PotionEffect>();
for (const e of (raw as { items: RawRow[] }).items) {
  table.set(e.id, { id: e.id, code: e.code, name: e.name, hp: pair(e.hp), mp: pair(e.mp), stm: pair(e.stm) });
}

/** 按 itemlist.id（= proto `itemlist_id` = `ItemDef.id`）查；非回复类返回 null */
export function potionEffect(itemlistId: number): PotionEffect | null {
  return table.get(itemlistId) ?? null;
}
