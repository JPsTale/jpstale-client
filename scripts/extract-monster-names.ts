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
 *    3060 词干**照常进行→键候选池**（2026-09-26 起，此前只进语言表且被门禁卡死、实际贡献 0）。
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
 * <h3>行 → 键的阶梯（⑤；两段式，2026-09-26 起）</h3>
 * **旧阶梯先行**（① `*Name` 严格归一命中 → ② 全候选唯一中文名 → ③ 命中里唯一中文名），
 * 出键即用 —— 已入库的键由"旧阶梯先行"构造性保证零漂移。
 * 旧阶梯无解（现库 166 个 NULL）才走 **E 阶梯**：E1 统一空白/下划线后唯一命中 →
 * E2 命中里 ①zhoon 词干唯一 → E3 命中里 3060 词干唯一 → E4 全候选唯一中文名。
 * 照旧铁律：键必须换得出显示名（有中文名），换不出的留 NULL 显式回落数据名。
 *
 * <h3>冲突裁定（实测唯一一例）</h3>
 * `kimera_A.zhoon` 首行注释指向 `106_Bloodyknight.inf`，但 B_NAME = 利爪神兽：
 * **判注释为笔误** —— ① `Bknight.ini` 已有自己的 `Bknight.zhoon`（血色骑士）；
 * ② "利爪神兽"与模型 `kimera_A`（monsterlist id=132 Chimera）语义吻合。
 * ⇒ 规则：**首行注释指向的 inf 的模型 ≠ 本文件名词干对应的模型时，按文件名归**。
 *
 * <h3>产出</h3>
 * <ul>
 *   <li>`locales/zh_cn.json` / `en_us.json` 的 `monster.<inf文件名>.name`（**平铺键**，2026-09-26 起；
 *       zh = 中文名；en = inf 里的
 *       `*Name`/monsterlist 数据名；**只补缺失**，手写不被覆盖；死条目剪掉保键集成对）；</li>
 *   <li>`tmp/monster-namekey.sql`：**逐行** `UPDATE gamedb.monsterlist SET namekey = '<词干>'`——
 *       行 → 词干的匹配规则见文件末 ⑤。生成脚本**只读库**，跑它不会改库（要改另执行该 SQL）。</li>
 *   <li>`tmp/monster-namekey-manual.json`（**读入**，⑤b）：人工裁定 `{ "<行id>": "<词干>" }`，
 *       由 `analysis/monster-namekey-消歧.html` 产出；最高优先级，覆盖两阶梯。</li>
 *   <li>`../analysis/monster-namekey-data.js`（⑥）：两阶梯+人工裁定后仍无解、候选 ≥2 的行，
 *       供消歧网页用（`MONSTER_AMBIGUOUS_OUT` 可换路径）。</li>
 * </ul>
 *
 * <h3>产出（对照）</h3>
 * 生成时会拿"算出来的 key"与库中现值逐行比对并打印差异 —— 幂等性、漂移都一眼可见。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
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

/**
 * 走 podman（本机）→ ssh（`PT_DB_HOST`）两级取 DB 文本；都取不到返回 null（**不猜**）。
 * 只读查询，无写库副作用。
 */
function queryDb(sql: string): string | null {
  const tryRun = (f: string, a: string[]): string | null => {
    try {
      return execFileSync(f, a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch { return null; }
  };
  const host = process.env.PT_DB_HOST ?? 'root@192.168.31.10';
  return tryRun('podman', ['exec', '-i', 'priston-pg', 'psql', '-U', 'sa', '-d', 'pristontale', '-At', '-F', '|', '-c', sql])
    ?? tryRun('ssh', [host, `podman exec -i priston-pg psql -U sa -d pristontale -At -F'|' -c "${sql}"`]);
}

/** 模型路径 → 英文名（en 侧的兜底来源，同 item-defs 的三级取数） */
function dbMonsterNames(): Map<string, Set<string>> {
  const SQL = "select lower(modelfile), min(name) from gamedb.monsterlist where modelfile != '0' group by lower(modelfile)";
  let text: string | null = null;
  if (process.env.PT_MONSTERLIST_DUMP) {
    try { text = readFileSync(process.env.PT_MONSTERLIST_DUMP, 'utf8'); } catch { /* 下一级 */ }
  }
  text ??= queryDb(SQL);
  const NL = String.fromCharCode(10);
  const out = new Map<string, string>();
  if (!text) {
    console.warn('⚠ 取不到 monsterlist（en 侧这些模型不写词条，显示走数据名）');
    return out;
  }
  for (const line of text.split(NL)) {
    const [model, name] = line.split('|');
    // 同模型多行（Hopy / Hopy Kid 共用 hopy.ini）—— 收集**名字集合**供行名精确匹配
    if (model && name) {
      const set = out.get(model.trim()) ?? new Set<string>();
      set.add(name.trim());
      out.set(model.trim(), set);
    }
  }
  return out;
}
const dbNames = dbMonsterNames();

/** 库里的 monsterlist 行（id / name / 现有 namekey / 等级 / 小写 modelfile）—— ⑤ 定 key 与漂移比对用 */
interface DbRow { id: number; name: string; nameKey: string | null; level: number; model: string }
function dbMonsterRows(): DbRow[] {
  const SQL = "select id, name, namekey, level, lower(modelfile) from gamedb.monsterlist"
    + " where modelfile is not null and modelfile <> '0' order by id";
  const text = queryDb(SQL);
  if (!text) {
    console.warn('⚠ 取不到 monsterlist 行 ⇒ 跳过 namekey 生成与比对（不改任何文件）');
    return [];
  }
  const out: DbRow[] = [];
  for (const line of text.split(String.fromCharCode(10))) {
    const [id, name, key, level, model] = line.split('|');
    if (!id || !/^\d+$/.test(id.trim())) continue;
    out.push({
      id: Number(id), name: (name ?? '').trim(),
      nameKey: key && key.trim() ? key.trim() : null,
      level: Number((level ?? '').trim()) || 0,
      model: (model ?? '').trim(),
    });
  }
  return out;
}
const dbRows = dbMonsterRows();

// ── ②b 来源②：3060 的中文字段 inf（*名字/*外型文件）—— inf 文件名即词干 ──
/** 3060 全量 inf：词干 → 模型 + 中文名（中文名可能没有）。**不设**"模型须在 11 职业端出现过"
 *  的门禁 —— 行匹配（⑤ E 阶梯）与语言表都以这份为准；死条目由"模型没有 monsterlist 行即剪"兜住。 */
interface Inf3060Info { model: string; zh: string | null }
const inf3060All = new Map<string, Inf3060Info>();
if (existsSync(SRC_3060)) {
  for (const f of readdirSync(SRC_3060)) {
    if (!f.toLowerCase().endsWith('.inf')) continue;
    const t = decode(readFileSync(join(SRC_3060, f)));
    const model = /\*\s*外型文件\s*"([^"]*)"/.exec(t)?.[1]?.trim().toLowerCase();
    const name = /\*\s*名字\s*"([^"]*)"/.exec(t)?.[1]?.trim();
    if (!model) continue;
    const stem = f.slice(0, -4).toLowerCase();
    if (!inf3060All.has(stem)) {
      inf3060All.set(stem, { model, zh: name && CJK.test(name) ? name : null });
    }
  }
}
/** 11 职业端出现过的模型集合（旧门禁的判定材料） */
const infByStemModels = new Set([...infByStem.values()].map((v) => v.model));
/** 旧口径子集（模型在 11 职业端也有 inf 且有中文名）—— 只喂给⑤旧阶梯的 zhStems，保持历史行为不变 */
const stemsFrom3060 = new Map<string, string>(
  [...inf3060All].filter(([, v]) => v.zh && infByStemModels.has(v.model)).map(([k, v]) => [k, v.zh!]),
);
let added3060 = 0;               // ②补进语言表的条数（统计用）

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

for (const [rel, lang] of [['src/locales/zh_cn.json', 'zh'], ['src/locales/en_us.json', 'en']] as const) {
  const table = load(rel);
  const monKey = (stem: string): string => `monster.${stem}.name`;
  let added = 0, kept = 0;
  for (const [stem, names] of inf2names) {
    const name = [...names][0]!;
    const model = infByStem.get(stem)?.model;
    // 剪枝：模型没有任何 monsterlist 行 ⇒ 服务端永远不会用它建怪 ⇒ 条目是死的
    //（zh/en 一起剪，保住键集成对）
    if (!model || !dbNames.has(model)) continue;
    const enName = infByStem.get(stem)?.enName ?? [...dbNames.get(model)!][0] ?? null;
    const value = lang === 'zh' ? name : enName;
    if (!value) continue;                 // en 没有来源名 ⇒ 不写（客户端用数据名）
    const cur = table[monKey(stem)] as string | undefined;
    if (cur) { kept++; continue; }        // 已存在 ⇒ 不动（手写优先）
    table[monKey(stem)] = value;
    added++;
  }
  // 来源②：zhoon 没有的模型，用 3060 inf 的中文名补 —— 按 **3060 inf 自己的词干**写
  // （该词干在候选池里，按行匹配时可达）。en 侧用库里的 monsterlist.name 配对
  // （3060 inf 无英文字段；与"en 回落数据名"同口径）。
  for (const [stem, info] of inf3060All) {
    if (!info.zh) continue;
    if (!dbNames.has(info.model)) continue;   // 剪枝：模型没有 monsterlist 行 ⇒ 死条目
    const value = lang === 'zh' ? info.zh
      : (infByStem.get(stem)?.enName ?? [...dbNames.get(info.model)!][0] ?? null);
    if (!value) continue;
    const cur = table[monKey(stem)] as string | undefined;
    if (cur) { kept++; continue; }        // 已有（①覆盖/手写）⇒ 不动
    table[monKey(stem)] = value;
    if (lang === 'zh') added3060++;
  }
  // 剪掉本轮没有写（= 模型没有 monsterlist 行）的陈旧键 —— 否则旧运行的死条目会一直留在表里
  const allowed = new Set<string>();
  for (const [stem, names] of inf2names) {
    const model = infByStem.get(stem)?.model;
    if (model && dbNames.has(model)) allowed.add(stem);
  }
  for (const [stem, info] of inf3060All) {
    if (dbNames.has(info.model)) allowed.add(stem);
  }
  let pruned = 0;
  for (const k of Object.keys(table)) {
    const m = /^monster\.(.+)\.name$/.exec(k);
    if (m && !allowed.has(m[1]!)) { delete table[k]; pruned++; }
  }
  if (pruned) console.log(`  ${rel}：剪掉 ${pruned} 个死条目（模型不在 monsterlist）`);
  write(rel, table);
  const monCount = Object.keys(table).filter((k) => /^monster\..+\.name$/.test(k)).length;
  console.log(`  ${rel}（${lang}）：新增 ${added} / 保持 ${kept}（访问计数，两轮来源会有重叠）`
    + `，怪物键合计 ${monCount}`);
}

// ── ⑤ 行 → `monsterlist.namekey`（该行该用哪个词干）─────────────────────────
// 规则（**唯一实现**；此前只在 `tmp/make-migration-v2.py` 里，仓库内无法重跑 —— 现已收进来）：
//   ① 该行 modelfile 的候选词干中，`*Name`（归一化：去空白 + 小写）等于该行 `name` 的 ⇒ 命中；
//   ② 命中不唯一时，若候选里**只有一个**词干有中文名 ⇒ 取它；
//   ③ 仍不唯一时，若命中集里**只有一个**有中文名 ⇒ 取它；
//   ④ 只有"唯一命中 **且** 该词干有中文名"才写键 —— 没中文名的词干写进去也换不出显示名，
//      留 NULL 让客户端显式回落 `name`（零兜底：宁可显式"未映射"）。
const normKey = (s: string): string => s.replace(/\s+/g, '').toLowerCase();
/** 扩展阶梯用：空白与下划线同格（'Great_Greven' 与 'Great Greven' 是同一个名字） */
const normKeyU = (s: string): string => s.replace(/[\s_]+/g, '').toLowerCase();
/** 有中文名的词干（zhoon 文件名词干 ∪ 3060 inf 词干）—— **只喂旧阶梯**（保持历史行为不变） */
const zhStems = new Set<string>([...zhoon.keys(), ...stemsFrom3060.keys()]);
/** 词干的中文名：① inf2names（裁定后的 zhoon 源）优先，② 3060 inf 的 *名字 */
const zhNameOf = (stem: string): string | null =>
  [...(inf2names.get(stem) ?? [])][0] ?? inf3060All.get(stem)?.zh ?? null;
const candsByModel = new Map<string, { stem: string; en: string | null }[]>();
for (const [stem, v] of infByStem) {
  const arr = candsByModel.get(v.model) ?? [];
  arr.push({ stem, en: v.enName ? normKey(v.enName) : null });
  candsByModel.set(v.model, arr);
}
// 3060 词干的扩展候选池（en=null：3060 inf 没有 *Name，只经中文名/消歧路径可达）。
// ⚠ 只喂 E 阶梯 —— 旧阶梯必须用上面这份纯 11 职业候选池：3060 同模型词干多带中文名，
//   混进去会把旧规则②的"唯一中文名"挤成歧义，让已入库的键丢掉（实测 71 键回归）。
const candsByModelE = new Map<string, { stem: string; en: string | null }[]>();
for (const [model, arr] of candsByModel) candsByModelE.set(model, [...arr]);
for (const [stem, v] of inf3060All) {
  const arr = candsByModelE.get(v.model) ?? [];
  if (!arr.some((c) => c.stem === stem)) arr.push({ stem, en: null });
  candsByModelE.set(v.model, arr);
}
const id2key = new Map<number, string>();
for (const row of dbRows) {
  const n = normKey(row.name);
  const cands = candsByModel.get(row.model) ?? [];
  let hit = cands.filter((c) => c.en && c.en === n).map((c) => c.stem);
  if (hit.length !== 1) {
    const zhCands = cands.filter((c) => zhStems.has(c.stem)).map((c) => c.stem);
    if (zhCands.length === 1) hit = zhCands;
  }
  if (hit.length !== 1) {
    const zhHits = hit.filter((s) => zhStems.has(s));
    if (zhHits.length === 1) hit = zhHits;
  }
  const key = hit.length === 1 ? hit[0]! : null;
  if (key && zhStems.has(key)) { id2key.set(row.id, key); continue; }

  // E 阶梯（2026-09-26）：只服务旧阶梯无解的行（现库 166 个 NULL），旧阶梯出键时绝不执行
  // —— 已入库的键零漂移由"旧阶梯先行 + 旧候选池独立"构造性保证。口径沿用本文件既有裁定（① zhoon 优先）：
  //   E1 统一 norm（normKeyU）后唯一命中且有中文名 ⇒ 取（修 *Name 下划线/行名空格这类纯记法差）
  //   E2 命中不唯一 ⇒ 命中里 ①zhoon 词干唯一 ⇒ 取（与"同名模型多来源 ① 优先"同一裁定）
  //   E3 仍不唯一 ⇒ 命中里 3060 词干唯一 ⇒ 取
  //   E4 仍无 ⇒ 全候选里中文名唯一 ⇒ 取（3060 补进 zh 源后的规则②）
  // 照旧铁律：键必须换得出显示名（有中文名）；换不出的键无意义 ⇒ 留 NULL 显式回落数据名。
  const candsE = candsByModelE.get(row.model) ?? [];
  let ekey: string | null = null;
  const hitU = candsE.filter((c) => c.en && normKeyU(c.en) === normKeyU(row.name)).map((c) => c.stem);
  if (hitU.length === 1) {
    if (zhNameOf(hitU[0]!)) ekey = hitU[0]!;
  } else if (hitU.length > 1) {
    const h1 = hitU.filter((s) => inf2names.has(s));
    if (h1.length === 1 && zhNameOf(h1[0]!)) ekey = h1[0]!;
    else {
      const h2 = hitU.filter((s) => inf3060All.get(s)?.zh);
      if (h2.length === 1 && zhNameOf(h2[0]!)) ekey = h2[0]!;
    }
  }
  if (!ekey) {
    const zc = candsE.filter((c) => zhNameOf(c.stem));
    if (zc.length === 1) ekey = zc[0]!.stem;
  }
  if (ekey) id2key.set(row.id, ekey);
}

// ── ⑤b 人工裁定（最高优先级，2026-09-26）：`tmp/monster-namekey-manual.json` = { "<行id>": "<词干>" } ──
// 由 `analysis/monster-namekey-消歧.html` 产出。裁定即权威（手写优先于两阶梯，覆盖它们的结果）；
// 行 id 不存在 / 词干不是任何 inf ⇒ 告警并跳过（不猜）；词干没中文名 ⇒ 告警但照写（客户端回落数据名）。
const manualPath = process.env.MONSTER_KEY_MANUAL ?? resolve(root, 'tmp/monster-namekey-manual.json');
if (dbRows.length > 0 && existsSync(manualPath)) {
  const manual = JSON.parse(readFileSync(manualPath, 'utf8')) as Record<string, string>;
  const rowById = new Map(dbRows.map((r) => [r.id, r]));
  let applied = 0;
  for (const [idStr, stem] of Object.entries(manual)) {
    const id = Number(idStr);
    if (!rowById.has(id)) { console.warn(`⚠ 人工裁定：id=${idStr} 不在 monsterlist ⇒ 跳过`); continue; }
    if (!infByStem.has(stem) && !inf3060All.has(stem)) {
      console.warn(`⚠ 人工裁定：id=${idStr} 的词干 ${stem} 不是任何来源的 inf ⇒ 跳过`); continue;
    }
    if (!zhNameOf(stem)) console.warn(`⚠ 人工裁定：id=${idStr} → ${stem} 没有中文名（客户端将回落数据名）`);
    id2key.set(id, stem);
    applied++;
  }
  console.log(`人工裁定已并入：${applied}/${Object.keys(manual).length} 条（${manualPath}）`);
}

if (dbRows.length > 0) {
  // 与库里的现值比对 —— 让"生成器说的"和"库里现在的"差额可见（幂等性 + 漂移都能一眼看到）。
  // 差额分两类：改动已有键（**必须为 0**，出现即是回归）与 NULL → 有键（E 阶梯的修复目标）。
  const drift = dbRows.filter((r) => (id2key.get(r.id) ?? null) !== r.nameKey);
  const changed = drift.filter((r) => r.nameKey !== null);
  const added = drift.filter((r) => r.nameKey === null);
  console.log(`\n行 → namekey：${id2key.size} / ${dbRows.length} 行命中（其余留 NULL ⇒ 客户端回落数据名）`);
  console.log(`与库中现值比对：一致 ${dbRows.length - drift.length} / ${dbRows.length}`
    + `，新增（NULL→有键）${added.length}`
    + (changed.length ? `，⚠ **改动已有键 ${changed.length}（必须为 0，逐条列在下面）**` : ''));
  for (const r of changed.slice(0, 20)) {
    console.warn(`   ⚠ id=${r.id} ${r.name}：库=${r.nameKey} 生成=${id2key.get(r.id) ?? 'NULL'}`);
  }
  for (const r of added.slice(0, 30)) {
    console.log(`   + id=${r.id} ${r.name}：NULL → ${id2key.get(r.id)}`);
  }
  if (added.length > 30) console.log(`   ... 共 ${added.length} 条新增`);
  // 产出可直接执行的 UPSERT（**只写 namekey**，不动 name；幂等：重跑同结果）
  const outPath = process.env.MONSTER_KEY_SQL_OUT ?? resolve(root, 'tmp/monster-namekey.sql');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, [
    '-- monsterlist.namekey（i18n 键 = inf 词干）—— 由 `npm run monster-names` 生成（幂等）',
    ...(changed.length ? ['-- ⚠ 生成时与库中已有键有出入（见生成器输出的"改动已有键"清单），先查清再执行'] : []),
    ...[...id2key].sort((a, b) => a[0] - b[0])
      .map(([id, k]) => `UPDATE gamedb.monsterlist SET namekey = '${k}' WHERE id = ${id};`),
    '',
  ].join(String.fromCharCode(10)), 'utf8');
  console.log(`已写 ${outPath}（${id2key.size} 条 UPDATE；执行它才会改库 —— 生成脚本本身只读）`);

  // ── ⑥ 歧义行清单 → `analysis/monster-namekey-消歧.html` 的数据源（两阶梯+人工裁定都无解、候选 ≥2）──
  const ambPath = process.env.MONSTER_AMBIGUOUS_OUT ?? resolve(root, '../analysis/monster-namekey-data.js');
  if (existsSync(dirname(ambPath))) {
    const amb = dbRows
      .filter((r) => !id2key.has(r.id))
      .map((r) => ({
        id: r.id, name: r.name, level: r.level, model: r.model,
        // 同模型已定键的行 —— 人肉裁定最有用的参照（同模型通常同源资料）
        siblings: dbRows
          .filter((o) => o.id !== r.id && o.model === r.model && o.nameKey)
          .map((o) => ({ id: o.id, name: o.name, key: o.nameKey! })),
        cands: (candsByModelE.get(r.model) ?? []).map((c) => {
          const srcs: string[] = [];
          if (infByStem.has(c.stem)) srcs.push('11职业');
          if (inf3060All.has(c.stem)) srcs.push('3060');
          return {
            stem: c.stem, src: srcs.join('+'),
            en: infByStem.get(c.stem)?.enName ?? null,
            zh: zhNameOf(c.stem),
          };
        }),
      }))
      .filter((r) => r.cands.length >= 2);
    writeFileSync(ambPath,
      '// 由 jpstale-client 的 `npm run monster-names` 生成 —— 消歧网页的数据源，勿手改\n'
      + 'window.MONSTER_NAMEKEY_DATA = '
      + JSON.stringify({ generated: new Date().toISOString(), rows: amb }, null, 1) + ';\n',
      'utf8');
    console.log(`歧义行数据 → ${ambPath}（${amb.length} 行待人工裁定）`);
  }
}

console.log(`来源：inf ${infByStem.size} 个（有模型）/ zhoon ${zhoon.size} 个有中文名`
  + `（${renamedByStem} 条按文件名归位 —— 首行注释笔误）`);
console.log(`语言表 monster.<inf>.name：${inf2names.size} 条（①zhoon）+ ${added3060} 条（②3060 inf）`
  + `；丢弃 ${skipped} 条无 inf 的`);
