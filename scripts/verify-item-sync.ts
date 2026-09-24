/**
 * `verify-item-sync` —— **库 ↔ 客户端生成物/语言表**是否同步（`npm run verify-item-sync`）。
 *
 * <h3>为什么需要它（用户 2026-09-25 的原话）</h3>
 * "我在数据库已经把 BI139~BI141 的名字改了，但是背包里它们还是旧名字" ——
 * 那一刻**没有任何东西会告诉你**"改库之后要重跑生成器"：界面只是安静地显示旧值。
 * 本脚本就把这件事变成一条**能自己红的检查**：拿库里的真值，和仓库里那两份产物逐件比。
 *
 * <h3>比什么</h3>
 * <ul>
 *   <li>`id` 集合：库里有而 `ITEM_DEFS` 没有（新增物品没生成）/ 反之（库里删了）⇒ 红；</li>
 *   <li>`name`：库里的名字与 `en` 语言表（`item.<id>.name`）不同 ⇒ 红（**en 侧是库名的镜像**）；</li>
 *   <li>`zh` 侧**不比对**：它是译文（`item-names` 的产物），与库名本来就不同；
 *       未翻译的条数是"暂时沿用数据名"，由 `verify-i18n-parity` 报数。</li>
 * </ul>
 *
 * 取数三级（与 `extract-item-defs` / `extract-item-names` 同款）：`PT_ITEMLIST_DUMP` → 本机 podman → ssh。
 * **取不到库时明确跳过并退出 0**（不假装通过；AGENTS #12 的"显式未知"）。要**自动同步**就加 `--fix`：
 * 依次跑 `npm run item-defs` 与 `npm run item-names`。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ⚠ 过滤条件必须与生成器**逐字一致**（`extract-item-defs.ts` 的 `WHERE questid = 0`）：
// 任务物品（`questid != 0`）**有意不进客户端**，拿它们比会误报 44 条"漏生成"。
const SQL = "select id, name from gamedb.itemlist where questid = 0 order by id";
const DB_HOST = process.env.PT_DB_HOST ?? 'root@192.168.31.10';

function dump(): { text: string; source: string } | null {
  const dumpFile = process.env.PT_ITEMLIST_DUMP;
  if (dumpFile) {
    try {
      return { text: readFileSync(dumpFile, 'utf8'), source: `file:${dumpFile}` };
    } catch { /* 落到下一级 */ }
  }
  const tryRun = (f: string, a: string[]): string | null => {
    try {
      // stderr 丢掉：本机没装/没起 podman 时会打一大段噪声，而我们是三级回退（失败就下一级）
      return execFileSync(f, a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch { return null; }
  };
  const podman = tryRun('podman', ['exec', '-i', 'priston-pg', 'psql', '-U', 'sa', '-d', 'pristontale',
    '-At', '-F', '|', '-c', SQL]);
  if (podman) return { text: podman, source: 'podman(本机)' };
  const ssh = tryRun('ssh', [DB_HOST,
    `podman exec -i priston-pg psql -U sa -d pristontale -At -F'|' -c "${SQL}"`]);
  if (ssh) return { text: ssh, source: `ssh:${DB_HOST}` };
  return null;
}

const db = dump();
if (!db) {
  console.log('[item-sync] 跳过：取不到 gamedb.itemlist（设 PT_ITEMLIST_DUMP，或确保本机/ssh 能跑 podman exec）');
  process.exit(0);
}

const rows = new Map<number, string>();
for (const line of db.text.split(/\r?\n/)) {
  if (!line.trim()) continue;
  const [id, name] = line.split('|');
  // ⚠ **不能 trim**：库里真的有尾随空格的名字（如 `Hunting Knife `），裁了就把
  // "库与生成物一致" 误报成不一致（我第一版就是这么错的）。
  if (id) rows.set(Number(id), name ?? '');
}

const { ITEM_DEFS } = await import('../src/game/data/itemDefs.js');
const defs = ITEM_DEFS as unknown as Array<{ id: number; name: string }>;
const defById = new Map(defs.map((d) => [d.id, d.name]));

const zhTable = JSON.parse(readFileSync(resolve('src/locales/zh.json'), 'utf8')) as
  { item: Record<string, { name?: string }> };
const enTable = JSON.parse(readFileSync(resolve('src/locales/en.json'), 'utf8')) as
  { item: Record<string, { name?: string }> };
const nameOf = (t: typeof zhTable, id: number): string | undefined => t.item[String(id)]?.name;

let bad = 0;
const line = (msg: string): void => { console.log('  FAIL ' + msg); bad++; };

// ① id 集合
const onlyDb = [...rows.keys()].filter((id) => !defById.has(id));
const onlyRepo = [...defById.keys()].filter((id) => !rows.has(id));
if (onlyDb.length) {
  line(`库里有 ${onlyDb.length} 件物品没生成到客户端（跑 npm run item-defs）：`
    + `id ${onlyDb.slice(0, 8).join(',')}｜名字如「${rows.get(onlyDb[0])}」`);
} else if (onlyRepo.length) {
  line(`客户端有 ${onlyRepo.length} 件物品库里已经没有了（跑 npm run item-defs 清掉）：id ${onlyRepo.slice(0, 8).join(',')}`);
} else {
  console.log(`  ok   id 集合一致（${rows.size} 件）`);
}

// ② 名字：库 vs `en` 语言表（en 侧是库名的镜像）
const nameDrift: string[] = [];
for (const [id, dbName] of rows) {
  const en = nameOf(enTable, id);
  if (en !== undefined && en !== dbName) nameDrift.push(`id=${id}「${en}」→「${dbName}」`);
}
if (nameDrift.length) {
  line(`库里的名字与 en 语言表有 ${nameDrift.length} 处不同（跑 npm run item-names --force，`
    + `或手改 locales/en.json 的 item.<id>.name）：\n       ${nameDrift.slice(0, 6).join('\n       ')}`);
} else {
  console.log('  ok   库名与 en 语言表一致（zh 侧是译文，不参与比对）');
}

// ③ ITEM_DEFS 自身是否还是同一次生成的（它比语言表更基础：图标/尺寸/需求等级都靠它）
const driftDefs = defs.filter((d) => rows.has(d.id) && d.name !== rows.get(d.id));
if (driftDefs.length) {
  line(`ITEM_DEFS 里有 ${driftDefs.length} 件的名字与库不同（跑 npm run item-defs）：`
    + driftDefs.slice(0, 5).map((d) => `id=${d.id}「${d.name}」→「${rows.get(d.id)}」`).join('；'));
} else {
  console.log('  ok   ITEM_DEFS 与库同名（图标/尺寸/需求等级同源于它）');
}

if (bad && process.argv.includes('--fix')) {
  console.log('\n--fix：依次重跑两个生成器…');
  for (const s of ['item-defs', 'item-names']) {
    // ⚠ Windows 下直接 spawn `npm.cmd` 会 EINVAL（Node 24 的已知行为）⇒ 走 `shell: true`
    execFileSync('npm', ['run', s], { stdio: 'inherit', cwd: resolve('.'), shell: true });
  }
  console.log('\n--fix 完成：请重跑一次本脚本确认全绿（item-names 默认只补缺失，改过名的要用 --force）');
  process.exit(0);
}

console.log(bad === 0
  ? `\n[item-sync] ✓ 与库同步（取数：${db.source}）`
  : `\n[item-sync] ✗ ${bad} 处不同步（取数：${db.source}）—— 见上，跑对应生成器；加 --fix 可自动重跑`);
process.exit(bad === 0 ? 0 : 1);
