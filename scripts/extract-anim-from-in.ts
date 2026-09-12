/**
 * 从 11 职业服务端的 `.in` 明文动画定义生成权威语义表。
 *
 * 为什么用 `.in` 而不是 `.inx` 二进制 + sItem 索引：
 *   `.inx` 的 `itemCodeList` 存的是 **sItem 索引**，必须对着「产出该 .inx 的那一代客户端」
 *   的物品表读。我方 `m1~m8bip.inx` 来自 11 职业客户端，而 `client/game/items/items.dat`
 *   是 EU 的（两代新物品块位置不同）—— 混读必然得出错误结论（已踩过两次）。
 *   `.in` 把职业名（`MartialArtist`）、武器代码名（`WV101`）、技能名（`*적용기술`）
 *   全部写成明文，**完全不依赖任何索引表**。
 *
 * 关键：`.in` 是 `Server服务端/char/tmABCD/M{n}Bip.inx` 的**同源明文**，其帧是
 * **每个动作组（`*동작모음 "X.ASE"`）内部的局部帧**；`.inx` 用的是跨组绝对帧。
 * 故配对用**顺序 + 时长(end-start)** 校验，而不是直接比帧号。实测：
 *   m6 78↔78、m8 81↔81 全配；m1 的 Server 侧 150 条中 148 条与我方 .inx 帧区间一致
 *   （我方 m1 共 165 条 = 该 148 条 + 17 条新客户端追加的动作，后者在本 .in 里没有语义）。
 *
 * 输入：`.refsrc/in/M{1..8}Bip.in`（CP949→UTF-8）
 *       `PT_SRC_SERVER` 下的 `char/tmabcd/m{n}.smb` + `m{n}bip.inx`（取绝对帧）
 * 输出：`src/game/data/anim-in/*.generated.json`
 *
 * 用法：npx tsx scripts/extract-anim-from-in.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseInx, parseSmb } from '../src/core/char-parser.js';
import { buildMotionList } from '../src/render/monster-loader.js';
import { motionStateName } from '../src/char/char-format.js';

const IN_DIR = resolve('migration/in');
const OUT_DIR = resolve('src/game/data/anim-in');
const SRV = process.env.PT_SRC_SERVER
  ?? 'E:/BaiduNetdiskDownload/精灵/精灵11职业单机版一键端/精灵11职业单机版一键端/Server服务端';
const GROUPS = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'];

/* ─────────── 武器代码 → 语义（前缀含义取自 11 职业包 `装备代码.txt`）─────────── */

/**
 * 代码前缀 → 武器类型。`WS` 同时是弓(WS1xx)与剑(WS2xx) —— 官方命名即如此。
 * `WV`（拳套）与 `WN`（图腾）是我方旧表里没有的类型。
 * 单双手按百位段：1xx=单手、2xx=双手；其余段归 '?'（见脚本报告）。
 */

/** 权威武器码表（由 scripts/extract-weapon-codes.ts 生成：类型查 category、单双手查 classitem）。
 *  旧的本文件内 numeric 规则**已废弃**（实测同段内单双手是混的），仅作最后兜底。 */
const WC_TABLE = JSON.parse(readFileSync(resolve('src/game/data/anim-in/weapon-codes.generated.json'), 'utf8')) as {
  table: Record<string, { type: string; hand: string; src: { type: string; hand: string } }>;
};
/** 幽灵码（三处皆无：EU 物品表 / OpenItem 补充 / 模型）—— 从条目白名单里剔除。
 *  清单由 `npx tsx scripts/report-phantom-codes.ts` 生成，见其说明。 */
const PHANTOM = new Set<string>(
  (JSON.parse(readFileSync(resolve('src/game/data/source/phantom-weapon-codes.json'), 'utf8')) as { codes: string[] }).codes
    .map((c) => c.toUpperCase()),
);
let touchedByPhantom = 0;   // 含幽灵码的条目数
let emptiedByPhantom = 0;   // 剔除后武器码为空的条目数
function typeOfWeaponCodeAuthoritative(code: string): { type: string; hand: string } | null {
  const hit = WC_TABLE.table[code.toUpperCase()];
  if (!hit) return null;
  return { type: hit.type, hand: hit.hand === '?' ? '?' : hit.hand };
}
function typeOfWeaponCode(code: string): { type: string; hand: string } | null {
  const m = /^([A-Z]{2})(\d{3})$/.exec(code);
  if (!m) return null;
  const p = m[1]!;
  const n = Number(m[2]!);
  const hand = n >= 100 && n < 200 ? '1H' : n >= 200 && n < 300 ? '2H' : '?';
  switch (p) {
    case 'WA': return { type: 'AXE', hand };
    case 'WC': return { type: 'CLAW', hand };
    case 'WD': return { type: 'DAGGER', hand };
    case 'WH': return { type: 'HAMMER', hand };
    case 'WM': return { type: 'STAFF', hand };
    case 'WN': return { type: 'PHANTOM', hand };   // 图腾（萨满），漂在背后不挂手
    case 'WP': return { type: 'SCYTHE', hand };    // 枪/镰
    case 'WS': return n >= 200 ? { type: 'SWORD', hand } : { type: 'BOW', hand };
    case 'WT': return { type: 'JAVELIN', hand };
    case 'WV': return { type: 'KNUCKLE', hand };   // 拳套（格斗家）
    // 非武器也会出现在白名单里（表示"仅在该装备下可用"）：
    // 盾 DS、铠甲 DA、法袍/鞋/护手/法师盾/臂环/项链 DB/DG/OM/OA/OR
    case 'DS': return { type: 'SHIELD', hand: '-' };
    case 'DA': case 'DB': case 'DG': case 'OM': case 'OA': case 'OR':
      return { type: 'GEAR', hand: '-' };
    default: return null;
  }
}

/* ─────────── .in 解析 ─────────── */

interface InEntry {
  /** 韩文动作名（原样保留，便于人工对照） */
  motion: string;
  /** 组内局部帧 */
  start: number; end: number;
  /** `*<动作名>` 行里的两个事件帧（局部帧，常见 2 个） */
  events: number[];
  repeat: boolean;
  /** `모두`=任意武器 / `없음`=空手 / `list`=指定代码（可与空手并存） */
  weapon: { kind: 'all' | 'none' | 'list'; codes: string[]; unarmed?: boolean };
  classes: string[];
  locations: string[];
  /** `*적용기술` 技能名 —— 技能→动画绑定，明文 */
  skills: string[];
  /** 所属 `*동작모음` 动作组 */
  collection: string;
  /** 紧随其后的 `//` 说明 */
  note: string;
  /** 被 `//` 注释掉的条目（未启用） */
  disabled: boolean;
}

function parseIn(text: string): InEntry[] {
  const out: InEntry[] = [];
  let collection = '';
  let cur: InEntry | null = null;
  const push = () => { if (cur) out.push(cur); cur = null; };
  const mk = (motion: string, f: string[], disabled: boolean): InEntry => ({
    motion, start: Number(f[0]), end: Number(f[1]),
    events: f.slice(2).filter((x) => /^\d+$/.test(x)).map(Number),
    repeat: f.includes('반복'),
    weapon: { kind: 'none', codes: [], unarmed: true },
    classes: [], locations: [], skills: [], collection, note: '', disabled,
  });

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;

    // 被注释掉的条目：`//*서있기동작1   87   267`
    // 注意它后面未注释的 `*착용무기/적용직업/해당위치` 仍属于它，故照常建条目再标 disabled。
    const dis = /^\/\/\s*\*(\S+)\s+(\d+)\s+(\d+)\s*(.*)$/.exec(line);
    if (dis) { push(); cur = mk(dis[1]!, [dis[2]!, dis[3]!, ...dis[4]!.split(/\s+/).filter(Boolean)], true); continue; }
    if (line.startsWith('//')) { if (cur) cur.note = cur.note || line.slice(2).replace(/\s+/g, ' ').trim(); continue; }
    if (!line.startsWith('*')) continue;

    const body = line.slice(1);
    const tab = body.indexOf('\t');
    const name = (tab >= 0 ? body.slice(0, tab) : body).trim();
    const rest = tab >= 0 ? body.slice(tab + 1).trim() : '';
    const f = rest.split(/\s+/).filter(Boolean);

    if (name === '동작모음') { push(); collection = rest.replace(/"/g, '').trim(); continue; }
    if (name === '동작파일') continue;

    if (name === '착용무기') {
      if (!cur) continue;
      if (rest === '모두') { cur.weapon = { kind: 'all', codes: [] }; continue; }
      // `없음`(空手) 会**混在列表里**（如 `없음 WC101 WC102...` = 空手或爪），故单独识别
      const unarmed = f.includes('없음');
      const raw = f.filter((x) => x !== '없음');
      // **剔除幽灵码**：私服往 `.in` 白名单里塞了码、但物品与模型都没配齐（见
      // `src/game/data/source/phantom-weapon-codes.json`）。它们永远无法装备，却会让
      // "纯手别条目"被误判成"手未定"而漏进另一手别的候选（用户实测：单手锤看到双手锤动画）。
      // ⚠ 剔除后若为空，**不可当作空手条目** —— 原列表本意是"某种武器"，只是码全是幽灵；
      // 记为 list(空列表)，由匹配器按"未给出武器约束"处理，比谎称空手安全。
      const codes = raw.filter((x) => !PHANTOM.has(x.toUpperCase()));
      if (raw.length !== codes.length) {
        touchedByPhantom++;
        if (!codes.length) { emptiedByPhantom++; console.log(`  ⚠ 条目武器码全为幽灵码，已置空: ${cur.motion ?? cur.collection ?? '(未命名)'}`); }
      }
      cur.weapon = raw.length && !codes.length
        ? { kind: 'list', codes: [], unarmed }
        : (codes.length ? { kind: 'list', codes, unarmed } : { kind: 'none', codes: [], unarmed: true });
      continue;
    }
    if (name === '적용직업') { if (cur) cur.classes.push(...f); continue; }
    if (name === '해당위치') { if (cur) cur.locations.push(...f); continue; }
    if (name === '적용기술') { if (cur) cur.skills.push(f.join(' ')); continue; }

    // `*<动作名>  start  end  [ev1 ev2]  [반복]`
    if (f.length >= 2 && /^\d+$/.test(f[0]!) && /^\d+$/.test(f[1]!)) { push(); cur = mk(name, f, false); }
  }
  push();
  return out;
}

/* ─────────── 与同源 .inx 配对（顺序 + 时长校验）─────────── */

const ab = (p: string): ArrayBuffer => {
  const b = readFileSync(p);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

mkdirSync(OUT_DIR, { recursive: true });
const nameToState = new Map<string, Map<string, number>>();
const report: string[] = [];
const unknownCodes = new Map<string, number>();
let totalIn = 0, totalPaired = 0, totalDurMismatch = 0;

for (const grp of GROUPS) {
  const inPath = resolve(IN_DIR, `${grp.toUpperCase()}Bip.in`);
  if (!existsSync(inPath)) { report.push(`${grp}: 缺 .refsrc/in/${grp.toUpperCase()}Bip.in`); continue; }
  const entries = parseIn(readFileSync(inPath, 'utf8'));

  let inxRows: Array<{ index: number; state: number; start: number; end: number; events: number[]; skillCodes: number[] }> = [];
  const srvSmb = `${SRV}/char/tmabcd/${grp}.smb`;
  const srvInx = `${SRV}/char/tmabcd/${grp}bip.inx`;
  if (existsSync(srvSmb) && existsSync(srvInx)) {
    inxRows = buildMotionList(parseSmb(ab(srvSmb)), parseInx(ab(srvInx))).map((m) => ({
      index: m.index, state: m.state, start: m.startFrame, end: m.endFrame,
      events: Array.from(m.eventFrame ?? []).filter((x) => x > 0),
      // `.inx` 里的 skillCodeList —— 技能动画的索引（203~222 等），
      // 与 `.in` 的 `*적용기술` 技能名配对后即得「技能名 → 动画索引」绑定
      skillCodes: Array.from(m.skillCodeList ?? []).filter((x) => x > 0),
    }));
  }

  // 关键：`.in` 里被 `//` 注释掉的条目**不在 .inx 中**，故只按启用条目配对。
  // （实测 m8：86 − 5 = 81 = .inx 81；m2：99 − 1 = 98 = .inx 98）
  const active = entries.filter((e) => !e.disabled);
  const n = Math.min(active.length, inxRows.length);
  const paired: Array<Record<string, unknown>> = [];
  let durBad = 0;
  for (let i = 0; i < n; i++) {
    const e = active[i]!;
    const r = inxRows[i]!;
    if (e.end - e.start !== r.end - r.start) durBad++;
    const st = motionStateName(r.state);
    const m = nameToState.get(e.motion) ?? new Map<string, number>();
    m.set(st, (m.get(st) ?? 0) + 1);
    nameToState.set(e.motion, m);
    for (const c of e.weapon.codes) if (!typeOfWeaponCodeAuthoritative(c)) unknownCodes.set(c, (unknownCodes.get(c) ?? 0) + 1);

    paired.push({
      inxIndex: r.index,
      inxState: st,
      inxFrames: [r.start, r.end],
      inxEvents: r.events,
      /** `.inx` 的 skillCodeList（技能动画索引）；配合 skills 即为「技能名→索引」绑定 */
      inxSkillCodes: r.skillCodes,
      /** 动作组内局部帧（.in 原值） */
      localFrames: [e.start, e.end],
      collection: e.collection,
      motion: e.motion,
      repeat: e.repeat,
      disabled: e.disabled,
      classes: e.classes,
      locations: e.locations,
      skills: e.skills,
      weapon: e.weapon,
      weaponSemantics: e.weapon.codes.map((c) => ({ code: c, ...(typeOfWeaponCodeAuthoritative(c) ?? { type: 'UNKNOWN', hand: '?' }) })),
      note: e.note,
    });
  }

  totalIn += entries.length;
  totalPaired += n;
  totalDurMismatch += durBad;
  report.push(`${grp}: .in ${entries.length} 条（启用 ${active.length} / 注释 ${entries.length - active.length}）`
    + ` / 同源 .inx ${inxRows.length} 条 → 配对 ${n}，时长不符 ${durBad}`
    + (active.length !== inxRows.length ? `，启用数与 .inx 不等（差 ${active.length - inxRows.length}）` : ' ✓'));

  writeFileSync(resolve(OUT_DIR, `anim-${grp}.generated.json`), JSON.stringify({
    note: '由 scripts/extract-anim-from-in.ts 从 11 职业服务端 .in 明文生成（权威语义源）。'
      + '职业名/武器代码/技能名均为原文明文，不经 sItem 索引。inxFrames 取自同源 .inx（绝对帧）。'
      + '生成物，勿手改。',
    group: grp, source: `.refsrc/in/${grp.toUpperCase()}Bip.in`,
    inEntryCount: entries.length, inxRowCount: inxRows.length, pairedCount: n,
    activeCount: active.length,
    /** 被 .in 以 `//` 注释掉的条目（实测不在 .inx 中，保留供参考） */
    disabledEntries: entries.filter((e) => e.disabled),
    entries: paired,
  }, null, 1) + '\n');
}

/* ─────────── 汇总产物 ─────────── */

const stateMap: Record<string, Record<string, number>> = {};
for (const [k, v] of [...nameToState.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ko'))) {
  stateMap[k] = Object.fromEntries([...v.entries()].sort((a, b) => b[1] - a[1]));
}
writeFileSync(resolve(OUT_DIR, 'motion-state-map.generated.json'), JSON.stringify({
  note: '韩文动作名 → .inx 状态名 的**实测**映射（按顺序+时长配对得出，非人工猜测）。生成物，勿手改。',
  map: stateMap,
}, null, 1) + '\n');

const legend: Record<string, { type: string; hand: string }> = {};
for (const c of ['WA101', 'WA201', 'WC101', 'WD101', 'WD201', 'WH101', 'WM101', 'WN101',
  'WP101', 'WS101', 'WS102', 'WS103', 'WS104', 'WS201', 'WS205', 'WT101', 'WV101', 'WV201']) {
  legend[c] = typeOfWeaponCodeAuthoritative(c) ?? { type: 'UNKNOWN', hand: '?' };
}
writeFileSync(resolve(OUT_DIR, 'weapon-code-legend.generated.json'), JSON.stringify({
  note: '武器代码前缀 → (类型,单双手)。前缀含义取自 11 职业包根目录 `装备代码.txt`：'
    + 'WA斧 WC爪 WD匕 WH锤 WM法杖 WN图腾 WP枪 WS1xx弓 WS2xx剑 WT标枪 WV拳套。'
    + '单双手按百位段 1xx=单手 / 2xx=双手。生成物，勿手改。',
  legend,
}, null, 1) + '\n');

console.log(`.in 条目合计 ${totalIn}；配对 ${totalPaired}；时长不符 ${totalDurMismatch}`);
for (const r of report) console.log('  ' + r);
if (unknownCodes.size) {
  console.log(`\n未识别武器代码 ${unknownCodes.size} 种：`);
  for (const [c, n] of [...unknownCodes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`  ${c} ×${n}`);
}
console.log(`\n韩文动作名 ${nameToState.size} 种。状态名映射抽样：`);
for (const [k, v] of [...nameToState.entries()].slice(0, 16)) {
  console.log(`  ${k.padEnd(16)} → ${[...v.entries()].map(([s, n]) => `${s}×${n}`).join('  ')}`);
}
console.log(`\n写出 ${OUT_DIR}/anim-m{1..8}.generated.json + motion-state-map + weapon-code-legend`);
console.log(`幽灵码剔除：涉及 ${touchedByPhantom} 个条目；其中剔除后武器码为空 ${emptiedByPhantom} 个（已置空列表，不冒充空手）`);
