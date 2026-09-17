/**
 * **`.part` 源语覆盖率扫描** —— 用我们的解析器跑遍所有 `.part`，汇总**没被翻译的键**。
 *
 * 背景：`.part` 是原版**自研的一套源语**，解释器在 `HoBaram/HoNewParticle.cpp`
 * （tokenizer 里那张关键字表：`PARTICLESYSTEM / EVENTSEQUENCE / NUMPARTICLES / EMITRATE /
 * SOURCEBLENDMODE / DESTBLENDMODE / SPAWNDIR / PARTANGLEX..Z / LOCALANGLE..Z / REDCOLOR…
 * INLENGTH / OUTLENGTH / SIZEEXT / EVENTTIMER` …），而我们这边是
 * `core/effect/part-script.ts`（解析）→ `part-to-quarks.ts`（翻成 quarks 源语）→ `quarks-runtime`（执行）。
 *
 * 那个解析器只覆盖了源语的一部分，而**没被读到的键此前是静默丢弃**的
 * （`initial partAngleZ` 就这么丢了很久，表现为"粒子朝向全一样、看着不动"）。
 * 这个扫描把缺口量出来，让"哪些源语还没翻译"变成可见的数字（AGENTS #12）。
 *
 * 用法：`npx tsx scripts/scan-part-coverage.ts [资产根]`
 */
import fs from 'node:fs';
import path from 'node:path';
import { parsePart } from '../src/core/effect/part-script.js';

const ASSET = process.argv[2] ?? process.env.PT_ASSET_ROOT ?? 'E:/JPsTale/client';
/** `.part` 的两个来源（与 `part-assets.partScriptPaths` 一致） */
const ROOTS = ['effect/particle/script', 'game/scripts/particles'];

let files = 0;
let withUnhandled = 0;
/** 键 → { 次数, 例子 } */
const counter = new Map<string, { n: number; sample: string }>();
/** 键出现在多少个不同文件里（比"次数"更能说明覆盖面） */
const filesOf = new Map<string, Set<string>>();

for (const root of ROOTS) {
  const dir = path.join(ASSET, root);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    if (!f.toLowerCase().endsWith('.part')) continue;
    files++;
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const sys = parsePart(text);
    const un = sys.unhandled ?? [];
    if (un.length > 0) withUnhandled++;
    for (const k of un) {
      const c = counter.get(k) ?? { n: 0, sample: `${root}/${f}` };
      c.n++;
      counter.set(k, c);
      (filesOf.get(k) ?? filesOf.set(k, new Set()).get(k)!).add(f);
    }
  }
}

const rows = [...counter.entries()]
  .map(([k, v]) => ({ key: k, uses: v.n, files: filesOf.get(k)!.size, sample: v.sample }))
  .sort((a, b) => b.files - a.files || b.uses - a.uses);

console.log(`扫描 ${files} 个 .part（资产根 ${ASSET}）`);
console.log(`其中 ${withUnhandled} 个文件含**未被翻译**的键；不同键 ${rows.length} 个：\n`);
console.log('  文件数  出现次数  键                                        例子');
for (const r of rows) {
  console.log(`  ${String(r.files).padStart(5)}  ${String(r.uses).padStart(7)}  ${r.key.padEnd(40)} ${r.sample}`);
}
if (rows.length === 0) console.log('  （无 —— 全部键都被翻译）');
