/**
 * **技能动作速率分布表生成器** —— 回答"哪些技能的动作速度随攻速、哪些是常数"。
 *
 * 背景：`docs/技能动画速度-原版机制.md`（2026-09-23 立项）考证"哪一层随攻速变快"。
 * 结论的核心是一张**分布表**（`CONST` / 按攻速 / 喂常量所以固定 / 按技能等级 / 其它）。
 * 本脚本把那张表**变成可复算**：重跑一次，逐技能打印 `CODE` 与该处 `MotionLoopSpeed`
 * 的赋值形态，并给出计数。
 *
 * ── 取证源（**这是本脚本的唯一输入口径**）─────────────────────────────
 * **`.refsrc/tree/SkillSub.cpp`** —— 客户端仓里的参考源副本（gitignore；取回方式见 AGENTS「参考资料源」）。
 * 它与 `E:\repo\NewSourcePT-2023\SrcGame\src\SkillSub.cpp` **逐字节相同**
 * （md5 `468de9f003858c24160d4ab2897de420`，18387 行的 `character.cpp` 那一份同源）。
 * ⚠ **行号只对这份 md5 成立** —— 换一份检出（如 8 职业的 ex-machina）行号全不同，
 *   所以下表打印的每个行号都请连同文件一起引用。
 *
 * ── 判据（**不自己写扫描器**）──────────────────────────────────────
 * case 块的定位**复用** `scripts/openplay-scan.ts` 的 `scanSwitchCases`（AGENTS #15「唯一实现」：
 * 那份扫描器已经服务 `extract-openplay-skills` 与 `verify-mouse-cast`，这里不复制第二份）。
 * 本脚本只做**它没做的那件事**：把每个 `MotionLoopSpeed = <表达式>;` 归属到
 * **最近的、在它前面的一个 case 标签**（标签涵盖了嵌套 `case N:`，因为嵌套 switch 的分支也是边界）。
 *
 * ⚠ 两个入口都要扫：`OpenPlaySkill()`（**右键/无目标**那条路）与 `PlaySkillAttack()`
 * （**左拳/追打**那条路）。同一个技能可能两处都有赋值且**值不同**（`SKILL_ENCHANT_WEAPON` 就是
 * 70 与 90 各一处）—— 只扫一个函数会漏掉一半。
 *
 * 用法：`npm run skill-motion-speed [-- --json] [--src=<路径>]`
 *   `--json`      输出机器可读的完整结果（复核时贴进文档用）
 *   `--src=<路径>` 换一份源码复核（例：8 职业的 ex-machina
 *                 `--src=E:/repo/ex-machina/src/game/Legacy/Game/Character/SkillSub.cpp`）。
 *                 ⚠ 换源后**行号与计数都变**，别把两份的数混着引用。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanSwitchCases, type OpenPlayScan } from './openplay-scan.js';
import { SKILLS, CLASS_DIR } from '../src/game/skillData.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const srcArg = process.argv.find((a) => a.startsWith('--src='));
const REF = srcArg ? resolve(srcArg.slice('--src='.length)) : resolve(ROOT, '.refsrc/tree/SkillSub.cpp');

if (!existsSync(REF)) {
  console.error(`✗ 缺少 ${REF}`);
  if (!srcArg) {
    console.error('  `.refsrc/` 是 gitignore 的参考源目录；取回方式见 AGENTS.md「参考资料源」一节。');
    console.error('  或用 `--src=<路径>` 指定另一份复核。');
  }
  process.exit(1);
}
/** ⚠ latin1：源文件是 EUC-KR/CJK 混编码，用 utf8 解会抛错；ASCII 部分（宏名/表达式）不受影响 */
const src = readFileSync(REF, 'latin1');

/** 赋值形态 —— 这张表的**分类口径**就是文档 D 节那张表 */
export type Form =
  | 'CONST'               // 纯整数字面量：70 / 80 / 100 …
  | 'ATTACKSPEED'         // GetAttackSpeedFrame(... Attack_Speed ...) —— 真的按攻速
  | 'FIXED-via-GAF'       // GetAttackSpeedFrame(<数字字面量>) —— 调了同函数但喂常量 ⇒ 结果固定
  | 'SKILL-LEVEL'         // 60 + (Charging_Strike_Time[...] * 2) 之类，按技能等级
  | 'INLINE-ATTACKSPEED'  // **内联式**：右值不含 GetAttackSpeedFrame，但**同一 case 块内**出现过 Attack_Speed
  | 'LOOP-COUNT'          // 90 + (10 * lpCurPlayer->MotionLoop) —— 按剩余循环数
  | 'OTHER';              // 认不出来的（**不猜，如实报 OTHER**）

/**
 * 分类：右值表达式 + **它所在的 case 块**（块内文本只用于"内联式"一条）。
 *
 * ⚠ 「内联式」为什么需要块上下文：该来源有 3 处把攻速公式**自己抄了一遍**再改成别的值 ——
 *   `SKILL_CRITICAL_HIT`（先 `cnt = smCharInfo.Attack_Speed - 6;` 夹 [0,6] 再 `cnt += 2;`
 *   然后 `MotionLoopSpeed = (80 * (fONE + 32 * cnt + 32)) >> FLOATNS;`）、
 *   `SKILL_S_SWORD` / `SKILL_B_UP`（`cnt = GetAttackSpeedFrame(…Attack_Speed…, 1);` 然后 `= cnt;`）。
 *   这三处的**右值里都没有 `Attack_Speed` 字面**，只按右值判会全落进 `OTHER` ⇒
 *   与"按攻速的技能数 = 16"矛盾。判据写成"**块内出现过 Attack_Speed**"，
 *   比"块内有 `- 6`"之类的形状匹配更稳（且脚本会把块内那行一并打印，人可当场核对）。
 *
 * ⚠ **这条规则会过度触发吗**：会 —— 只要块内**任何地方**提到 `Attack_Speed` 就算内联式。
 *   本文件当前 107 处赋值里符合的恰好是那 3 处（见脚本输出的 `INLINE-ATTACKSPEED` 清单），
 *   所以现在没有假阳性；**但换一份源码/加一条新赋值后必须重看那份清单**，别把规则当恒真。
 */
export function classify(expr: string, caseBlock = ''): Form {
  const e = expr.replace(/\s+/g, ' ').trim();
  if (/^\d+$/.test(e)) return 'CONST';
  if (/GetAttackSpeedFrame\s*\(/.test(e)) {
    // 参数里出现 Attack_Speed ⇒ 真按攻速；否则是喂常量（如 GetAttackSpeedFrame(7)）
    return e.includes('Attack_Speed') ? 'ATTACKSPEED' : 'FIXED-via-GAF';
  }
  if (/Attack_Speed/.test(caseBlock)) return 'INLINE-ATTACKSPEED';
  if (/_Time\s*\[/.test(e)) return 'SKILL-LEVEL';
  if (/MotionLoop/.test(e) && /\*/.test(e)) return 'LOOP-COUNT';
  return 'OTHER';
}

/** 该形态**是否真的随攻速** —— 文档的"按攻速技能数"用这一列求和，不用形态名 */
export function isAttackSpeedDependent(f: Form): boolean {
  return f === 'ATTACKSPEED' || f === 'INLINE-ATTACKSPEED';
}

interface Row {
  /** 函数（施法入口）—— 右键走 `OpenPlaySkill`、左拳走 `PlaySkillAttack` */
  scope: string;
  /** 技能宏名 */
  macro: string;
  /** `case` 那行的行号（1-based，对本文件 md5 成立） */
  caseLine: number;
  /** `MotionLoopSpeed = …;` 那行的行号 */
  assignLine: number;
  /** 右值表达式（逐字，已压掉多余空白） */
  expr: string;
  form: Form;
  /** 该赋值**实际所属**的 case 标签（嵌套 `case N:` 时与 `macro` 不同，用来解释 ENCHANT 的两处） */
  ownerLabel: string;
  /** 该 case 块内提到 `Attack_Speed` 的逐字行 —— 「内联式」判定的证据，空数组即"与攻速无关" */
  attackSpeedLines: string[];
}

/** 一个 case 标签（任意形态：`SKILL_X` 或 `case 3:`）—— 只作**分块边界**用 */
interface Label { line: number; text: string }

function scanFile(text: string): Row[] {
  const scopes: { name: string; fn: RegExp; sw: RegExp }[] = [
    { name: 'OpenPlaySkill', fn: /^\s*int\s+OpenPlaySkill\s*\(/, sw: /switch\s*\(\s*lpSkill->Skill_Info\.CODE\s*\)/ },
    { name: 'PlaySkillAttack', fn: /^\s*int\s+PlaySkillAttack\s*\(/, sw: /switch\s*\(\s*lpSkill->CODE\s*\)/ },
  ];
  const lines = text.split('\n');
  const rows: Row[] = [];

  for (const s of scopes) {
    let scan: OpenPlayScan;
    try {
      scan = scanSwitchCases(text, s.fn, s.name, s.sw);
    } catch (err) {
      // 不许静默：一个入口扫不出来就是口径失效
      console.error(`✗ ${s.name}: ${(err as Error).message}`);
      process.exit(1);
    }

    /** **全部** case 标签（含嵌套 `case N:`）—— 边界必须含嵌套，否则嵌套分支里的赋值会归错桶 */
    const labels: Label[] = [];
    for (let i = scan.switchLine - 1; i < scan.switchEndLine; i++) {
      const m = /^\s*(case\s+[^:]+|default)\s*:/.exec(lines[i] ?? '');
      if (m) labels.push({ line: i + 1, text: m[1]!.replace(/\s+/g, ' ').trim() });
    }

    /** 当前所处的最外层 `SKILL_*` case（嵌套标签沿用最近一个 —— 嵌套分支仍算该技能） */
    let topCase: { macro: string; line: number } | null = null;
    for (let i = 0; i < labels.length; i++) {
      const lo = labels[i]!.line;
      const hi = (labels[i + 1]?.line ?? scan.switchEndLine + 1) - 1;
      const owner = labels[i]!;
      // 该标签是不是"最外层 SKILL_* case"（用扫描器的 cases 名单判 —— 嵌套的 SKILL_* 在 nestedCases 里）
      const isTop = scan.cases.some((c) => c.line === lo);
      if (isTop) {
        topCase = scan.cases.find((c) => c.line === lo)!;
      } else if (!topCase) {
        // 还没进入任何 SKILL_* case 就碰撞到嵌套标签 ⇒ 判据失效，别硬归属
        console.error(`✗ ${s.name}: 行 ${lo} 的 case 标签（${owner.text}）出现在任何 SKILL_* case 之前 —— 归属判据失效`);
        process.exit(1);
      }
      /** 本 case 块的原文（含嵌套部分）—— 「内联式」判据要看它，且会随结果一起打印供人核对 */
      const block = lines.slice(lo - 1, hi).join('\n');
      for (let ln = lo; ln <= hi; ln++) {
        const m = /MotionLoopSpeed\s*=\s*(.+?);/.exec(lines[ln - 1] ?? '');
        if (!m) continue;
        const expr = m[1]!.replace(/\s+/g, ' ').trim();
        rows.push({
          scope: s.name,
          macro: topCase!.macro,
          caseLine: topCase!.line,
          assignLine: ln,
          expr,
          form: classify(expr, block),
          ownerLabel: owner.text,
          // 证据：块内提到 Attack_Speed 的那几行（空数组 = 与攻速无关，可据此推翻 INLINE-ATTACKSPEED）
          attackSpeedLines: lines
            .map((l, k) => ({ l, k: k + 1 }))
            .filter((x) => x.k >= lo && x.k <= hi && /Attack_Speed/.test(x.l))
            .map((x) => `${x.k}: ${x.l.replace(/\s+/g, ' ').trim()}`),
        });
      }
    }
  }
  return rows;
}

const rows = scanFile(src);

/* ─────────── 生成物：技能 → 速率形态（`npm run skill-motion-speed --write`） ─────────── */

const RATE_OUT = resolve(ROOT, 'src/game/data/skill-motion-speed.generated.json');

/** 源里那个"按攻速"的式子换算成**帧步进**（子帧/70Hz 逻辑帧）：
 *  `GetAttackSpeedFrame(as[, add])` = `(80 * (GetAttackSpeedMainFrame(as) + add*32)) >> 8`，
 *  而 `GetAttackSpeedMainFrame(as) = fONE + 32*clamp(as-6,0,6)`（`playsub.cpp:6338-6356`，
 *  `fONE = 256` / `FLOATNS = 8` 见 `smType.h:21-22`）。 */
export function frameStepFromAttackSpeed(attackSpeed: number, add = 0): number {
  const clamped = Math.max(0, Math.min(attackSpeed - 6, 6));
  const addBonus = add > 0 && add < 6 ? add * 32 : 0;
  return (80 * (256 + 32 * clamped + addBonus)) >> 8;
}
/** 帧步进 → 我们的播放速率倍率：`rate = FrameStep / 68.5714`。
 *  68.5714 = 4800/70 —— 原版每秒推进 = FrameStep×70 子帧 = FrameStep×70/160 动作帧，
 *  我们 rate=1 时每秒 30 动作帧（`ANIM_FPS_BASE`）⇒ rate = (FrameStep·70/160)/30。 */
export const RATE_DIVISOR = 4800 / 70;

/** 一行生成物的形状（运行时读它，见 `src/game/skillRate.ts`） */
interface RateRow {
  job: number;
  classDir: string;
  icon: string;
  name: string;
  /** 速率形态：`const` / `gaf-const`（喂常量的 GetAttackSpeedFrame）/ `attack-speed` /
   *  `skill-level`（含表格名，运行时按技能等级查我们自己的表）/ `loop-count` / `other` */
  kind: 'const' | 'gaf-const' | 'attack-speed' | 'skill-level' | 'loop-count' | 'other';
  /** `kind` 的取值：const=帧步进；gaf-const=输入给 GAF 的常量；attack-speed=add；
   *  skill-level=`{base, table, mult}`；loop-count=`{base, per}` */
  value?: number;
  add?: number;
  base?: number;
  table?: string;
  mult?: number;
  per?: number;
  expr: string;
  /** 出处（`SkillSub.cpp` 的行号与入口；两个入口都有时会各一条 —— 值可以不同） */
  sites: Array<{ scope: string; caseLine: number; assignLine: number; form: Form; expr: string; attackSpeedLines: string[] }>;
}

/**
 * 把扫描结果**归到我们的技能行**上（按名字归一化，与 `extract-skill-map` 同一套），
 * 每行合并两个入口（`PlaySkillAttack` 左拳/追打优先 —— 我们的三条施法入口里两条走它）。
 */
function buildRateTable(rs: Row[]): { json: Record<string, unknown>; matched: number } {
  const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const bySkill = new Map<string, Row[]>();
  for (const r of rs) {
    const key = norm(r.macro.replace(/^SKILL_/, ''));
    const arr = bySkill.get(key);
    if (arr) arr.push(r); else bySkill.set(key, [r]);
  }
  const parse = (r: Row): Pick<RateRow, 'kind' | 'value' | 'add' | 'base' | 'table' | 'mult' | 'per'> => {
    if (r.form === 'CONST') return { kind: 'const', value: Number(r.expr) };
    if (r.form === 'FIXED-via-GAF') return { kind: 'gaf-const', value: Number(/\((\d+)\)/.exec(r.expr)?.[1] ?? '0') };
    const gafArg = (s: string): number => Number(/GetAttackSpeedFrame\([^,)]*,\s*(\d+)\s*\)/.exec(s)?.[1] ?? '0');
    const gaf = /GetAttackSpeedFrame\([^)]*\)/.exec(r.expr)?.[0] ?? '';
    if (r.form === 'ATTACKSPEED') return { kind: 'attack-speed', add: gafArg(r.expr) };
    if (r.form === 'INLINE-ATTACKSPEED') {
      // 内联式：右值是 `cnt`，真正的式子写在块内那行（证据行）
      const line = r.attackSpeedLines.find((l) => l.includes('GetAttackSpeedFrame')) ?? '';
      const handle = /Attack_Speed\s*-\s*6/.test(line) ? -1 : gafArg(line);
      return handle === -1 ? { kind: 'attack-speed', add: 2 } : { kind: 'attack-speed', add: handle };
    }
    const m = /^(\d+)\s*\+\s*\(?\s*([A-Za-z_]\w*)\s*\[/.exec(r.expr);
    if (r.form === 'SKILL-LEVEL' && m) {
      return { kind: 'skill-level', base: Number(m[1]), table: m[2]!, mult: Number(/(\*\s*(\d+))/.exec(r.expr)?.[2] ?? '1') };
    }
    const lc = /^(\d+)\s*\+\s*\((\d+)\s*\*/.exec(r.expr);
    if (r.form === 'LOOP-COUNT' && lc) return { kind: 'loop-count', base: Number(lc[1]), per: Number(lc[2]) };
    return { kind: 'other' };
  };

  const outRows: RateRow[] = [];
  let matched = 0;
  const jobOf = new Map(Object.entries(CLASS_DIR).map(([job, dir]) => [dir, Number(job)]));
  for (const [classDir, list] of Object.entries(SKILLS)) {
    for (const s of list) {
      const key = norm(s.name);
      const altKey = s.alt ? norm(s.alt) : '';
      const hits = bySkill.get(key) ?? (altKey ? bySkill.get(altKey) : undefined) ?? [];
      // 两个入口都有 ⇒ `PlaySkillAttack`（左拳/追打）优先；值不同会在 sites 里各留一条（可复核）
      const pick = hits.find((h) => h.scope === 'PlaySkillAttack') ?? hits[0];
      const spec = pick ? parse(pick) : { kind: 'other' as const };
      if (pick) matched++;
      outRows.push({
        job: jobOf.get(classDir)!,
        classDir, icon: s.iconFile, name: s.name,
        ...spec,
        expr: pick?.expr ?? '',
        sites: hits.map((h) => ({
          scope: h.scope, caseLine: h.caseLine, assignLine: h.assignLine, form: h.form,
          expr: h.expr, attackSpeedLines: h.attackSpeedLines,
        })),
      });
    }
  }
  return {
    matched,
    json: {
      note: '技能 → 原版 MotionLoopSpeed 的速率形态（生成物，勿手改）。'
        + '源 = SkillSub.cpp 的 `MotionLoopSpeed = …` 赋值点（两个入口 OpenPlaySkill / PlaySkillAttack）。'
        + 'kind: const/gaf-const/attack-speed/skill-level/loop-count/other；'
        + 'runtime 速率 = 帧步进 / 68.5714（= 4800/70，见 src/game/skillRate.ts）。'
        + '重跑：npx tsx scripts/report-skill-motion-speed.ts --write',
      source: { file: '.refsrc/tree/SkillSub.cpp', md5: '468de9f003858c24160d4ab2897de420' },
      rateDivisor: RATE_DIVISOR,
      rows: outRows,
    },
  };
}

if (process.argv.includes('--write') || process.argv.includes('--json')) {
  const out = buildRateTable(rows);
  if (process.argv.includes('--write')) {
    writeFileSync(RATE_OUT, JSON.stringify(out.json, null, 1) + '\n');
    console.log(`写出 ${RATE_OUT}`);
    console.log(`  技能 ${out.json.rows.length} 条（有速率行 ${out.matched}，源里查不到 ${out.json.rows.length - out.matched}）`);
    const tally = new Map<string, number>();
    for (const r of out.json.rows) tally.set(r.kind, (tally.get(r.kind) ?? 0) + 1);
    console.log(`  kind：${[...tally.entries()].map(([k, v]) => `${k}=${v}`).join(' ')}`);
  }
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ file: '.refsrc/tree/SkillSub.cpp', rows }, null, 2));
  }
  process.exit(0);
}

// ── 打印：逐技能 ────────────────────────────────────────────────
const byMacro = new Map<string, Row[]>();
for (const r of rows) {
  if (!byMacro.has(r.macro)) byMacro.set(r.macro, []);
  byMacro.get(r.macro)!.push(r);
}
console.log(`# 技能动作速率分布 —— ${REF}`);
console.log(`# 赋值点 ${rows.length} 处，涉及 ${byMacro.size} 个技能宏（行号只对本文件 md5 成立）`);
console.log();
for (const macro of [...byMacro.keys()].sort()) {
  const rs = byMacro.get(macro)!;
  const cells = rs.map((r) => `${r.scope === 'OpenPlaySkill' ? 'R' : 'L'}:${r.assignLine} ${r.form} ${r.expr}`);
  console.log(`${macro.padEnd(30)} ${cells.join('  ||  ')}`);
}

// ── 打印：计数 ──────────────────────────────────────────────────
const tally = new Map<Form, number>();
for (const r of rows) tally.set(r.form, (tally.get(r.form) ?? 0) + 1);
const atkSkills = [...byMacro.values()].filter((rs) => rs.some((r) => isAttackSpeedDependent(r.form))).length;
console.log();
console.log('## 赋值形态计数（按"处"）');
for (const f of ['CONST', 'ATTACKSPEED', 'FIXED-via-GAF', 'SKILL-LEVEL', 'INLINE-ATTACKSPEED', 'LOOP-COUNT', 'OTHER'] as Form[]) {
  const n = tally.get(f) ?? 0;
  if (n) console.log(`   ${f.padEnd(20)} ${n}`);
}
console.log(`   ${'合计'.padEnd(19)} ${rows.length}`);
console.log();
console.log('## 真正随攻速的技能数（ATTACKSPEED ∪ INLINE-ATTACKSPEED，按"技能"去重）');
console.log(`   ${atkSkills} / ${byMacro.size}`);
console.log();
console.log(`## 按入口拆分（R = OpenPlaySkill 右键/无目标，L = PlaySkillAttack 左拳/追打）`);
for (const s of ['OpenPlaySkill', 'PlaySkillAttack']) {
  const n = rows.filter((r) => r.scope === s).length;
  const k = new Set(rows.filter((r) => r.scope === s).map((r) => r.macro)).size;
  console.log(`   ${s.padEnd(18)} 赋值 ${n} 处 / ${k} 个技能`);
}

// ── 打印：非 CONST 的每一处都给出「为什么这么判」（可推翻）────────────────
console.log();
console.log('## 非 CONST 逐处证据（行号 + 右值 + 块内 Attack_Speed 行）');
for (const r of rows.filter((x) => x.form !== 'CONST')) {
  console.log(`   ${r.form.padEnd(20)} ${r.macro} [${r.scope}] 赋值@${r.assignLine}  case@${r.caseLine}  owner=${r.ownerLabel}`);
  console.log(`      = ${r.expr}`);
  if (r.attackSpeedLines.length) {
    for (const l of r.attackSpeedLines) console.log(`      ↳ ${l}`);
  } else {
    console.log('      ↳ （块内无 Attack_Speed ⇒ 与攻速无关）');
  }
}
