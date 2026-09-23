/**
 * **右键"无目标施放"名单生成器** —— 抽 `OpenPlaySkill()`（`.refsrc/tree/SkillSub.cpp`）里
 * `switch (lpSkill->Skill_Info.CODE)` 内**全部** `case SKILL_*`，并对我方 220 行技能表做 join 报告。
 *
 * 用途：`WorldView` 的右键 = **先试无目标施放**（原版 `Winmain.cpp:3080-3090`），
 * 名单就是这份生成物；不在名单里的技能右键只走"用右拳打光标下的怪"。
 * 逐行调研见 `docs/技能施法-原版流程.md`（§5.1 / 附录 A / §12）。
 *
 * 输入：`.refsrc/tree/SkillSub.cpp`（⚠ 该文件会被 `grep` 当二进制，命令行要加 `-a`）。
 * 扫描判据（含"为什么不是 57 条"）写在 `scripts/openplay-scan.ts` 头注释 —— 那是**唯一实现**。
 *
 * 输出：`src/game/data/source/skill-openplay-macros.json`
 *       （名单 + 函数/switch 行号 + 与我方技能表的 join 覆盖率；**对不上的逐条列出，不静默丢**）
 *
 * 用法：`npm run openplay-skills`
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanOpenPlayCases, scanSkillDistRangeCases } from './openplay-scan.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const REF = resolve(ROOT, '.refsrc/tree/SkillSub.cpp');
const OUT = resolve(ROOT, 'src/game/data/source/skill-openplay-macros.json');
const TABLES = resolve(ROOT, 'src/game/data/skill-tables.generated.json');

if (!existsSync(REF)) {
  console.error('✗ 缺少 .refsrc/tree/SkillSub.cpp');
  console.error('  `.refsrc/` 是 gitignore 的参考源目录；取回方式见 AGENTS.md「参考资料源」一节。');
  process.exit(1);
}
if (!existsSync(TABLES)) {
  console.error(`✗ 缺少 ${TABLES} —— 先跑 \`npm run\` 的 extract-skill-tables 生成技能表`);
  process.exit(1);
}

/** ⚠ 读成 latin1：源文件是 EUC-KR/CJK 混编码，用 utf8 解会抛错或被替换字符吃掉字节，影响不了 ASCII 宏名但会让行号统计失真 */
const src = readFileSync(REF, 'latin1');
const scan = scanOpenPlayCases(src);
/**
 * 同文件 `GetSkillDistRange()`（射程表）也是 `case SKILL_*`，**两张表的部分技能本来就会重叠**
 * （Healing/Virtual Life/… 既有射程、也能无目标放），所以"名单与它不相交"是**错的断言**。
 * 真正的反向证据 = 它出现在**另一个函数**里：它的函数头在 `OpenPlaySkill` 的闭合 `}` 之后。
 */
const distScan = scanSkillDistRangeCases(src);
if (distScan.funcLine <= scan.funcEndLine) {
  console.error(`✗ GetSkillDistRange（第 ${distScan.funcLine} 行）不晚于 OpenPlaySkill 的闭合行`
    + `（第 ${scan.funcEndLine} 行）—— 两个 switch 的边界判据失效`);
  process.exit(1);
}

interface SkillRow { classDir: string; useCode: string; macro: string | null }
const table = JSON.parse(readFileSync(TABLES, 'utf8')) as {
  skills: SkillRow[];
  macros: Array<{ macro: string; group: string; src: string }>;
};
const byMacro = new Map<string, SkillRow>();
for (const r of table.skills) if (r.macro) byMacro.set(r.macro, r);
const definedMacros = new Set(table.macros.map((m) => m.macro));

const macros = scan.cases.map((c) => c.macro);
const matched = macros.filter((m) => byMacro.has(m));
const missing = macros.filter((m) => !byMacro.has(m));
const notDefinedInHeader = macros.filter((m) => !definedMacros.has(m));
const byUseCode: Record<string, number> = {};
const byClassDir: Record<string, number> = {};
for (const m of matched) {
  const r = byMacro.get(m)!;
  byUseCode[r.useCode] = (byUseCode[r.useCode] ?? 0) + 1;
  byClassDir[r.classDir] = (byClassDir[r.classDir] ?? 0) + 1;
}

const out = {
  note: '右键"无目标施放"技能名单（生成物，勿手改；重生用 `npm run openplay-skills`）。'
    + `来源 = .refsrc/tree/SkillSub.cpp 的 int OpenPlaySkill(sSKILL*)（第 ${scan.funcLine} 行）内`
    + ` switch (lpSkill->Skill_Info.CODE)（第 ${scan.switchLine} 行）到其闭合 }（第 ${scan.switchEndLine} 行）`
    + ' 之间**花括号深度 = 1** 的全部 case SKILL_*。'
    + ' 判据与"为什么不是行号窗口切出的 57 条"见 scripts/openplay-scan.ts 头注释；'
    + ' 逐行调研与闸门出处见 docs/技能施法-原版流程.md。'
    + ' ⚠ 同文件 GetSkillDistRange（射程表）也是 case SKILL_*，是**另一个函数里的另一个 switch**'
    + '（其分支与本名单**本来就会重叠**，故"不相交"不是判据）；它的边界记在 excludedOtherSwitch 里供复核。'
    + ' ⚠ 名单只回答"这个技能**能不能**无目标放"，**不含**源码每个 case 自己的守卫'
    + '（如 SKILL_TRIUMPH_OF_VALHALLA 要求"没选中任何角色"）—— 那部分本轮未实现。',
  source: '.refsrc/tree/SkillSub.cpp',
  function: 'OpenPlaySkill',
  funcLine: scan.funcLine,
  funcEndLine: scan.funcEndLine,
  switchLine: scan.switchLine,
  switchEndLine: scan.switchEndLine,
  count: macros.length,
  /** 同文件 `GetSkillDistRange()`（技能射程表）也有 `case SKILL_*`，是**另一个函数里的另一个 switch** —— 留痕供复核 */
  excludedOtherSwitch: {
    function: 'GetSkillDistRange',
    switchLine: distScan.switchLine,
    switchEndLine: distScan.switchEndLine,
    cases: distScan.cases.map((c) => c.macro),
  },
  /** 本函数区间内**深度 ≠ 1** 的 `case`（嵌套 switch 的分支）—— 应为空；非空说明判据要复核 */
  nestedCasesInBody: scan.nestedCases.map((c) => ({ macro: c.macro, line: c.line })),
  join: {
    tableRows: table.skills.length,
    matched: matched.length,
    missing,
    notDefinedInSinSkillH: notDefinedInHeader,
    byUseCode,
    byClassDir,
  },
  macros: scan.cases.map((c) => ({ macro: c.macro, line: c.line })),
};
writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');

console.log(`OpenPlaySkill 无目标施放名单 ${macros.length} 条`
  + `（函数第 ${scan.funcLine} 行 / switch 第 ${scan.switchLine}..${scan.switchEndLine} 行）`);
console.log(`已排除的另一个 switch：GetSkillDistRange（第 ${distScan.switchLine}..${distScan.switchEndLine} 行）`
  + ` ${distScan.cases.length} 条分支（${distScan.cases.slice(0, 4).map((c) => c.macro).join(', ')}…）`);
console.log(`本函数体内嵌套 switch 的 case：${scan.nestedCases.length} 条（应为 0）`);
console.log(`与我方 ${table.skills.length} 行技能表 join：对上 ${matched.length} / 对不上 ${missing.length}`);
if (missing.length) console.log(`  对不上：${missing.join(', ')}`);
if (notDefinedInHeader.length) console.log(`  ⚠ 不在 sinbaram/sinSkill.h 宏表里：${notDefinedInHeader.join(', ')}`);
console.log(`  useCode 分布：${Object.entries(byUseCode).map(([k, v]) => `${k}=${v}`).join(' ')}`);
console.log(`  职业分布：${Object.entries(byClassDir).map(([k, v]) => `${k}=${v}`).join(' ')}`);
console.log(`写出 ${OUT}`);
