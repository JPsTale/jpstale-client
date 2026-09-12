/**
 * 武器 idcode 前缀 → 类型的**兜底**表。
 *
 * 独立成模块的原因：`extract-item-semantics.ts`（生成 DB 语义表）和
 * `weapon-type.ts`（消费语义表）都需要它，而后者要 import 生成物 ——
 * 放在 weapon-type 里会让生成脚本反向依赖自己生成的文件。
 *
 * 只在 DB 查不到时使用。当前实际只会命中 DB 里 `category='Quest'` 的
 * 新手武器（Beginner's Axe/Bow/Talon/Staff/Javelin…），它们 weaponclass>0
 * 但 category 不是武器类型。
 */

/** 0x0106（Bows）低位落在这个集合内 = 弩；与 DB 的 modelposition=4 完全一致 */
export const CROSSBOW_LOWS = new Set([
  0x0200, 0x0300, 0x0400, 0x0800, 0x0900, 0x0A00, 0x0D00, 0x1100, 0x1400,
]);

/** idcode 高 16 位前缀 → 武器类型；未知返回 null */
export function typeFromIdCodePrefix(idCode: number): string | null {
  const prefix = idCode & 0xFFFF0000;
  const low = idCode & 0xFFFF;
  switch (prefix) {
    case 0x01010000: return 'AXE';
    case 0x01020000: return 'CLAW';
    case 0x01030000: return 'HAMMER';
    case 0x01040000: return 'STAFF';
    case 0x01050000: return 'SCYTHE';
    case 0x01060000: return CROSSBOW_LOWS.has(low) ? 'CROSSBOW' : 'BOW';
    case 0x01070000: return 'SWORD';
    case 0x01080000: return 'JAVELIN';
    case 0x01090000: return 'PHANTOM';
    case 0x010A0000: return 'DAGGER';
    // 0x010B = WV = 拳套（格斗家）。前缀取自 11 职业包 `装备代码.txt`（"WV101拳套"），
    // 并由 11 职业服务端 OpenItem 扫描结果 `items-11job.json` 独立证实
    // （36 条 WV，idCode 17498368~17512704 = 0x010B0000 段）。DB 里没有这个家族。
    case 0x010B0000: return 'KNUCKLE';
    default: return null;
  }
}
