/**
 * 语义化动画数据提取 —— 只做「结构化描述」，不生成 glTF。
 *
 * 动机（见 docs/chars/语义化动画系统.md）：PT 的动画匹配依赖 ID ——
 * `.inx` 的 `itemCodeList` 存的是 **sItem 索引**，靠它反查武器 idcode；
 * 新版本客户端/私服新增的武器与技能在这些白名单里**没有编号**，于是
 * `filter` 出空、动画匹配失败。而正确的 ID 是 C++ 里硬编码的，我们不可知。
 *
 * 本提取器把语义从二进制里"拿出来"：
 *   - 武器要求：sItem 索引 → **idcode → (weaponType, handType)** 语义
 *   - 职业位掩码 → **职业名**
 *   - 技能索引 → **技能名**
 *   - 并给每个动作一个**可读 ID**（如 attack_1h_sword#2、skill_brandish#1）
 * 未能解析的武器码会被**显式列出**（这正是"新武器无动画"症状的可见化）。
 *
 * 输出（生成物勿手改，重跑会覆盖）：
 *   src/game/data/anim/anim-<group>.generated.json  每 motion 组一份
 *   src/game/data/anim/weapon-semantics.generated.json  idcode → (type,hand)
 *
 * 用法：npx tsx scripts/extract-anim-semantics.ts
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseInx, parseSmb } from '../src/core/char-parser.js';
import { buildMotionList } from '../src/render/monster-loader.js';
import { decodeClassFlags, motionStateName } from '../src/char/char-format.js';
import { SITEM_CODE_BY_INDEX } from '../src/char/sitem-weapon-index.js';
import { getWeaponTypeFromIdCode, getWeaponSemantics } from '../src/char/weapon-type.js';
import { ITEM_DEFS } from '../src/game/data/itemDefs.js';
import { SKILLS } from '../src/game/skillData.js';
import { SKILL_INDEX_BY_ICON } from '../src/game/data/skillIndexByIcon.js';

const ASSET = resolve(process.env.PT_ASSET_ROOT ?? 'E:/JPsTale/client');
const OUT_DIR = resolve('src/game/data/anim');
/** 空手哨兵：动画白名单里 0xFFFF 表示"空手" */
const UNARMED_SENTINEL = 0xFFFF;

const ab = (p: string): ArrayBuffer => {
  const b = readFileSync(p);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

/* ─────────── 语义词汇表 ─────────── */

/** idcode → 道具定义（仅用于报告里显示名称/图标，不参与语义判定） */
const ITEM_DEFS_BY_CODE = new Map(ITEM_DEFS.map((d) => [d.code, d]));

/**
 * idcode → { type, hand }。
 * 权威来源 = DB `gamedb.itemlist`（经 item-weapon-semantics.generated.json），
 * 里面已有 type / hand / attackClass / primaryClass 四列，不再自行推导。
 * `type` 拿不到 = 该 idcode 不在 DB 的武器集合里（记入 dbMissing 供核对）。
 */
const weaponSemantics = new Map<number, { type: string; hand: string }>();
function semanticsOfIdCode(idcode: number): { type: string; hand: string } | null {
  const hit = weaponSemantics.get(idcode);
  if (hit) return hit;
  const sem = getWeaponSemantics(idcode);
  if (!sem) {
    // DB 里没有：仍给一次前缀兜底（新武器/私服武器），但记入 dbMissing
    const t = getWeaponTypeFromIdCode(idcode);
    if (!t) return null;
    const v = { type: t, hand: '?' };
    weaponSemantics.set(idcode, v);
    return v;
  }
  const v = { type: sem.type, hand: sem.hand };
  weaponSemantics.set(idcode, v);
  return v;
}

/** 技能索引 → 技能名（由 iconFile → index 反查） */
const SKILL_NAME_BY_INDEX = new Map<number, string>();
for (const [classDir, list] of Object.entries(SKILLS)) {
  for (const s of list) {
    const idx = SKILL_INDEX_BY_ICON[s.iconFile];
    if (idx != null && idx >= 0 && !SKILL_NAME_BY_INDEX.has(idx)) SKILL_NAME_BY_INDEX.set(idx, s.name);
    void classDir;
  }
}

/* ─────────── 动作条目 → 结构化 ─────────── */

interface WeaponReq { any: boolean; unarmed: boolean; list: Array<{ type: string; hand: string }> }
interface AnimEntry {
  id: string;
  state: string;
  frames: [number, number];
  repeat: boolean;
  eventFrames: number[];
  classes: string[];
  weapon: WeaponReq;
  skills: string[];
  location: 'village' | 'field' | 'any';
  /** 原始索引，便于回溯与交叉验证 */
  raw: { index: number; itemCodes: number[]; skillCodes: number[]; motionFrame: number };
  /** 未能解析的武器（idcode 或 sItem 索引）——"新武器无动画"症状 */
  unresolvedItems: number[];
  /**
   * 白名单解析情况。这是**覆盖率**，不是"对错"：
   * sItem 索引表天然缺新职业/新武器，解析不出来是常态而非错误 —— 也正是要做
   * 语义化动画系统的原因。判据从来不该是"索引能不能对上"，而是"这条动画是什么语义"。
   */
  xref: {
    idcodeTypes: string[];
    /** 图标文件名的字母前缀。注意 `ws` 是**跨类型共用图集**（剑/匕首/弓/弩都在内），
     *  故它只作为"用了哪张图集"的记录，**不可**当作武器类型的判据。 */
    iconFamilies: string[];
    /** 白名单码数 / 其中能查到 idcode 的码数 */
    coverage: { total: number; resolved: number };
    /** full=全部解析；partial=部分（新武器常态）；none=一条都没解析出来；
     *  empty=该条目没有白名单。none 时语义由帧/事件特征承担，
     *  例如刺客双持匕首 = Assassin + ATTACK + 双结算帧。 */
    coverageLevel: 'full' | 'partial' | 'none' | 'empty';
    /** coverageLevel=none 时的帧/事件特征（用于在索引解析不了时仍能识别） */
    frameSignature?: { hitSettlements: number; spanFrames: number };
  };
}

function weaponReqOf(itemCodes: number[], count: number): { req: WeaponReq; unresolved: number[] } {
  const req: WeaponReq = { any: false, unarmed: false, list: [] };
  const unresolved: number[] = [];
  if (count <= 0) { req.any = true; return { req, unresolved }; }
  for (let i = 0; i < count && i < 52; i++) {
    const idx = itemCodes[i]!;
    // 0 与超出 sItem 表的值为**数组补位**，不是"未知武器"（曾把它们计入未解析，虚报数千条）
    if (idx === 0) continue;
    if (idx === UNARMED_SENTINEL) { req.unarmed = true; continue; }
    const idcode = SITEM_CODE_BY_INDEX[idx];
    if (idcode == null || idcode === 0) continue;   // 补位
    const sem = semanticsOfIdCode(idcode);
    if (!sem) { unresolved.push(idcode); continue; } // 真·未知：idcode 存在但推不出武器类型
    if (!req.list.some((w) => w.type === sem.type && w.hand === sem.hand)) req.list.push(sem);
  }
  return { req, unresolved };
}

/** 可读 ID：家族 + 武器语义 + 变体序号（同基名多条目时加 #N） */
function baseId(state: string, req: WeaponReq, skills: string[]): string {
  if (state === 'SKILL' && skills.length) {
    const s = skills[0]!.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    return `skill_${s}`;
  }
  const fam: Record<string, string> = {
    STAND: 'stand', WALK: 'walk', RUN: 'run', ATTACK: 'attack', SKILL: 'skill',
    DAMAGE: 'damage', DEAD: 'dead', FALLDOWN: 'fall', FALLSTAND: 'fallstand',
    FALLDAMAGE: 'falldamage', RESTART: 'restart', EAT: 'eat', WARP: 'warp',
  };
  const f = fam[state] ?? state.toLowerCase();
  if (req.unarmed) return `${f}_unarmed`;
  if (req.any || req.list.length === 0) return f;
  if (req.list.length === 1) {
    const w = req.list[0]!;
    return `${f}_${w.hand.toLowerCase()}_${w.type.toLowerCase()}`;
  }
  return `${f}_mixed`;   // 一个条目覆盖多种武器（如"全部"）
}

/* ─────────── 遍历 motion 组 ─────────── */

const GROUPS = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'];
const summary: string[] = [];
let totalEntries = 0;
let totalUnresolved = 0;
/** (state,weapon,hand) 组合 → 是否有条目（用于暴露"匹配不到"的组合） */
const covered = new Set<string>();
/**
 * 解析不出的 sItem 索引 → 引用次数。这是"新职业/新武器"的清单：
 * 这些索引在 .inx 白名单里，但 sItem 表没有对应项，所以查不到 idcode。
 * 不当作错误，而是当作"语义待补"的资产待办。
 */
const unresolvedIdx = new Map<number, { idx: number; entryCount: number; groups: Set<string> }>();

mkdirSync(OUT_DIR, { recursive: true });

/* ── 预扫描：图标前缀 ↔ idcode 推出的武器类型，共现统计 ──
   两个信号都来自资产/我们的表，谁对事先不知道 —— 所以用**全局多数表决**得出映射，
   条目只按"是否符合多数"标注可信度，不由我预先断言某一路正确。 */
const prefixTypeCount = new Map<string, Map<string, number>>();
for (const grp of GROUPS) {
  const inxPath = `${ASSET}/char/tmabcd/${grp}bip.inx`;
  const smbPath = `${ASSET}/char/tmabcd/${grp}.smb`;
  if (!existsSync(inxPath) || !existsSync(smbPath)) continue;
  let ms;
  try { ms = buildMotionList(parseSmb(ab(smbPath)), parseInx(ab(inxPath))); } catch { continue; }
  for (const m of ms) {
    const codes = Array.from(m.itemCodeList ?? []).slice(0, m.itemCodeCount).filter((x) => x !== 0);
    for (const idx of codes) {
      if (idx === UNARMED_SENTINEL) continue;
      const idcode = SITEM_CODE_BY_INDEX[idx];
      if (idcode == null || idcode === 0) continue;
      const d = ITEM_DEFS_BY_CODE.get(idcode);
      const pre = d?.icon ? d.icon.replace(/[0-9].*$/, '') : null;
      const t = getWeaponTypeFromIdCode(idcode);
      if (!pre || !t) continue;
      const m2 = prefixTypeCount.get(pre) ?? new Map<string, number>();
      m2.set(t, (m2.get(t) ?? 0) + 1);
      prefixTypeCount.set(pre, m2);
    }
  }
}
/** 前缀 → 类型共现表决；用于**报告**（不是判据）：哪个图标图集跨了类型 */
const ambiguousPrefixes: string[] = [];
for (const [pre, m2] of prefixTypeCount) {
  const sorted = [...m2.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length > 1 && sorted[1]![1] > 0) {
    const tot = sorted.reduce((s, [, c]) => s + c, 0);
    ambiguousPrefixes.push(`${pre}: ${sorted.map(([t, c]) => `${t}×${c}(${((100 * c) / tot).toFixed(0)}%)`).join(' vs ')}`);
  }
}

// 名称判据已废弃：道具名称与游戏归类本就不一致（`Dagger` 归 Swords、
// `Hand Blade` 归 Claws、`Horned Bow` 的 idcode 是弩），拿名称当"第三路信号"
// 只会把道具级异常重复计到几百个条目上。真正的判据是 DB 的四列。
// 教训与判据演进见 AGENTS.md「已知纠错」第 3 条。

for (const grp of GROUPS) {
  const inxPath = `${ASSET}/char/tmabcd/${grp}bip.inx`;
  const smbPath = `${ASSET}/char/tmabcd/${grp}.smb`;
  if (!existsSync(inxPath) || !existsSync(smbPath)) { summary.push(`${grp}: 缺文件，跳过`); continue; }

  let motions;
  try {
    const bip = parseInx(ab(inxPath));
    const smb = parseSmb(ab(smbPath));
    motions = buildMotionList(smb, bip);
  } catch (e) {
    summary.push(`${grp}: 解析失败 ${(e as Error).message}`);
    continue;
  }

  const entries: AnimEntry[] = [];
  const idCount = new Map<string, number>();
  for (const m of motions) {
    const skills = Array.from(m.skillCodeList ?? []).filter((x) => x >= 0)
      .map((x) => SKILL_NAME_BY_INDEX.get(x))
      .filter((x): x is string => !!x);
    const { req, unresolved } = weaponReqOf(Array.from(m.itemCodeList ?? []), m.itemCodeCount);
    const state = motionStateName(m.state);
    const base = baseId(state, req, skills);
    const n = (idCount.get(base) ?? 0) + 1;
    idCount.set(base, n);
    const id = n > 1 ? `${base}#${n}` : base;

    for (const w of req.list) covered.add(`${state}|${w.type}|${w.hand}`);
    if (req.unarmed) covered.add(`${state}|UNARMED|-`);
    if (req.any) covered.add(`${state}|ANY|-`);

    // 交叉核对（不参与匹配，只用于标注可信度）
    //
    // 两版错误判据的教训（勿重蹈）：
    //   v1 用「图标前缀全局多数」—— `ws` 是跨类型共用图集（剑/匕首/弓/弩都在内），
    //      720 条里 406 条被误标冲突，全是假象。
    //   v2 用「道具名称」—— 名称与游戏归类本就不一致（`Dagger` 归 Swords、
    //      `Hand Blade` 归 Claws），且异常是**道具级**的，会被引用它的众条目
    //      重复计成 193 条。
    // v3 起改用 DB `gamedb.itemlist` 的四列（正交且权威）。判据只剩一个：
    //   白名单里出现了**不在 DB 武器表里**的 idcode —— 那才说明表漂移、需要人看。
    const codes = Array.from(m.itemCodeList ?? []).slice(0, m.itemCodeCount).filter((x) => x !== 0 && x !== UNARMED_SENTINEL);
    const idcodeTypes: string[] = [];
    const iconFamilies: string[] = [];
    let resolved = 0;
    for (const idx of codes) {
      const idcode = SITEM_CODE_BY_INDEX[idx];
      if (idcode == null || idcode === 0) {
        // 解析不出 = sItem 表缺这一项（新职业/新武器）。记录下来，但不当作错误。
        const a = unresolvedIdx.get(idx) ?? { idx, entryCount: 0, groups: new Set<string>() };
        a.entryCount++;
        a.groups.add(grp);
        unresolvedIdx.set(idx, a);
        continue;
      }
      resolved++;
      const d = ITEM_DEFS_BY_CODE.get(idcode);
      const pre = d?.icon ? d.icon.replace(/[0-9].*$/, '') : null;
      const sem = getWeaponSemantics(idcode);
      const t = sem?.type ?? getWeaponTypeFromIdCode(idcode);
      if (t && !idcodeTypes.includes(t)) idcodeTypes.push(t);
      if (pre && !iconFamilies.includes(pre)) iconFamilies.push(pre);
    }
    const coverageLevel: AnimEntry['xref']['coverageLevel'] =
      codes.length === 0 ? 'empty'
        : resolved === 0 ? 'none'
          : resolved === codes.length ? 'full' : 'partial';
    const xref: AnimEntry['xref'] = {
      idcodeTypes, iconFamilies,
      coverage: { total: codes.length, resolved },
      coverageLevel,
    };
    // 一条都解析不出来时，语义只能靠帧/事件特征承担（如刺客双持 = 双结算帧）
    if (coverageLevel === 'none') {
      xref.frameSignature = {
        hitSettlements: Array.from(m.eventFrame ?? []).filter((x) => x > 0).length,
        spanFrames: m.endFrame - m.startFrame,
      };
    }

    entries.push({
      id, state, frames: [m.startFrame, m.endFrame], repeat: !!m.repeat,
      eventFrames: Array.from(m.eventFrame ?? []).filter((x) => x > 0),
      classes: decodeClassFlags(m.dwJobCodeBit),
      weapon: req, skills,
      location: m.mapPosition === 1 ? 'village' : m.mapPosition === 2 ? 'field' : 'any',
      raw: {
        index: m.index,
        itemCodes: Array.from(m.itemCodeList ?? []).slice(0, m.itemCodeCount),
        skillCodes: Array.from(m.skillCodeList ?? []).filter((x) => x > 0),
        motionFrame: m.motionFrame,
      },
      unresolvedItems: unresolved,
      xref,
    });
    totalUnresolved += unresolved.length;
  }

  writeFileSync(resolve(OUT_DIR, `anim-${grp}.generated.json`), JSON.stringify({
    note: '由 scripts/extract-anim-semantics.ts 从当前客户端 .inx/.smb 提取的语义表（生成物，勿手改）。'
      + '武器要求已从 sItem 索引翻为 (weaponType,handType) 语义；与 glTF 无关，只描述"这是什么动作"。',
    group: grp, smb: `${grp}.smb`, entryCount: entries.length, entries,
  }, null, 1) + '\n');

  totalEntries += entries.length;
  const byState = new Map<string, number>();
  for (const e of entries) byState.set(e.state, (byState.get(e.state) ?? 0) + 1);
  summary.push(`${grp}: ${entries.length} 条  [${[...byState.entries()].map(([k, v]) => `${k}:${v}`).join(' ')}]`);
}

writeFileSync(resolve(OUT_DIR, 'weapon-semantics.generated.json'),
  JSON.stringify({ note: 'idcode → (weaponType, handType) 语义词汇表', table: [...weaponSemantics.entries()] }, null, 1) + '\n');

// 图标前缀表决表：记录"哪个图标图集跨了武器类型"。
// 关键的负面知识：`ws` 同时涵盖 剑/匕首/弓/弩，所以 **不能**把图标前缀当类型判据。
writeFileSync(resolve(OUT_DIR, 'icon-prefix-vote.generated.json'),
  JSON.stringify({
    note: '图标文件名前缀 ↔ idcode 武器类型 的全局共现次数。'
      + '用于判定某前缀能否作为类型判据（单一类型=可以；跨类型=不可以，如 ws 涵盖 剑/匕首/弓/弩）。'
      + '生成物，勿手改。',
    scannedHits: [...prefixTypeCount.values()].reduce((s, m2) => s + [...m2.values()].reduce((a, b) => a + b, 0), 0),
    prefixes: [...prefixTypeCount.entries()].sort().map(([prefix, m2]) => {
      const sorted = [...m2.entries()].sort((a, b) => b[1] - a[1]);
      const total = sorted.reduce((s, [, c]) => s + c, 0);
      const majority = sorted[0]![0];
      const ambiguous = sorted.length > 1 && sorted[1]![1] > 0;
      return {
        prefix, total, majority, ambiguous,
        /** 仅当 !ambiguous 时该前缀可作为武器类型判据 */
        usableAsTypeOracle: !ambiguous,
        types: sorted.map(([type, count]) => ({ type, count, pct: Math.round((100 * count) / total) })),
      };
    }),
    ambiguousPrefixes,
  }, null, 1) + '\n');

// 漂移清单：动画白名单里出现、但不在 DB 武器表内的 idcode。
// 非空说明 sItem 索引表与 DB 之间发生漂移，这才是要人工核对的清单。
writeFileSync(resolve(OUT_DIR, 'sitem-unresolved-indices.generated.json'),
  JSON.stringify({
    note: '动画白名单里出现、但 sItem 索引表查不到 idcode 的索引（按索引去重）。'
      + '这是**新职业/新武器的待补清单**，不是错误 —— sItem 表本就缺它们，'
      + '这也正是要做语义化动画系统的原因：语义不依赖索引解析的完整性。'
      + '这些条目请靠 覆盖率 + 帧/事件特征（见各条目 xref.frameSignature）识别。生成物，勿手改。',
    count: unresolvedIdx.size,
    items: [...unresolvedIdx.values()]
      .map((v) => ({ idx: v.idx, entryCount: v.entryCount, groups: [...v.groups].sort() }))
      .sort((a, b) => b.entryCount - a.entryCount),
  }, null, 1) + '\n');

console.log(`动作条目合计 ${totalEntries}；未能解析的武器引用 ${totalUnresolved} 处`);
for (const s of summary) console.log('  ' + s);
console.log(`\n已覆盖的 (状态,武器,手) 组合 ${covered.size} 个`);
if (ambiguousPrefixes.length) {
  console.log('\n图标前缀含混（不可作类型判据）：');
  for (const a of ambiguousPrefixes) console.log('  ' + a);
}
const cov = { full: 0, partial: 0, none: 0, empty: 0 } as Record<string, number>;
for (const grp of GROUPS) {
  const p = resolve(OUT_DIR, `anim-${grp}.generated.json`);
  if (!existsSync(p)) continue;
  for (const e of (JSON.parse(readFileSync(p, 'utf8')) as { entries: AnimEntry[] }).entries) cov[e.xref.coverageLevel]!++;
}
console.log(`\n白名单覆盖率：全部解析 ${cov.full} / 部分解析 ${cov.partial} / 一条未解析 ${cov.none} / 无白名单 ${cov.empty}`);
console.log(`解析不出的 sItem 索引 ${unresolvedIdx.size} 个（新武器待补清单，见 sitem-unresolved-indices.generated.json），引用最多的：`);
for (const a of [...unresolvedIdx.values()].sort((x, y) => y.entryCount - x.entryCount).slice(0, 12)) {
  console.log(`  idx ${String(a.idx).padStart(4)}  被 ${String(a.entryCount).padStart(4)} 个条目引用  组 ${[...a.groups].sort().join(',')}`);
}
console.log(`写出 ${OUT_DIR}/anim-<group>.generated.json、weapon-semantics.generated.json、icon-prefix-vote.generated.json、sitem-unresolved-indices.generated.json`);
