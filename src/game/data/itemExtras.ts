/**
 * 物品**模板附加信息**查表：药水槽容量 / 重量 / 药水堆叠上限。
 *
 * 数据来源：`item-extras.generated.json`（`scripts/extract-item-extras.ts`，`npm run item-extras`），
 * 取自 `gamedb.itemlist` 的 `potionspace` / `weight` / `potioncount`。
 *
 * 为什么不在 proto 里：这三项是**模板列**，物品实例（`userdb.item`）根本没有它们
 * （与 `potionEffects.ts` 的"恢复数值"同一类问题、同一套解法）。
 * 服务端侧 `weight` 由模板直接算负重、`potionspace` 尚无消费方（装备系统的药水槽扩容未做），
 * 所以本表**只用于显示**，不参与任何判定。
 */
import raw from './item-extras.generated.json';

export interface ItemExtras {
  id: number;
  /** 药水槽容量：装备后每个药水槽能放的瓶数（0 = 不提供） */
  potionSpace: number;
  /** 模板重量 */
  weight: number;
  /** 药水槽内该种药水的堆叠上限（0 = 未定义） */
  potionCount: number;
}

interface RawRow { id: number; potionSpace: number; weight: number; potionCount: number; }

const table = new Map<number, ItemExtras>();
for (const e of (raw as { items: RawRow[] }).items) {
  table.set(e.id, e);
}

/** 按 `itemlist.id` 查（与 `itemDefById` / `potionEffect` 同一把键）。 */
export function itemExtras(id: number | undefined): ItemExtras | null {
  return id === undefined ? null : table.get(id) ?? null;
}
