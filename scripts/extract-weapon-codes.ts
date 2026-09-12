/**
 * 武器码 → (类型, 单双手) 的权威对照表。
 *
 * **教训（勿重蹈）**：曾用"武器码的数字段"推单双手（1xx=单手 / 2xx=双手）。
 * 这是错的 —— 实测 `WA102` = classitem 4（单手）、`WA105` = classitem 6（双手），
 * 同一个 WA1xx 段里单双手就混着；`WS201` 也是 4（单手）而 `WS205` 是 6。
 * 因此单双手**只能查 `classitem`**，类型**只能查 `category`**，不得由代码形状推。
 *
 * 来源：
 *   类型  ← `src/game/data/source/items-11job.json` 的 `category`（11 职业服务端 OpenItem 扫描）
 *   单双手 ← `gamedb.itemlist.classitem`（4=1H / 6=2H）
 * 取不到的单双手标 `?`（不猜），并在报告里列出，供人工或后续文本源补齐。
 *
 * 输入：`.refsrc/wcodes-db.txt`（`code|classitem|category` 的 DB 导出，由本脚本的取数步骤生成）
 * 输出：`src/game/data/anim-in/weapon-codes.generated.json`
 * 用法：npx tsx scripts/extract-weapon-codes.ts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { typeFromIdCodePrefix } from '../src/char/weapon-idcode-prefix.js';

const IN_DIR = resolve('src/game/data/anim-in');
const DB_DUMP = resolve('.refsrc/wcodes-db.txt');
const SCAN = resolve('src/game/data/source/items-11job.json');
const OUT = resolve('src/game/data/anim-in/weapon-codes.generated.json');
const GROUPS = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'];

/** `.in` 里实际引用到的全部武器码 */
// 码清单**直接读 .in 源文件**，不读 anim-in 产物 —— 否则 anim-in 又要读本表，形成循环。
const used = new Set<string>();
/** 每一条 `*착용무기` 白名单的码表（= 一个"条目"的可用武器集合）。
 *  用于**条目归属**判定手别：某码出现在哪些条目里，就看那些条目其余码的手别。 */
const entryLists: string[][] = [];
for (const g of GROUPS) {
  const p = resolve('migration/in', `${g.toUpperCase()}Bip.in`);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (!line.startsWith('*') || !line.includes('착용무기')) continue;
    const codes = [...line.matchAll(/\b([A-Za-z]{2})(\d{3})\b/g)].map((m) => (m[1]! + m[2]!).toUpperCase());
    for (const c of codes) used.add(c);
    if (codes.length >= 4 && !line.includes('모두')) entryLists.push(codes);   // `모두`=任意武器，无判别力
  }
}

// **剔除幽灵码**：私服把这些码塞进 `.in` 白名单，但物品与模型都没配齐（三处皆无）
// → 永远无法装备，留着只会污染别的武器的匹配（手别未知 → 纯手别条目被判成"手未定"）。
// 清单由 `npx tsx scripts/report-phantom-codes.ts` 生成，两个生成器共用。
const PHANTOM = new Set<string>(
  (JSON.parse(readFileSync(resolve('src/game/data/source/phantom-weapon-codes.json'), 'utf8')) as { codes: string[] }).codes
    .map((c) => c.toUpperCase()),
);
const phantomHit = [...used].filter((c) => PHANTOM.has(c));
for (const c of phantomHit) used.delete(c);

/** 类别名 → 语义类型 */
const CATEGORY_TYPE: Record<string, string> = {
  Axes: 'AXE', Claws: 'CLAW', Daggers: 'DAGGER', Dagger: 'DAGGER', Hammers: 'HAMMER',
  Staffs: 'STAFF', Wands: 'STAFF', Scythes: 'SCYTHE', Bows: 'BOW', Swords: 'SWORD',
  Javelins: 'JAVELIN', Phantoms: 'PHANTOM', Vambraces: 'KNUCKLE', Shields: 'SHIELD',
};

/** 扫描结果：码 → category、码 → idCode */
const scanType = new Map<string, string>();
const scanId = new Map<string, number>();
for (const x of JSON.parse(readFileSync(SCAN, 'utf8')) as Array<{ code: string; category: string; idCode: number }>) {
  const t = CATEGORY_TYPE[x.category];
  if (t) scanType.set(x.code.toUpperCase(), t);
  scanId.set(x.code.toUpperCase(), x.idCode);
}

/**
 * EU 客户端 `game/items/items.dat`：108 字节定长记录，**偏移 76 = classitem**。
 * 该偏移由 4 个锚点验证（WA101=4、WA105=6、WS201=4、WS205=6 全中）。
 * 注意 788 字节版的 `Game.exe` 内嵌表**不是**这个布局（偏移 76 处为 0），
 * 故此处只用 items.dat 这一份可靠来源。
 */
const EU_ITEMS_DAT = process.env.PT_EU_ITEMS_DAT ?? 'E:/JPsTale/client/game/items/items.dat';
const euClass = new Map<number, number>();
if (existsSync(EU_ITEMS_DAT)) {
  const d = readFileSync(EU_ITEMS_DAT);
  const S = 108;
  for (let i = 0; i + S <= d.length; i += S) {
    const cls = d.readUInt32LE(i + 76);
    if (cls === 4 || cls === 6) euClass.set(d.readUInt32LE(i), cls);
  }
}

/** DB 导出：码 → { classitem, category } */
const dbClass = new Map<string, { cls: number; cat: string }>();
if (existsSync(DB_DUMP)) {
  for (const line of readFileSync(DB_DUMP, 'utf8').split(/\r?\n/)) {
    const f = line.split('|');
    if (f.length < 3 || !f[0]) continue;
    dbClass.set(f[0]!.toUpperCase(), { cls: Number(f[1]), cat: f[2]! });
  }
}

/**
 * 手工覆盖表（提交进仓库，可长期维护）。
 * 用于两条自动来源都查不到的单双手 —— 例如 11 职业新增的高阶段
 * （WV101..WV157 拳套等），其 classitem 只在客户端 exe 里，未解码。
 * 键可为**具体码**，也可为**组键**（`前缀+段`，如 `WV1xx`）；具体码优先。
 * 取法：在游戏里装上该物品，看它占单手槽还是双手槽。
 */
interface HandOverride { note?: string; groups?: Record<string, string>; codes?: Record<string, string> }
const OVERRIDE_PATH = resolve('src/game/data/source/weapon-hand-overrides.json');
/** 类型的人工覆盖（优先级最高；来源 migration/reviews/*.jsonc 的人工校对） */
const TYPE_OVERRIDE_PATH = resolve('src/game/data/source/weapon-type-overrides.json');
const overType: { codes?: Record<string, string> } = existsSync(TYPE_OVERRIDE_PATH)
  ? JSON.parse(readFileSync(TYPE_OVERRIDE_PATH, 'utf8')) as { codes?: Record<string, string> }
  : {};
const over: HandOverride = existsSync(OVERRIDE_PATH)
  ? JSON.parse(readFileSync(OVERRIDE_PATH, 'utf8')) as HandOverride
  : {};
const groupKey = (c: string) => `${c.slice(0, 3)}xx`;
function manualHand(code: string): string | null {
  const v = over.codes?.[code] ?? over.groups?.[groupKey(code)];
  return v === '1H' || v === '2H' ? v : null;
}
/** 显式标 `?` = 人为判定"未定"，用于**抑制家族一致性外推**（有争议时用）。 */
function isPinnedUnknown(code: string): boolean {
  return (over.codes?.[code] ?? over.groups?.[groupKey(code)]) === '?';
}

const table: Record<string, { type: string; hand: string; src: { type: string; hand: string } }> = {};

/**
 * 家族一致性推断：某前缀的**已知道具**若在 `classitem` 上全体一致（全 4 或全 6），
 * 则同族未知码沿用该值，标注 `family-unanimous`。
 * 这不是"猜"——它是从该族自身的权威数据外推，且依据可审计（生成物里标明来源）。
 * 反例：Axes/Bows/Hammers/Scythes/Swords/Wands 同族内 1H 与 2H 并存，故不做推断。
 */
const famHand = new Map<string, { hand: string; n: number }>();
{
  const acc = new Map<string, { h4: number; h6: number }>();
  for (const d of dbClass.values()) {
    if (d.cls !== 4 && d.cls !== 6) continue;
    // 只有能从码推出前缀的才计入（DB 里 codeimg1 就是码）
    void d;
  }
  // 用「已知码」的码前缀统计（码来自 .in，classitem 来自 DB 或 items.dat）
  for (const c of used) {
    const db = dbClass.get(c);
    const euC = euClass.get(scanId.get(c) ?? -1);
    const cls = db ? db.cls : euC;
    if (cls !== 4 && cls !== 6) continue;
    const p = c.slice(0, 2);
    const a = acc.get(p) ?? { h4: 0, h6: 0 };
    if (cls === 4) a.h4++; else a.h6++;
    acc.set(p, a);
  }
  for (const [p, a] of acc) {
    if (a.h4 > 0 && a.h6 === 0) famHand.set(p, { hand: '1H', n: a.h4 });
    else if (a.h6 > 0 && a.h4 === 0) famHand.set(p, { hand: '2H', n: a.h6 });
  }
}
const noHand: string[] = [];
const noType: string[] = [];
/** 手工覆盖与条目归属**冲突**的码（冲突要可见，不能静默取其一） */
const handConflict: string[] = [];

/**
 * **条目归属**判定手别 —— 本项目已验证的强证据，优先于 `db.classitem`（已被声明有误的源）。
 *
 * 做法：先用"手工覆盖 / DB / items.dat / 家族一致"得到一个**种子**手别，再对每个码统计
 * 它出现在哪些条目、那些条目里**其余码**的手别分布；若一致落在单侧（且 ≥2 条条目），
 * 就采信该侧。这是单趟传播（种子多数已正确，实测收敛且能自动重现此前的人工结论）。
 * 基线自检：已知 1H 手弩 `WS102/103` = 26 条 1H 条目 / 0 条 2H；已知 2H 弓 `WS101/104` = 0 / 41。
 */
const seedHand = new Map<string, string>();
for (const code of used) {
  const db = dbClass.get(code);
  const euC = euClass.get(scanId.get(code) ?? -1);
  const manual = manualHand(code);
  const cls = manual ? null : (db ? db.cls : euC);
  seedHand.set(code, manual ?? (cls === 4 ? '1H' : cls === 6 ? '2H' : (famHand.get(code.slice(0, 2))?.hand ?? '?')));
}
const memberHand = new Map<string, { hand: string; on1: number; on2: number }>();
for (const code of used) {
  let on1 = 0, on2 = 0;
  for (const list of entryLists) {
    if (!list.includes(code)) continue;
    const others = list.filter((c) => c !== code && (seedHand.get(c) === '1H' || seedHand.get(c) === '2H'));
    if (others.length < 4) continue;
    const o1 = others.filter((c) => seedHand.get(c) === '1H').length;
    if (o1 > others.length - o1) on1++; else on2++;
  }
  if (on1 + on2 >= 2 && (on1 === 0 || on2 === 0)) memberHand.set(code, { hand: on1 === 0 ? '2H' : '1H', on1, on2 });
}

for (const code of [...used].sort()) {
  const db = dbClass.get(code);
  // 单双手可信来源优先级：手工覆盖 → DB classitem → EU items.dat classitem（偏移 76）→ 未知
  const idc = scanId.get(code) ?? null;
  const euC = euClass.get(idc ?? -1);
  const manual = manualHand(code);
  const pinned = isPinnedUnknown(code);      // 人为标 ? → 抑制家族外推
  const fam = pinned ? undefined : famHand.get(code.slice(0, 2));
  // pinned 只**抑制家族外推**，不抹掉 DB/items.dat 的实测值 —— 抹掉会丢信息。
  // 保留值但标注 `(争议)`，下游可按标记过滤，等实测裁定后再改。
  const cls = manual ? null : (db ? db.cls : euC);
  // **条目归属优先于 DB/items.dat**：它是原版白名单自己的陈述、且通过基线自检；
  // 而 `classitem` 来自已被声明有误的 EU 源。手工覆盖（用户/人工裁定）仍最高。
  const typeManual = overType.codes?.[code] ?? null;
  // 类型：**idcode 前缀规则优先**（它是唯一能区分弓/弩的信号：0x0106 低位集合=弩，
  // 已验证与 DB modelposition=4 的 9 把弩完全一致）。曾用 scan.category 的 Bows→BOW，
  // 结果弓与弩同型 → 2H 弓命中弩的条目（用户实测），且高阶 WS 码还漏成 UNKNOWN。
  const typeByIdcode = idc != null ? typeFromIdCodePrefix(idc) : null;
  const type = typeManual ?? typeByIdcode ?? scanType.get(code) ?? (db ? (CATEGORY_TYPE[db.cat] ?? null) : null);
  // **盾（SHIELD）没有单双手之分**（它是副手件）→ 不参与条目归属，保持 `?`，别贴 1H/2H 噪声。
  const mem = manual || type === 'SHIELD' ? null : memberHand.get(code);
  if (manual && memberHand.has(code) && memberHand.get(code)!.hand !== manual) {
    handConflict.push(`${code}: 手工=${manual} vs 条目归属=${memberHand.get(code)!.hand}(${memberHand.get(code)!.on1}条1H/${memberHand.get(code)!.on2}条2H)`);
  }
  // ⚠ 凡由 EU 侧（gamedb.itemlist / items.dat）推出的 hand 一律标注来源：保留值但**降级为参考**；
  // 家族一致性外推继承同一可疑性。人工覆盖（用户断言）与条目归属不继承。
  const EU_TAG = '(EU源·已声明有误)';
  const handSrc = manual ? 'manual-override'
    : mem ? `in-entry-membership(${mem.on1}条1H/${mem.on2}条2H)`
      : pinned && (db || euC != null) ? `${db ? 'db.classitem' : 'items.dat@76'}${EU_TAG}`
        : pinned ? 'pinned-unknown(人工判为未定)'
          : db ? `db.classitem${EU_TAG}`
            : euC != null ? `items.dat@76${EU_TAG}`
              : fam ? `family-unanimous(${fam.n} 例)${EU_TAG}` : '缺失';
  const hand = manual ?? mem?.hand ?? (cls === 4 ? '1H' : cls === 6 ? '2H' : cls != null ? `classitem=${cls}` : (fam?.hand ?? '?'));
  if (!type) noType.push(code);
  if (hand === '?') noHand.push(code);
  table[code] = {
    type: type ?? 'UNKNOWN',
    hand,
    src: { type: typeManual ? 'manual-override' : typeByIdcode ? 'idcode-prefix(含弓/弩细分)' : scanType.has(code) ? 'scan.category' : 'db.category', hand: handSrc },
  };
}

writeFileSync(OUT, JSON.stringify({
  note: '武器码 → (类型, 单双手)。**不得由代码形状推**：实测同段内单双手是混的'
    + '（WA102=4 单手 / WA105=6 双手；WS201=4 / WS205=6）。'
    + '类型取 items-11job.json 的 category，单双手取 gamedb.itemlist.classitem（4=1H/6=2H）。'
    + 'hand 判定优先级（强→弱）：manual-override（用户/人工裁定）→ **in-entry-membership**'
    + '（.in 条目归属：该码所在条目里其余码的手别，单侧一致且≥2 条才采信；通过基线自检'
    + ' WS102/103=26条1H/0 、WS101/104=0/41 条）→ db.classitem / items.dat@76（EU 源，已被声明有误）'
    + '→ family-unanimous → hand="?"（无证据，**不猜**）。每个码的 src.hand 记明来源。生成物，勿手改。',
  counts: {
    used: used.size, withType: used.size - noType.length, withHand: used.size - noHand.length,
    missingHand: noHand.length, missingType: noType.length,
  },
  missingHandCodes: noHand,
  table,
}, null, 1) + '\n');

console.log(`.in 引用武器码 ${used.size} 个`);
console.log(`  类型可定 ${used.size - noType.length}；单双手可定 ${used.size - noHand.length}，缺 ${noHand.length}`);
if (noHand.length) {
  const byP = new Map<string, number>();
  for (const c of noHand) byP.set(c.slice(0, 2), (byP.get(c.slice(0, 2)) ?? 0) + 1);
  console.log('  缺单双手的按前缀：' + [...byP.entries()].map(([p, n]) => `${p}×${n}`).join(' '));
}
console.log(`写出 ${OUT}`);
{
  const withMem = Object.entries(table).filter(([, v]) => v.src.hand.startsWith('in-entry-membership'));
  const fromDb = Object.entries(table).filter(([, v]) => v.src.hand.includes('classitem') && v.src.hand.includes('EU源'));
  console.log(`  手别来源: 条目归属 ${withMem.length} / DB·items.dat(EU源) ${fromDb.length} / 手工 ${Object.values(table).filter((v) => v.src.hand === 'manual-override').length} / 家族 ${Object.values(table).filter((v) => v.src.hand.startsWith('family')).length} / 未定 ${noHand.length}`);
  console.log(`  条目归属判定的码（前 10，含两侧计数）: ${withMem.slice(0, 10).map(([c, v]) => `${c}=${v.hand}${v.src.hand.replace('in-entry-membership', '')}`).join(' ')}`);
  if (handConflict.length) {
    console.log(`  ⚠ 手工覆盖与条目归属**冲突** ${handConflict.length} 个（已按手工，但请复核）:`);
    for (const c of handConflict) console.log('     ' + c);
  }
}
console.log(`幽灵码剔除：${phantomHit.length} 个（${phantomHit.slice(0, 8).join(' ')}${phantomHit.length > 8 ? ' …' : ''}）`);
