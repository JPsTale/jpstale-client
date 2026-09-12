/**
 * m8（格斗家）的基座动作是从哪一组复制的？
 *
 * 思路：格斗家的普通动作不像凭空新做，而像克隆自某个已有职业组。
 * 以 (stateCode, itemCode 数组, eventFrame 签名) 为指纹，把 m8 的条目
 * 与其他 7 组对齐，统计帧偏移的分布。偏移恒定 → 确认为复制关系。
 *
 * 用法：npx tsx scripts/compare-m8-origin.ts
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseInx, parseSmb } from '../src/core/char-parser.js';
import { buildMotionList } from '../src/render/monster-loader.js';
import { motionStateName } from '../src/char/char-format.js';

const ASSET = resolve(process.env.PT_ASSET_ROOT ?? 'E:/JPsTale/client');
const ab = (p: string): ArrayBuffer => {
  const b = readFileSync(p);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
interface Row { idx: number; state: number; start: number; end: number; items: string; ev: string; job: number }

function load(g: string): Row[] {
  const inx = `${ASSET}/char/tmabcd/${g}bip.inx`;
  const smb = `${ASSET}/char/tmabcd/${g}.smb`;
  if (!existsSync(inx) || !existsSync(smb)) return [];
  return buildMotionList(parseSmb(ab(smb)), parseInx(ab(inx))).map((m) => ({
    idx: m.index, state: m.state, start: m.startFrame, end: m.endFrame,
    items: Array.from(m.itemCodeList ?? []).slice(0, m.itemCodeCount).join(','),
    ev: Array.from(m.eventFrame ?? []).filter((x) => x > 0).join(','),
    job: m.dwJobCodeBit >>> 0,
  }));
}

const groups = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'];
const m8 = load('m8');
console.log(`m8 条目 ${m8.length}（jobcode 0x${(m8[0]?.job ?? 0).toString(16)}）
`);

const fpOf = (r: Row) => `${r.state}|${r.items}|${r.ev}`;
/** 只保留在组内**唯一**的指纹 —— 同指纹多条会让"最近帧起点"配对出错 */
function uniqueFp(rows: Row[]): Map<string, Row> {
  const cnt = new Map<string, number>();
  const one = new Map<string, Row>();
  for (const r of rows) { const k = fpOf(r); cnt.set(k, (cnt.get(k) ?? 0) + 1); one.set(k, r); }
  for (const [k, n] of cnt) if (n > 1) one.delete(k);
  return one;
}

const m8u = uniqueFp(m8);
console.log(`m8 唯一指纹 ${m8u.size}/${m8.length}
`);

console.log('=== 用唯一指纹对齐，看帧偏移是否为常数 ===');
const summary: Array<[string, number, number[]]> = [];
for (const g of groups) {
  const gu = uniqueFp(load(g));
  const ds: number[] = [];
  for (const [k, r] of m8u) {
    const c = gu.get(k);
    if (c) ds.push(r.start - c.start);
  }
  if (!ds.length) { console.log(`  ${g}: 无可对齐的唯一指纹`); continue; }
  const dist = new Map<number, number>();
  for (const d of ds) dist.set(d, (dist.get(d) ?? 0) + 1);
  const top = [...dist.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`  ${g}: 对齐 ${String(ds.length).padStart(2)} 条　偏移分布 ${top.slice(0, 5).map(([d, n]) => `${d}:${n}`).join('  ')}`);
  summary.push([g, ds.length, ds]);
}

console.log('=== 结论 ===');
const best = summary.sort((a, b) => b[1] - a[1])[0];
if (best) {
  const dist = new Map<number, number>();
  for (const d of best[2]) dist.set(d, (dist.get(d) ?? 0) + 1);
  const top = [...dist.entries()].sort((a, b) => b[1] - a[1]);
  const [mode, n] = top[0]!;
  const same = top.filter(([, c]) => c === n).length === 1;
  console.log(`  最相似组 = ${best[0]}（${best[1]} 条唯一指纹可对齐）`);
  console.log(`  众数偏移 = ${mode} 帧，占 ${n}/${best[2].length}`);
  if (same && n === best[2].length) console.log(`  ★ 偏移恒定且唯一 → m8 基座动作克隆自 ${best[0]}，整体平移 ${mode} 帧`);
  else if (same && n >= best[2].length * 0.7) console.log(`  ☆ 主偏移 ${mode} 帧占多数（${n}/${best[2].length}），其余为零散差异 → 基本克隆自 ${best[0]}，少数帧被重排`);
  else console.log(`  偏移不唯一 → 不是简单克隆，可能是同源但重新编排过`);
}

// m8 独有的部分（无指纹匹配）= 自己的东西
console.log('\n=== m8 中无法与其他组对齐的条目（= 格斗家独有）===');
const allFp = new Set<string>();
for (const g of groups) for (const r of load(g)) allFp.add(`${r.state}|${r.items}|${r.ev}`);
for (const r of m8) {
  if (allFp.has(`${r.state}|${r.items}|${r.ev}`)) continue;
  console.log(`  #${String(r.idx).padStart(3)} ${motionStateName(r.state).padEnd(10)} [${r.start},${r.end}] ev=${r.ev || '-'} items=${r.items.split(',').length}`);
}
