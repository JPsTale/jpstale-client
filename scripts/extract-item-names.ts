/**
 * 物品名写入两份语言表 —— `item.<id>.name`（`npm run item-names`）。
 *
 * <h3>为什么直接写进 `locales/{zh,en}.json`</h3>
 * 用户 2026-09-25 明确要求："把 i18n 内容放进 en.json 和 zh.json"（先前一版是"生成物 + 运行时合并"，
 * 已按此改掉：**不再有运行时合并**，也没有中间生成物 —— 两份语言表就是唯一真值）。
 *
 * <h3>中文名来源</h3>
 * `analysis/3060-openitem/*.txt`（另一份中文客户端的 OpenItem，1214 个文件；字段名是中文
 * `*名字`/`*代码`，编码**逐个文件**试 UTF-8→GBK）。英文名取我们自己 `ITEM_DEFS` 里的数据名
 * （= `gamedb.itemlist.name`）⇒ 两份语言表**同一套键**（对照方便，parity 也自然成立）。
 *
 * <h3>对齐口径</h3>
 * 文件名的词干 = `ItemDef.icon`（= `gamedb.itemlist.codeimg1` 小写），文件内 `*代码` 也参与匹配；
 * **不按物品名对齐**（同名不同件是常态）。
 *
 * <h3>为什么写"全量"</h3>
 * 用户 2026-09-25 的硬规则：**i18n 内容只有一处**（`locales/*.json`），别的地方最多是它的输入。
 * 所以两份表都写全（每件物品都有 `item.<id>.name`）：zh 没译文时**先沿用数据名**（一眼看得出未翻译）。
 * ⚠ 库里改 `name` **只影响 en 侧与本脚本的输入** —— 改完要重跑本脚本（加 `--force` 才会刷新已存在条目），
 * 否则界面不会变（这正是用户抱怨过的"改了库为什么不生效"）。
 *
 * <h3>覆盖策略（重要）</h3>
 * 默认**只补缺失的 id**（已存在的条目原样不动 ⇒ 你手改过的名字不会被重跑覆盖）；
 * 要按来源**刷新全部**时加 `--force`。写回用统一的 2 空格缩进 + CRLF（与现文件一致，幂等）。
 *
 * 环境变量：`SRC_3060` 覆盖来源目录；默认 `<本仓库>/../analysis/3060-openitem`。
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const SRC = process.env.SRC_3060 ?? resolve(root, '..', 'analysis', '3060-openitem');
const FORCE = process.argv.includes('--force');

if (!existsSync(SRC)) {
  console.error(`✗ 找不到来源目录 ${SRC}\n  设 SRC_3060 指向「中文客户端 OpenItem」目录（应含 bc101.txt 这类文件）`);
  process.exit(1);
}

/** 逐文件试编码：严格 UTF-8 → GBK（那份数据两种都有） */
function decode(buf: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('gbk').decode(buf);
  }
}

interface Def { id: number; code: number; name: string; icon: string }
const defs = (await import('../src/game/data/itemDefs.js')).ITEM_DEFS as unknown as Def[];

const byKey = new Map<string, string>();          // 文件名词干（小写）→ 中文名
const byCode = new Map<string, string>();         // 文件内 `*代码`（小写）→ 中文名
let files = 0;
for (const f of readdirSync(SRC)) {
  if (!f.toLowerCase().endsWith('.txt')) continue;
  files++;
  const txt = decode(readFileSync(join(SRC, f)));
  const name = /\*\s*名字\s*"([^"]*)"/.exec(txt)?.[1]?.trim();
  const code = /\*\s*代码\s*"([^"]*)"/.exec(txt)?.[1]?.trim();
  if (!name) continue;
  byKey.set(f.replace(/\.txt$/i, '').toLowerCase(), name);
  if (code) byCode.set(code.toLowerCase(), name);
}

const CJK = /[\u4e00-\u9fff]/;
const zhNames = new Map<number, string>();        // id → 中文名（那边没给译文的先沿用数据名）
const enNames = new Map<number, string>();        // id → 英文名（= 我们的数据名）
const untranslated: number[] = [];                // 还没有中文译文的 id（zh 暂时显示数据名）
let nonChinese = 0;
for (const d of defs) {
  const hit = byKey.get(d.icon.toLowerCase()) ?? byCode.get(d.icon.toLowerCase());
  // 两份表都写**全量**：客户端显示的名字 100% 来自语言表（库里那份 name 只是本脚本的输入）。
  // 那边没收录 / 是英文占位的 ⇒ zh 先沿用数据名（= 未翻译，一眼看得出，等补）
  const translated = hit && CJK.test(hit) ? hit : null;
  zhNames.set(d.id, translated ?? d.name);
  enNames.set(d.id, d.name);
  if (!translated) {
    // ⚠ `nonChinese` 是 `untranslated` 的**子集**（有名字但不是汉字）—— 别把两个数相加
    if (hit) nonChinese++;
    untranslated.push(d.id);
  }
}

type Table = Record<string, unknown>;
const load = (rel: string): Table => JSON.parse(readFileSync(resolve(root, rel), 'utf8')) as Table;
const write = (rel: string, obj: Table): void => {
  // 与现文件同款：2 空格缩进 + CRLF + 中文不转义（幂等：同样的输入产出同样的字节）
  writeFileSync(resolve(root, rel), JSON.stringify(obj, null, 2).replace(/\n/g, '\r\n') + '\r\n', 'utf8');
};

for (const [rel, names, lang] of [['src/locales/zh.json', zhNames, 'zh'],
                                  ['src/locales/en.json', enNames, 'en']] as const) {
  const table = load(rel);
  const item = (table.item ?? {}) as Record<string, unknown>;
  let added = 0, refreshed = 0, kept = 0;
  for (const [id, name] of names) {
    const cur = item[String(id)] as { name?: string } | undefined;
    if (cur?.name === name) { kept++; continue; }
    if (cur && !FORCE) { kept++; continue; }        // 已存在且非 --force ⇒ 不动（可能是你手改过的）
    if (cur) refreshed++; else added++;
    item[String(id)] = { name };
  }
  table.item = item;
  write(rel, table);
  console.log(`  ${rel}（${lang}）：新增 ${added} / 刷新 ${refreshed} / 保持 ${kept}`);
}

console.log(`来源 ${files} 个文件；两份语言表各 ${defs.length} 条`);
console.log(`  来源里没有中文名的 ${untranslated.length} 条（其中英文占位 ${nonChinese} 条）`
  + ` —— 这些在 zh 侧暂用数据名；**手写过译文的不会被本脚本覆盖**`
  + `（如 #484 金币 / #485 经验值）`);
console.log(FORCE ? '（--force：按来源刷新了已存在的条目）' : '（默认只补缺失；要按来源刷新用 --force）');
