/**
 * 运行时路径全量核对。**两个道具宇宙都要覆盖**（漏一个就会"武器显示 ? 或被挂到背上"）：
 *   A. `item-weapon-semantics.generated.json` —— 由 EU `gamedb.itemlist` 生成（316 件）
 *   B. `ITEM_DEFS` + `items-supplement.generated.json` —— 检查器/游戏实际能装备的集合
 *      （B 里的"只在 OpenItem、EU 表没有"的部分，曾因只查 A 而一律显示 `?` 且被挂到背上）
 * 另验证两条已确立的规则：
 *   ① 两轴独立（动画轴 hand / 挂载轴 sheathe）—— WS118 为样本；
 *   ② **爪族全族收械留在手上**（源码三张表只到 WC123，更高阶爪靠族规则，勿回退）。
 */
import { getWeaponTypeFromIdCode, getHandTypeFromIdCode, getSheatheSlot } from '../src/char/weapon-type.js';
import { sheatheBone, WEAPON_BONES } from '../src/render/weapon-loader.js';
import { ITEM_DEFS } from '../src/game/data/itemDefs.js';
import supplement from '../src/game/data/items-supplement.generated.json';
import db from '../src/game/data/item-weapon-semantics.generated.json';

type Row = { name: string; type: string; hand: string; sheathe: { slot: string; src: string } };
const byIdcode = (db as unknown as { byIdcode: Record<string, Row> }).byIdcode;
const ids = Object.keys(byIdcode);
let fail = 0;
const missType: string[] = [];
const missHand: string[] = [];
const missSlot: string[] = [];
for (const id of ids) {
  const n = Number(id);
  const w = byIdcode[id]!;
  if (!getWeaponTypeFromIdCode(n)) missType.push(`${id} ${w.name}`);
  if (!getHandTypeFromIdCode(n)) missHand.push(`${id} ${w.name}`);
  if (!getSheatheSlot(n)) missSlot.push(`${id} ${w.name}`);
}
fail += missType.length + missHand.length + missSlot.length;
console.log(`【A】EU 物品表武器 ${ids.length} 件 —— 运行时缺失：type ${missType.length} / hand ${missHand.length} / 挂载槽 ${missSlot.length}`);
for (const m of missType.slice(0, 12)) console.log('  缺type:', m);
for (const m of missHand.slice(0, 12)) console.log('  缺hand:', m);
for (const m of missSlot.slice(0, 12)) console.log('  缺挂载槽:', m);

// 【B】检查器/游戏实际能装备的全部武器（含 OpenItem 独有的 11 职业新武器）
const sup = (supplement as unknown as { items: Array<{ code: number; name: string; folder: string }> }).items;
const equipable = [
  ...ITEM_DEFS.filter((d) => d.folder === 'weapon').map((d) => ({ code: d.code, name: d.name })),
  ...sup.filter((d) => d.folder === 'weapon'),
];
const supUnresolved = equipable.filter((d) => !getSheatheSlot(d.code));
console.log(`\n【B】可装备武器 ${equipable.length} 件（ITEM_DEFS + OpenItem 补充）—— 挂载槽未解析：${supUnresolved.length}`);
for (const d of supUnresolved.slice(0, 12)) console.log('  ✗', d.name);
fail += supUnresolved.length;
const viaFallback = equipable.filter((d) => !byIdcode[String(d.code)]);
const srcDist: Record<string, number> = {};
for (const d of viaFallback) { const s = getSheatheSlot(d.code).src; srcDist[s] = (srcDist[s] ?? 0) + 1; }
console.log(`  其中不在 EU 表、需兜底解析的 ${viaFallback.length} 件，来源分布：${JSON.stringify(srcDist)}`
  + `（default=源码表与族规则都未收录 → 显式入背，属预期）`);

// 规则②：爪族全族 → 'hand'（两个宇宙都算，含 OpenItem 独有的高阶爪）
const clawCodes = new Map<number, string>();
for (const w of Object.entries(byIdcode)) if (w[1].type === 'CLAW') clawCodes.set(Number(w[0]), w[1].name);
for (const d of equipable) if (d.code >>> 16 === 0x0102) clawCodes.set(d.code, d.name);
const clawBad = [...clawCodes].filter(([code]) => {
  const s = getSheatheSlot(code);
  return s.slot !== 'hand' || sheatheBone(code) !== WEAPON_BONES.RIGHT_HAND;
});
console.log(`\n爪族（两宇宙合并去重）${clawCodes.size} 件 → 收械留手上：${clawCodes.size - clawBad.length} 通过 / ${clawBad.length} 失败`);
for (const [code, name] of clawBad) console.log(`  ✗ 0x${code.toString(16)} ${name} → ${getSheatheSlot(code).slot} / ${sheatheBone(code)}`);
fail += clawBad.length;

// 两轴独立性抽样
const FAM: Record<string, number> = { WA:0x0101,WC:0x0102,WH:0x0103,WM:0x0104,WP:0x0105,WS:0x0106,WT:0x0108,WN:0x0109,WD:0x010a,WV:0x010b };
const idc = (c: string) => { const p = c.slice(0,2); const n = Number(c.slice(2));
  const fam = p==='WS'&&n>=200?0x0107:FAM[p]!; const i = p==='WS'&&n>=200?n-200:n-100;
  return ((fam<<16)|(i*0x100))>>>0; };
console.log('\n码      动画轴type  动画轴hand  挂载槽      骨骼');
for (const c of ['WS118','WS101','WS102','WS104']) {
  const id = idc(c);
  console.log(`  ${c.padEnd(6)}${String(getWeaponTypeFromIdCode(id)).padEnd(12)}${String(getHandTypeFromIdCode(id)).padEnd(11)}${String(getSheatheSlot(id)?.slot).padEnd(12)}${sheatheBone(id)}`);
}
console.log(fail ? `\n${fail} 项失败` : '\n全部通过');

