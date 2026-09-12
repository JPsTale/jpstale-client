/**
 * 判断某组的动作是否照搬了另一组的关键帧（"省 K 帧"）。
 *
 * 判据：逐条比较 (stateCode, startFrame, endFrame, 事件帧签名) 是否完全相同。
 * 帧范围是动画数据里最"人工"的部分 —— 复制粘贴改模型时它会被整段保留，
 * 所以精确相同 = 强血缘证据。比比较 itemCodeList 可靠（后者含已知的解析假数据）。
 *
 * 用法：npx tsx scripts/compare-keyframes.ts
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseInx, parseSmb } from '../src/core/char-parser.js';
import { buildMotionList } from '../src/render/monster-loader.js';

const ASSET = resolve(process.env.PT_ASSET_ROOT ?? 'E:/JPsTale/client');
const GROUPS = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'];
const ab = (p: string): ArrayBuffer => {
  const b = readFileSync(p);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

/** 帧签名（不含 item 数组）：state + 起止帧 + 事件帧 */
function sigs(g: string): { full: Set<string>; range: Set<string>; list: Array<[number, number, number, string]> } {
  const inx = `${ASSET}/char/tmabcd/${g}bip.inx`;
  const smb = `${ASSET}/char/tmabcd/${g}.smb`;
  if (!existsSync(inx) || !existsSync(smb)) return { full: new Set(), range: new Set(), list: [] };
  const rows = buildMotionList(parseSmb(ab(smb)), parseInx(ab(inx)));
  const full = new Set<string>();
  const range = new Set<string>();
  const list: Array<[number, number, number, string]> = [];
  for (const m of rows) {
    const ev = Array.from(m.eventFrame ?? []).filter((x) => x > 0).join(',');
    range.add(`${m.state}|${m.startFrame}|${m.endFrame}`);
    full.add(`${m.state}|${m.startFrame}|${m.endFrame}|${ev}`);
    list.push([m.state, m.startFrame, m.endFrame, ev]);
  }
  return { full, range, list };
}

const S = new Map<string, ReturnType<typeof sigs>>();
for (const g of GROUPS) S.set(g, sigs(g));

console.log('=== 每组的条目数 ===');
for (const g of GROUPS) console.log(`  ${g}: ${S.get(g)!.list.length}`);

console.log('\n=== 逐对：帧范围精确相同 / 帧范围+事件帧都相同 ===');
const out: Array<[string, string, number, number]> = [];
for (let i = 0; i < GROUPS.length; i++) {
  for (let j = i + 1; j < GROUPS.length; j++) {
    const a = S.get(GROUPS[i]!)!;
    const b = S.get(GROUPS[j]!)!;
    let nr = 0, nf = 0;
    for (const [st, s0, e0, ev] of a.list) {
      if (b.range.has(`${st}|${s0}|${e0}`)) nr++;
      if (b.full.has(`${st}|${s0}|${e0}|${ev}`)) nf++;
    }
    out.push([GROUPS[i]!, GROUPS[j]!, nr, nf]);
  }
}
for (const [a, b, nr, nf] of out.sort((x, y) => y[2] - x[2]).slice(0, 14)) {
  console.log(`  ${a}-${b}: 帧范围同 ${String(nr).padStart(3)} 条，范围+事件帧同 ${String(nf).padStart(3)} 条`);
}

console.log('\n=== m8 与各组的帧范围重合（降序）===');
for (const [a, b, nr, nf] of out.filter((p) => p[0] === 'm8' || p[1] === 'm8').sort((x, y) => y[2] - x[2])) {
  const total = S.get('m8')!.list.length;
  console.log(`  ${a}-${b}: ${nr}/${total} 条帧范围完全相同（${((100 * nr) / total).toFixed(0)}%），其中事件帧也同 ${nf} 条`);
}
