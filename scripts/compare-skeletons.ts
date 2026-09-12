/**
 * 8 个动画组的骨骼血缘对比。
 *
 * 目的：判断"某组的模型/骨架是从哪一组改出来的"。
 * 开发者在做新职业时常直接复用现有角色的 K 帧与骨架，只在骨骼名/网格上做改动，
 * 所以**骨骼名集合的重合度**是血缘的强证据（比动画帧更可靠）。
 *
 * 用法：npx tsx scripts/compare-skeletons.ts
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseSmb } from '../src/core/char-parser.js';
import { buildSkeleton } from '../src/render/skinned-builder.js';

const ASSET = resolve(process.env.PT_ASSET_ROOT ?? 'E:/JPsTale/client');
const GROUPS = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'];

const boneSets = new Map<string, Set<string>>();
const counts = new Map<string, number>();

for (const g of GROUPS) {
  const p = `${ASSET}/char/tmabcd/${g}.smb`;
  if (!existsSync(p)) { console.log(`${g}: 缺 smb`); continue; }
  const buf = readFileSync(p);
  const smb = parseSmb(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  const skel = buildSkeleton(smb, false);
  const names = new Set<string>();
  skel.skeletonGroup.traverse((o) => names.add(o.name));
  boneSets.set(g, names);
  counts.set(g, names.size);
}

console.log('=== 骨骼节点数 ===');
for (const g of GROUPS) console.log(`  ${g}: ${counts.get(g) ?? '-'}`);

/** 名称里的体型前缀（tmb/tfb/mmb/mfb = t男/t女/m男/m女） */
console.log('\n=== 每组骨骼名里的体型前缀 ===');
for (const g of GROUPS) {
  const s = boneSets.get(g);
  if (!s) continue;
  const stat = new Map<string, number>();
  for (const n of s) {
    const m = /^(tmb|tfb|mmb|mfb|tb|tf|mb|mf)/i.exec(n);
    if (m) stat.set(m[1]!.toLowerCase(), (stat.get(m[1]!.toLowerCase()) ?? 0) + 1);
  }
  const top = [...stat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  console.log(`  ${g}: ${top.map(([k, v]) => `${k}×${v}`).join('  ') || '(无前缀骨骼名)'}`);
}

console.log('\n=== 两两重合度（Jaccard，越高越同源）===');
const pairs: Array<[string, string, number]> = [];
for (let i = 0; i < GROUPS.length; i++) {
  for (let j = i + 1; j < GROUPS.length; j++) {
    const a = boneSets.get(GROUPS[i]!);
    const b = boneSets.get(GROUPS[j]!);
    if (!a || !b) continue;
    let inter = 0;
    for (const n of a) if (b.has(n)) inter++;
    const uni = a.size + b.size - inter;
    pairs.push([GROUPS[i]!, GROUPS[j]!, uni ? inter / uni : 0]);
  }
}
for (const [a, b, v] of pairs.sort((x, y) => y[2] - x[2])) {
  console.log(`  ${a}-${b}  ${(v * 100).toFixed(1)}%`);
}

console.log('\n=== 与 m8 最亲近的组 ===');
for (const [a, b, v] of pairs.filter((p) => p[0] === 'm8' || p[1] === 'm8').sort((x, y) => y[2] - x[2])) {
  console.log(`  ${a}-${b}  ${(v * 100).toFixed(1)}%`);
}

console.log('\n=== m8 独有 / 缺失的骨骼名（与最亲近组比）===');
const nearest = pairs.filter((p) => p[0] === 'm8' || p[1] === 'm8').sort((x, y) => y[2] - x[2])[0];
if (nearest) {
  const other = nearest[0] === 'm8' ? nearest[1] : nearest[0];
  const a = boneSets.get('m8')!;
  const b = boneSets.get(other)!;
  const onlyA = [...a].filter((n) => !b.has(n));
  const onlyB = [...b].filter((n) => !a.has(n));
  console.log(`  对比组 ${other}`);
  console.log(`  m8 独有 ${onlyA.length} 个: ${onlyA.slice(0, 25).join(', ')}`);
  console.log(`  ${other} 独有 ${onlyB.length} 个: ${onlyB.slice(0, 25).join(', ')}`);
}
