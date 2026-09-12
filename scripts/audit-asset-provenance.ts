/**
 * 客户端资产来源审计。
 *
 * 我方 `client/` 是三份来源拼起来的：11 职业客户端、EU 客户端、以及本地改动。
 * 混代会导致难以察觉的错误（典型：`.inx` 的 sItem 索引对着 EU 的物品表读，
 * 得到完全错误的武器结论 —— 已踩过一次）。
 *
 * 本脚本对每个文件做 md5，与两个来源逐一对齐，输出：
 *   来源分类计数 + 「与两个来源都不同」（=本地改动/第三版本）的清单。
 *
 * 来源路径可用环境变量覆盖：
 *   PT_SRC_11=<11职业包>/Game客户端   PT_SRC_EU=<EU 客户端根>
 * 用法：npx tsx scripts/audit-asset-provenance.ts [--list]
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const OURS = 'E:/JPsTale/client';
const SRC11 = process.env.PT_SRC_11
  ?? 'E:/BaiduNetdiskDownload/精灵/精灵11职业单机版一键端/精灵11职业单机版一键端/Game客户端';
const SRCEU = process.env.PT_SRC_EU ?? 'E:/EU/Pristontale EU';
const LIST = process.argv.includes('--list');

function walk(root: string, out: string[] = [], base = root): string[] {
  let ents: string[];
  try { ents = readdirSync(root); } catch { return out; }
  for (const e of ents) {
    const p = join(root, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out, base);
    else out.push(relative(base, p));
  }
  return out;
}
/** 路径归一：小写 + 正斜杠（我方是小写折叠副本，Windows 上大小写不敏感） */
const norm = (p: string) => p.split(sep).join('/').toLowerCase();
const md5 = (p: string): string | null => {
  try { return createHash('md5').update(readFileSync(p)).digest('hex').slice(0, 12); } catch { return null; }
};

console.log('索引来源清单…');
const files11 = new Map<string, string>();   // norm → 真实相对路径
for (const f of walk(SRC11)) files11.set(norm(f), f);
const filesEU = new Map<string, string>();
for (const f of walk(SRCEU)) filesEU.set(norm(f), f);
console.log(`  11职业 ${files11.size} 个文件，EU ${filesEU.size} 个文件`);

const ours = walk(OURS);
console.log(`  我方 ${ours.length} 个文件\n`);

const buckets = new Map<string, number>();
const diverged: string[] = [];
const oursOnly: string[] = [];

for (const rel of ours) {
  const n = norm(rel);
  const h = md5(join(OURS, rel));
  const in11 = files11.has(n);
  const inEU = filesEU.has(n);
  if (!in11 && !inEU) { oursOnly.push(rel); buckets.set('我方独有', (buckets.get('我方独有') ?? 0) + 1); continue; }
  const h11 = in11 ? md5(join(SRC11, files11.get(n)!)) : null;
  const hEU = inEU ? md5(join(SRCEU, filesEU.get(n)!)) : null;
  if (h11 && h === h11 && (!hEU || h11 === hEU)) { buckets.set('两源一致', (buckets.get('两源一致') ?? 0) + 1); continue; }
  if (h11 && h === h11) { buckets.set('同 11职业', (buckets.get('同 11职业') ?? 0) + 1); continue; }
  if (hEU && h === hEU) { buckets.set('同 EU', (buckets.get('同 EU') ?? 0) + 1); continue; }
  if (h11 && hEU && h11 === hEU) { buckets.set('与两源都不同（源一致）', (buckets.get('与两源都不同（源一致）') ?? 0) + 1); }
  else buckets.set('与两源都不同（源不同）', (buckets.get('与两源都不同（源不同）') ?? 0) + 1);
  if (diverged.length < 400) diverged.push(rel);
}

/** 按顶层目录汇总 */
const byTop = new Map<string, Map<string, number>>();
for (const rel of ours) {
  const n = norm(rel);
  const h = md5(join(OURS, rel));
  const top = norm(rel).split('/').slice(0, 2).join('/');
  const in11 = files11.has(n); const inEU = filesEU.has(n);
  let k: string;
  if (!in11 && !inEU) k = '我方独有';
  else {
    const h11 = in11 ? md5(join(SRC11, files11.get(n)!)) : null;
    const hEU = inEU ? md5(join(SRCEU, filesEU.get(n)!)) : null;
    if (h11 && h === h11 && (!hEU || h11 === hEU)) k = '两源一致';
    else if (h11 && h === h11) k = '同 11职业';
    else if (hEU && h === hEU) k = '同 EU';
    else k = '与两源都不同';
  }
  const m = byTop.get(top) ?? new Map<string, number>();
  m.set(k, (m.get(k) ?? 0) + 1);
  byTop.set(top, m);
}

console.log('=== 总体来源构成 ===');
for (const [k, v] of [...buckets.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(22)} ${String(v).padStart(6)}  (${((100 * v) / ours.length).toFixed(1)}%)`);
}

console.log('\n=== 按顶层目录（前 24，按文件数）===');
const rows = [...byTop.entries()].map(([t, m]) => [t, m, [...m.values()].reduce((a, b) => a + b, 0)] as const)
  .sort((a, b) => b[2] - a[2]).slice(0, 24);
const keys = ['两源一致', '同 11职业', '同 EU', '与两源都不同', '我方独有'];
console.log('  ' + '目录'.padEnd(26) + keys.map((k) => k.padStart(12)).join('') + '总'.padStart(8));
for (const [t, m, tot] of rows) {
  console.log('  ' + t.padEnd(26) + keys.map((k) => String(m.get(k) ?? 0).padStart(12)).join('') + String(tot).padStart(8));
}

console.log(`\n=== 与两源都不同的文件（最多列 400，共记录 ${diverged.length}）===`);
if (LIST) for (const d of diverged) console.log('  ' + d);
else console.log('  （加 --list 打印）');

writeFileSync('src/game/data/_asset-provenance.json', JSON.stringify({
  note: '客户端资产来源审计结果（生成物）。两源=11职业客户端 / EU 客户端。',
  ours: ours.length, src11: files11.size, srcEU: filesEU.size,
  buckets: Object.fromEntries(buckets),
  byTopDir: Object.fromEntries([...byTop].map(([t, m]) => [t, Object.fromEntries(m)])),
  diverged: diverged.slice(0, 400),
  oursOnlySample: oursOnly.slice(0, 400),
}, null, 1) + '\n');
console.log('\n写出 src/game/data/_asset-provenance.json');
