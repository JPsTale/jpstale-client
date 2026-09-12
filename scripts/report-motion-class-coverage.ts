/**
 * m1~m8 动画组的职业覆盖报告。
 *
 * 目的：把"哪一组服务哪些职业"从推测变成数据 —— 逐组统计 `dwJobCodeBit`
 * 的**不同取值**（原始位掩码）与条目数，并汇总每个职业出现在哪些组里。
 *
 * 注意 `dwJobCodeBit = 0` 表示无职业限制（通用动作），解码为 ALL。
 * 与 JOB_DATA.bipInx（客户端按体型选的组）是两件事：
 *   dwJobCodeBit 是动画数据自己声明的适用职业，JOB_DATA 是"这个职业用哪套骨骼"。
 *   两者不一致正是要暴露的东西。
 *
 * 用法：npx tsx scripts/report-motion-class-coverage.ts
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseInx, parseSmb } from '../src/core/char-parser.js';
import { buildMotionList } from '../src/render/monster-loader.js';
import { CLASS_FLAG, decodeClassFlags, motionStateName } from '../src/char/char-format.js';
import { JOB_DATA } from '../src/render/char-loader.js';

const ASSET = resolve(process.env.PT_ASSET_ROOT ?? 'E:/JPsTale/client');
const GROUPS = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'];
const ab = (p: string): ArrayBuffer => {
  const b = readFileSync(p);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

/** 组 → 位掩码 → 条目数 */
const perGroup = new Map<string, Map<number, number>>();
/** 组 → 条目总数 */
const totals = new Map<string, number>();
/** 职业 → 组 → 条目数 */
const perClass = new Map<string, Map<string, number>>();

for (const g of GROUPS) {
  const inxPath = `${ASSET}/char/tmabcd/${g}bip.inx`;
  const smbPath = `${ASSET}/char/tmabcd/${g}.smb`;
  if (!existsSync(inxPath) || !existsSync(smbPath)) { console.log(`${g}: 缺文件`); continue; }
  const ms = buildMotionList(parseSmb(ab(smbPath)), parseInx(ab(inxPath)));
  const bits = new Map<number, number>();
  totals.set(g, ms.length);
  for (const m of ms) {
    const b = m.dwJobCodeBit >>> 0;
    bits.set(b, (bits.get(b) ?? 0) + 1);
    for (const name of decodeClassFlags(b)) {
      const cm = perClass.get(name) ?? new Map<string, number>();
      cm.set(g, (cm.get(g) ?? 0) + 1);
      perClass.set(name, cm);
    }
  }
  perGroup.set(g, bits);
}

console.log('=== 每组出现过的 dwJobCodeBit（原始位掩码）===');
for (const g of GROUPS) {
  const bits = perGroup.get(g);
  if (!bits) continue;
  console.log(`\n${g}  共 ${totals.get(g)} 条，不同 jobcode ${bits.size} 种：`);
  for (const [b, n] of [...bits.entries()].sort((a, c) => c[1] - a[1])) {
    const names = decodeClassFlags(b);
    console.log(`  0x${b.toString(16).padStart(4, '0')}  ${String(n).padStart(3)} 条  ${names.join('/')}`);
  }
}

console.log('\n=== 每组的职业并集 ===');
for (const g of GROUPS) {
  const bits = perGroup.get(g);
  if (!bits) continue;
  let union = 0;
  for (const b of bits.keys()) union |= b;
  console.log(`  ${g}: ${decodeClassFlags(union).join('/')}${union === 0 ? '（全部条目都无职业限制）' : ''}`);
}

console.log('\n=== 每个职业出现在哪些组 ===');
for (const name of Object.keys(CLASS_FLAG)) {
  const cm = perClass.get(name);
  if (!cm) { console.log(`  ${name.padEnd(12)} 未出现在任何组`); continue; }
  const parts = [...cm.entries()].sort().map(([g, n]) => `${g}:${n}`);
  console.log(`  ${name.padEnd(12)} ${parts.join('  ')}`);
}

console.log('\n=== JOB_DATA 声明（职业 → 用哪套骨骼）对照 ===');
const declared = new Map<string, number[]>();
for (const [id, job] of Object.entries(JOB_DATA)) {
  const mt = /(m\d+)bip\.inx$/i.exec(job.bipInx);
  if (!mt) continue;
  const g = mt[1]!.toLowerCase();
  declared.set(g, [...(declared.get(g) ?? []), Number(id)]);
}
const JOB_NAME: Record<number, string> = {
  1: 'Fighter', 2: 'Mechanician', 3: 'Archer', 4: 'Pikeman', 5: 'Atalanta',
  6: 'Knight', 7: 'Magician', 8: 'Priestess', 9: 'Assassin', 10: 'Shaman',
};
for (const g of GROUPS) {
  const ids = declared.get(g) ?? [];
  const names = ids.map((i) => `${i}=${JOB_NAME[i] ?? '?'}`);
  console.log(`  ${g}: ${names.length ? names.join(' ') : '（无职业声明使用）'}`);
}
