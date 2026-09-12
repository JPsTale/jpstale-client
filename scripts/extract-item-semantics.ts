/**
 * 从权威 DB（gamedb.itemlist）生成武器语义表。
 *
 * 为什么用 DB 而不是 idcode 前缀 / 图标名 / 道具名称：
 *   前三者都是**间接信号**，会互相矛盾（`ws` 是跨类型共用图集，曾导致 406 条假冲突）。
 *   DB 的 itemlist 是游戏服务端自己的道具表，以下四列是**正交的权威语义**：
 *     weaponclass  0=非武器；1=近战 / 2=远程 / 3=魔法（攻击行为类）
 *     category     武器类型：Axes/Claws/Hammers/Wands/Scythes/Bows/Swords/Javelins/Phantom/Dagger
 *     classitem    4=单手 / 6=双手
 *     modelposition Bows 内部分弓/弩：2=弓（背挂）/ 4=弩（含手弩）
 *     primaryspec  该类型的主用职业（1=Fighter … 9=Assassin … 10=Shaman；0=无）
 *
 * 数据源获取顺序：
 *   1. PT_ITEMLIST_DUMP 环境变量指向的本地 dump（离线）
 *   2. 本机 podman exec priston-pg psql（服务器上跑）
 *   3. ssh <PT_DB_HOST> podman exec …（开发机跑）
 * 生成物：src/game/data/item-weapon-semantics.generated.json
 *
 * 用法：npx tsx scripts/extract-item-semantics.ts
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { typeFromIdCodePrefix } from '../src/char/weapon-idcode-prefix.js';
import { sheatheSlotFromFamily, sheatheSlotFromSource } from '../src/render/sheathe-rules.js';

const OUT = resolve('src/game/data/item-weapon-semantics.generated.json');
const DB_HOST = process.env.PT_DB_HOST ?? 'root@192.168.31.10';
const SQL = 'SELECT idcode, name, category, weaponclass, classitem, modelposition, primaryspec\n'
  + 'FROM gamedb.itemlist ORDER BY idcode;';

/** 拉取 dump：优先本地文件，其次 podman，最后 ssh */
const TAB = '\t';
function fetchDump(): { text: string; source: string } {
  const local = process.env.PT_ITEMLIST_DUMP;
  if (local && existsSync(local)) {
    return { text: readFileSync(local, 'utf8'), source: `file:${local}` };
  }
  // 注意：分隔符必须是**字面制表符**。写 -F'\t' 会在 ssh → 远端 sh → psql 的
  // 多层引号中被吃成两字符 "\\t"，于是每行都不是 7 段，读出来 0 行。
  const remote = `podman exec -i priston-pg psql -U sa -d pristontale -t -A -F'${TAB}' -f -`;
  try {
    return {
      text: execFileSync('podman', ['exec', '-i', 'priston-pg', 'psql', '-U', 'sa', '-d', 'pristontale', '-t', '-A', '-F', TAB, '-f', '-'],
        { input: SQL, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }),
      source: 'podman:priston-pg',
    };
  } catch { /* 本机没有 podman，走 ssh */ }
  return {
    text: execFileSync('ssh', ['-o', 'BatchMode=yes', DB_HOST, remote], { input: SQL, encoding: 'utf8' }),
    source: `ssh:${DB_HOST}`,
  };
}

/** category → 语义类型。Bows 内部再按 modelposition 分弓/弩。
 *  注：`Quest`（新手武器）等非武器类目不在表内，由 idcode 前缀兜底。 */
const CATEGORY_TYPE: Record<string, string> = {
  Axes: 'AXE', Claws: 'CLAW', Hammers: 'HAMMER', Wands: 'STAFF', Scythes: 'SCYTHE',
  Bows: 'BOW', Swords: 'SWORD', Javelins: 'JAVELIN', Phantom: 'PHANTOM', Dagger: 'DAGGER',
};
/** weaponclass → 攻击行为类 */
const ATTACK_CLASS: Record<number, string> = { 1: 'MELEE', 2: 'RANGED', 3: 'MAGIC' };
/**
 * 是否手持武器。Phantom（萨满图腾）是唯一例外：它**漂在角色背后**，
 * 不挂到手骨上，所以没有挥击/入鞘动作，动画按魔法类走。
 */
const HAND_ATTACHED: Record<string, boolean> = { PHANTOM: false };
/** primaryspec → 主用职业（与 char/char-format.ts 的 CLASS_FLAG 一致） */
const CLASS_NAME: Record<number, string> = {
  0: 'none', 1: 'Fighter', 2: 'Mechanician', 3: 'Archer', 4: 'Pikeman', 5: 'Atalanta',
  6: 'Knight', 7: 'Magician', 8: 'Priestess', 9: 'Assassin', 10: 'Shaman', 11: 'Mortal',
};

interface Row { idcode: number; name: string; category: string; weaponclass: number; classitem: number; modelposition: number; primaryspec: number }

/** 收械挂点的人工覆盖（优先级最高；见文件头 note） */
const SHEATHE_OVERRIDE_PATH = resolve('src/game/data/source/weapon-sheathe-overrides.json');
/**
 * **人工覆盖**（与 `extract-weapon-codes.ts` 读同一批文件 —— 一个值一个真相）。
 * 曾只把 hand 覆盖喂给 weapon-codes、没喂这里，导致选择器显示 2H 而匹配器按 1H
 *（用户给的 WS118 就是这种不一致）。
 */
function loadOverrides(path: string, field: 'codes' | 'groups'): Record<string, string> {
  if (!existsSync(path)) return {};
  const j = JSON.parse(readFileSync(path, 'utf8')) as Record<string, Record<string, string>>;
  return j[field] ?? {};
}
const TYPE_OV = loadOverrides('src/game/data/source/weapon-type-overrides.json', 'codes');
const HAND_OV = loadOverrides('src/game/data/source/weapon-hand-overrides.json', 'codes');
const HAND_OV_GROUPS = loadOverrides('src/game/data/source/weapon-hand-overrides.json', 'groups');
/** idcode → 武器码（见下方 codeOfIdcode） */
function handOverrideOf(idcode: number): string | null {
  const c = codeOfIdcode(idcode);
  if (!c) return null;
  const v = HAND_OV[c] ?? HAND_OV_GROUPS[`${c.slice(0, 3)}xx`];
  return v === '1H' || v === '2H' ? v : null;
}
function typeOverrideOf(idcode: number): string | null {
  const c = codeOfIdcode(idcode);
  return c ? (TYPE_OV[c] ?? null) : null;
}

const sheatheOverride: Record<string, { slot: string; why?: string }> = existsSync(SHEATHE_OVERRIDE_PATH)
  ? (JSON.parse(readFileSync(SHEATHE_OVERRIDE_PATH, 'utf8')) as { codes: Record<string, { slot: string; why?: string }> }).codes
  : {};
/**
 * idcode → 武器码（如 WS118）。**公式经核对**：码序号 = 段基址 + 低位/0x100
 *   0x0106（弓） → 100 段 → WS101… ；0x0107（剑，同用 WS 字母）→ 200 段 → WS201…
 *   其他族（WA/WH/WM/WP/WT/WN/WD/WV）→ 100 段
 * ⚠ 曾误取第二个字节得到 `WS018`，导致覆盖表查不到 WS118 —— 公式错会**静默**失效。
 */
function codeOfIdcode(idcode: number): string | null {
  const hi = (idcode >>> 16) & 0xffff;
  const n = (idcode & 0xffff) / 0x100;
  const p = { 0x0101: 'WA', 0x0102: 'WC', 0x0103: 'WH', 0x0104: 'WM', 0x0105: 'WP',
              0x0106: 'WS', 0x0107: 'WS', 0x0108: 'WT', 0x0109: 'WN', 0x010a: 'WD', 0x010b: 'WV' }[hi];
  if (!p || !Number.isInteger(n)) return null;
  return `${p}${hi === 0x0107 ? 200 + n : 100 + n}`;
}

/**
 * 每件武器都**显式**给出收械挂点（用户要求：显式优于规则计算）。
 * src 标明来源（按优先级）：
 *   'user'                        人工覆盖（weapon-sheathe-overrides.json）
 *   'NewSourcePT-2023/character.cpp'  源码三张表命中（11 职业版 = 权威）
 *   'family-rule(爪族)'           三张表未收录的同族武器 → 族规则
 *   'default'                     三者皆无 → 显式 back（不在此藏隐式默认）
 */
function sheatheOf(idcode: number): { slot: string; src: string } {
  const code = codeOfIdcode(idcode);
  const ov = code ? sheatheOverride[code] : undefined;
  if (ov) return { slot: ov.slot, src: 'user' };
  const src = sheatheSlotFromSource(idcode);
  if (src) return { slot: src, src: 'NewSourcePT-2023/character.cpp' };
  // 三张表未收录的同族武器 → 族规则（源码白名单是硬编码的，表外一律落默认）
  const fam = sheatheSlotFromFamily(idcode);
  if (fam) return { slot: fam.slot, src: `family-rule(${fam.label})` };
  // 匕首（WD 族）走这里 → 'back'：**两版源码的三张表里都没有匕首**，
  // 即 dwItemSetting 取默认 1 → BackObjBip[0] = "Bip in01"。
  // （m6 刺客骨架里有 `Bip in_DaggerL/R`/`in07`/`in08` 专属骨，但两版 C++ 都没引用，
  //   故不采信 —— 见 AGENTS.md 纠错 #8。若日后证实刺客匕首挂腰，在族规则里加一条即可。）
  return { slot: 'back', src: 'default' };
}

const { text, source } = fetchDump();
const rows: Row[] = [];
let skipped = 0;
for (const line of text.split(/\r?\n/)) {
  const f = line.split('\t');
  if (f.length < 7) { if (line.trim()) skipped++; continue; }
  rows.push({
    idcode: Number(f[0]), name: f[1]!, category: f[2]!,
    weaponclass: Number(f[3]), classitem: Number(f[4]),
    modelposition: Number(f[5]), primaryspec: Number(f[6]),
  });
}
if (!rows.length) throw new Error('itemlist dump 为空 —— 检查 DB 连通性');

/** 语义类型：非武器返回 null；Bows 用 modelposition 分弓/弩 */
function typeOf(r: Row): string | null {
  if (r.weaponclass <= 0) return null;
  const ov = typeOverrideOf(r.idcode);
  if (ov) return ov;                              // 人工覆盖优先（与 weapon-codes 同源）
  const base = CATEGORY_TYPE[r.category];
  // 未知 category（如 Quest 新手武器）用 idcode 前缀兜底
  if (!base) return typeFromIdCodePrefix(r.idcode);
  // Bows 内部分弓/弩：modelposition 2=弓（背挂）4=弩。弓一律双手；
  // 弩分单手（手弩，像手枪单手激发）与双手（两手抬起扣扳机）—— 由 classitem 决定。
  // Bows 内分弓/弩：优先 idcode 低位集合（与 DB modelposition 实测一致），
  // 退化时才用 modelposition；两者都不可得则 BOW。
  if (base === 'BOW') {
    const byId = typeFromIdCodePrefix(r.idcode);
    if (byId === 'CROSSBOW' || byId === 'BOW') return byId;
    return r.modelposition === 4 ? 'CROSSBOW' : 'BOW';
  }
  return base;
}
const handOf = (r: Row) => handOverrideOf(r.idcode) ?? (r.classitem === 4 ? '1H' : r.classitem === 6 ? '2H' : 'UNDEFINED');

const byIdcode: Record<string, unknown> = {};
const catSummary = new Map<string, { type: string; weaponClass: string; hand: string[]; primary: string; count: number }>();
let agree = 0, disagree = 0;
const diffs: string[] = [];
let dupes = 0;

for (const r of rows) {
  const t = typeOf(r);
  if (!t) continue;
  if (byIdcode[r.idcode]) { dupes++; continue; }   // 同 idcode 多名称：保留首条
  const hand = handOf(r);
  byIdcode[r.idcode] = {
    name: r.name, category: r.category, type: t, hand,
    attackClass: ATTACK_CLASS[r.weaponclass] ?? `wc${r.weaponclass}`,
    primaryClass: CLASS_NAME[r.primaryspec] ?? `ps${r.primaryspec}`,
    sheath: r.modelposition,
    /** 收械（非战斗）挂点：**每件武器都显式给出**（用户要求，不做运行时默认计算） */
    sheathe: sheatheOf(r.idcode),
    handAttached: HAND_ATTACHED[t] ?? true,
  };
  const key = `${r.category}/${t}`;
  const cur = catSummary.get(key) ?? { type: t, weaponClass: ATTACK_CLASS[r.weaponclass] ?? '?', hand: [], primary: CLASS_NAME[r.primaryspec] ?? '?', count: 0 };
  if (!cur.hand.includes(hand)) cur.hand.push(hand);
  cur.count++;
  catSummary.set(key, cur);

  // 与「纯 idcode 前缀」对照 —— 这是真正独立于 DB 的信号，
  // 用来量化 DB 到底补充/纠正了什么（不是判据）。
  const prefixType = typeFromIdCodePrefix(r.idcode);
  if (prefixType === t) agree++;
  else { disagree++; if (diffs.length < 40) diffs.push(`  ${String(r.idcode).padStart(9)} "${r.name}" DB=${t} 前缀=${prefixType ?? 'null'}`); }
}

writeFileSync(OUT, JSON.stringify({
  note: '武器语义表（权威来源：gamedb.itemlist 的 weaponclass/category/classitem/modelposition/primaryspec）。'
    + '生成物，勿手改；重新生成用 npx tsx scripts/extract-item-semantics.ts。'
    + '字段：type=武器类型（Bows 内按 modelposition 2=弓/4=弩 细分）、hand=单双手、'
    + 'attackClass=攻击行为类、primaryClass=主用职业、sheath=挂点（modelposition）、handAttached=是否手持。'
    + '注意：Phantom（萨满图腾）漂在角色背后，不挂手骨，handAttached=false；'
    + '且 sItem 索引表（sitem-weapon-index.ts）只覆盖 0x0101~0x0108，'
    + 'Phantom(0x0109)/Dagger(0x010A) 无 sItem 索引，故永远不会出现在 .inx 的 itemCodeList 里。',
  source, weaponCount: Object.keys(byIdcode).length,
  categories: [...catSummary.entries()].map(([k, v]) => ({ category: k, ...v, hand: v.hand.sort() })),
  byIdcode,
}, null, 1) + '\n');

console.log(`数据源 ${source}；读到 ${rows.length} 行（跳过多余字段 ${skipped} 行，同 idcode 去重 ${dupes} 行）`);
console.log(`武器语义 ${Object.keys(byIdcode).length} 条 → ${OUT}`);
console.log('\ncategory / 类型 / 攻击类 / 单双手 / 主用职业 / 条数：');
for (const [k, v] of [...catSummary.entries()].sort()) {
  console.log(`  ${k.padEnd(16)} ${v.type.padEnd(8)} ${v.weaponClass.padEnd(7)} ${v.hand.sort().join('+').padEnd(6)} ${v.primary.padEnd(12)} ${v.count}`);
}
console.log(`\n与「纯 idcode 前缀」一致性：${agree} 一致 / ${disagree} 不一致`);
for (const d of diffs) console.log(d);
