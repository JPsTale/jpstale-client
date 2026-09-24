/**
 * 技能数据地基 —— 从原版源码**机械抽取**四份数据（不做语义推断、不填任何拿不到的值）。
 *
 * 输入（全在 `.refsrc/tree/` 下；⚠ 这些文件会被 grep 当二进制，命令行须加 `-a`）：
 *   ① `sinbaram/sinSkill_Info.cpp`               —— 参数数组（`int Name[10]` / `int Name[10][2]`）
 *   ② `sinbaram/sinSkill.h`                      —— 技能宏（`#define SKILL_X (GROUP_Y | CHANGE_JOBn | SKILL_m)`）
 *   ③ `Language/Brazil/b_sinSkill_Info.h`        —— 技能定义（`sSKILL_INFO` 内联初始化列表）
 *      `Language/English/e_sinSkill_Info.h`      —— 同上，另一语言
 *   ④ `character.cpp` 的 `CheckSkillIndex()`     —— 职业 → `SkillDataCode[]` 区间（技能身份表的作业段）
 *      `fileread.cpp` 的 `SkillDataCode[]`        —— 源码侧"技能编号 → 名字"表（下标 = 行号 − 5628）
 *
 * 输出**三处**：
 *   ① 客户端 `src/game/data/skill-tables.generated.json`（提交进仓；界面/检查器用）
 *   ② 服务端 `jpstale-server/modules/common-service/src/main/resources/skilldata/skill-tables.json`
 *      （提交进仓；与①**逐字节相同**、同一 `sourceHash`；`SkillDataRegistry` 启动时从 classpath 读）
 *   ③ 服务端 `jpstale-server/modules/common-model/.../enums/skill/SkillIds.java`
 *      （220 个技能身份常量：`名字 = 大写 slug`、`值 = 数字 id`）
 *      ⚠ 服务端仓库不存在时（只 clone 了客户端）②③**只打印一行并跳过**，不失败（见本文件末尾）。
 *      路径可用 `PT_SERVER_ROOT` 覆盖（与 `verify-i18n-parity` 同一约定）。
 *
 * 四条口径（写进产物的 `note`）：
 *   · **数值表下标 = 技能等级 − 1**（源码用法 `Table[sinSkill.UseSkill[i].Point - 1]`）；
 *   · **定义按位置原样存成 tuple**（字段顺序 = `sinSkill.h:350-365` 的 `sSKILL_INFO`），
 *     不做逐字段命名映射 —— 由使用方解释；
 *   · 计数 `arrays=484` 的口径是**声明为 `int` 的参数表**（451 一维 + 33 二维）；
 *     另有 **7 张 `float[10]`** 表（如 `Raving_UseLife`）同样抽取、同样在 `arrays` 里，
 *     但它们不在上面那个口径内，故单独计数 `arraysFloat1d`（见 `counts`）；
 *   · **技能身份表 `skills`（220 行 = 11 职业 × 20 槽）**：`skillId = 0x<job><tier><slot>`（每段一字节、
 *     十进制值）；**槽序 = 需求等级序**（= 面板序 = `skillData.SKILLS` 数组序），与源码 `SKILL_n` 位无关
 *     （mecha J1 的两格在源码里是反的，见 `docs/技能系统-mecha.md` §0.4.1）。**配对**靠名字/alt 命中
 *     （`in-name`）或需求等级序（`position`），刺客/萨满那两套外来命名只按位置对齐并标 `unverified`。
 *
 * 用法：`node node_modules/tsx/dist/cli.mjs scripts/extract-skill-tables.ts`
 *       （或 `npx tsx scripts/extract-skill-tables.ts`）
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLASS_DIR, SKILLS } from '../src/game/skillData.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const REF = resolve(ROOT, '.refsrc/tree');
const OUT = resolve(ROOT, 'src/game/data/skill-tables.generated.json');
/**
 * 服务端副本（内容与客户端那份**逐字节相同**）。
 *
 * 放在 `modules/common-service/src/main/resources/` 的理由：服务端**两个 app**（game-server / web-server）
 * 都 `scanBasePackages = "org.jpstale"`，共享的静态数据本来就住在这个模块
 * （同级已有 `resources/fields/fields.json`），所以资源放这里 = 两个进程都能从 classpath 读到，
 * 且不需要任何一方重复声明。消费者 `org.jpstale.common.service.skill.SkillDataRegistry` 也在本模块。
 */
const SERVER_ROOT = process.env.PT_SERVER_ROOT ?? resolve(ROOT, '..', 'jpstale-server');
const OUT_SERVER = resolve(SERVER_ROOT, 'modules', 'common-service', 'src', 'main', 'resources',
  'skilldata', 'skill-tables.json');
/** ③ `SkillIds.java`：220 个技能身份常量（与①②同源同时产出，避免"两边各写一份名字"） */
const OUT_JAVA = resolve(SERVER_ROOT, 'modules', 'common-model', 'src', 'main', 'java',
  'org', 'jpstale', 'server', 'common', 'enums', 'skill', 'SkillIds.java');

const F_ARRAYS = 'sinbaram/sinSkill_Info.cpp';
const F_MACROS = 'sinbaram/sinSkill.h';
const F_DEF_BR = 'Language/Brazil/b_sinSkill_Info.h';
const F_DEF_EN = 'Language/English/e_sinSkill_Info.h';
/**
 * 中文定义表（**GBK**）。
 *
 * ⚠ 抽取器整体按 `latin1` 读（保字节、方便解析），所以中文的 name/desc 拿到的是"latin1 乱码"，
 * 必须**再按 GBK 解一次**（`decodeDefText`）—— 直接 latin1 落进 JSON 会得到 `¼«¹â»¤¶Ü` 这种东西。
 *
 * 覆盖：与 English 同为**8 职业时代**的语言文件（151 条，**没有刺客/萨满那 47 条**）⇒
 * 面板取中文名时要按"语言表没有 ⇒ 回退 + 上报"处理（`game/skillText.ts`），不许静默给个空串。
 */
const F_DEF_CN = 'Language/Chinese/C_sinSkill_Info.h';
/** ④ 技能身份表的两份源码依据（作业段区间 + 源码侧编号表） */
const F_CHARACTER = 'character.cpp';
const F_FILEREAD = 'fileread.cpp';
/** 拼接顺序固定 ⇒ sourceHash 幂等（定长分帧，避免 `ab|c` 与 `a|bc` 同哈希） */
const INPUTS = [F_ARRAYS, F_MACROS, F_DEF_BR, F_DEF_EN, F_DEF_CN, F_CHARACTER, F_FILEREAD];

for (const rel of INPUTS) {
  if (!existsSync(resolve(REF, rel))) {
    console.error(`✗ 缺少 .refsrc/tree/${rel}`);
    console.error('  `.refsrc/` 是 gitignore 的参考源目录；取回方式见 AGENTS.md「参考资料源」一节。');
    process.exit(1);
  }
}

/* ─────────────── 通用：按字符扫描 C 初始化列表（保留行号、尊重字符串字面量） ─────────────── */

/** 把 `//` 行注释替换成等长空格 —— 长度与换行都不变，故字符下标↔行号仍成立 */
function maskLineComments(text: string): string {
  const out = text.split('');
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inStr) {
      if (c === '\\') { i++; continue; }   // `\"` 不吃掉字符串结尾
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') { out[i] = ' '; i++; }
    }
  }
  return out.join('');
}

/** 行首偏移表 → 1-based 行号（含末尾空行的边界） */
function lineIndex(text: string): (idx: number) => number {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return (idx: number): number => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= idx) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };
}

/** 初始化列表的值：字符串字面量的内容 / 裸 token 原样 / 嵌套列表 / null（缺省槽） */
type Init = string | null | Init[];

function skipWs(s: string, i: number): number {
  while (i < s.length && /\s/.test(s[i]!)) i++;
  return i;
}

/**
 * 解析 `{...}` 初始化列表。**裸 token 原样返回字符串**（不猜类型）：
 * 数字、标识符（`sinWA1` / `F_Xxx` / `SKILL_Xxx` / 表名）都先当串，由调用方按位置决定怎么解释。
 * 缺省槽返回 `null`（两种写法：`,,` 与尾逗号 `..., }`）—— 这是源码真的没写，不是我们编的 0。
 */
function parseInit(s: string, pos: number): { value: Init[]; end: number } {
  if (s[pos] !== '{') throw new Error(`parseInit: 期望 '{'，实际 '${s[pos]}' @${pos}`);
  let i = pos + 1;
  const items: Init[] = [];
  let needValue = true;                 // 本位置是否应当读到一个值（尾逗号 ⇒ 源码跳过了这个槽）
  for (;;) {
    i = skipWs(s, i);
    if (s[i] === '}') { if (needValue && items.length) items.push(null); i++; break; }
    if (s[i] === ',') { if (needValue) items.push(null); i++; needValue = true; continue; }
    if (!needValue) throw new Error(`parseInit: 两个值之间缺逗号 @${i}`);
    const r = parseValue(s, i);
    items.push(r.value);
    i = skipWs(s, r.end);
    needValue = false;
    if (s[i] === ',') { i++; needValue = true; continue; }
    if (s[i] === '}') { i++; break; }
    throw new Error(`parseInit: 期望 ',' 或 '}'，实际 '${s[i]}' @${i}`);
  }
  return { value: items, end: i };
}

function parseValue(s: string, pos: number): { value: Init; end: number } {
  let i = skipWs(s, pos);
  if (s[i] === '{') return parseInit(s, i);
  if (s[i] === '"') {
    i++;
    let out = '';
    while (s[i] !== '"') {
      if (s[i] === '\\') { out += s[i + 1] ?? ''; i += 2; continue; }
      if (i >= s.length) throw new Error('parseValue: 字符串未闭合 @' + pos);
      out += s[i]!; i++;
    }
    return { value: out, end: i + 1 };
  }
  let t = '';
  while (i < s.length && !/[,\{\}\s]/.test(s[i]!)) t += s[i++]!;
  // 空 token（`,,` / `, }`）⇒ null，**不前进**，交给上层去吃掉那个分隔符
  return { value: t === '' ? null : t, end: i };
}

/* ─────────────── ① 参数数组 ─────────────── */

interface ArrRow {
  dims: number[];
  type: string;
  values: number[] | number[][];
  /** 声明所在行（`int Name[10] = {` 的 `int`） */
  src: string;
  /** 初始化列表收尾（`;`）所在行 —— 与 src 不同即**跨多行的表**（如 Cyclone_Strike_AreaDamage 占 168-169） */
  srcEnd: string;
}

const arrText = readFileSync(resolve(REF, F_ARRAYS), 'latin1');
const arrClean = maskLineComments(arrText);
const arrLine = lineIndex(arrText);

/** `1.f` / `1.3F` / `-22` / `120` → number；非数字**抛错**（不静默跳过、不填 0） */
function toNum(tok: string, what: string, line: number): number {
  const cleaned = tok.replace(/[fFuUlL]+$/, '');
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(cleaned)) {
    throw new Error(`✗ ${F_ARRAYS}:${line} ${what} 的值 '${tok}' 不是数字字面量 —— 抽取器只认字面量，不解释表达式`);
  }
  return Number(cleaned);
}

const arrays: Record<string, ArrRow> = {};
let arraysInt1d = 0;
let arraysInt2d = 0;
let arraysFloat1d = 0;
/** 源码里**初始化项数 ≠ 声明长度**的表（C 会补零，我们**不补** —— 原样记录 + 报出，见 AGENTS #12） */
const arrDefects: Array<{ name: string; src: string; declared: number; actual: number }> = [];

{
  const declRe = /^[ \t]*(?:static[ \t]+)?(int|float|double)[ \t]+([A-Za-z_]\w*)[ \t]*\[10\](?:\[2\])?[ \t]*=[ \t]*\{/gm;
  for (const m of arrClean.matchAll(declRe)) {
    const type = m[1]!;
    const name = m[2]!;
    const declLine = arrLine(m.index!);
    const braceAt = m.index! + m[0].length - 1;
    const dims = /\[10\]\[2\]/.test(m[0]) ? [10, 2] : [10];
    const { value, end } = parseInit(arrClean, braceAt);
    // 数组没有"字段"语义：`{1,2,3,}` 的尾逗号只是尾逗号，不是第 4 个元素
    while (value.length && value[value.length - 1] === null) value.pop();
    const src = `${F_ARRAYS}:${declLine}`;
    let values: number[] | number[][];
    if (dims.length === 1) {
      if (value.length !== 10) arrDefects.push({ name, src, declared: 10, actual: value.length });
      values = value.map((v, k) => toNum(String(v), `${name}[${k}]`, declLine));
      if (type === 'int') arraysInt1d++; else arraysFloat1d++;
    } else {
      if (value.length !== 10) arrDefects.push({ name, src, declared: 10, actual: value.length });
      values = value.map((row, k) => {
        if (!Array.isArray(row)) throw new Error(`✗ ${src} ${name}[${k}] 不是 '{a,b}' 形式`);
        if (row.length !== 2) arrDefects.push({ name: `${name}[${k}]`, src, declared: 2, actual: row.length });
        return row.map((v, j) => toNum(String(v), `${name}[${k}][${j}]`, declLine));
      });
      arraysInt2d++;
    }
    if (arrays[name]) throw new Error(`✗ ${src} 表名重复：${name}`);
    const tail = arrClean.slice(end);
    if (tail.trimStart()[0] !== ';') throw new Error(`✗ ${src} ${name} 初始化结束处不是 ';'`);
    const semi = end + (tail.length - tail.trimStart().length);
    arrays[name] = { dims, type, values, src, srcEnd: `${F_ARRAYS}:${arrLine(semi)}` };
  }
}

/** 复核：与 `counts.arrays` 的口径自洽（484 = int 声明；float 单列） */
const arraysTotal = arraysInt1d + arraysInt2d + arraysFloat1d;
if (Object.keys(arrays).length !== arraysTotal) {
  throw new Error(`✗ 数组计数不自洽：keys=${Object.keys(arrays).length} 分类和=${arraysTotal}`);
}

/* ─────────────── ② 技能宏 ─────────────── */

const hText = readFileSync(resolve(REF, F_MACROS), 'latin1');
const hClean = maskLineComments(hText);
const hLines = hClean.split(/\r?\n/);

/** `#define SKILL_n 0x...` 槽位值表（⚠ 不是 1..17：SKILL_10 = 0x10 = 16，见 AGENTS 的 `sinNN` 类陷阱） */
const slotValues = new Map<string, number>();
for (const L of hLines) {
  const m = /^[ \t]*#define[ \t]+(SKILL_\d+)[ \t]+(0x[0-9A-Fa-f]+)[ \t]*$/.exec(L);
  if (m) slotValues.set(m[1]!, Number(m[2]!));
}
/** `GROUP_X` 值表 */
const groupValues = new Map<string, number>();
for (const L of hLines) {
  const m = /^[ \t]*#define[ \t]+(GROUP_[A-Z_]+)[ \t]+(0x[0-9A-Fa-f]+)[ \t]*$/.exec(L);
  if (m) groupValues.set(m[1]!, Number(m[2]!));
}
const tierValues = new Map<string, number>();
for (const L of hLines) {
  const m = /^[ \t]*#define[ \t]+(CHANGE_JOB\d+)[ \t]+(0x[0-9A-Fa-f]+)[ \t]*$/.exec(L);
  if (m) tierValues.set(m[1]!, Number(m[2]!));
}

interface MacroRow {
  macro: string; group: string; tier: number; slotInTier: number;
  slot: string; slotValue: number; value: number; valueHex: string; src: string;
}

const macros: MacroRow[] = [];
{
  const re = /^[ \t]*#define[ \t]+([A-Za-z_]\w*)[ \t]+\([ \t]*([A-Za-z_]\w*)[ \t]*\|[ \t]*([A-Za-z_]\w*)[ \t]*\|[ \t]*([A-Za-z_]\w*)[ \t]*\)[ \t]*;?[ \t]*$/;
  for (let i = 0; i < hLines.length; i++) {
    const m = re.exec(hLines[i]!);
    if (!m) continue;
    const macro = m[1]!;
    const group = m[2]!;
    const tierTok = m[3]!;
    const slot = m[4]!;
    if (!groupValues.has(group)) throw new Error(`✗ ${F_MACROS}:${i + 1} ${macro} 的组 '${group}' 不是 GROUP_* 常量`);
    if (!tierValues.has(tierTok)) throw new Error(`✗ ${F_MACROS}:${i + 1} ${macro} 的转职 '${tierTok}' 不是 CHANGE_JOBn`);
    if (!slotValues.has(slot)) throw new Error(`✗ ${F_MACROS}:${i + 1} ${macro} 的槽位 '${slot}' 不在 SKILL_n 表里`);
    const value = groupValues.get(group)! | tierValues.get(tierTok)! | slotValues.get(slot)!;
    macros.push({
      macro, group,
      tier: Number(tierTok.slice('CHANGE_JOB'.length)),
      slotInTier: Number(slot.slice('SKILL_'.length)),
      slot,
      slotValue: slotValues.get(slot)!,
      value,
      valueHex: '0x' + value.toString(16).toUpperCase().padStart(8, '0'),
      src: `${F_MACROS}:${i + 1}`,
    });
  }
}
const macroNames = new Set(macros.map((m) => m.macro));
if (macroNames.size !== macros.length) throw new Error('✗ 宏名重复');

/* ─────────────── ③ 技能定义（语言文件，按位置 tuple） ─────────────── */

interface DefRow {
  tuple: Array<string | number | null>;
  src: string;
  code: string | null;
  macro: string | null;
  /** 跨语言对齐：brazil 条目记 english 下标，反之亦然；未配对 = null */
  english?: number | null;
  brazil?: number | null;
}

/** `sSKILL_INFO` 的字段在初始化列表里的**位置**（`sinSkill.h:350-365`；末尾 `SkillNum` 一律缺省） */
const TUPLE_LEN = 22;
const CODE_AT = 19;         // ← 只用到的几处偏移写在这里，不做全字段命名映射
const REQLEVEL_AT = 2;
const USECODE_AT = 20;      // `SIN_SKILL_USE_*`（可绑哪些拳位）；[18]=FuncPointer、[21]=UseMana 表名
const ELEMENT_AT = 7;       // `Element[3]` 的首项；`Element[0] != 0` 在原版有两处语义（见 element0 字段注释）
const RM_AT = 5;            // `RequireMastery[2]` 的首项（CD 公式的 `RequireMastery[0]`）

function parseDefs(rel: string): DefRow[] {
  const text = readFileSync(resolve(REF, rel), 'latin1');
  const clean = maskLineComments(text);
  const lineOf = lineIndex(text);
  const rows: DefRow[] = [];
  // 条目 = 每个顶层的 `{ "...", ... }` 初始化列表（结构体数组的一个元素）
  for (let i = 0; i < clean.length; i++) {
    if (clean[i] !== '{') continue;
    const { value, end } = parseInit(clean, i);
    // 只认"看起来像技能定义"的条目：≥2 项 + 首项是字符串（宏定义里的 `{0x...}` 不会命中）
    if (value.length >= 2 && typeof value[0] === 'string') {
      const flat = value.flat(9) as Array<string | null>;
      const at = lineOf(i);
      if (flat.length > TUPLE_LEN) {
        throw new Error(`✗ ${rel}:${at} 定义展平后 ${flat.length} 项 > ${TUPLE_LEN}（sSKILL_INFO 字段数）—— 抽取器理解错了`);
      }
      // 源码未写的尾部槽补 null（与"写了 0"区分开）：全部条目对齐到结构体字段数，位置才稳定可引用
      const padded: Array<string | null> = [...flat];
      while (padded.length < TUPLE_LEN) padded.push(null);
      const tup = padded.map((v) => (v === null ? null : /^-?\d+$/.test(v) ? Number(v) : v));
      const codeTok = tup[CODE_AT];
      const code = typeof codeTok === 'string' && /^SKILL_[A-Z0-9_]+$/.test(codeTok) ? codeTok : null;
      // 位置锚点自检：本来源的 349 条定义在这一格都是数字（拿它当"抽歪了"的哨兵）
      if (typeof tup[REQLEVEL_AT] !== 'number') {
        throw new Error(`✗ ${rel}:${at} [${REQLEVEL_AT}] 不是数字（实得 ${JSON.stringify(tup[REQLEVEL_AT])}）—— 字段序对不上`);
      }
      rows.push({
        tuple: tup,
        src: `${rel}:${at}`,
        code,
        macro: code && macroNames.has(code) ? code : null,
      });
    }
    i = end - 1;
  }
  return rows;
}

const brazil = parseDefs(F_DEF_BR);
const english = parseDefs(F_DEF_EN);
const chinese = parseDefs(F_DEF_CN);

/**
 * 把某个语言定义的 **name / desc**（元组 [0]/[1]）从"latin1 保字节串"按真实编码解回来。
 * 只碰这两格：其余格是数字/ASCII 宏名，动了会破坏解析自检。
 */
function decodeDefText(rows: DefRow[], encoding: string): void {
  if (encoding === 'latin1') return;   // 西欧语言：latin1 就是对的
  const dec = new TextDecoder(encoding);
  for (const r of rows) {
    for (const i of [0, 1]) {
      const v = r.tuple[i];
      if (typeof v === 'string') r.tuple[i] = dec.decode(Buffer.from(v, 'latin1'));
    }
  }
}
decodeDefText(chinese, 'gbk');

// 自检：中文条目必须真的解出非 ASCII（否则就是编码写错了，比如把 GBK 当 latin1 存）
{
  const withCjk = chinese.filter((r) => /[一-鿿]/.test(String(r.tuple[0] ?? ''))).length;
  if (withCjk < chinese.length * 0.9) {
    throw new Error(`✗ 中文定义表解出来只有 ${withCjk}/${chinese.length} 条含汉字 —— 编码（GBK）或文件选错了`);
  }
}

/* ─────────────── 跨语言对齐 ─────────────── */

/** ① 有 CODE 的按 CODE 名配对（两文件内均唯一，已断言）；② 余下无 CODE 的按各自块内相对次序配对 */
const alignRule = [
  '① 有 CODE 的条目按 CODE 名（= sinSkill.h 的宏名）配对，两侧均唯一命中才算；',
  '② 余下**无 CODE** 的条目按各自文件内的相对次序（块内偏移）配对（两侧都是文件尾部连续的 others 段）；',
  '③ 仍未配对的 Brazil 条目列入 align.brazilOnly（English 无对应 = 该语言没收录这条技能）。',
];
const alignByCode: Array<[number, number]> = [];
const alignByOrder: Array<[number, number]> = [];
const brazilOnly: Array<{ index: number; macro: string | null; name: string | null }> = [];
{
  const brByCode = new Map<string, number>();
  brazil.forEach((d, i) => { if (d.code) brByCode.set(d.code, i); });
  const usedBr = new Set<number>();
  english.forEach((d, j) => {
    if (!d.code) return;
    const i = brByCode.get(d.code);
    if (i === undefined) return;                 // English 有、Brazil 没有 —— 本来源不出现
    d.brazil = i; brazil[i]!.english = j;
    usedBr.add(i);
    alignByCode.push([i, j]);
  });
  const brLeft = brazil.map((_, i) => i).filter((i) => !usedBr.has(i) && !brazil[i]!.code);
  const enLeft = english.map((_, j) => j).filter((j) => english[j]!.brazil == null && !english[j]!.code);
  for (let k = 0; k < Math.min(brLeft.length, enLeft.length); k++) {
    const i = brLeft[k]!;
    const j = enLeft[k]!;
    brazil[i]!.english = j; english[j]!.brazil = i;
    usedBr.add(i);
    alignByOrder.push([i, j]);
  }
  brazil.forEach((d, i) => {
    if (usedBr.has(i)) return;
    const name = typeof d.tuple[0] === 'string' ? d.tuple[0] : null;
    brazilOnly.push({ index: i, macro: d.macro, name });
  });
}
/** 对齐必须是**保序**的（否则"按顺序对齐"的前提不成立 ⇒ 当场报错，不静默） */
const monotone = (pairs: Array<[number, number]>): boolean => {
  let lastB = -1;
  let lastE = -1;
  for (const [b, e] of [...pairs].sort((x, y) => x[1] - y[1])) {
    if (b < lastB || e < lastE) return false;
    lastB = b; lastE = e;
  }
  return true;
};
if (!monotone([...alignByCode, ...alignByOrder])) {
  throw new Error('✗ 跨语言对齐非保序 —— 两个语言文件的条目次序不一致，需改为显式规则并复核');
}

/* ─────────────── ④-a 职业 → `SkillDataCode[]` 区间（`character.cpp` 的 `CheckSkillIndex`） ─────────────── */

/**
 * `CheckSkillIndex(Job, bSkill)` 把"源码技能编号"按职业分段 —— 它就是"这个编号属不属于该职业"的权威判据，
 * 也是 `SkillDataCode[]` 的**作业段边界**（职业 11/martial 不在 switch 里：源码没有它）。
 */
interface JobRange { job: number; lo: number; hi: number; src: string }

const jobRanges: JobRange[] = [];
{
  const text = readFileSync(resolve(REF, F_CHARACTER), 'latin1');
  const clean = maskLineComments(text);
  const lineOfFn = lineIndex(text);
  const at = clean.indexOf('int CheckSkillIndex(');
  if (at < 0) {
    throw new Error(`✗ ${F_CHARACTER} 里找不到 CheckSkillIndex() —— 技能身份表的作业区间无从取得`);
  }
  const end = clean.indexOf('\n}', at);
  const body = clean.slice(at, end);
  const re = new RegExp('case\\s+(\\d+)\\s*:\\s*if\\s*\\(\\s*bSkill\\s*(?:&&\\s*)?'
    + '(?:>\\s*(0x[0-9A-Fa-f]+)\\s*&&\\s*)?bSkill\\s*<=\\s*(0x[0-9A-Fa-f]+)\\s*\\)\\s*return\\s+TRUE\\s*;', 'g');
  for (const m of body.matchAll(re)) {
    const job = Number(m[1]);
    const hi = Number(m[3]);
    const lo = m[2] ? Number(m[2]) + 1 : 1;   // 首个 case 无下界 ⇒ 从 1 起
    jobRanges.push({ job, lo, hi, src: `${F_CHARACTER}:${lineOfFn(at)}` });
  }
  jobRanges.sort((a, b) => a.lo - b.lo);
  // 自检：必须从 1 开始、逐段相接（否则说明解析漏了 case 或读错了格式）
  let expect = 1;
  for (const r of jobRanges) {
    if (r.lo !== expect) {
      throw new Error(`✗ CheckSkillIndex 的区间不连续：${r.job} 段从 ${r.lo} 起，期望 ${expect}`);
    }
    expect = r.hi + 1;
  }
  if (jobRanges.length !== 10) {
    throw new Error(`✗ CheckSkillIndex 里解析到 ${jobRanges.length} 个职业段，期望 10（1..10；11=格斗家源码没有）`);
  }
}

/* ─────────────── ④-b `SkillDataCode[]`（源码侧"编号 → 名字"） ─────────────── */

interface SdcRow { index: number; name: string; code: number; src: string }

const sdcRows: SdcRow[] = [];
{
  const text = readFileSync(resolve(REF, F_FILEREAD), 'latin1');
  const clean = maskLineComments(text);
  const lineOfFile = lineIndex(text);
  const decl = /SkillDataCode\s*\[\s*\]\s*=\s*\{/.exec(clean);
  if (!decl) {
    throw new Error(`✗ ${F_FILEREAD} 里找不到 SkillDataCode[] 的定义`);
  }
  const declLine = lineOfFile(decl.index);
  const end = clean.indexOf('};', decl.index + decl[0].length);
  if (end < 0) {
    throw new Error(`✗ ${F_FILEREAD} 的 SkillDataCode[] 初始化没收尾（找不到 '};'）`);
  }
  const body = clean.slice(decl.index + decl[0].length, end);
  const bodyStartLine = declLine + 1;
  for (const m of body.matchAll(/\{\s*"([^"]*)"\s*,\s*(\d+)\s*\}/g)) {
    const line = bodyStartLine + (body.slice(0, m.index!).split('\n').length - 1);
    const index = sdcRows.length;
    // 源码口径（`docs/技能系统-mecha.md` §0.4.1）：下标 = 行号 − 5628；5628 就是首个条目的行号。
    // 这里按**计数**定下标、再用行号自检 —— 两个算法都必须成立，否则是抽取读歪了。
    if (index !== 0 && line - (declLine + 2) !== index) {
      throw new Error(`✗ ${F_FILEREAD}:${line} 第 ${index} 条的"下标 = 行号 − ${declLine + 2}"不成立`
        + `（实得 ${line - (declLine + 2)}）—— 表里有换行/注释之外的东西`);
    }
    sdcRows.push({ index, name: m[1]!, code: Number(m[2]), src: `${F_FILEREAD}:${line}` });
  }
  // 第 0 条是源码的哨兵（`{ "xxxxxxxxxxxxx", 0 }`）⇒ 它错位就说明整表偏移了
  if (sdcRows[0]?.name !== 'xxxxxxxxxxxxx') {
    throw new Error(`✗ ${F_FILEREAD} 的 SkillDataCode[0] 期望哨兵 'xxxxxxxxxxxxx'，实得 '${sdcRows[0]?.name}'`);
  }
}

/** 该职业的 `SkillDataCode[]` 段（连续区间；职业 11 不在源码的 switch 里 ⇒ 空） */
const sdcBlockOf = (job: number): SdcRow[] => {
  const r = jobRanges.find((x) => x.job === job);
  return r ? sdcRows.filter((e) => e.index >= r.lo && e.index <= r.hi) : [];
};

/**
 * 段内的"**变体条目**"：名字 = 同段里另一个条目名 + 数字后缀（实测只有 knight 段的 `DIVINEPIERCING2/3`）。
 * 它们是同一技能的多段动画变体、**不占槽**，故"按源码槽号取第 n 个"时必须跳过。
 */
const variantIndexesOf = (block: SdcRow[]): Set<number> => {
  const names = new Set(block.map((e) => e.name));
  const out = new Set<number>();
  for (const e of block) {
    const m = /^(.+?)(\d+)$/.exec(e.name);
    if (m && names.has(m[1]!)) out.add(e.index);
  }
  return out;
};

/* ─────────────── ④-c 技能身份表（220 行） ─────────────── */

/** 职业号 → 源码技能组（拼写不统一：mecha → MECHANICIAN、assassin → ASSASSINE；11 无组） */
const GROUP_OF_JOB: Array<string | null> = [null,
  'GROUP_FIGHTER', 'GROUP_MECHANICIAN', 'GROUP_ARCHER', 'GROUP_PIKEMAN', 'GROUP_ATALANTA',
  'GROUP_KNIGHT', 'GROUP_MAGICIAN', 'GROUP_PRIESTESS', 'GROUP_ASSASSINE', 'GROUP_SHAMAN', null];

/** 归一化：小写 + 去非字母数字（`SKILL_SWIFT_AXE` 与 `Swift Axe` / `Swiftness` 的比较口径） */
const normName = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');
/** 枚举常量名（大写 slug）；⚠ 只用于**无源码**的 60 个（有源码的用宏去前缀，保留源码拼写） */
const slugOf = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/** `SIN_SKILL_USE_*`（`sinbaram/sinSkill_Info.h:2-5` 的位掩码）→ 客户端 `skillData.useCode` 的词表 */
const USE_CODE_TOKEN: Record<string, string> = {
  SIN_SKILL_USE_RIGHT: 'RIGHT', SIN_SKILL_USE_LEFT: 'LEFT',
  SIN_SKILL_USE_ALL: 'ALL', SIN_SKILL_USE_NOT: 'NOT',
};

/** 需求等级序（**项目口径**：槽 = 需求等级序；出处 `docs/技能系统-作业包-00-总纲.md` §3.7.1/§3.7.1c） */
const REQ_LV_BY_SLOT = [10, 12, 14, 17, 20, 23, 26, 30, 40, 43, 46, 50, 60, 63, 66, 70];

interface SkillRow {
  job: number; classDir: string;
  skillId: number; skillIdHex: string;
  slotInJob: number; tier: number; slotInTier: number;
  iconFile: string; name: string; alt: string | null; nameSrc: string; constName: string;
  reqLv: number; useCode: string; weapon: number[];
  macro: string | null; pairing: string;
  sourceReqLv: number | null; sourceUseCode: string | null; sourceName: string | null;
  sourceSkillDataCodeIndex: number | null; sourceSkillDataCodeName: string | null;
  sourceSkillDataCodeSrc: string | null;
  /**
   * `Element[0]`（源码 `sinSkill.cpp:2064` 熟练度恒满 / `:839` 粉色 gage）。
   * 取值来源见文件内 `ELEMENT_SOURCES` 的对账说明；5 转取 `T5_ELEMENT0`（人工裁定）。
   */
  element0: number;
  /** 该值的来源：`english` / `chinese` / `brazil` / `manual-override`（**逐值 provenance**） */
  element0Src: string;
  /**
   * CD 公式的 `RequireMastery[2]`（`sinSkill.cpp:2072`）。取值口径见 `requireMasteryOf`
   * —— 与 `element0` 同源（English/Chinese 优先），**不是** `definitions.brazil` 那一列。
   */
  requireMastery: number[] | null;
  requireMasterySrc: string;
}

const macroByName = new Map(macros.map((m) => [m.macro, m]));
const brDefOfMacro = new Map<string, DefRow>();
for (const d of brazil) if (d.macro && !brDefOfMacro.has(d.macro)) brDefOfMacro.set(d.macro, d);
/** 英文/中文定义按宏索引（只用来取 `Element[0]` —— 见 `element0` 字段的取舍说明）。 */
const enDefOfMacro = new Map<string, DefRow>();
for (const d of english) if (d.macro && !enDefOfMacro.has(d.macro)) enDefOfMacro.set(d.macro, d);
const cnDefOfMacro = new Map<string, DefRow>();
for (const d of chinese) if (d.macro && !cnDefOfMacro.has(d.macro)) cnDefOfMacro.set(d.macro, d);

/* ── `Element[0]` 的三源对账（**只取一个值，但必须知道为什么**） ──────────────────────────
   它在原版 `sinSkill.cpp` 里被读两处（同一文件、都按技能）：
     · `:2064` 熟练度：`if (Skill_Info.Element[0]) UseSkillMastery = 10000;`（**熟练度恒满** ⇒ CD 最短）
     · `:839`  面板 gage：`if (Flag && Element[0])` 画 `Gage-5.bmp`（粉色）而不是红色
   三份语言文件的取值**互相打架**，实测（160 个有宏的技能行）：
     · **English / Chinese 完全一致**（共有 130 个宏，element 分歧 **0**），且命中规律清晰：
       `Element[0] = 1` 的正好是**高转职段**的技能（8 职业表里的 T3/T4，共 32 条）。
     · **Brazil 是异类**：198 条里 **136 条** 写了 1（含"格斗之术""龙卷枪风"这类 T1/T2，
       以及被动），既不符合另两份语言文件、也不符合上表的"高转段"规律 ⇒ 判为**该私服的整表改写**。
   ⇒ **取 English（缺该宏时退回 Brazil）**；两份英文/中文表若有分歧 ⇒ 直接抛（数据打架不许静默取一边）。
   5 转（`macro == null`，40 行）三份表都没有定义 ⇒ 见 `T5_ELEMENT0`。 */
const ELEMENT_SOURCES = [
  { lang: 'english', defs: enDefOfMacro },
  { lang: 'chinese', defs: cnDefOfMacro },
] as const;

/**
 * 5 转（无宏定义、三份源码表都没有这 40 行）的 `Element[0]` = **1**。
 *
 * **依据 = 用户 2026-09-24 在原版客户端里的观察**：5 转技能画的是**粉色 gage**，
 * 而粉色 gage 唯一的源码触发条件就是 `Element[0] != 0`（`sinSkill.cpp:839` ⇒ `Gage-5.bmp`）。
 * 同一行源码又规定 `Element[0]` ⇒ 熟练度恒满，故这两件事在 5 转上应当**同时成立**
 * （不是我们在 UI 上单独打的一个标记）。属**人工裁定**，来源如实记为 `manual-override`。
 */
const T5_ELEMENT0 = 1;

/**
 * 按宏取 `RequireMastery[2]`（CD 公式的 `RequireMastery[0] + RequireMastery[1] × Point`）。
 *
 * **口径与 `Element[0]` 相同**：English/Chinese 优先（两者须一致），缺则退回 Brazil。理由（实测）：
 * 在 130 个英/巴共有的宏里，巴西只有 **7 条** `RequireMastery[0]` 与英/中文不同 —— 而且**全部**是
 * `Element[0] = 1` 的高阶技能，巴西一律把 `[0]` 写成 **0**（配合 `Element[0]=1` ⇒ 熟练度恒满=
 * `Mastery` 夹到 1 ⇒ CD 0.5 秒）：
 * <pre>
 *   SKILL_IMPULSION      en/cn 130 → br 0
 *   SKILL_CYCLONE_STRIKE en/cn 135 → br 0
 *   SKILL_X_RAGE         en/cn 210 → br 0
 *   SKILL_CHAIN_LIGHTNING en/cn 120 → br 0
 *   SKILL_DIASTROPHISM   en/cn 106 → br 0
 *   SKILL_VIRTUAL_LIFE   en/cn 134 → br 82
 *   SKILL_M_METEO        en/cn 190 → br 82
 * </pre>
 * 这与 `Element[0]` 那 96 条是**同一次私服改写**的痕迹（高阶技能一律"无 CD"）⇒ 同判。
 */
function requireMasteryOf(macro: string): { value: number[] | null; src: string } {
  const en = enDefOfMacro.get(macro);
  const cn = cnDefOfMacro.get(macro);
  if (en && cn) {
    const a = [en.tuple[RM_AT], en.tuple[RM_AT + 1]].map(String).join(',');
    const b = [cn.tuple[RM_AT], cn.tuple[RM_AT + 1]].map(String).join(',');
    if (a !== b) {
      throw new Error(`✗ 宏 ${macro} 的 RequireMastery 在 English(${en.src})=[${a}] 与 Chinese(${cn.src})=[${b}] 不一致`
        + ` —— 两份语言表打架，必须先裁定取哪份，不许静默取一边`);
    }
  }
  const hit = en ?? cn;
  if (hit) {
    return { value: [hit.tuple[RM_AT] as number, hit.tuple[RM_AT + 1] as number],
      src: en ? 'english' : 'chinese' };
  }
  const br = brDefOfMacro.get(macro);
  if (br) return { value: [br.tuple[RM_AT] as number, br.tuple[RM_AT + 1] as number], src: 'brazil' };
  return { value: null, src: 'none' };
}

/** 按宏取 `Element[0]`：English → Chinese（须一致）→ Brazil 兜底；都取不到 ⇒ null（未知，不猜） */
function element0OfMacro(macro: string): { value: number | null; src: string } {
  const en = enDefOfMacro.get(macro);
  const cn = cnDefOfMacro.get(macro);
  if (en && cn) {
    const a = en.tuple[ELEMENT_AT] as number;
    const b = cn.tuple[ELEMENT_AT] as number;
    if (a !== b) {
      throw new Error(`✗ 宏 ${macro} 的 Element[0] 在 English(${en.src})=${a} 与 Chinese(${cn.src})=${b} 不一致`
        + ` —— 两份语言表打架，必须先裁定取哪份，不许静默取一边`);
    }
  }
  const hit = en ?? cn;
  if (hit) return { value: hit.tuple[ELEMENT_AT] as number, src: en ? 'english' : 'chinese' };
  const br = brDefOfMacro.get(macro);
  if (br) return { value: br.tuple[ELEMENT_AT] as number, src: 'brazil' };
  return { value: null, src: 'none' };
}
const elementNotes: string[] = [];

const skills: SkillRow[] = [];
/** 只报不改的清单（生成器打印；校验器另有独立对账） */
const skillWarnings: string[] = [];
const defOrderNotes: string[] = [];
const reqDupNotes: string[] = [];
const blockNotes: string[] = [];
const slotFallbackRows: string[] = [];
const unverifiedRows: string[] = [];
const positionRows: string[] = [];
const useCodeNoneRows: string[] = [];

for (let job = 1; job <= 11; job++) {
  const classDir = CLASS_DIR[job];
  const client = classDir ? SKILLS[classDir] : undefined;
  if (!classDir || !client) {
    throw new Error(`✗ 职业 ${job} 在 skillData.CLASS_DIR / SKILLS 里没有对应的 classDir`);
  }
  if (client.length !== 20) {
    throw new Error(`✗ ${classDir} 的 skillData.SKILLS 有 ${client.length} 项，期望 20（5 转 × 4 槽）`);
  }
  const group = GROUP_OF_JOB[job];
  const range = jobRanges.find((r) => r.job === job);
  const block = sdcBlockOf(job);
  /** 段内**占槽**的条目（去掉 `DIVINEPIERCING2/3` 这类变体）：5 转 × 4 槽 ⇒ 必须是 20 条 */
  const slotsOfBlock = block.filter((e) => !variantIndexesOf(block).has(e.index));
  if (block.length !== 0) {
    if (block.length !== range!.hi - range!.lo + 1) {
      throw new Error(`✗ ${classDir} 的 SkillDataCode 段不连续（${block.length} 条，区间 ${range!.lo}..${range!.hi}）`);
    }
    if (slotsOfBlock.length !== 20) {
      throw new Error(`✗ ${classDir} 的 SkillDataCode 段去掉变体后有 ${slotsOfBlock.length} 条占槽条目，期望 20（5 转 × 4 槽）`);
    }
    if (block.length !== 20) {
      blockNotes.push(`${classDir}: 段 ${range!.lo}..${range!.hi} 共 ${block.length} 条，其中变体 `
        + `${block.filter((e) => variantIndexesOf(block).has(e.index)).map((e) => `${e.index}:${e.name}`).join(', ')}`
        + `（不占槽；按槽号取时已跳过）`);
    }
  }

  /* 有源码的 16 个：按**需求等级序**对齐到 idx 0..15（= 面板序 = 项目口径，与源码 SKILL_n 位无关） */
  const srcSlots: Array<DefRow | undefined> = new Array<DefRow | undefined>(20).fill(undefined);
  if (group) {
    const inGroup = macros.filter((m) => m.group === group);
    if (inGroup.length !== 16) {
      throw new Error(`✗ ${group} 有 ${inGroup.length} 个宏，期望 16（4 转 × 4 槽）`);
    }
    const set = new Set(inGroup.map((m) => m.macro));
    const defs = brazil.filter((d) => d.macro !== null && set.has(d.macro));
    if (defs.length !== 16) {
      throw new Error(`✗ ${group} 的 16 个宏在 Brazil 定义里只找到 ${defs.length} 条`);
    }
    const fileOrder = defs.map((d) => d.macro).join(',');
    // 按需求等级序排；**同值保持定义文件序**（显式 tiebreak，不依赖引擎的稳定排序）
    const indexed = defs.map((d, i) => ({ d, i }));
    indexed.sort((a, b) => ((a.d.tuple[REQLEVEL_AT] as number) - (b.d.tuple[REQLEVEL_AT] as number))
      || (a.i - b.i));
    const byReq = indexed.map((x) => x.d);
    const levels = byReq.map((d) => d.tuple[REQLEVEL_AT] as number);
    const dupLevels = [...new Set(levels.filter((v, i) => levels.indexOf(v) !== i))];
    if (dupLevels.length) {
      // 源码**真的**有两个同等级的技能（刺客 J4：Pollute 与 Ninja Shadow 都写 66）
      // ⇒ 不视为抽取错误，但必须报出来：按需求等级序排时这两格的先后只能靠文件序。
      reqDupNotes.push(`${group} 的 RequireLevel 有重复值 ${dupLevels.join(',')}`
        + `（按需求等级序排时同值保持定义文件序：${byReq.map((d) => d.macro).slice(12).join(',')}）`);
    }
    if (byReq.map((d) => d.macro).join(',') !== fileOrder) {
      // **不是错误**：文件序与需求等级序不一致时，以需求等级序为准（面板序），并把事实记下来
      defOrderNotes.push(`${group} 定义文件序 ≠ 需求等级序（文件序 = ${fileOrder}，需求等级序 = `
        + `${byReq.map((d) => d.macro).join(',')}）`);
    }
    byReq.forEach((d, i) => { srcSlots[i] = d; });
    // 源侧需求等级必须与**誊写的**需求等级序逐格一致（唯一例外由校验器显式登记）
    for (let i = 0; i < 16; i++) {
      const lv = byReq[i]!.tuple[REQLEVEL_AT] as number;
      if (lv !== REQ_LV_BY_SLOT[i]) {
        skillWarnings.push(`${classDir} idx${i}（${byReq[i]!.macro}）源 RequireLevel=${lv}，需求等级序期望 ${REQ_LV_BY_SLOT[i]}`);
      }
    }
  }

  for (let idx = 0; idx < 20; idx++) {
    const s = client[idx]!;
    const tier = Math.floor(idx / 4) + 1;
    const slotInTier = (idx % 4) + 1;
    const skillId = (job << 16) | (tier << 8) | slotInTier;
    const def = srcSlots[idx];
    const macro = def?.macro ?? null;
    const m = macro ? macroByName.get(macro) : undefined;
    if (macro && !m) throw new Error(`✗ 宏 '${macro}' 不在 macros 表里`);

    /* 配对证据：名字/alt 命中源码宏名（去 SKILL_ 前缀）；否则按需求等级序（position） */
    const cands = [normName(s.name), s.alt ? normName(s.alt) : ''].filter(Boolean);
    const macroKey = macro ? normName(macro.replace(/^SKILL_/, '')) : '';
    const hit = macroKey !== '' && cands.includes(macroKey);
    let pairing: string;
    if (!macro) pairing = 'none';
    else if (hit) pairing = 'in-name';
    else if (job === 9 || job === 10) {
      // 刺客/萨满是一整套外来命名（客户端 wartale 名 vs 源码缩写宏）⇒ **不许按名字硬配**
      pairing = 'unverified';
      unverifiedRows.push(`${classDir} idx${idx} ${s.name} / ${macro}`);
    } else {
      pairing = 'position';
      positionRows.push(`${classDir} idx${idx} ${s.name} / ${macro}（源码名 ${def!.tuple[0]}）`);
    }

    /* 源码 SkillDataCode 下标：先按名字（强），名字对不上再按**源码槽号**（弱，记明来源） */
    let sdcIndex: number | null = null;
    let sdcSrc: string | null = null;
    if (macro && range && m) {
      const found = block.filter((e) => cands.includes(normName(e.name)));
      if (found.length > 1) {
        throw new Error(`✗ ${classDir} idx${idx} 在 SkillDataCode 段里命中 ${found.length} 条同名：`
          + found.map((e) => `${e.index}:${e.name}`).join(', '));
      }
      if (found.length === 1) {
        sdcIndex = found[0]!.index;
        sdcSrc = 'name';
      } else {
        // 源码槽号推出的下标：块内**跳过变体条目**后的第"槽内位次"个。
        // ⚠ 不能直接 `块首 + 位次 − 1`：knight 段多两条变体（22 条），会把 J4 的四格整体推歪 2 格。
        const local = (m.tier - 1) * 4 + m.slotInTier;
        if (local > slotsOfBlock.length) {
          throw new Error(`✗ ${classDir} 的段内可数槽位只有 ${slotsOfBlock.length} 条，取不到第 ${local} 槽`);
        }
        sdcIndex = slotsOfBlock[local - 1]!.index;
        sdcSrc = 'slot';
        slotFallbackRows.push(`${classDir} idx${idx} ${s.name} / ${macro}`
          + `（块内 ${range.lo}..${range.hi} 无同名条目 ⇒ 按源码槽号（跳过变体）取 ${sdcIndex} = ${sdcRows[sdcIndex]?.name}）`);
      }
    } else if (range && m == null) {
      // 5 转（40 个）：没有宏，源码段里它的位置 = **可数槽位的最后 4 条**；先试名字，再按段尾定位
      const found = block.filter((e) => cands.includes(normName(e.name)));
      if (found.length === 1) {
        sdcIndex = found[0]!.index;
        sdcSrc = 'name';
      } else {
        sdcIndex = slotsOfBlock[slotsOfBlock.length - 4 + slotInTier - 1]!.index;
        sdcSrc = 'block-j5';
      }
    }

    const srcUse = def ? def.tuple[USECODE_AT] : null;
    let sourceUseCode: string | null = null;
    if (def) {
      if (typeof srcUse === 'string' && USE_CODE_TOKEN[srcUse]) {
        sourceUseCode = USE_CODE_TOKEN[srcUse]!;
      } else if (typeof srcUse === 'number') {
        // 源码没写 USECODE（字面量 0）⇒ **原样记 0**，不猜成某个词表值
        sourceUseCode = `0x${srcUse.toString(16).toUpperCase().padStart(8, '0')}`;
        useCodeNoneRows.push(`${classDir} idx${idx} ${s.name}（${macro}）USECODE=0`);
      } else {
        throw new Error(`✗ ${def.src} 的 USECODE 槽（tuple[${USECODE_AT}]）不是 SIN_SKILL_USE_* 也不是数字：`
          + `${JSON.stringify(srcUse)}`);
      }
    }

    /* 客户端值为准的列：`reqLv`（除刺客 idx15 那格外与源码一致）、`weapon`；
       `useCode` 按 2026-09-23 裁定取**源码** USECODE（无源码的 60 个只能用客户端值） */
    const constName = macro ? macro.replace(/^SKILL_/, '') : slugOf(s.name);
    /* `Element[0]`：有宏 ⇒ 按上面的三源口径取；无宏（5 转）⇒ 人工裁定值 */
    const el = macro ? element0OfMacro(macro) : { value: T5_ELEMENT0, src: 'manual-override' };
    if (el.value === null) {
      elementNotes.push(`${classDir} idx${idx}（${macro}）Element[0] 三份定义表都没有 ⇒ 记 0（未知按 0，见 element0 注释）`);
    }
    /* `RequireMastery[2]`：同一口径。无宏（5 转）⇒ null（**CD 因此算不出来** ⇒ 客户端显式"未知"，
       不编一个档位出来 —— 源码里 5 转本来也不存在） */
    const rm = macro ? requireMasteryOf(macro) : { value: null, src: 'none' };
    skills.push({
      job,
      classDir,
      skillId,
      skillIdHex: '0x' + skillId.toString(16).toUpperCase().padStart(6, '0'),
      slotInJob: idx,
      tier,
      slotInTier,
      iconFile: s.iconFile,
      name: s.name,
      alt: s.alt ?? null,
      nameSrc: classDir === 'martial' ? 'client-button' : 'wartale',
      constName,
      reqLv: s.reqLv,
      useCode: sourceUseCode ?? s.useCode,
      weapon: s.weapon ?? [],
      macro,
      pairing,
      sourceReqLv: def ? (def.tuple[REQLEVEL_AT] as number) : null,
      sourceUseCode,
      sourceName: def && typeof def.tuple[0] === 'string' ? def.tuple[0] : null,
      sourceSkillDataCodeIndex: sdcIndex,
      sourceSkillDataCodeName: sdcIndex === null ? null : (sdcRows[sdcIndex]?.name ?? null),
      sourceSkillDataCodeSrc: sdcSrc,
      element0: el.value ?? 0,
      element0Src: el.value === null ? 'none' : el.src,
      requireMastery: rm.value,
      requireMasterySrc: rm.src,
    });
  }
}

/* 身份表自检：id 唯一、常量名唯一、常量名是合法 Java 标识符、区间取值正确 */
{
  const bad: string[] = [];
  const ids = new Set<number>();
  const names = new Set<string>();
  const icons = new Set<string>();
  for (const r of skills) {
    if (ids.has(r.skillId)) bad.push(`id 重复 ${r.skillIdHex}`);
    ids.add(r.skillId);
    if (names.has(r.constName)) bad.push(`常量名重复 ${r.constName}`);
    names.add(r.constName);
    // `skillIndex.byIconFile` 用 iconFile 当键：重复会**静默**互相覆盖（索引少一条而没人知道）
    if (icons.has(r.iconFile)) bad.push(`iconFile 重复 ${r.iconFile}（${r.classDir} idx${r.slotInJob}）`);
    icons.add(r.iconFile);
    if (!/^[A-Z][A-Z0-9_]*$/.test(r.constName)) bad.push(`常量名不是合法标识符：${r.constName}（${r.classDir} idx${r.slotInJob}）`);
    if (r.skillId !== ((r.job << 16) | (r.tier << 8) | r.slotInTier)) bad.push(`${r.constName} 的 id 与段位不符`);
    if (r.slotInJob !== (r.tier - 1) * 4 + r.slotInTier - 1) bad.push(`${r.constName} 的 slotInJob 与 (tier,slotInTier) 不符`);
  }
  if (skills.length !== 220) bad.push(`行数 ${skills.length} ≠ 220`);
  if (bad.length) throw new Error(`✗ 技能身份表自检失败：\n  ${bad.join('\n  ')}`);
}

const withMacro = skills.filter((r) => r.macro !== null).length;
const pairingCount = skills.reduce<Record<string, number>>((acc, r) => {
  acc[r.pairing] = (acc[r.pairing] ?? 0) + 1;
  return acc;
}, {});

/** 双向索引：客户端用 `byIconFile`、服务端用 `byMacro`、面板/槽位用 `byClassDir` */
const skillIndex = {
  note: '双向索引：skillId ↔ (classDir, slotInJob) ↔ {macro, iconFile, constName}。'
    + 'byClassDir 的数组序 = slotInJob 序（= 面板序 = 需求等级序）。',
  byClassDir: Object.fromEntries(Object.keys(SKILLS).map((dir) => {
    const list = skills.filter((r) => r.classDir === dir).sort((a, b) => a.slotInJob - b.slotInJob);
    return [dir, list.map((r) => r.skillId)];
  })),
  byMacro: Object.fromEntries(skills.filter((r) => r.macro).map((r) => [r.macro!, r.skillId])),
  byIconFile: Object.fromEntries(skills.map((r) => [r.iconFile, r.skillId])),
};

/* ─────────────── 写出 ─────────────── */

const sha1 = (b: Buffer | string): string => createHash('sha1').update(b).digest('hex');
const sources = INPUTS.map((rel) => {
  const buf = readFileSync(resolve(REF, rel));
  return { path: rel, bytes: buf.length, sha1: sha1(buf) };
});
const h = createHash('sha1');
for (const s of sources) h.update(`${s.path}\u0000${s.bytes}\u0000`).update(readFileSync(resolve(REF, s.path)));
const sourceHash = h.digest('hex').slice(0, 16);

const out = {
  note: '由 scripts/extract-skill-tables.ts 从 .refsrc/tree 的原版源码机械抽取（sinbaram/sinSkill_Info.cpp'
    + ' 的参数数组 + sinbaram/sinSkill.h 的技能宏 + Language/{Brazil,English}/*_sinSkill_Info.h 的技能定义'
    + ' + character.cpp 的 CheckSkillIndex 区间 + fileread.cpp 的 SkillDataCode 编号表）。'
    + ' 口径：① 数值表下标 = 技能等级 − 1（源码用法 Table[Point - 1]）；'
    + ' ② 定义按**位置原样**存成 tuple（顺序 = sinSkill.h:350-365 的 sSKILL_INFO，展平共 22 项；'
    + ' 其中 [2]=RequireLevel、[7]=Element[0]、[19]=CODE、[20]=USECODE、[21]=UseMana），不做逐字段命名映射；'
    + ` ③ counts.arrays=484 的口径是**声明为 int 的参数表**（451 一维 + 33 二维），` 
    + `另有 ${arraysFloat1d} 张 float[10]（如 Raving_UseLife）同样在 arrays 里、单列计数 arraysFloat1d。`
    + ' 裸 token 原样保留（数字仍是数字、标识符是字符串）；缺省槽记 null —— 没有任何编造值。'
    + ' ⚠ `defects` 是源码**自己**写短了的初始化列表（C 编译时会补 0）：我们**不补零**、原样记录并在此列明。'
    + ` ④ skills = 技能身份表 ${skills.length} 行（11 职业 × 20 槽 = 有源码 ${withMacro} + 无源码 ${skills.length - withMacro}）：`
    + ' skillId = 0x<job 1..11><tier 1..5><slot 1..4>（每段一字节、十进制值）；'
    + ' 槽序 = **需求等级序**（= 面板序 = skillData.SKILLS 数组序；与源码 SKILL_n 位无关 ——'
    + ' mecha J1 第 3/4 格在源码里是反的，见 docs/技能系统-mecha.md §0.4.1）；'
    + ' `macro/pairing` 是**配对**（这一格是哪个技能）：有源码的按定义表条目对齐，'
    + ' pairing=in-name（客户端名或 alt 命中源码宏名）| position（靠需求等级序）| unverified'
    + '（刺客 10 + 萨满 11 这 21 格的客户端名与源码缩写宏是两套命名，只按位置对齐、不许按名字硬配）| none（60 个无源码）；'
    + ' `reqLv/weapon` 取**客户端值**（sourceReqLv 留源码原值对账）；'
    + ' `useCode` 取**源码 USECODE**（2026-09-23 裁定；60 个无源码的只能用客户端值）；'
    + ' `sourceSkillDataCodeIndex` 取**源码编号表**（`fileread.cpp` 的 SkillDataCode[] 下标）——'
    + ' 先按名字在职业段内定位（sourceSkillDataCodeSrc=name），名字对不上才按源码槽号取（=slot）、'
    + ' 5 转的按职业段尾 4 条取（=block-j5）、格斗家取不到（源码 switch 无 case 11）。'
    + ' `skillIndex` 是双向索引（byClassDir / byMacro / byIconFile），客户端只新增"iconFile → skillId"这一查表。',
  generatedAt: new Date().toISOString(),
  sourceHash,
  sources,
  counts: {
    arrays: arraysInt1d + arraysInt2d,
    arrays1d: arraysInt1d,
    arrays2d: arraysInt2d,
    arraysFloat1d,
    arraysTotal,
    macros: macros.length,
    defsBrazil: brazil.length,
    defsEnglish: english.length,
    defsChinese: chinese.length,
    skills: skills.length,
    skillsWithMacro: withMacro,
    skillsClientOnly: skills.length - withMacro,
    skillPairing: pairingCount,
  },
  arrays,
  defects: arrDefects,
  macros,
  definitions: { brazil, english, chinese },
  requireMasteryNote: 'skills[].requireMastery = CD 公式的 `RequireMastery[2]`（`sinSkill.cpp:2072`）。'
    + '口径与 element0 相同（English/Chinese 优先、两者须一致、缺则 Brazil）：巴西在 130 个共有宏里'
    + '有 7 条把 `[0]` 写成 0，**全部**是 Element[0]=1 的高阶技能（与那 96 条 element 改写同源）⇒ 同判。'
    + '5 转（无宏定义）为 null：CD 算不出来时应显式未知，不许编档位。',
  elementNote: 'skills[].element0 = `Element[0]`（原版 `sinSkill.cpp:2064` 熟练度恒满 / `:839` 粉色 gage）。'
    + '取值**不取 Brazil**：Brazil 198 条里 136 条写 1（含 T1/T2 与被动），与 English/Chinese 冲突；'
    + 'English 与 Chinese 在共有的 130 个宏上**分歧为 0**，且 `=1` 的正好是高转职段 ⇒ 按这两个取。'
    + '缺英文/中文的宏退回 Brazil；5 转（无宏定义）取 1（依据 = 用户观察到的粉色 gage，见 element0Src）。',
  align: {
    rule: alignRule,
    pairs: alignByCode.length + alignByOrder.length,
    byCode: alignByCode.length,
    byOrder: alignByOrder.length,
    brazilOnly,
  },
  skills,
  skillIndex,
};

/** 两份产物**同一字符串**：逐字节相同是"两端同代"的判据（`sourceHash` 只覆盖输入，覆盖不了格式） */
const serialized = JSON.stringify(out, null, 1) + '\n';
writeFileSync(OUT, serialized);

/**
 * ② 服务端副本。
 * ⚠ **服务端仓库不存在就跳过**（别人可能只 clone 了客户端）—— 打印一行明说，**不失败**：
 * 这不是"静默兜底"（AGENTS #12），而是"该产物不属于本仓库"的正常情形，故只提示、不改退出码。
 * 服务端目录在但**父目录写不进去**之类的问题仍照常抛错（只有 `modules/common-service` 不存在才算"没这个仓库"）。
 */
let serverWritten: string | null = null;
if (existsSync(resolve(SERVER_ROOT, 'modules', 'common-service'))) {
  mkdirSync(dirname(OUT_SERVER), { recursive: true });
  writeFileSync(OUT_SERVER, serialized);
  serverWritten = OUT_SERVER;
} else {
  console.log(`服务端路径不存在（${SERVER_ROOT}），已跳过副本`);
}

/* ─────────────── ③ `SkillIds.java`（与①②同源产出；220 个常量） ─────────────── */

/**
 * 枚举常量名 = 身份表的 `constName`，值 = **十进制** id 的 0x 字面量（每段一字节、hex 里直读）。
 * `desc` 只写**短句**（显示名 + 职业/槽 + 需求等级）：源码出处写在设计文档里，不进代码。
 */
const javaLines: string[] = [];
{
  javaLines.push('package org.jpstale.server.common.enums.skill;');
  javaLines.push('');
  javaLines.push('import java.util.HashMap;');
  javaLines.push('import java.util.Map;');
  javaLines.push('');
  javaLines.push('/**');
  javaLines.push(' * 我方技能身份（220 个 = 11 职业 x 20 槽）—— <b>生成物，勿手改</b>。');
  javaLines.push(' * 由客户端仓库脚本按其生成器口径产出，与 skilldata/skill-tables.json 的 skills 段逐行对应。');
  javaLines.push(' *');
  javaLines.push(' * <p>编号规则 {0x}{job}{tier}{slot}：每段一字节、十进制值、在 hex 里直读');
  javaLines.push(' * （fighter 一转一槽 = 0x010101，pikeman 五转四槽 = 0x040504）。job 用我方 job 号 1..11，');
  javaLines.push(' * 与 characterinfo.job_code 同一套；tier 1..5 = 转职档，slot 1..4 = 该档内的槽。');
  javaLines.push(' *');
  javaLines.push(' * <p>常量名只作可读性（日志/表/代码引用）：有源码的用源码宏名，无源码的用客户端显示名。');
  javaLines.push(' * <b>名字不进协议、不当判据</b>；判据一律用 {@link #id()}。');
  javaLines.push(' */');
  javaLines.push('public enum SkillIds {');
  let lastJob = -1;
  for (const r of skills) {
    if (r.job !== lastJob) {
      javaLines.push('');
      javaLines.push(`    // ${r.job} ${r.classDir}`);
      lastJob = r.job;
    }
    const desc = `${r.name} - ${r.classDir} T${r.tier}-${r.slotInTier}, reqLv ${r.reqLv}`;
    javaLines.push(`    ${r.constName}(${r.skillIdHex}, "${desc.replace(/"/g, '\\"')}"),`);
  }
  javaLines.push('    ;');
  javaLines.push('');
  javaLines.push('    private final int id;');
  javaLines.push('    private final String desc;');
  javaLines.push('');
  javaLines.push('    private static final Map<Integer, SkillIds> BY_ID = new HashMap<>();');
  javaLines.push('');
  javaLines.push('    static {');
  javaLines.push('        for (SkillIds s : values()) {');
  javaLines.push('            if (BY_ID.put(s.id, s) != null) {');
  javaLines.push('                throw new IllegalStateException("SkillIds 有重复 id：0x" + Integer.toHexString(s.id));');
  javaLines.push('            }');
  javaLines.push('        }');
  javaLines.push('    }');
  javaLines.push('');
  javaLines.push('    SkillIds(int id, String desc) {');
  javaLines.push('        this.id = id;');
  javaLines.push('        this.desc = desc;');
  javaLines.push('    }');
  javaLines.push('');
  javaLines.push('    /** 技能身份（数字 id）；协议、props 键、服务端判据都用它。 */');
  javaLines.push('    public int id() {');
  javaLines.push('        return id;');
  javaLines.push('    }');
  javaLines.push('');
  javaLines.push('    /** 供日志用的一句短语（显示名 + 职业/槽 + 需求等级）。 */');
  javaLines.push('    public String desc() {');
  javaLines.push('        return desc;');
  javaLines.push('    }');
  javaLines.push('');
  javaLines.push('    /** id 里的职业段（1..11），与 characterinfo.job_code 同一套。 */');
  javaLines.push('    public int job() {');
  javaLines.push('        return (id >> 16) & 0xFF;');
  javaLines.push('    }');
  javaLines.push('');
  javaLines.push('    /** id 里的转职档（1..5）。 */');
  javaLines.push('    public int tier() {');
  javaLines.push('        return (id >> 8) & 0xFF;');
  javaLines.push('    }');
  javaLines.push('');
  javaLines.push('    /** id 里的档内槽位（1..4）。 */');
  javaLines.push('    public int slotInTier() {');
  javaLines.push('        return id & 0xFF;');
  javaLines.push('    }');
  javaLines.push('');
  javaLines.push('    /** 数字 id -> 常量；未知 id 直接抛（不返回 null、不给占位值）。 */');
  javaLines.push('    public static SkillIds ofId(int id) {');
  javaLines.push('        SkillIds s = BY_ID.get(id);');
  javaLines.push('        if (s == null) {');
  javaLines.push('            throw new IllegalArgumentException("未知技能 id：0x" + Integer.toHexString(id));');
  javaLines.push('        }');
  javaLines.push('        return s;');
  javaLines.push('    }');
  javaLines.push('}');
}
let javaWritten: string | null = null;
if (existsSync(resolve(SERVER_ROOT, 'modules', 'common-model'))) {
  mkdirSync(dirname(OUT_JAVA), { recursive: true });
  writeFileSync(OUT_JAVA, javaLines.join('\n') + '\n');
  javaWritten = OUT_JAVA;
} else {
  console.log(`服务端 common-model 路径不存在（${SERVER_ROOT}），已跳过 SkillIds.java`);
}

const jobGroups = new Set(['GROUP_FIGHTER', 'GROUP_MECHANICIAN', 'GROUP_ARCHER', 'GROUP_PIKEMAN', 'GROUP_ATALANTA',
  'GROUP_KNIGHT', 'GROUP_MAGICIAN', 'GROUP_PRIESTESS', 'GROUP_ASSASSINE', 'GROUP_SHAMAN']);
const perGroup = new Map<string, number>();
for (const m of macros) perGroup.set(m.group, (perGroup.get(m.group) ?? 0) + 1);

console.log(`参数数组 ${Object.keys(arrays).length}（int ${arraysInt1d + arraysInt2d} = 一维 ${arraysInt1d} + 二维 ${arraysInt2d}；float ${arraysFloat1d}）`);
console.log(`技能宏 ${macros.length}（职业组 ${[...jobGroups].reduce((n, g) => n + (perGroup.get(g) ?? 0), 0)} / OTHERSKILL ${perGroup.get('GROUP_OTHERSKILL') ?? 0} / SKILL ${perGroup.get('GROUP_SKILL') ?? 0}）`);
console.log(`技能定义 brazil ${brazil.length} / english ${english.length}`);
console.log(`跨语言对齐 ${out.align.pairs} 对（按 CODE ${alignByCode.length} + 按次序 ${alignByOrder.length}）；Brazil 独有 ${brazilOnly.length} 条`);
console.log(`SkillDataCode ${sdcRows.length} 条；职业段 ${jobRanges.length} 段（${jobRanges.map((r) => `${r.job}:${r.lo}-${r.hi}`).join(' ')}）`);
console.log(`技能身份 ${skills.length} 行（有宏 ${withMacro} / 无宏 ${skills.length - withMacro}）；`
  + `pairing ${Object.entries(pairingCount).map(([k, v]) => `${k}=${v}`).join(' ')}`);
console.log(`sourceHash ${sourceHash}`);
console.log(`写出 ${OUT}`);
if (serverWritten) console.log(`写出 ${serverWritten}（与上者逐字节相同）`);
if (javaWritten) console.log(`写出 ${javaWritten}（${skills.length} 常量）`);
if (arrDefects.length) {
  console.log(`\n⚠ 源码初始化列表写短（声明 10 项、实写不足）共 ${arrDefects.length} 处 —— **原样记录、未补零**：`);
  for (const d of arrDefects) console.log(`    ${d.src} ${d.name}: 声明 ${d.declared}，实写 ${d.actual}`);
}
if (elementNotes.length) {
  console.log(`
⚠ Element[0] 三份定义表都没有的技能行（记 0）共 ${elementNotes.length} 处：`);
  for (const n of elementNotes) console.log(`    ${n}`);
}
if (defOrderNotes.length) {
  console.log(`\n⚠ 定义文件序 ≠ 需求等级序（按需求等级序对齐，文件序记在此）共 ${defOrderNotes.length} 处：`);
  for (const n of defOrderNotes) console.log(`    ${n}`);
}
if (reqDupNotes.length) {
  console.log(`\n⚠ 定义表里有**同需求等级**的技能（源码如此；同值保持文件序）共 ${reqDupNotes.length} 处：`);
  for (const n of reqDupNotes) console.log(`    ${n}`);
}
if (blockNotes.length) {
  console.log(`\n⚠ SkillDataCode 的职业段里有多条**变体条目**（不占槽）共 ${blockNotes.length} 处：`);
  for (const n of blockNotes) console.log(`    ${n}`);
}
if (slotFallbackRows.length) {
  console.log(`\n⚠ SkillDataCode 段内无同名条目（按**源码槽号**取下标）共 ${slotFallbackRows.length} 处：`);
  for (const n of slotFallbackRows) console.log(`    ${n}`);
}
if (useCodeNoneRows.length) {
  console.log(`\n⚠ 源码 USECODE 写的是字面量 0（原样记 0x0，不猜词表值）共 ${useCodeNoneRows.length} 处：`);
  for (const n of useCodeNoneRows) console.log(`    ${n}`);
}
if (skillWarnings.length) {
  console.log(`\n⚠ 源 RequireLevel 与需求等级序不一致共 ${skillWarnings.length} 处（客户端值仍为准）：`);
  for (const n of skillWarnings) console.log(`    ${n}`);
}
if (positionRows.length) {
  console.log(`\n配对按需求等级序（名字未命中）共 ${positionRows.length} 处：`);
  for (const n of positionRows) console.log(`    ${n}`);
}
console.log(`配对存疑（刺客/萨满那两套外来命名，只按位置对齐）共 ${unverifiedRows.length} 处`
  + `（刺客 ${unverifiedRows.filter((x) => x.startsWith('assassin')).length} / `
  + `萨满 ${unverifiedRows.filter((x) => x.startsWith('shaman')).length}）：`);
for (const n of unverifiedRows) console.log(`    ${n}`);
