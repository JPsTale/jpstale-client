/**
 * 物品**显示名**的唯一实现（AGENTS #15）。
 *
 * 优先级：**i18n 表**（`item.<id>.name`，写在 `locales/{zh,en}.json` 里）→ 物品数据自带的名字
 * （`gamedb.itemlist.name`，兜底 —— 表里没有的 id 就走它）。
 * 那份 i18n 表由 `npm run item-names` 从另一份中文客户端的 OpenItem 填充（`scripts/extract-item-names.ts`），
 * 也可以直接手写；**手改过的条目重跑生成器不会被动**（默认只补缺失，见脚本头部）。
 * 也就是说：绝大多数物品不需要写词条（数据里的英文名就是基准），**要本地化/改名的才加一条** ——
 * 与 NPC 名字（`npc.<内名>.name`）同一套做法。
 *
 * **键用 `gamedb.itemlist.id`（主键，十进制）**，不是 `idcode` —— 与 Web 管理端详情页的约定同源
 * （`docs/plans/2026-09-21-pt-web-admin-items-design.md` §十三：**URL 传主键、不传 idcode**，
 * 因为一个 `codeimg1` 可能对应多行）。例：`item.755.name` = BI139「Skill Master (1st)」。
 *
 * ⚠ 三个坑：
 *   ① 键写错一个数字**不会报错**（`tOr` 会安静地用数据名），所以靠 `verify-itemtip` 的
 *      「每个 `item.<id>.name` 键都必须对应一件真实物品」那组断言兜底；
 *   ② 服务端下发的名字（`S2C_GroundItemAppear.name`、商店条目名）**没经过这里** ——
 *      地面/商店那两处是拿 `itemlistId` 再过一遍本模块；
 *   ③ 不要把本模块塞进 `data/itemDefs.ts`：那个文件是**生成物**（`npm run item-defs` 会覆盖）。
 */
import { tOr } from '../i18n/index.js';
import { itemDefById, type ItemDef } from './data/itemDefs.js';

/** 物品主键 → i18n 键（`item.<id>.name`，十进制主键）。 */
export function itemNameKey(itemlistId: number): string {
  return `item.${itemlistId}.name`;
}

/**
 * 物品显示名。
 *
 * @param itemlistId 物品**主键**（`ItemDef.id` / `GameItem.itemlistId`）；`null`/0 ⇒ 只用数据名
 * @param dataName   物品数据自带的名字（`ItemDef.name`，来自 `gamedb.itemlist`）
 * @param fallback   `dataName` 也没有时显示什么（调用方给，如 `#<itemlistId>` 或 `''`）
 */
export function itemDisplayName(itemlistId: number | null | undefined,
                                dataName: string | null | undefined,
                                fallback = ''): string {
  const base = dataName ?? fallback;
  return itemlistId ? tOr(itemNameKey(itemlistId), base) : base;
}

/** 直接给定义（面板/背包那种手上有 `ItemDef` 的地方）。 */
export function itemDisplayNameOf(def: ItemDef | null | undefined, fallback = ''): string {
  return itemDisplayName(def?.id, def?.name, fallback);
}

/**
 * 手上只有 `itemlistId` **加一个数据名**时用这个（商店条目就是这种：
 * 名字是服务端下发的，条目里只有主键）。
 *
 * ⚠ 传进来的 `dataName` **优先于**本地 `ITEM_DEFS` 的名字 —— 它是服务端**实时**库里的名字，
 * 而我们那份 `itemDefs.ts` 是**生成物**（改库后没重跑 `npm run item-defs` 就是旧的）。
 */
export function itemDisplayNameById(itemlistId: number | null | undefined,
                                    dataName: string | null | undefined,
                                    fallback = ''): string {
  const def = itemlistId ? itemDefById(itemlistId) : undefined;
  return itemDisplayName(itemlistId, dataName ?? def?.name, fallback);
}
