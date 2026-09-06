// 扫描 DB monsterlist.modelfile 对应客户端资产 inx,判定是否有 RUN(0x60)动画,
// 生成 UPDATE SQL 回写 gamedb.monsterlist.has_run。
// 用法: npx tsx scripts/scan-db-monster-run.ts [资产根目录] [输出sql]
import { parseInx } from '../src/core/char-parser.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

const assetRoot = (process.argv[2] || '/data/PristonTale/apps/client/').replace(/\\/g, '/');
const sqlOut = process.argv[3] || '/tmp/opencode/monster_has_run.sql';

function normToInx(raw: string): string {
  const s = raw.replace(/\\/g, '/').trim().toLowerCase();
  const slash = s.lastIndexOf('/');
  const dir = slash >= 0 ? s.substring(0, slash) : '';
  const name = slash >= 0 ? s.substring(slash + 1) : s;
  const dot = name.lastIndexOf('.');
  const base = dir + (dot > 0 ? '/' + name.substring(0, dot) : '/' + name);
  return (base.endsWith('.inx') ? base : base + '.inx').replace(/^\/+/, '');
}

// 读取 DB(整表 id/modelfile)
const rows = execFileSync('podman', ['exec', 'priston-pg', 'psql', '-U', 'sa', '-d', 'pristontale',
  '-t', '-A', '-F', '\t', '-c', 'SELECT id, modelfile FROM gamedb.monsterlist;'], { encoding: 'utf8' });

const cache = new Map<string, boolean>(); // normalized inx path -> hasRun
const missing = new Set<string>();
let parseFailed = 0;

function hasRunByModel(raw: string): boolean {
  const key = normToInx(raw);
  if (cache.has(key)) return cache.get(key)!;
  let result = false;
  try {
    const full = assetRoot + key;
    if (fs.existsSync(full)) {
      const buf = fs.readFileSync(full);
      const info = parseInx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
      result = info.motions.some((m) => m.state === 0x60);
    } else {
      missing.add(key);
    }
  } catch {
    parseFailed++;
    result = false;
  }
  cache.set(key, result);
  return result;
}

// 按 distinct modelfile 生成 update
const seen = new Set<string>();
const lines: string[] = [];
lines.push('-- monster has_run backfill (RUN 0x60 in inx motion)');
for (const line of rows.split('\n')) {
  if (!line.trim()) continue;
  const tab = line.indexOf('\t');
  const id = line.substring(0, tab).trim();
  const model = line.substring(tab + 1).trim();
  if (!id || !model) continue;
  if (seen.has(model)) continue;
  seen.add(model);
  const run = hasRunByModel(model);
  lines.push(`UPDATE gamedb.monsterlist SET has_run = ${run} WHERE modelfile = '${model.replace(/'/g, "''")}';`);
}
fs.writeFileSync(sqlOut, lines.join('\n') + '\n');
console.log(`modelfile distinct=${seen.size}, missingAsset=${missing.size}, parseFailed=${parseFailed}`);
for (const m of [...missing].slice(0, 10)) console.log('  missing:', m);
console.log('sql ->', sqlOut);
