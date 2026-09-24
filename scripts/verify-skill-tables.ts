/**
 * 技能数据地基的**校验器** —— 钉住 `src/game/data/skill-tables.generated.json` 的四组事实。
 *
 *   校验 A  计数        —— 参数数组 484（int；另有 7 张 float 单列）· 宏 202 · 定义 198/151；
 *                          10 个职业组各 16（4 转 × 4）、无 CHANGE_JOB5
 *   校验 B  fighter 表  —— 45 张 fighter 参数表**逐张**存在，且 `dims` 与 `src` 行号与任务书一致
 *   校验 C  fighter 技能 —— 16 个技能的宏 → `(tier, slotInTier)` 与 Brazil 定义的 `RequireLevel`，
 *                          并要求每条都能**跨语言对齐**（Brazil[i] ↔ English[j] ↔ macro）
 *   校验 D  技能身份 220 行（评审稿 §4 的四条）——
 *                          ① `slotInJob == 客户端数组下标`（220 行逐个，且图标/名/需求等级/武器一致）；
 *                          ② 三方 `iconFile` 一致（生成物 220 ↔ `skillData` 220 ↔ `skillIndexByIcon` 键集），
 *                             已知例外**显式登记**（6 个 null + 4 个 martial 缺席）；
 *                          ③ `skillId` 唯一、`job∈1..11`、`tier∈1..5`、`slot∈1..4`、`id ↔ slotInJob` 一致
 *                             （另钉常量名唯一且是合法 Java 标识符）；
 *                          ④ 与源码对账：**独立**解析 `fileread.cpp` 的 `SkillDataCode[]`，逐行比
 *                             `sourceSkillDataCodeIndex`（名字法）并把「名字对不上、只能按槽号取」的逐条列出；
 *                             `sourceReqLv`/`sourceUseCode` 与定义表逐条比、与誊写的需求等级序逐条比
 *                             （差异只列不报错，但**例外集必须恰好等于登记的那几条**，多一条就红）；
 *                          另：`SkillIds.java` 与生成物必须**双向一致**（220 个名字↔id）。
 *
 * ⚠ 期望值是**独立誊写**（来自 `E:\JPsTale\docs\技能系统-fighter.md` 逐字核对过的口径），
 *   不是从生成物反读出来的 —— 否则校验器只是在自查。抽取与断言对不上时**改抽取器，别改断言**。
 *
 * ⚠ 校验 D 的 ④ 段需要 `.refsrc/tree/fileread.cpp`（gitignore 的参考源）。取不到时**明确报红**
 *   （不静默跳过）：那一段的意义就是"用另一份源码独立复算"，没有它整段等于没跑。
 *
 * 用法：`npm run verify-skill-tables`
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { CLASS_DIR, SKILLS } from '../src/game/skillData.js';
import { SKILL_INDEX_BY_ICON } from '../src/game/data/skillIndexByIcon.js';

const here = dirname(fileURLToPath(import.meta.url));
const PATH = resolve(here, '../src/game/data/skill-tables.generated.json');
const REF = resolve(here, '../.refsrc/tree');
/** 服务端 `SkillIds.java` 的路径（与生成器同一约定：`PT_SERVER_ROOT` 可覆盖） */
const SERVER_ROOT = process.env.PT_SERVER_ROOT ?? resolve(here, '..', '..', 'jpstale-server');
const PATH_JAVA = resolve(SERVER_ROOT, 'modules', 'common-model', 'src', 'main', 'java',
  'org', 'jpstale', 'server', 'common', 'enums', 'skill', 'SkillIds.java');

interface ArrRow { dims: number[]; type: string; values: number[] | number[][]; src: string; srcEnd: string }
interface MacroRow {
  macro: string; group: string; tier: number; slotInTier: number;
  slot: string; slotValue: number; value: number; valueHex: string; src: string;
}
interface DefRow {
  tuple: Array<string | number | null>; src: string;
  code: string | null; macro: string | null; english?: number | null; brazil?: number | null;
}
interface SkillRow {
  job: number; classDir: string; skillId: number; skillIdHex: string;
  slotInJob: number; tier: number; slotInTier: number;
  iconFile: string; name: string; alt: string | null; nameSrc: string; constName: string;
  reqLv: number; useCode: string; weapon: number[];
  macro: string | null; pairing: string;
  sourceReqLv: number | null; sourceUseCode: string | null; sourceName: string | null;
  sourceSkillDataCodeIndex: number | null; sourceSkillDataCodeName: string | null;
  sourceSkillDataCodeSrc: string | null;
}
interface Data {
  note: string; sourceHash: string; sources: Array<{ path: string; bytes: number; sha1: string }>;
  counts: Record<string, number> & { skillPairing?: Record<string, number> };
  arrays: Record<string, ArrRow>;
  defects: Array<{ name: string; src: string; declared: number; actual: number }>;
  macros: MacroRow[];
  definitions: { brazil: DefRow[]; english: DefRow[] };
  align: { rule: string[]; pairs: number; byCode: number; byOrder: number; brazilOnly: Array<{ index: number; macro: string | null; name: string | null }> };
  skills: SkillRow[];
  skillIndex: {
    note: string;
    byClassDir: Record<string, number[]>;
    byMacro: Record<string, number>;
    byIconFile: Record<string, number>;
  };
}

const d = JSON.parse(readFileSync(PATH, 'utf8')) as Data;

let fails = 0;
const ok = (label: string, cond: boolean, detail = ''): void => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) fails++;
};
const dimsStr = (dims: number[]): string => `[${dims.join('][')}]`;
/** `sinbaram/sinSkill_Info.cpp:168` → 168（拿不到就 -1，让断言直接红） */
const lineOf = (src: string): number => {
  const m = /:(\d+)$/.exec(src);
  return m ? Number(m[1]) : -1;
};

/* ─────────────── 校验 A：计数 ─────────────── */

console.log('[校验 A] 计数（口径见生成物 note：arrays=484 只算 int 声明）');
const c = d.counts;
ok('参数数组 int 声明 484（451 一维 + 33 二维）', c.arrays === 484 && c.arrays1d === 451 && c.arrays2d === 33,
  `实得 arrays=${c.arrays} 1d=${c.arrays1d} 2d=${c.arrays2d}`);
ok('另有 float[10] 7 张（如 Raving_UseLife）单列计数', c.arraysFloat1d === 7, `实得 ${c.arraysFloat1d}`);
ok('arrays 表里实际条目 = 484 + 7 = 491（口径自洽）',
  Object.keys(d.arrays).length === 491 && c.arraysTotal === 491 && c.arrays + c.arraysFloat1d === c.arraysTotal,
  `实得 keys=${Object.keys(d.arrays).length} total=${c.arraysTotal}`);
ok('技能宏 202', c.macros === 202 && d.macros.length === 202, `实得 counts=${c.macros} 数组长=${d.macros.length}`);
ok('技能定义 198 (Brazil) / 151 (English)',
  c.defsBrazil === 198 && c.defsEnglish === 151
  && d.definitions.brazil.length === 198 && d.definitions.english.length === 151,
  `实得 ${c.defsBrazil}/${c.defsEnglish}，数组长 ${d.definitions.brazil.length}/${d.definitions.english.length}`);

const JOB_GROUPS = ['GROUP_FIGHTER', 'GROUP_MECHANICIAN', 'GROUP_ARCHER', 'GROUP_PIKEMAN', 'GROUP_ATALANTA',
  'GROUP_KNIGHT', 'GROUP_MAGICIAN', 'GROUP_PRIESTESS', 'GROUP_ASSASSINE', 'GROUP_SHAMAN'];
{
  const bad: string[] = [];
  for (const g of JOB_GROUPS) {
    const n = d.macros.filter((m) => m.group === g).length;
    if (n !== 16) bad.push(`${g}=${n}`);
  }
  ok('10 个职业组各 16 个宏（4 转 × 4）', bad.length === 0, bad.join(' '));
}
{
  // "4/4/4/4"：fighter 每一转各 4 个，且槽位就是 SKILL_1..4
  const f = d.macros.filter((m) => m.group === 'GROUP_FIGHTER');
  const perTier = [1, 2, 3, 4].map((t) => f.filter((m) => m.tier === t).length);
  ok('GROUP_FIGHTER 共 16，且每转 4（4/4/4/4）', f.length === 16 && perTier.every((n) => n === 4),
    `实得 ${f.length}，各转 ${perTier.join('/')}`);
  const slots = f.map((m) => `${m.tier}-${m.slotInTier}`).sort().join(' ');
  ok('fighter 的槽位铺满 1..4 转 × 1..4 槽（无缺口/无重复）',
    slots === '1-1 1-2 1-3 1-4 2-1 2-2 2-3 2-4 3-1 3-2 3-3 3-4 4-1 4-2 4-3 4-4', slots);
}
ok('只有 CHANGE_JOB1..4（本来源没有 CHANGE_JOB5）',
  d.macros.every((m) => m.tier >= 1 && m.tier <= 4)
  && d.macros.every((m) => /^SKILL_\d+$/.test(m.slot)),
  `tier 取值 ${[...new Set(d.macros.map((m) => m.tier))].sort().join(',')}`);
ok('分组总数自洽：职业组 160 + OTHERSKILL 39 + SKILL 3 = 202',
  d.macros.filter((m) => JOB_GROUPS.includes(m.group)).length === 160
  && d.macros.filter((m) => m.group === 'GROUP_OTHERSKILL').length === 39
  && d.macros.filter((m) => m.group === 'GROUP_SKILL').length === 3);
ok('宏值 = 组 | 转职 | 槽位（⚠ SKILL_n 的值不是 n：SKILL_10=0x10）',
  d.macros.every((m) => m.value === (m.value & 0xFFFFFFFF))
  && d.macros.find((m) => m.macro === 'SKILL_SWORD_BLAST')?.valueHex === '0x05010001'
  && d.macros.find((m) => m.slot === 'SKILL_10')?.slotValue === 16);

/* ─────────────── 校验 B：fighter 的 45 张参数表 ─────────────── */

/** 逐张誊写（任务书 B 段的 45 行；任务文本写"40 张"但实际列了 45 行，按列出的断言） */
const FIGHTER_TABLES: Array<[string, string, number]> = [
  ['Melee_Mastery_DamagePercent', '[10]', 97],
  ['PlusFire', '[10]', 100],
  ['Raving_Damage', '[10]', 103],
  ['Ravind_Speed', '[10]', 104],
  ['Raving_UseLife', '[10]', 105],
  ['Raving_UseMana', '[10]', 106],
  ['Impact_Attack_Rating', '[10]', 109],
  ['Impact_Damage', '[10]', 110],
  ['Impact_UseMana', '[10]', 111],
  ['T_Impact_Damage', '[10]', 114],
  ['T_Impact_Hit', '[10]', 115],
  ['T_Impact_UseMana', '[10]', 116],
  ['B_Swing_Damage', '[10]', 119],
  ['B_Swing_Critical', '[10]', 120],
  ['B_Swing_UseMana', '[10]', 121],
  ['Roar_Range', '[10]', 124],
  ['Roar_Time', '[10]', 125],
  ['Roar_UseMana', '[10]', 126],
  ['R_Zecram_Damage', '[10]', 130],
  ['R_Zecram_UseMana', '[10]', 131],
  ['Concentration_AttackRate', '[10]', 136],
  ['Concentration_Time', '[10]', 137],
  ['Concentration_UseMana', '[10]', 138],
  ['A_Crash_Damage', '[10]', 141],
  ['A_Crash_AttackRate', '[10]', 142],
  ['A_Crash_UseMana', '[10]', 143],
  ['Swift_Axe_Speed', '[10]', 146],
  ['Swift_Axe_Time', '[10]', 147],
  ['Swift_Axe_UseMana', '[10]', 148],
  ['B_Crash_Damage', '[10]', 151],
  ['B_Crash_DemonDamage', '[10]', 152],
  ['B_Crash_UseMana', '[10]', 153],
  ['Destoryer_DamagePercent', '[10]', 156],
  ['Destoryer_AddCritical', '[10]', 157],
  ['Destoryer_UseMana', '[10]', 158],
  ['Berserker_AddAttack', '[10]', 161],
  ['Berserker_SubAbsorb', '[10]', 162],
  ['Berserker_Time', '[10]', 163],
  ['Berserker_UseMana', '[10]', 164],
  ['Cyclone_Strike_DamagePercent', '[10]', 167],
  ['Cyclone_Strike_AreaDamage', '[10][2]', 168],
  ['Cyclone_Strike_AttackNum', '[10]', 169],
  ['Cyclone_Strike_Area', '[10]', 170],
  ['Cyclone_Strike_UseMana', '[10]', 171],
  ['Boost_Health_Life', '[10]', 175],
];

console.log(`\n[校验 B] fighter 参数表 ${FIGHTER_TABLES.length} 张（逐张：存在 + dims + src 行号）`);
/*
 * ⚠ 任务书给的行号里，`Cyclone_Strike_AreaDamage` 之后 3 张**差一行** —— 不是抽取错：
 *   `Cyclone_Strike_AreaDamage` 的初始化列表跨 **168–169 两行**（168 是 `int ... = {{...},`，
 *   169 才是收尾 `{195,225},…,{255,285}};`），任务书按"一表一行"顺推，于是把其后各表各推早 1 行。
 *   这里**保留任务书的数、只对这 3 张 +1 校正**，同时把**成因**也断言掉（`srcEnd` 必须真是 169），
 *   免得这句解释变成无法推翻的散文。
 */
const SPILL_TABLES = new Set(['Cyclone_Strike_AttackNum', 'Cyclone_Strike_Area', 'Cyclone_Strike_UseMana']);
{
  const missing: string[] = [];
  const dimBad: string[] = [];
  const lineBad: string[] = [];
  for (const [name, wantDims, wantLine] of FIGHTER_TABLES) {
    const row = d.arrays[name];
    if (!row) { missing.push(name); continue; }
    if (dimsStr(row.dims) !== wantDims) {
      dimBad.push(`${name}: 期望 ${wantDims}，实得 ${dimsStr(row.dims)}（${row.src}）`);
    }
    const expect = wantLine + (SPILL_TABLES.has(name) ? 1 : 0);
    if (lineOf(row.src) !== expect) {
      lineBad.push(`${name}: 期望 sinbaram/sinSkill_Info.cpp:${expect}，实得 ${row.src}`);
    }
  }
  ok(`${FIGHTER_TABLES.length} 张表**全部存在**`, missing.length === 0, missing.length ? `缺 ${missing.join(', ')}` : '');
  ok('dims 全部与期望一致（含 Cyclone_Strike_AreaDamage = [10][2]）', dimBad.length === 0, dimBad.join(' | '));
  ok('src 行号全部与期望一致（跨行表按 +1 校正，原因见下条）', lineBad.length === 0, lineBad.join(' | '));
  const spillRow = d.arrays.Cyclone_Strike_AreaDamage;
  ok('成因核实：Cyclone_Strike_AreaDamage 的初始化列表确实跨两行（168 → 169）',
    lineOf(spillRow?.src ?? '') === 168 && lineOf(spillRow?.srcEnd ?? '') === 169,
    `实得 ${spillRow?.src} → ${spillRow?.srcEnd}`);
  ok('校正只施加于紧随其后的 3 张，且这 3 张的任务书行号恰为 169/170/171',
    FIGHTER_TABLES.filter(([n]) => SPILL_TABLES.has(n)).map(([, , l]) => l).join(',') === '169,170,171');
  // 值域抽查：一维表 10 项、二维表 10×2 —— 防止"抽到了但抽错形状"
  const shapeBad: string[] = [];
  for (const [name, wantDims] of FIGHTER_TABLES) {
    const row = d.arrays[name];
    if (!row) continue;
    if (row.values.length !== 10) shapeBad.push(`${name}: 实得 ${row.values.length} 行`);
    if (wantDims === '[10][2]') {
      for (const [k, r] of (row.values as number[][]).entries()) {
        if (!Array.isArray(r) || r.length !== 2) shapeBad.push(`${name}[${k}]: 实得 ${JSON.stringify(r)}`);
      }
    }
  }
  ok('形状抽查：一维 10 项 / 二维 10×2', shapeBad.length === 0, shapeBad.join(' | '));
}
{
  // 抽查具体值（源文件逐字）：这三张是任务书正文引过的
  const mv = d.arrays.Melee_Mastery_DamagePercent;
  ok('Melee_Mastery_DamagePercent 首/末 = 6 / 32（源码逐字）',
    JSON.stringify(mv?.values) === JSON.stringify([6, 10, 14, 18, 21, 24, 26, 28, 30, 32]));
  const rl = d.arrays.Raving_UseLife;
  ok('Raving_UseLife 是 float 表且末值 3.7（源文件 `1.f,…,3.7f`）',
    rl?.type === 'float' && (rl?.values as number[])[9] === 3.7);
  const bs = d.arrays.Berserker_SubAbsorb;
  ok('Berserker_SubAbsorb 全负（-22…-40，源码逐字）',
    JSON.stringify(bs?.values) === JSON.stringify([-22, -24, -26, -28, -30, -32, -34, -36, -38, -40]));
  const cy = d.arrays.Cyclone_Strike_AreaDamage;
  ok('Cyclone_Strike_AreaDamage 首行 [120,150]、末行 [255,285]（源码逐字）',
    JSON.stringify(cy?.values[0]) === '[120,150]' && JSON.stringify(cy?.values[9]) === '[255,285]');
}

/* ─────────────── 校验 C：fighter 的 16 个技能 ─────────────── */

/** 逐条誊写：宏名、转、槽、Brazil 定义的 RequireLevel（见 docs/技能系统-fighter.md） */
const FIGHTER_SKILLS: Array<[string, number, number, number]> = [
  ['SKILL_MELEE_MASTERY', 1, 1, 10],
  ['SKILL_FIRE_ATTRIBUTE', 1, 2, 12],
  ['SKILL_RAVING', 1, 3, 14],
  ['SKILL_IMPACT', 1, 4, 17],
  ['SKILL_TRIPLE_IMPACT', 2, 1, 20],
  ['SKILL_BRUTAL_SWING', 2, 2, 23],
  ['SKILL_ROAR', 2, 3, 26],
  ['SKILL_RAGE_OF_ZECRAM', 2, 4, 30],
  ['SKILL_CONCENTRATION', 3, 1, 40],
  ['SKILL_AVANGING_CRASH', 3, 2, 43],
  ['SKILL_SWIFT_AXE', 3, 3, 46],
  ['SKILL_BONE_CRASH', 3, 4, 50],
  ['SKILL_DETORYER', 4, 1, 60],
  ['SKILL_BERSERKER', 4, 2, 63],
  ['SKILL_CYCLONE_STRIKE', 4, 3, 66],
  ['SKILL_BOOST_HEALTH', 4, 4, 70],
];

console.log(`\n[校验 C] fighter ${FIGHTER_SKILLS.length} 个技能（宏 → 转/槽 + Brazil RequireLevel + 跨语言对齐）`);
{
  const noMacro: string[] = [];
  const tierBad: string[] = [];
  const lvBad: string[] = [];
  const noAlign: string[] = [];
  const aligned: string[] = [];
  const names: string[] = [];
  for (const [macro, tier, slot, reqLevel] of FIGHTER_SKILLS) {
    const m = d.macros.find((x) => x.macro === macro);
    if (!m) { noMacro.push(macro); continue; }
    if (m.tier !== tier || m.slotInTier !== slot) {
      tierBad.push(`${macro}: 期望 转${tier}/槽${slot}，实得 转${m.tier}/槽${m.slotInTier}（${m.src}）`);
    }
    // 名字 → Brazil 定义（**按 CODE = 宏名**匹配，不是按葡萄牙语名字）
    const i = d.definitions.brazil.findIndex((x) => x.code === macro);
    if (i < 0) { noAlign.push(`${macro}: Brazil 里没有 CODE = ${macro} 的条目`); continue; }
    const br = d.definitions.brazil[i]!;
    const name = typeof br.tuple[0] === 'string' ? br.tuple[0] : '';
    names.push(`${macro} = ${name}`);
    if (br.tuple[2] !== reqLevel) lvBad.push(`${macro}: 期望 RequireLevel ${reqLevel}，实得 ${br.tuple[2]}（${br.src}）`);
    // 跨语言对齐：Brazil[i].english = j 且 English[j].brazil = i 且 English[j].code = macro
    const j = br.english;
    const en = typeof j === 'number' ? d.definitions.english[j] : undefined;
    if (!en || en.code !== macro || en.brazil !== i) {
      noAlign.push(`${macro}: Brazil[${i}] ↔ English[${j ?? 'null'}] 不互指（English.code=${en?.code ?? 'n/a'}）`);
      continue;
    }
    aligned.push(`${macro} → Brazil[${i}] ↔ English[${j}]`);
  }
  ok('16 个宏全部存在', noMacro.length === 0, noMacro.join(', '));
  ok('(转, 槽) 全部与期望一致', tierBad.length === 0, tierBad.join(' | '));
  ok('Brazil 定义的 RequireLevel 全部与期望一致', lvBad.length === 0, lvBad.join(' | '));
  ok('16 条**全部**能对齐到宏（Brazil[i] ↔ English[j] ↔ macro，双向互指）', noAlign.length === 0, noAlign.join(' | '));
  ok('对齐是 1:1 且下标各不相同', new Set(aligned).size === FIGHTER_SKILLS.length, `实得 ${new Set(aligned).size} 条`);
  console.log(`      对照（宏 = Brazil 名）：${names.join(' · ')}`);
}
{
  // 全局对齐统计（这是"其余数据也一起抽"的那部分，形状不对就说明规则跑偏）
  const a = d.align;
  ok('对齐总数 = English 条目数 151（129 按 CODE + 22 按次序）',
    a.pairs === 151 && a.byCode === 129 && a.byOrder === 22,
    `实得 pairs=${a.pairs} byCode=${a.byCode} byOrder=${a.byOrder}`);
  ok('Brazil 独有 47 条（32 条有宏的刺客/萨满段 + 15 条无 CODE 的尾部）', a.brazilOnly.length === 47,
    `实得 ${a.brazilOnly.length}`);
  const enAligned = d.definitions.english.filter((x) => typeof x.brazil === 'number').length;
  ok('English 侧 151 条全部有 Brazil 对应（无孤儿）', enAligned === 151, `实得 ${enAligned}`);
  // 互指自洽：任意 j 满足 english[j].brazil = i ⇒ brazil[i].english = j
  const broken = d.definitions.english
    .map((x, j) => [x, j] as const)
    .filter(([x, j]) => typeof x.brazil === 'number' && d.definitions.brazil[x.brazil!]?.english !== j)
    .map(([x, j]) => `English[${j}] → Brazil[${x.brazil}] 不回指`);
  ok('全部对齐对双向互指', broken.length === 0, broken.slice(0, 5).join(' | '));
  ok('对齐保序（English 顺序 ⊂ Brazil 顺序，随各自下标单调递增）', (() => {
    let lastB = -1;
    for (let j = 0; j < d.definitions.english.length; j++) {
      const i = d.definitions.english[j]!.brazil;
      if (typeof i !== 'number') continue;
      if (i < lastB) return false;
      lastB = i;
    }
    return true;
  })());
  ok('有 CODE 的条目数与期望一致：Brazil 161 / English 129（其余 37 / 22 条无 CODE，不猜）',
    d.definitions.brazil.filter((x) => x.macro !== null).length === 161
    && d.definitions.english.filter((x) => x.macro !== null).length === 129
    && d.definitions.brazil.filter((x) => x.macro === null).length === 37
    && d.definitions.english.filter((x) => x.macro === null).length === 22);
  ok('未配对到宏的条目 CODE 位置留空（macro=null 时 code 也必须是 null）',
    d.definitions.brazil.every((x) => x.macro !== null || x.code === null)
    && d.definitions.english.every((x) => x.macro !== null || x.code === null));
}

/* ─────────────── 校验 D：技能身份 220 行（评审稿 §4 的四条断言） ─────────────── */

/** 归一化：小写 + 去非字母数字（与生成器同一口径，但**独立写在这里**） */
const normName = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');
/** 誊写：需求等级序（`docs/技能系统-作业包-00-总纲.md` §3.7.1 / §3.7.1c；J1..J4 为源码实测、J5 为外推） */
const REQ_LV_BY_SLOT = [10, 12, 14, 17, 20, 23, 26, 30, 40, 43, 46, 50, 60, 63, 66, 70];
const JOB_DIRS: Array<[number, string]> = [
  [1, 'fighter'], [2, 'mecha'], [3, 'archer'], [4, 'pikeman'], [5, 'atalanta'], [6, 'knight'],
  [7, 'magician'], [8, 'priestess'], [9, 'assassin'], [10, 'shaman'], [11, 'martial'],
];
/** 客户端技能定义（只用这几列对账；`weapon` 可缺省） */
interface ClientSkill {
  iconFile: string; name: string; alt?: string; reqLv: number; useCode: string; weapon?: number[];
}
const CLIENT = SKILLS as unknown as Record<string, ClientSkill[]>;
/** ② 六个 `null`（逐条誊写自 `skillIndexByIcon.ts` 的现状：`null` = 回退普攻的显式语义） */
const EXPECT_NULL_ICONS = [
  'ma110 combo_javelin.bmp', 'mm103 stone_skin.bmp', 'mn103 divine_inquisiton.bmp',
  'ms90 h_regene.bmp', 'tf12 f_attribute.bmp', 'tp100 ring_spears.bmp',
];
/** ② 四个缺席（全在 martial：map 里没有这四个键） */
const EXPECT_ABSENT_ICONS = [
  'tma12 s_mastery.bmp', 'tma30 s_mastery.bmp', 'tma80 d_mastery.bmp', 'tma90 h_training.bmp',
];
/** ④ 唯一登记的需求等级例外：刺客 idx15（`SKILL_P_SHADOW`）源码写 66、需求等级序是 70（2026-09-23 裁定取客户端 70） */
const REQ_LV_EXCEPTIONS: Array<[string, number, number, number]> = [['assassin', 15, 66, 70]];
/**
 * ④-1 `SkillDataCode[]` 的职业段（**独立誊写**自源码的形状：`CheckSkillIndex` 的区间 + 表尾的格斗家段）。
 * 左侧 10 段是源码 `CheckSkillIndex` 明写的；格斗家段只在**表里**存在、源码 switch 里没有 case 11
 * ⇒ 生成物对它**留空**（不认领），这里只用它做"每段 20 个槽"的形状检查。
 */
const SDC_RANGES: Record<string, [number, number]> = {
  mecha: [1, 20], fighter: [21, 40], pikeman: [41, 60], archer: [61, 80], knight: [81, 102],
  atalanta: [103, 122], priestess: [123, 142], magician: [143, 162], assassin: [163, 182],
  shaman: [183, 202], martial: [203, 222],
};
/** 源码 `CheckSkillIndex` 认领的 10 个职业（格斗家不在其中 ⇒ 生成物的 source* 列对它留空） */
const SDC_CLAIMED = Object.keys(SDC_RANGES).filter((k) => k !== 'martial');

const clientOf = CLASS_DIR as Record<number, string>;
const skills = d.skills;

console.log(`\n[校验 D] 技能身份 ${skills?.length ?? 0} 行（220 = 11 职业 × 20 槽；评审稿 §4 的四条）`);

if (!Array.isArray(skills) || skills.length === 0) {
  ok('生成物含 skills 段（220 行）', false, `实得 ${Array.isArray(skills) ? '空数组' : '缺键'} —— 先跑 scripts/extract-skill-tables.ts`);
} else {
  /* ① slotInJob == 客户端数组下标（且图标/名/需求等级/武器逐格与客户端一致） */
  {
    const badSlot: string[] = [];
    const badIcon: string[] = [];
    const badName: string[] = [];
    const badLv: string[] = [];
    const badWeapon: string[] = [];
    let total = 0;
    for (const [job, dir] of JOB_DIRS) {
      if (clientOf[job] !== dir) badSlot.push(`job ${job} 的 CLASS_DIR 期望 ${dir}，实得 ${clientOf[job]}`);
      const list = CLIENT[dir];
      if (!list || list.length !== 20) {
        badSlot.push(`${dir} 的 skillData.SKILLS 不是 20 项（实得 ${list?.length ?? '缺'}）`);
        continue;
      }
      const rows = skills.filter((r) => r.classDir === dir).sort((a, b) => a.slotInJob - b.slotInJob);
      if (rows.length !== 20) badSlot.push(`${dir} 在生成物里 ${rows.length} 行，期望 20`);
      for (let i = 0; i < Math.min(rows.length, 20); i++) {
        const r = rows[i]!;
        const s = list[i]!;
        total++;
        if (r.slotInJob !== i) badSlot.push(`${dir} 第 ${i} 行的 slotInJob=${r.slotInJob}`);
        if (r.iconFile !== s.iconFile) badIcon.push(`${dir} idx${i}: 生成物 '${r.iconFile}' vs 客户端 '${s.iconFile}'`);
        if (r.name !== s.name) badName.push(`${dir} idx${i}: 生成物 '${r.name}' vs 客户端 '${s.name}'`);
        if (r.reqLv !== s.reqLv) badLv.push(`${dir} idx${i}: 生成物 ${r.reqLv} vs 客户端 ${s.reqLv}`);
        if (JSON.stringify(r.weapon) !== JSON.stringify(s.weapon ?? [])) {
          badWeapon.push(`${dir} idx${i}: 生成物 ${JSON.stringify(r.weapon)} vs 客户端 ${JSON.stringify(s.weapon ?? [])}`);
        }
      }
    }
    ok('① 11 职业 × 20 槽 = 220 行，且 `slotInJob == 客户端数组下标`',
      total === 220 && skills.length === 220 && badSlot.length === 0,
      `行 ${skills.length} / 逐格 ${total}；${badSlot.slice(0, 5).join(' | ')}`);
    ok('① 图标逐格 = 客户端（生成物不是另一份手抄的骨架）', badIcon.length === 0, badIcon.slice(0, 5).join(' | '));
    ok('① 显示名逐格 = 客户端（本轮**未改**任何客户端名，wartale 名只标来源）',
      badName.length === 0, badName.slice(0, 5).join(' | '));
    ok('① 需求等级取客户端值（与客户端逐格一致）', badLv.length === 0, badLv.slice(0, 5).join(' | '));
    ok('① 可用武器取客户端值（与客户端逐格一致）', badWeapon.length === 0, badWeapon.slice(0, 5).join(' | '));
    // 名字来源标注：只有格斗家是"取自 Button 文件名"（wartale 名待核），其余 200 个都是 wartale 名
    const srcBad = skills.filter((r) => r.nameSrc !== (r.classDir === 'martial' ? 'client-button' : 'wartale'));
    ok('① 每个 5 转/格斗家名字都标了来源 `nameSrc`（200 wartale + 20 client-button）',
      srcBad.length === 0 && skills.filter((r) => r.nameSrc === 'client-button').length === 20,
      srcBad.slice(0, 3).map((r) => `${r.classDir} idx${r.slotInJob}=${r.nameSrc}`).join(' | '));
  }

  /* ② 三方 iconFile 一致 */
  {
    const generated = new Set(skills.map((r) => r.iconFile));
    const mapKeys = new Set(Object.keys(SKILL_INDEX_BY_ICON));
    const absent = [...generated].filter((k) => !mapKeys.has(k)).sort();
    const extra = [...mapKeys].filter((k) => !generated.has(k)).sort();
    const nulls = Object.entries(SKILL_INDEX_BY_ICON).filter(([, v]) => v === null).map(([k]) => k).sort();
    ok('② 生成物 220 个 iconFile 互不相同',
      generated.size === skills.length, `唯一 ${generated.size} / 行 ${skills.length}`);
    ok('② `skillIndexByIcon` 的键集 = 生成物 220 − 缺席 4（且没有多余的键）',
      absent.join('|') === [...EXPECT_ABSENT_ICONS].sort().join('|') && extra.length === 0,
      `缺席 ${absent.join(', ')}；多余 ${extra.join(', ')}`);
    ok('② `null` 的图标恰好是登记的那 6 个（`null` = 回退普攻的显式语义）',
      nulls.join('|') === [...EXPECT_NULL_ICONS].sort().join('|'),
      `实得 ${nulls.join(', ')}`);
    // 覆盖数：220 − 6 null − 4 缺席 = 210
    const covered = [...generated].filter((k) => mapKeys.has(k) && SKILL_INDEX_BY_ICON[k] !== null).length;
    ok('② 有动画索引的覆盖数 = 210（220 − 6 null − 4 缺席）', covered === 210, `实得 ${covered}`);
    ok('② 5 转/格斗家那 60 个里，有索引的恰好 51 个（评审稿 §4 的实测）',
      skills.filter((r) => r.macro === null && typeof SKILL_INDEX_BY_ICON[r.iconFile] === 'number').length === 51,
      `实得 ${skills.filter((r) => r.macro === null && typeof SKILL_INDEX_BY_ICON[r.iconFile] === 'number').length}`);
  }

  /* ③ id / 段位 / 常量名 */
  {
    const ids = new Set<number>();
    const consts = new Set<string>();
    const bad: string[] = [];
    for (const r of skills) {
      if (ids.has(r.skillId)) bad.push(`id 重复 ${r.skillIdHex}`);
      ids.add(r.skillId);
      if (consts.has(r.constName)) bad.push(`常量名重复 ${r.constName}`);
      consts.add(r.constName);
      if (!(r.job >= 1 && r.job <= 11)) bad.push(`${r.constName}: job=${r.job}`);
      if (!(r.tier >= 1 && r.tier <= 5)) bad.push(`${r.constName}: tier=${r.tier}`);
      if (!(r.slotInTier >= 1 && r.slotInTier <= 4)) bad.push(`${r.constName}: slotInTier=${r.slotInTier}`);
      if (r.skillId !== ((r.job << 16) | (r.tier << 8) | r.slotInTier)) bad.push(`${r.constName}: id 与段位不符`);
      if (r.skillIdHex !== '0x' + r.skillId.toString(16).toUpperCase().padStart(6, '0')) {
        bad.push(`${r.constName}: skillIdHex='${r.skillIdHex}' 与 skillId=${r.skillId} 不符`);
      }
      if (r.slotInJob !== (r.tier - 1) * 4 + r.slotInTier - 1) bad.push(`${r.constName}: id ↔ slotInJob 不一致`);
      if (!/^[A-Z][A-Z0-9_]*$/.test(r.constName)) bad.push(`${r.constName}: 不是合法 Java 标识符`);
      if (r.classDir !== (CLASS_DIR as Record<number, string>)[r.job]) bad.push(`${r.constName}: classDir 与 job 不符`);
    }
    ok('③ `skillId` 唯一、`job∈1..11`、`tier∈1..5`、`slot∈1..4`、`id ↔ slotInJob` 一致、常量名合法且唯一',
      bad.length === 0, bad.slice(0, 6).join(' | '));
    // 计数自洽（生成物自带 counts 与行数、pairing 分布）
    const p = d.counts.skillPairing ?? {};
    const dist = skills.reduce<Record<string, number>>((acc, r) => {
      acc[r.pairing] = (acc[r.pairing] ?? 0) + 1;
      return acc;
    }, {});
    ok('③ `counts` 与 220 行自洽（skills=220、有宏 160 / 无宏 60、pairing 分布）',
      d.counts.skills === 220 && d.counts.skillsWithMacro === 160 && d.counts.skillsClientOnly === 60
      && skills.filter((r) => r.macro !== null).length === 160
      && JSON.stringify(p) === JSON.stringify(dist),
      `实得 counts=${JSON.stringify(p)} / 逐行=${JSON.stringify(dist)}`);
    ok('③ `skillIndex` 三张索引与 220 行自洽（byClassDir 11×20 / byMacro 160 / byIconFile 220）',
      Object.keys(d.skillIndex.byClassDir).length === 11
      && Object.values(d.skillIndex.byClassDir).every((a) => a.length === 20)
      && Object.keys(d.skillIndex.byMacro).length === 160
      && Object.keys(d.skillIndex.byIconFile).length === 220
      && skills.every((r) => d.skillIndex.byIconFile[r.iconFile] === r.skillId)
      && skills.every((r) => r.macro === null || d.skillIndex.byMacro[r.macro] === r.skillId),
      `byMacro ${Object.keys(d.skillIndex.byMacro).length} / byIconFile ${Object.keys(d.skillIndex.byIconFile).length}`);
  }

  /* ④ 与源码对账 */
  {
    /* ④-1 独立解析 `fileread.cpp` 的 `SkillDataCode[]`（不复用生成物的任何中间量） */
    const fileread = resolve(REF, 'fileread.cpp');
    if (!existsSync(fileread)) {
      ok(`④ 能读到参考源 .refsrc/tree/fileread.cpp（SkillDataCode 对账的前提）`, false,
        '缺文件 —— `.refsrc/` 是 gitignore 的参考源，取回方式见 AGENTS.md「参考资料源」一节');
    } else {
      const text = readFileSync(fileread, 'latin1');
      const lines = text.split(/\r?\n/);
      let declLine = -1;
      for (let i = 0; i < lines.length; i++) {
        if (/SkillDataCode\s*\[\s*\]\s*=/.test(lines[i]!)) { declLine = i + 1; break; }
      }
      const entries: Array<{ index: number; name: string; line: number }> = [];
      for (let i = declLine; i < lines.length; i++) {
        const m = /^\s*\{\s*"([^"]*)"\s*,\s*(\d+)\s*\}/.exec(lines[i]!);
        if (m) entries.push({ index: entries.length, name: m[1]!, line: i + 1 });
        if (/^\s*\};/.test(lines[i]!)) break;
      }
      const base = declLine + 2;   // `下标 = 行号 − base`（源码口径：5628 = 首个条目行号 ⇒ 与行号法互证）
      const lineFormulaBad = entries.filter((e) => e.index !== 0 && e.line - base !== e.index);
      ok('④-1 `SkillDataCode[]` 解析自洽（下标 = 计数；且与"行号 − 首个条目行号"逐条一致）',
        entries.length === 230 && entries[0]?.name === 'xxxxxxxxxxxxx' && lineFormulaBad.length === 0,
        `条目 ${entries.length}；行号法不符 ${lineFormulaBad.length} 条`);
      // 职业段：由 CheckSkillIndex 的区间决定 —— 这里按**源码的形状**独立誊写段宽（10 个职业段 + 尾部）
      const blockOf = (dir: string): Array<{ index: number; name: string }> => {
        const [lo, hi] = SDC_RANGES[dir]!;
        return entries.filter((e) => e.index >= lo && e.index <= hi);
      };
      // "变体条目"（名字 = 同段另一条目名 + 数字后缀；实测只有 knight 的 DIVINEPIERCING2/3）不占槽
      const slotsOf = (dir: string): Array<{ index: number; name: string }> => {
        const b = blockOf(dir);
        const names = new Set(b.map((e) => e.name));
        return b.filter((e) => {
          const m = /^(.+?)(\d+)$/.exec(e.name);
          return !(m && names.has(m[1]!));
        });
      };
      ok('④-1 每个职业段去掉变体后都是 20 条占槽条目（5 转 × 4 槽）',
        JOB_DIRS.every(([, dir]) => slotsOf(dir).length === 20),
        JOB_DIRS.map(([, dir]) => `${dir}=${slotsOf(dir).length}`).join(' '));
      ok('④-1 变体条目只出现在 knight 段（名字 = 同段另一条目名 + 数字后缀）',
        JOB_DIRS.filter(([, dir]) => slotsOf(dir).length !== blockOf(dir).length).map(([, dir]) => dir).join(',') === 'knight',
        JOB_DIRS.map(([, dir]) => `${dir}=${blockOf(dir).length}`).join(' '));

      /* ④-2 逐行比 `sourceSkillDataCodeIndex`：名字命中的行必须与独立解析一致 */
      const nameMismatch: string[] = [];
      const ambiguous: string[] = [];
      const slotFallback: string[] = [];
      const j5Fallback: string[] = [];
      for (const r of skills) {
        if (!SDC_CLAIMED.includes(r.classDir)) continue;   // 格斗家：源码没认领这一段（生成物留空，另断言）
        const block = blockOf(r.classDir);
        const cands = [normName(r.name), r.alt ? normName(r.alt) : ''].filter(Boolean);
        const hit = block.filter((e) => cands.includes(normName(e.name)));
        if (hit.length > 1) {
          ambiguous.push(`${r.classDir} idx${r.slotInJob} 命中 ${hit.length} 条：`
            + hit.map((e) => `${e.index}:${e.name}`).join(', '));
          continue;
        }
        if (hit.length === 1) {
          if (r.sourceSkillDataCodeSrc !== 'name' || r.sourceSkillDataCodeIndex !== hit[0]!.index) {
            nameMismatch.push(`${r.classDir} idx${r.slotInJob} ${r.name}（${r.macro ?? '5 转'}）：`
              + `独立解析 ${hit[0]!.index}（${hit[0]!.name}）vs 生成物 `
              + `${r.sourceSkillDataCodeIndex}（${r.sourceSkillDataCodeName}, ${r.sourceSkillDataCodeSrc}）`);
          }
        } else if (r.macro !== null) {
          slotFallback.push(`${r.classDir} idx${r.slotInJob} ${r.name}（${r.macro}）⇒ ${r.sourceSkillDataCodeIndex}`
            + ` = ${r.sourceSkillDataCodeName}`);
          if (r.sourceSkillDataCodeSrc !== 'slot') {
            nameMismatch.push(`${r.classDir} idx${r.slotInJob} ${r.name}：段内无同名条目，但生成物标 src=${r.sourceSkillDataCodeSrc}`);
          }
          // 弱法也必须落在段内、且与"跳过变体后的第 n 个槽位"一致
          const local = (r.tier - 1) * 4 + r.slotInTier;
          if (slotsOf(r.classDir)[local - 1]?.index !== r.sourceSkillDataCodeIndex) {
            nameMismatch.push(`${r.classDir} idx${r.slotInJob} ${r.name}：按源码槽号取应为 `
              + `${slotsOf(r.classDir)[local - 1]?.index}，生成物写 ${r.sourceSkillDataCodeIndex}`);
          }
        } else {
          j5Fallback.push(`${r.classDir} idx${r.slotInJob} ${r.name} ⇒ ${r.sourceSkillDataCodeIndex}`
            + ` = ${r.sourceSkillDataCodeName}`);
          if (r.sourceSkillDataCodeSrc !== 'block-j5') {
            nameMismatch.push(`${r.classDir} idx${r.slotInJob} ${r.name}：5 转按段尾定位，但生成物标 src=${r.sourceSkillDataCodeSrc}`);
          }
          const slots = slotsOf(r.classDir);
          if (slots[slots.length - 4 + r.slotInTier - 1]?.index !== r.sourceSkillDataCodeIndex) {
            nameMismatch.push(`${r.classDir} idx${r.slotInJob} ${r.name}：按段尾 4 条取应为 `
              + `${slots[slots.length - 4 + r.slotInTier - 1]?.index}，生成物写 ${r.sourceSkillDataCodeIndex}`);
          }
        }
      }
      ok('④-2 名字能定位的行：生成物 `sourceSkillDataCodeIndex` 与**独立解析**逐条一致',
        nameMismatch.length === 0 && ambiguous.length === 0,
        [...ambiguous, ...nameMismatch].slice(0, 5).join(' | '));
      console.log('      差异逐条列出（④-2）：');
      console.log(`        · 段内无同名、按**源码槽号**取（弱法，已记 src=slot）${slotFallback.length} 条：`);
      for (const x of slotFallback) console.log(`            ${x}`);
      console.log(`        · 5 转按**段尾 4 条**取（已记 src=block-j5）${j5Fallback.length} 条：`);
      for (const x of j5Fallback) console.log(`            ${x}`);
      const martial = skills.filter((r) => r.classDir === 'martial');
      ok('④-2 格斗家那 20 行**留空**（源码 CheckSkillIndex 无 case 11 ⇒ 未认领该段，不猜）',
        martial.length === 20 && martial.every((r) => r.sourceSkillDataCodeIndex === null
          && r.sourceSkillDataCodeSrc === null && r.sourceReqLv === null && r.sourceUseCode === null),
        martial.slice(0, 3).map((r) => `${r.constName}=${r.sourceSkillDataCodeIndex}`).join(' | '));
      console.log(`        · 格斗家段在**表里**存在（${SDC_RANGES.martial!.join('..')}，20 条占槽条目），`
        + '但源码的 CheckSkillIndex 没有 case 11 ⇒ 生成物不认领、20 行 source* 全留空');
    }

    /* ④-3 `sourceReqLv` / `sourceUseCode` 与定义表逐条比 + 与誊写的需求等级序逐条比 */
    const brByMacro = new Map<string, DefRow>();
    for (const x of d.definitions.brazil) if (x.macro) brByMacro.set(x.macro, x);
    const enByMacro = new Map<string, DefRow>();
    for (const x of d.definitions.english) if (x.macro) enByMacro.set(x.macro, x);
    const USE_TOKEN: Record<string, string> = {
      SIN_SKILL_USE_RIGHT: 'RIGHT', SIN_SKILL_USE_LEFT: 'LEFT',
      SIN_SKILL_USE_ALL: 'ALL', SIN_SKILL_USE_NOT: 'NOT',
    };
    const defBad: string[] = [];
    const langBad: string[] = [];
    const seqDiffs: string[] = [];
    for (const r of skills) {
      if (r.macro === null) continue;
      const br = brByMacro.get(r.macro);
      if (!br) { defBad.push(`${r.constName}（${r.macro}）在 Brazil 定义里没有条目`); continue; }
      if (br.tuple[2] !== r.sourceReqLv) {
        defBad.push(`${r.constName}: sourceReqLv=${r.sourceReqLv} vs Brazil tuple[2]=${br.tuple[2]}（${br.src}）`);
      }
      const useTok = br.tuple[20];
      const want = typeof useTok === 'string' ? USE_TOKEN[useTok] ?? useTok : `0x${Number(useTok).toString(16).toUpperCase()}`;
      if (want !== r.sourceUseCode) {
        defBad.push(`${r.constName}: sourceUseCode=${r.sourceUseCode} vs Brazil tuple[20]=${JSON.stringify(useTok)}`);
      }
      // 客户端值与源码值的分歧必须**逐条列出**（`useCode` 按裁定取源码；`reqLv` 取客户端）
      const clientUse = SKILLS[r.classDir]![r.slotInJob]!.useCode;
      if (clientUse !== r.useCode) {
        seqDiffs.push(`useCode 不一致：${r.classDir} idx${r.slotInJob} ${r.name} 客户端=${clientUse} 生成物(源)=${r.useCode}`);
      }
      // 誊写的需求等级序（源码侧）：唯一登记的例外是刺客 idx15
      const expectLv = REQ_LV_BY_SLOT[(r.tier - 1) * 4 + r.slotInTier - 1]!;
      if (r.sourceReqLv !== expectLv) {
        const ex = REQ_LV_EXCEPTIONS.find(([dir, idx]) => dir === r.classDir && idx === r.slotInJob);
        if (ex) {
          if (r.sourceReqLv !== ex[2] || r.reqLv !== ex[3]) {
            defBad.push(`${r.constName}: 登记的例外是 源${ex[2]}/客户端${ex[3]}，实得 源${r.sourceReqLv}/客户端${r.reqLv}`);
          }
        } else {
          defBad.push(`${r.constName}: 源 RequireLevel=${r.sourceReqLv}，誊写的需求等级序期望 ${expectLv}`
            + `（未登记为新例外 —— 要么改誊写、要么改抽取，别放宽这条）`);
        }
      }
      // 跨语言：Brazil / English 对同一宏的 RequireLevel 与 USECODE 必须一致
      const en = enByMacro.get(r.macro);
      if (en && (en.tuple[2] !== br.tuple[2] || en.tuple[20] !== br.tuple[20])) {
        langBad.push(`${r.macro}: Brazil(${br.tuple[2]},${JSON.stringify(br.tuple[20])}) vs `
          + `English(${en.tuple[2]},${JSON.stringify(en.tuple[20])})`);
      }
    }
    ok('④-3 `sourceReqLv`/`sourceUseCode` 与 Brazil 定义**逐条**一致（160 个有源码的行）',
      defBad.length === 0, defBad.slice(0, 5).join(' | '));
    ok('④-3 跨语言一致：BR 与 EN 对同一宏的 RequireLevel / USECODE 无分歧',
      langBad.length === 0, langBad.slice(0, 3).join(' | '));
    // EN 151 只覆盖 8 个职业（各 16）；刺客/萨满的 32 条在 EN 里没有定义（Brazil 独有）⇒ 配对只能靠 BR
    {
      const enPerJob = JOB_DIRS.slice(0, 10).map(([, dir]) => {
        const macrosOfDir = skills.filter((r) => r.classDir === dir && r.macro !== null).map((r) => r.macro!);
        return `${dir}=${macrosOfDir.filter((m) => enByMacro.has(m)).length}`;
      });
      const want = ['fighter=16', 'mecha=16', 'archer=16', 'pikeman=16', 'atalanta=16', 'knight=16',
        'magician=16', 'priestess=16', 'assassin=0', 'shaman=0'];
      ok('④-3 English 只覆盖 8 个职业（各 16），刺客/萨满的 32 条是 Brazil 独有 ⇒ 配对只用 BR',
        enPerJob.join(',') === want.join(','), `实得 ${enPerJob.join(',')}`);
    }
    // 例外集必须**恰好**等于登记的那几条（多了就红 —— 这是"不许静默容忍"的落点）
    const foundExceptions = skills
      .filter((r) => r.macro !== null && r.sourceReqLv !== REQ_LV_BY_SLOT[(r.tier - 1) * 4 + r.slotInTier - 1])
      .map((r) => `${r.classDir}:${r.slotInJob}`).sort();
    ok('④-3 需求等级例外集**恰好**是登记的 1 条（assassin:15，源 66 / 客户端 70）',
      foundExceptions.join(',') === REQ_LV_EXCEPTIONS.map(([dir, idx]) => `${dir}:${idx}`).join(','),
      `实得 [${foundExceptions.join(', ')}]`);
    const useDiffCount = seqDiffs.length;
    console.log('      差异逐条列出（④-3）：与客户端取值不一致的格数：');
    console.log(`        · \`useCode\`：${useDiffCount} 格（裁定①：生成物取**源码** USECODE；`
      + `客户端 skillData 这 ${useDiffCount} 格待第 3 步照改。⚠ 评审稿 §4 记的是 35，实测 ${useDiffCount}）`);
    for (const x of seqDiffs) console.log(`            ${x}`);
    console.log(`        · \`reqLv\`：${skills.filter((r) => r.macro !== null && r.sourceReqLv !== r.reqLv).length} 格`
      + '（客户端值为准；只有登记的那 1 格与源码不同）');
  }

  /* ⑤ `SkillIds.java` ↔ 生成物（220 个名字↔id 双向一致） */
  {
    if (!existsSync(PATH_JAVA)) {
      console.log(`      （服务端 ${PATH_JAVA} 不存在 —— 跳过 SkillIds.java 对账；`
        + '只 clone 了客户端时的正常情形）');
    } else {
      const java = readFileSync(PATH_JAVA, 'utf8');
      const javaRows: Array<{ name: string; id: number }> = [];
      const javaBad: string[] = [];
      for (const m of java.matchAll(/^\s{4}([A-Z][A-Z0-9_]*)\((0x[0-9A-F]+),/gm)) {
        javaRows.push({ name: m[1]!, id: Number(m[2]!) });
      }
      const genById = new Map(skills.map((r) => [r.skillId, r.constName]));
      const genByName = new Map(skills.map((r) => [r.constName, r.skillId]));
      if (javaRows.length !== 220) javaBad.push(`常量 ${javaRows.length} 个，期望 220`);
      if (new Set(javaRows.map((x) => x.name)).size !== javaRows.length) javaBad.push('常量名有重复');
      for (const j of javaRows) {
        if (genById.get(j.id) !== j.name) {
          javaBad.push(`${j.name}(0x${j.id.toString(16)}) 在生成物里是 ${genById.get(j.id) ?? '（无此 id）'}`);
        }
      }
      for (const r of skills) {
        if (genByName.get(r.constName) !== r.skillId || !javaRows.some((x) => x.name === r.constName && x.id === r.skillId)) {
          javaBad.push(`生成物的 ${r.constName}(${r.skillIdHex}) 在 SkillIds.java 里没有对应常量`);
        }
      }
      ok('⑤ `SkillIds.java` 与生成物**双向一致**（220 个名字 ↔ id，无缺无多）',
        javaBad.length === 0, javaBad.slice(0, 5).join(' | '));
    }
  }
}

/* ─────────────── 附：源码自身缺陷（只报不断言） ─────────────── */

console.log('\n[附] 源码初始化列表写短的表（原样记录、未补零；C 编译时会补 0）');
if (d.defects.length === 0) {
  console.log('  （无）');
} else {
  for (const x of d.defects) console.log(`  · ${x.src} ${x.name}: 声明 ${x.declared}，实写 ${x.actual}`);
}


/* ── 校验 D：**中文定义段**（用户 2026-09-24 要求面板用原版中英文本） ──
   两条：① 生成物里必须有 `definitions.chinese` 且条数与 English 一致（同为 8 职业时代的 151 条）；
        ② 名/描述必须**真的解出汉字** —— 抽取器按 latin1 读文件，忘了按 GBK 回解就会得到 `¼«¹â»¤¶Ü`，
           那种数据"看起来有条目"却完全不能用（这条断言就是防它）。 */
{
  const chinese = (d.definitions as any).chinese as Array<{ tuple: Array<string | number | null>; src: string }> | undefined;
  ok('D1 生成物含中文定义段（`definitions.chinese`）', !!chinese && chinese.length > 0);
  ok('D2 中文条目数与英文一致（两份都是 8 职业时代的 151 条）',
    !!chinese && chinese.length === (d.definitions as any).english.length);
  const cjk = /[一-鿿]/;
  const named = (chinese ?? []).filter((r) => cjk.test(String(r.tuple[0] ?? ''))).length;
  ok('D3 中文名真的解出汉字（不是 latin1 乱码）',
    named === (chinese ?? []).length,
    `含汉字 ${named}/${chinese?.length ?? 0}`);
  const described = (chinese ?? []).filter((r) => cjk.test(String(r.tuple[1] ?? ''))).length;
  ok('D4 中文描述真的解出汉字', described === (chinese ?? []).length,
    `含汉字 ${described}/${chinese?.length ?? 0}`);
}

/* ── 校验 E：`element0` 与 `requireMastery` 的**三源对账**（2026-09-24）──
   这两列在 `sinSkill.cpp` 里各被读一次（`:2064` 熟练度恒满、`:2072` CD 档位），而三份语言定义表
   **互相打架**，所以生成物不照抄 Brazil、而是按"English/Chinese 优先"定值并记 `*Src`。本段把那个
   决定变成**可复算、可推翻**的：
     E1 每行都有 `element0 ∈ {0,1}` 与 `*Src`（值域/来源名都在白名单里）；
     E2 English 与 Chinese 在共有宏上**分歧为 0**（两列都查 —— 它们一致才是"英文优先"的前提）；
     E3 Brazil 与 English 的差异**只出现在高转段**：`Element[0]` 96 条差异、`RequireMastery[0]` 7 条差异，
        且这些行 `element0 === 1`（= 同一次"高阶技能无 CD"改写；出现一条不一致就说明口径崩了）；
     E4 5 转那 60 行（无宏定义）：`element0 = 1`（人工裁定，粉色 gage）、`requireMastery = null`
        （**算不出来就报未知**，不编档位）。
   反例：若某天 E3 统计出"差异里有 element0=0 的行" ⇒ 说明 Brazil 的改写不止高阶技能，
   那时必须重新裁定（而不是继续用现在的口径）。 */
console.log('\n[校验 E] `element0` / `requireMastery` 的三源对账（生成物口径 = English/Chinese 优先）');
{
  const rows = d.skills as Array<{ macro: string | null; element0: number; element0Src: string;
    requireMastery: number[] | null; requireMasterySrc: string }>;
  const SRC_OK = new Set(['english', 'chinese', 'brazil', 'manual-override', 'none']);

  const badVal = rows.filter((r) => r.element0 !== 0 && r.element0 !== 1);
  ok('E1 每行 `element0 ∈ {0,1}` 且 `*Src` 在白名单里',
    badVal.length === 0 && rows.every((r) => SRC_OK.has(r.element0Src) && SRC_OK.has(r.requireMasterySrc)),
    `越界 ${badVal.length} 行；Src 取值 ${[...new Set(rows.map((r) => r.element0Src + '/' + r.requireMasterySrc))].join(',')}`);

  const defs = d.definitions as { english: Array<{ macro: string; tuple: unknown[] }>;
    chinese: Array<{ macro: string; tuple: unknown[] }>;
    brazil: Array<{ macro: string; tuple: unknown[] }> };
  const mk = (l: Array<{ macro: string; tuple: unknown[] }>): Map<string, unknown[]> =>
    new Map(l.filter((x) => x.macro).map((x) => [x.macro, x.tuple]));
  const en = mk(defs.english), cn = mk(defs.chinese), br = mk(defs.brazil);

  let enCnEl = 0, enCnRm = 0, both = 0;
  for (const [m, t] of en) {
    const c = cn.get(m);
    if (!c) continue;
    both++;
    if (String(t[7]) !== String(c[7])) enCnEl++;
    if (`${t[5]},${t[6]}` !== `${c[5]},${c[6]}`) enCnRm++;
  }
  ok('E2 English 与 Chinese 在 ' + both + ' 个共有宏上 Element[0] / RequireMastery 分歧都为 0',
    both >= 120 && enCnEl === 0 && enCnRm === 0, `element 分歧 ${enCnEl}、requireMastery 分歧 ${enCnRm}`);

  // Brazil 与 English 的差异（只管英/巴共有的宏；只统计"英=中"的那些，排除中英本身打架）
  const elDiff: string[] = [], rmDiff: string[] = [];
  for (const [m, t] of en) {
    const b = br.get(m), c = cn.get(m);
    if (!b) continue;
    if (String(t[7]) !== String(b[7]) && (!c || String(c[7]) === String(t[7]))) elDiff.push(m);
    if (`${t[5]},${t[6]}` !== `${b[5]},${b[6]}` && (!c || `${c[5]},${c[6]}` === `${t[5]},${t[6]}`)) rmDiff.push(m);
  }
  const byMacro = new Map(rows.filter((r) => r.macro).map((r) => [r.macro!, r]));
  /* ⚠ 实测口径（2026-09-24）：差集**在 Brazil 那边全部 `Element[0] = 1`**（96 条 element 差异按定义如此，
     另 7 条是 RequireMastery[0] 被巴西写成 0，它们同样被巴西标成 Element[0]=1）⇒ "同一次改写"的判据。
     反例：若出现一条差异宏的 `brEl !== 1` ⇒ 巴西改的不止高阶技能，口径必须重新裁定。 */
  const diffMacros = [...new Set([...elDiff, ...rmDiff])];
  const brElOf = new Map(defs.brazil.filter((x) => x.macro).map((x) => [x.macro, x.tuple[7]]));
  const badBrEl = diffMacros.filter((m) => Number(brElOf.get(m)) !== 1);
  const badSrc = diffMacros.filter((m) => byMacro.get(m)?.element0Src !== 'english');
  ok(`E3 Brazil 与 English 的差异（element ${elDiff.length} / rm ${rmDiff.length}，共 ${diffMacros.length} 个宏）`
    + '在 Brazil 那边**全部** Element[0]=1，且我们一律取 English',
    elDiff.length > 0 && rmDiff.length > 0 && badBrEl.length === 0 && badSrc.length === 0,
    `brEl≠1: ${badBrEl.join(',') || '无'}；取值不是 english: ${badSrc.join(',') || '无'}；rm 差异清单 ${rmDiff.join(',')}`);

  const t5 = rows.filter((r) => r.macro === null);
  ok('E4 无宏定义的 ' + t5.length + ' 行：element0 = 1（人工裁定 = 粉色 gage）+ requireMastery = null',
    t5.length > 0 && t5.every((r) => r.element0 === 1 && r.requireMastery === null
      && r.element0Src === 'manual-override' && r.requireMasterySrc === 'none'),
    `实测 element0 取值 ${[...new Set(t5.map((r) => r.element0))].join(',')}`);
}

console.log(fails === 0
  ? `\n✓ verify-skill-tables 通过（校验 A/B/C/D；${Object.keys(d.arrays).length} 表 · ${d.macros.length} 宏 · ${d.definitions.brazil.length}+${d.definitions.english.length}+${d.definitions.chinese.length} 定义）`
  : `\n✗ ${fails} 条不符 —— 改 scripts/extract-skill-tables.ts 的抽取（或生成物），别改断言`);
process.exit(fails === 0 ? 0 : 1);
