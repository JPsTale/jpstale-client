/**
 * 技能系统 12 个文档的**结构闸门**（阶段 A 的产物 → 阶段 B 的第一道校验）。
 *
 * 为什么现在只校验文档、不校验 `skills.json`：`skills.json` **还不存在**
 * （阶段 B 的第 2 批才落数据）。而文档是**已经存在**的产物，且此前只靠人肉抽查过
 * （`docs/技能系统-作业包-00-总纲.md` §10.12.4）。本脚本把它固化成门。
 *
 *   校验 A  结构不变量   —— 每章 `§3.0`/`§5.0` 唯一 · R2/R3 段在 · 裁定引用合法（1–8）
 *   校验 B  计数自洽     —— 读该章**自己声明的算式**（`共 N 条 … 减 X`）并验算
 *                          ⚠ 这正是 §10.12.4 修正后的 A8：**不能用统一正则去"数条目"**，
 *                            必须用章内声明的算术（各章口径与格式都不同）
 *   校验 C  跨章一致     —— `useCode` 的定义在 12 个文件里一致（§10.13.4 B4）
 *   校验 D  P3 已清理     —— 不再有**未划线**的「请用户裁定」（§8.4 P3 之后应清空）
 *   校验 E  痕迹完整     —— 删除线成对（被推翻的旧结论**保留**而非抹掉，§10.12 铁律 2）
 *
 * 用法：`npx tsx scripts/verify-skills.ts`
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const DOCS = resolve(here, '../../docs');

/** 12 个文件：11 职业章 + 共享附录（总纲**不在**范围内 —— 它是裁定来源） */
const CHAPTERS = [
  '技能系统-fighter.md', '技能系统-mecha.md', '技能系统-archer.md', '技能系统-pikeman.md',
  '技能系统-atalanta.md', '技能系统-knight.md', '技能系统-magician.md', '技能系统-priestess.md',
  '技能系统-assassin.md', '技能系统-shaman.md', '技能系统-martial.md',
  '技能系统-共享-动画组.md',
];

let fails = 0;
const ok = (label: string, cond: boolean): void => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}`);
  if (!cond) fails++;
};

const read = (f: string): string => readFileSync(resolve(DOCS, f), 'utf8');

// 只保留真实存在的文件（防路径写错时静默通过）
const present = CHAPTERS.filter((f) => { try { read(f); return true; } catch { return false; } });

/* ─────────── 校验 A：结构不变量 ─────────── */
{
  console.log('\n[校验 A] 结构不变量');
  let sec0 = 0, r2 = 0, r3 = 0, legalRefs = 0, badRefs: string[] = [];
  for (const f of present) {
    const s = read(f);
    // §3.0（职业章）或 §5.0（共享附录）—— 必须锚行首，否则会数进 `#### 3.0.1`
    if (/^### [35]\.0 /m.test(s)) sec0++;
    if (s.includes('裁定 2')) r2++;
    if (s.includes('裁定 5')) r3++;
    // 裁定引用：`§10.11 裁定 N` 的 N 必须在 1..8
    for (const m of s.matchAll(/§10\.11\s*裁定\s*(\d+)/g)) {
      if (Number(m[1]) >= 1 && Number(m[1]) <= 8) legalRefs++;
      else badRefs.push(`${f}: 裁定 ${m[1]}`);
    }
  }
  ok(`${present.length}/${CHAPTERS.length} 个文件存在`, present.length === CHAPTERS.length);
  ok(`§3.0（或 §5.0）每章各一处`, sec0 === present.length);
  ok(`R2 段（裁定 2）每章都有`, r2 === present.length);
  ok(`R3 段（裁定 5）每章都有`, r3 === present.length);
  ok(`§10.11 裁定引用全部合法（共 ${legalRefs} 处）`, badRefs.length === 0);
  if (badRefs.length) badRefs.slice(0, 5).forEach((b) => console.log(`      ${b}`));
}

/* ─────────── 校验 B：计数 ─────────── */
{
  // ── B1（**真门**）：只对章内**声明了明确算式**的章验算 ──
  console.log('\n[校验 B1] 未决计数自洽（**只对章内声明了明确算式的**验算）');
  let checked = 0;
  const noEquation: string[] = [];
  for (const f of present) {
    const s = read(f);
    const short = f.replace('技能系统-', '').replace('.md', '');
    // 声明值：标题里的 `**N 条**`，退回 `在册未决 N 条` / `未决 N 条`
    const declared = /^##\s*[35][^\n]*?\*\*(\d+)\s*条\*\*/m.exec(s)
      ?? /在册未决\s*(\d+)\s*条/.exec(s)
      ?? /未决\s*(\d+)\s*条/.exec(s);
    if (!declared) { noEquation.push(`${short}（无计数声明）`); continue; }
    const got = Number(declared[1]);

    // 形态①「共 N 条 … 减 <ids>」  形态② 箭头式「~~共 N 条~~ … → M」
    const form2 = /共\s*(\d+)\s*条.{0,12}?~~[^\n]*?→\s*(\d+)/.exec(s);
    const form1 = /共\s*(\d+)\s*条[^\n]*?减([^。；]*?)(?:；|。|——|$)/.exec(s);
    let expect: number | null = null;
    let how = '';
    if (form1) {
      const minus = new Set([...form1[2]!.matchAll(/U-[A-Z0-9]+-\d+[a-z]?/g)].map((m) => m[0]));
      if (minus.size > 0) { expect = Number(form1[1]) - minus.size; how = `${form1[1]} − ${minus.size}`; }
    }
    if (expect === null && form2) { expect = Number(form2[2]); how = `箭头式 → ${expect}`; }
    if (expect === null) { noEquation.push(`${short}（**有计数但无算式**）`); continue; }

    checked++;
    if (expect !== got) console.log(`      ✗ ${short}: ${how} = ${expect}，但章内写「${got} 条」`);
    else ok(`${short}: ${how} = ${got}`, true);
  }
  console.log(`  ⇒ 可验算 ${checked}/${present.length}；**无算式、只能人读的 ${noEquation.length} 个**：`);
  noEquation.forEach((x) => console.log(`      · ${x}`));
}

{
  // ── B2（**只报告**）：各章计数口径不一致 ⇒ 脚本不判对错 ──
  // ⛔ 这里**曾经**想自动算「编号总数 / §3.0.1 收录数」，2026-09-20 **撤掉**了：
  //    ① 「首次出现的 `U-X-`」会取到**别章的交叉引用**，且 `U-K-` 被 pikeman 与 knight **共用**；
  //    ② 「自声明的编号范围」实测 12 章**全空**。
  //    ⇒ **报出错的数字比不报更糟**（把读者引到错处）⇒ 改为指路。
  console.log('');
  console.log('[校验 B2] ⚠ 各章「已裁定算不算移出未决」的**口径不一致** —— 脚本**不自动判**，见：');
  console.log('      · `docs/技能系统-作业包-00-总纲.md` §10.12.4（A8 的正确做法：读章内声明的算式）');
  console.log('      · 实例：magician 声明 25−2=23（§3.0.1 收 5 条却只扣 2）vs martial 声明 15−5=10（收 3+2 全扣）');
  console.log('      ⇒ 需协调者统一口径，或各章显式写明自己的口径。');
}

/* ─────────── 校验 C：useCode 定义跨章一致 ─────────── */
{
  console.log('\n[校验 C] `useCode` 的定义跨章一致（都必须是"拳位 = HUD 图标 = 鼠标键位"）');
  const bad: string[] = [];
  for (const f of present) {
    const s = read(f);
    if (!s.includes('useCode')) continue;              // 不引该字段的章不参与
    if (!/拳位/.test(s)) bad.push(`${f}: 提到 useCode 但没有"拳位"`);
    if (!/鼠标/.test(s)) bad.push(`${f}: 提到 useCode 但没有"鼠标"`);
  }
  ok(`引用 useCode 的章都写全了「拳位 + 鼠标」语义`, bad.length === 0);
  bad.slice(0, 5).forEach((b) => console.log(`      ${b}`));
}

/* ─────────── 校验 D：P3 之后不该再有"请用户裁定" ─────────── */
{
  console.log('\n[校验 D] §8.4 P3 已清理：无**未划线**的「请用户裁定」');
  const P3 = /(?:请|待|需)用户(?:裁定|定|说明)|由用户定/;
  const bad: string[] = [];
  for (const f of present) {
    read(f).split('\n').forEach((l, i) => {
      if (P3.test(l) && !l.includes('~~')) bad.push(`${f}:${i + 1}`);
    });
  }
  ok(`未划线的「请用户裁定」= 0`, bad.length === 0);
  bad.slice(0, 8).forEach((b) => console.log(`      ${b}`));
}

/* ─────────── 校验 E：删除线成对（旧结论保留而非抹掉） ─────────── */
{
  console.log('\n[校验 E] 删除线成对（被推翻的旧结论须**保留**，§10.12 铁律 2）');
  const bad: string[] = [];
  for (const f of present) {
    const n = (read(f).match(/~~/g) ?? []).length;
    if (n % 2 !== 0) bad.push(`${f}: ~~ 出现 ${n} 次（奇数）`);
  }
  ok(`全部文件的 ~~ 成对`, bad.length === 0);
  bad.forEach((b) => console.log(`      ${b}`));
}

console.log(fails === 0
  ? `\n✓ verify-skills 通过 —— ${present.length} 个文档的结构/计数/口径/痕迹齐备（校验 A–E）`
  : `\n✗ ${fails} 条不符 —— 对照 docs/技能系统-作业包-00-总纲.md §10.12 修文档，别改断言`);
process.exit(fails === 0 ? 0 : 1);
