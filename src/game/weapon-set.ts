/**
 * W 键「切换武器套」的**乐观预测**：由备用套的物品行推一份"切完之后的角色外观"。
 *
 * 为什么要预测（用户 2026-09-16 定）：切换请求发出后，服务端要一个往返才回外观；
 * 而攻击循环在这段窗口里就会起手下一刀 —— 那一刀用的是**旧武器**的动画，等外观到了
 * 模型才换成新武器 ⇒ "模型新、动画旧"。所以客户端在**发出请求的同一帧**就把外观换成备用套的。
 *
 * ⚠ 这是**短命预测，不是第二份真值**：服务端的 `S2C_AppearanceUpdate` 一到就整个覆盖它
 * （见 `WorldView.applySelfAppearance` 的指纹判据）。所以这里只求"一个往返内看起来对"，
 * 不求与 `AppearanceService.derive` 逐字段等价 —— 权威始终是服务端，客户端也不该有第二份。
 * 预测错了也无害：服务端答案的指纹不同 ⇒ 照常重建（用户要的"不正确才根据消息更新"）。
 *
 * 服务端 `ItemService.switchWeaponSet` 换的是 **slot 1（主手）与 slot 2（副手）** 两行，
 * 所以预测只动这两个槽对应的外观字段；职业/头/转职/躯干甲切武器套不动，沿用当前值。
 */
import type { CharacterAppearance } from '../ui/CharSelect.js';
import type { GameItem } from '../app/gameStore.js';
import { LOC } from './itemLocations.js';
import { itemDefById } from './data/itemDefs.js';
import { getWeaponTypeFromIdCode } from '../char/weapon-type.js';

/** 主手 / 副手槽号（与服务端 `ItemLocations.SLOT_MAIN_HAND` / `SLOT_OFF_HAND` 同值） */
const SLOT_MAIN_HAND = 1;
const SLOT_OFF_HAND = 2;

/**
 * 副手类型：0=不挂 1=盾 2=匕首 —— 与服务端 `AppearanceService.offHandKind` **同语义**。
 *
 * 服务端判据是 `itemlist.category`（`'Shields'` / `'Dagger'`），客户端没有那一列 ⇒
 * 用 `ITEM_DEFS` 里已有的两列组合等价判定（实测两个 class=2 的 folder 完全分开）：
 *   盾   → `class=2`(LHAND) 且 `folder='defense'`   （26 件，全是盾）
 *   法球 → `class=2` 但 `folder='accessory'`        （27 件，服务端也不挂）⇒ 0
 *   匕首 → `class=6` 且武器族是 `DAGGER`（= WD 族，`category='Dagger'`）
 *          ⚠ `ws201/202`（名为 Dagger/Celtic Dagger）是**剑族单手剑**、服务端不认它 ⇒ 这里也不认
 */
function offHandKindOf(def: { class: number; folder: string }, idCode: number): 0 | 1 | 2 {
  if (def.class === 2) return def.folder === 'defense' ? 1 : 0;
  if (def.class === 6 && getWeaponTypeFromIdCode(idCode) === 'DAGGER') return 2;
  return 0;
}

/**
 * 由**备用武器套**推"切换后的外观"。
 * @param current 当前外观（提供职业/头/转职/躯干甲等切武器套不变的字段）
 * @param items   当前物品表（任意来源，只看 `location`/`slot`）
 * @returns 预测外观；`current` 缺失时返回 null（调用方不切换）
 */
export function predictSwitchAppearance(
  current: CharacterAppearance | undefined,
  items: readonly GameItem[],
): CharacterAppearance | null {
  if (!current) return null;
  const at = (slot: number) =>
    items.find((x) => x.location === LOC.BACKUP_EQUIP && x.slot === slot) ?? null;

  const next: CharacterAppearance = { ...current };

  // 主手（备用套 slot 1）
  const main = at(SLOT_MAIN_HAND);
  const mainDef = main ? itemDefById(main.itemlistId) : null;
  if (main && mainDef) {
    next.weaponDorp = mainDef.icon;      // icon = codeImg1 = weaponDorp（与检查器同一处已核实）
    next.weaponIdcode = main.itemCode;
    next.weaponPos = mainDef.pos;        // modelPosition
  } else {
    next.weaponDorp = '';
    next.weaponIdcode = 0;
    next.weaponPos = 0;
  }

  // 副手（备用套 slot 2）
  const off = at(SLOT_OFF_HAND);
  const offDef = off ? itemDefById(off.itemlistId) : null;
  const kind = off && offDef ? offHandKindOf(offDef, off.itemCode) : 0;
  if (off && offDef && kind !== 0) {
    next.offHandDorp = offDef.icon;
    next.offHandIdcode = off.itemCode;
    next.offHandKind = kind;
    next.offHandPos = 2;
  } else {
    next.offHandDorp = '';
    next.offHandIdcode = 0;
    next.offHandKind = 0;
    next.offHandPos = 0;
  }

  return next;
}
