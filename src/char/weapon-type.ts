/**
 * weapon-type.ts — 武器语义（类型 / 单双手 / 攻击行为类 / 主用职业）
 *
 * 权威来源：`gamedb.itemlist`（游戏服务端自己的道具表），经
 * `scripts/extract-item-semantics.ts` 生成为 item-weapon-semantics.generated.json。
 * 取这四列作为语义，因为它们**互相正交**且都是游戏数据本身：
 *   weaponclass  1=近战 / 2=远程 / 3=魔法
 *   category     类型；Bows 内再按 modelposition 分 2=弓 / 4=弩
 *   classitem    4=单手 / 6=双手
 *   primaryspec  主用职业
 *
 * 为什么不再用 idcode 前缀 / 图标名 / 道具名称作判据：
 *   三者都是间接信号且会互相矛盾 —— 图标前缀 `ws` 是跨类型共用图集
 *   （剑/匕首/弓/弩都在内），曾据此把 720 条动画条目里的 406 条误判成"冲突"。
 *   idcode 前缀仍作为**兜底**（DB 里没有的道具），但不再作为首选。
 */
import { SITEM_CODE_BY_INDEX } from './sitem-weapon-index.js';
import { typeFromIdCodePrefix } from './weapon-idcode-prefix.js';
import { sheatheSlotFromFamily, sheatheSlotFromSource, type SheatheSlot } from '../render/sheathe-rules.js';
import dbRaw from '../game/data/item-weapon-semantics.generated.json';

/** 生成物结构见 scripts/extract-item-semantics.ts */
export interface WeaponSemantics {
  /** 收械（非战斗）挂点：每件武器都显式给出（生成物保证），src 标明来源 */
  sheathe?: { slot: string; src: string };
  name: string; category: string; type: string; hand: string;
  attackClass: string; primaryClass: string; sheath: number;
}
const DB = dbRaw as unknown as { byIdcode: Record<string, WeaponSemantics> };

/** idcode → DB 语义（无则 null） */
export function getWeaponSemantics(idCode: number): WeaponSemantics | null {
  if (!idCode) return null;
  return DB.byIdcode[String(idCode)] ?? null;
}

/**
 * 兜底：idcode 高 16 位前缀 → 类型（见 weapon-idcode-prefix.ts）。
 * 仅在 DB 里查不到时使用 —— 实际只会命中 DB 中 `category='Quest'` 的新手武器。
 */
function typeFromIdCodeFallback(idCode: number): string | null {
  return typeFromIdCodePrefix(idCode);
}

/**
 * idcode (32-bit uint) → weaponType 字符串（DB 优先，前缀兜底）
 * @returns 'AXE'|'CLAW'|'HAMMER'|'STAFF'|'SCYTHE'|'BOW'|'CROSSBOW'|'SWORD'|'JAVELIN'|'DAGGER'|'PHANTOM'|null
 */
export function getWeaponTypeFromIdCode(idCode: number): string | null {
  if (!idCode || idCode === 0) return null;
  const hit = getWeaponSemantics(idCode);
  if (hit) return hit.type;
  return typeFromIdCodeFallback(idCode);
}

/** idcode → 单双手（仅 DB 有；前缀兜底拿不到 classitem） */
export function getHandTypeFromIdCode(idCode: number): string | null {
  const hit = getWeaponSemantics(idCode);
  return hit ? hit.hand : null;
}

/**
 * idcode → 收械挂点。**分层解析，永不返回 null**：
 *   ① 语义表逐件显式值（生成物；src 可能是 user / character.cpp / family-rule / default）
 *   ② 源码三张表（`character.cpp` L1356 起）
 *   ③ 族规则（爪族等"整族无歧义"的族）
 *   ④ 显式 'back'
 *
 * ②③ 是为了覆盖**不在 EU 物品表、只在 OpenItem 里**的武器 —— 我方从 11 职业 OpenItem
 * 补出的新武器（如高阶爪 `0x0102_1A00/1B00/1C00/1D00`、`0x0102_3300~3500`）不在生成物里。
 * 旧版只查①，它们既显示 `?`，收械时又被挂到背上（用户实测：多个高阶爪）。
 * 语义表命中一律用表中的值（逐件显式优于规则计算），②③ 只作表外兜底。
 */
export function getSheatheSlot(idCode: number): { slot: SheatheSlot; src: string } {
  const explicit = getWeaponSemantics(idCode)?.sheathe;
  if (explicit) return explicit as { slot: SheatheSlot; src: string };
  if (!idCode) return { slot: 'back', src: 'default' };
  const fromSource = sheatheSlotFromSource(idCode);
  if (fromSource) return { slot: fromSource, src: 'character.cpp' };
  const fromFamily = sheatheSlotFromFamily(idCode);
  if (fromFamily) return { slot: fromFamily.slot, src: `family-rule(${fromFamily.label})` };
  return { slot: 'back', src: 'default' };
}

/** idcode → 攻击行为类 MELEE/RANGED/MAGIC（仅 DB 有） */
export function getAttackClassFromIdCode(idCode: number): string | null {
  const hit = getWeaponSemantics(idCode);
  return hit ? hit.attackClass : null;
}

/**
 * sItem 索引 → weaponType
 * @param sItemIndex sItem[] 数组索引（.inx itemCodeList 中的值）
 */
export function getWeaponTypeFromSItemIndex(sItemIndex: number): string | null {
  if (sItemIndex === 0xFF || sItemIndex == null) return 'BARE_HAND';
  const idCode = SITEM_CODE_BY_INDEX[sItemIndex];
  if (idCode == null) return null;
  return getWeaponTypeFromIdCode(idCode);
}

/**
 * 从 classItem（API 返回的单双手标识）推导 handType
 * @param classItem 4=单手, 6=双手
 */
export function getHandType(classItem: number): string {
  if (classItem === 4) return '1H';
  if (classItem === 6) return '2H';
  return 'UNDEFINED';
}
