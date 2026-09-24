/**
 * 怪物名生成器 —— 从中文客户端的 Monster 资料抽取，写两份语言表 + 一份服务端对照表
 * （`npm run monster-names`）。
 *
 * <h3>来源（两个，按序取）</h3>
 * ① `SRC_MONSTER`（11 职业端）：`name/*.zhoon` 的 `*B_NAME`（GBK）+ 同目录 `*.inf` 的
 *    `*葛剧颇老`（韩文"模型文件"）做桥 —— 覆盖高转段/多数怪；
 * ② `SRC_3060`（3060 端，用户 2026-09-25 补充）：`*.inf` 本身就是**中文字段**定义
 *    （`*名字`/`*外型文件`/`*等级`，GBK）—— `*外型文件` 即模型路径，**直接就是桥**，
 *    补上①没有的（兔妖/土妖/红蘑菇精…）。同名模型多来源时 **① zhoon 优先**（名字更全/更权威）。
 *
 * <h3>映射链（①）</h3>
 * `SRC_MONSTER`（默认 `E:\BaiduNetdiskDownload\精灵\精灵11职业单机版一键端\...\GameServer\Monster`）：
 * <ul>
 *   <li>`name/*.zhoon`：**中文名资料**，每文件一条 `*B_NAME "中文名"`（GB2312/GBK，逐文件试解）；
 *       首行注释 `//xxx.inf` 指向对应的 .inf（个别笔误，见下）；</li>
 *   <li>`*.inf`：怪物定义，`*葛剧颇老`（"模型文件"）= monsterlist.modelfile 同一路径 ——
 *       这就是 zhoon → monsterlist 的**桥**。</li>
 * </ul>
 *
 * <h3>键口径（用户 2026-09-25 定）</h3>
 * `monster.<inf_filename>.name` —— **inf 文件名词干**（小写、无扩展名，如 `85_king bat`）。
 * 名字资料本身就按 inf 组织；同一模型的多个 monsterlist 行共用同一份资料。
 * 对齐链：`zhoon → inf（首行注释，笔误时按文件名修正）→ 模型路径 → monsterlist.modelfile`。
 *
 * <h3>冲突裁定（实测唯一一例）</h3>
 * `kimera_A.zhoon` 首行注释指向 `106_Bloodyknight.inf`，但 B_NAME = 利爪神兽：
 * **判注释为笔误** —— ① `Bknight.ini` 已有自己的 `Bknight.zhoon`（血色骑士）；
 * ② "利爪神兽"与模型 `kimera_A`（monsterlist id=132 Chimera）语义吻合。
 * ⇒ 规则：**首行注释指向的 inf 的模型 ≠ 本文件名词干对应的模型时，按文件名归**。
 *
 * <h3>产出</h3>
 * <ul>
 *   <li>`locales/zh.json` / `en.json` 的 `monster.<inf文件名>.name`（zh = 中文名；en = inf 里的
 *       `*Name`/monsterlist 数据名；**只补缺失**，手写不被覆盖）；</li>
 *   <li>`../jpstale-server/modules/common-service/src/main/resources/monsterdata/monster-name-keys.json`：
 *       `模型路径 → inf 词干`（服务端建怪时算 `nameKey` 下发）。</li>
 * </ul>
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const SRC = process.env.SRC_MONSTER
  ?? 'E:/BaiduNetdiskDownload/精灵/精灵11职业单机版一键端/精灵11职业单机版一键端/Server服务端/GameServer/Monster';
const SRV_RESOURCE = resolve(root, '../jpstale-server/modules/common-service/src/main/resources/monsterdata');
const SRC_3060 = process.env.SRC_3060_INF
  ?? 'E:/BaiduNetdiskDownload/3060/GameServer/Monster';

if (!existsSync(SRC)) {
  console.error(`✗ 找不到来源目录 ${SRC}（设 SRC_MONSTER 覆盖）`);
  process.exit(1);
}

/** GB2312/GBK 逐文件试解（Node 没有内置 gbk → 借 python；失败按 latin1 兜出可读 ASCII 部分） */
function decode(buf: Buffer): string {
  const b64 = buf.toString('base64');
  const NL = String.fromCharCode(10);   // python -c 脚本本体的换行用显式拼接（避免被工具改写）
  const py = "import sys,base64" + NL
    + "sys.stdout.reconfigure(encoding='utf-8')" + NL
    + "sys.stdout.buffer.write(base64.b64decode('" + b64 + "').decode('gbk', errors='replace').encode('utf-8'))";
  try {
    return execFileSync('python', ['-X', 'utf8', '-c', py], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  } catch {
    return buf.toString('latin1');
  }
}

// ── ① .inf：文件名词干 → 模型路径 + inf 里的英文名 ──
interface InfInfo { model: string; enName: string | null }
const infByStem = new Map<string, InfInfo>();
for (const f of readdirSync(SRC)) {
  if (!f.toLowerCase().endsWith('.inf')) continue;
  const t = decode(readFileSync(join(SRC, f)));
  const model = /\*\s*葛剧颇老\s*"([^"]*)"/.exec(t)?.[1]?.trim().toLowerCase();
  const en = /\*\s*Name\s*"([^"]*)"/.exec(t)?.[1]?.trim() ?? null;
  if (model) infByStem.set(f.slice(0, -4).toLowerCase(), { model, enName: en });
}

// ── ② .zhoon：inf 词干 → 中文名（B_NAME，只收含汉字的）──
const CJK = /[\u4e00-\u9fff]/;
interface ZhoonEntry { inf: string | null; name: string }
const zhoon = new Map<string, ZhoonEntry>();
for (const f of readdirSync(join(SRC, 'name'))) {
  if (!f.toLowerCase().endsWith('.zhoon')) continue;
  const t = decode(readFileSync(join(SRC, 'name', f)));
  const nm = /\*\s*B_NAME\s*"([^"]*)"/.exec(t)?.[1]?.trim();
  if (!nm || !CJK.test(nm)) continue;
  const cmt = /^\/\/\s*(\S+\.inf)/im.exec(t)?.[1]?.trim().toLowerCase() ?? null;
  zhoon.set(f.slice(0, -6).toLowerCase(), { inf: cmt, name: nm });
}

// ── ②b 来源②：3060 的中文字段 inf（*名字/*外型文件）—— 直接以模型路径为桥 ──
const model2zh3060 = new Map<string, string>();
if (existsSync(SRC_3060)) {
  for (const f of readdirSync(SRC_3060)) {
    if (!f.toLowerCase().endsWith('.inf')) continue;
    const t = decode(readFileSync(join(SRC_3060, f)));
    const model = /\*\s*外型文件\s*"([^"]*)"/.exec(t)?.[1]?.trim().toLowerCase();
    const name = /\*\s*名字\s*"([^"]*)"/.exec(t)?.[1]?.trim();
    if (model && name && CJK.test(name) && !model2zh3060.has(model)) {
      model2zh3060.set(model, name);
    }
  }
}

// ── ③ 冲突裁定：注释指向的模型 ≠ 本文件名词干的模型 ⇒ 按文件名归（见文件头"冲突裁定"） ──
/** inf 词干 → 中文名（可能多来源 ⇒ 收集后查重） */
const inf2names = new Map<string, Set<string>>();
let renamedByStem = 0;
let skipped = 0;
for (const [stem, { inf, name }] of zhoon) {
  // 本文件名词干自己对应的 inf（有就优先用它判"注释是否笔误"）
  const own = infByStem.get(stem);
  let target: string | undefined;
  if (inf && infByStem.has(inf.replace(/\.inf$/, ''))) {
    const cmtModel = infByStem.get(inf.replace(/\.inf$/, ''))!.model;
    if (own && cmtModel !== own.model) {
      target = stem;                       // 注释笔误 ⇒ 按文件名归
      renamedByStem++;
    } else {
      target = inf.replace(/\.inf$/, '');
    }
  } else {
    target = (inf && infByStem.has(inf.replace(/\.inf$/, ''))) ? inf.replace(/\.inf$/, '') : stem;
  }
  if (!infByStem.has(target)) {
    // 词干对不上（含注释指路也不存在）⇒ 跳过。**这里会丢名字**（如无注释且 inf 缺失的），
    // 但"猜一个模型"更危险 —— 显式丢弃并在计数里可见。
    skipped++;
    continue;
  }
  const set = inf2names.get(target) ?? new Set<string>();
  set.add(name);
  inf2names.set(target, set);
}
const conflicts = [...inf2names.entries()].filter(([, s]) => s.size > 1);
if (conflicts.length) {
  console.warn(`⚠ 同一 inf 有多个不同中文名（取文件序第一个，其余列出）：`);
  for (const [k, s] of conflicts) console.warn(`   ${k}: ${[...s].join(' / ')}`);
}

// ── ④ 写语言表（monster.<inf词干>.name；zh=中文名，en=inf 的 *Name 或留空走数据名）──
type Table = Record<string, unknown>;
const load = (rel: string): Table => JSON.parse(readFileSync(resolve(root, rel), 'utf8')) as Table;
const write = (rel: string, obj: Table): void => {
  writeFileSync(resolve(root, rel), JSON.stringify(obj, null, 2).replace(/\n/g, '\r\n') + '\r\n', 'utf8');
};

for (const [rel, lang] of [['src/locales/zh.json', 'zh'], ['src/locales/en.json', 'en']] as const) {
  const table = load(rel);
  const mon = (table.monster ?? {}) as Record<string, unknown>;
  let added = 0, kept = 0;
  for (const [stem, names] of inf2names) {
    const name = [...names][0]!;
    const enName = infByStem.get(stem)?.enName;
    const value = lang === 'zh' ? name : enName;
    if (!value) continue;                 // en 没有来源名 ⇒ 不写（客户端用数据名）
    const cur = mon[stem] as { name?: string } | undefined;
    if (cur?.name) { kept++; continue; }  // 已存在 ⇒ 不动（手写优先）
    mon[stem] = { name: value };
    added++;
  }
  if (lang === 'zh') {
    // 来源②：zhoon 没有的模型，用 3060 inf 的中文名补（en 侧无来源 ⇒ 不写）
    for (const [model, name] of model2zh3060) {
      const stem = keyMapStemOf(model);
      if (!stem || mon[stem]) continue;   // 已有（①覆盖/手写）⇒ 不动
      mon[stem] = { name };
      added3060++;
    }
  }
  table.monster = mon;
  write(rel, table);
  console.log(`  ${rel}（${lang}）：新增 ${added} / 保持 ${kept}`);
}

let added3060 = 0;

/**
 * 模型路径 → 获胜的 inf 词干（= 写进服务端对照表的那个）。
 * 与 ⑤ 的选择规则一致：**有中文名（①或②）的词干优先**，否则文件序第一个。
 */
function keyMapStemOf(model: string): string | undefined {
  const cands = [...infByStem].filter(([, v]) => v.model === model);
  if (cands.length === 0) return undefined;
  const withZh = cands.find(([stem]) => inf2names.has(stem) || model2zh3060.has(model));
  return (withZh ?? cands[0]!)[0];
}

// ── ⑤ 服务端对照表：模型路径 → inf 词干 ──
// ⚠ 多个 inf 可指向**同一模型**（如 hopy.ini ← 3_Hopy(注释指向4_Hopy)/Sb1_Hopy/…）——
// 直接 `keyMap[model] = stem` 会被最后写的覆盖，可能选中"没有中文名"的那个词干，
// 服务端 nameKey 就指到一个查不到词条的键 ⇒ 名字永远回落数据名。
// 修法：**有中文名的 inf 词干优先**（同名模型多个都有中文时取文件序第一个）。
const keyMap: Record<string, string> = {};
for (const [stem, { model }] of [...infByStem].sort((a, b) => {
  const aHas = (inf2names.has(a[0]) || model2zh3060.has(a[1].model)) ? 0 : 1;  // 有中文名的排前
  const bHas = (inf2names.has(b[0]) || model2zh3060.has(b[1].model)) ? 0 : 1;
  return aHas - bHas;
})) {
  if (!(model in keyMap)) keyMap[model] = stem;
}
if (!existsSync(SRV_RESOURCE)) {
  const { mkdirSync } = await import('node:fs');
  mkdirSync(SRV_RESOURCE, { recursive: true });
}
writeFileSync(join(SRV_RESOURCE, 'monster-name-keys.json'),
  JSON.stringify(keyMap, null, 1).replace(/\n/g, '\r\n') + '\r\n', 'utf8');

console.log(`来源：inf ${infByStem.size} 个（有模型）/ zhoon ${zhoon.size} 个有中文名`
  + `（${renamedByStem} 条按文件名归位 —— 首行注释笔误）`);
console.log(`语言表 monster.<inf>.name：${inf2names.size} 条（①zhoon）+ ${added3060} 条（②3060 inf）`
  + `；丢弃 ${skipped} 条无 inf 的；服务端对照表 ${Object.keys(keyMap).length} 条`);
