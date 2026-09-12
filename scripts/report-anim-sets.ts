/**
 * animSet 普查：按 `.inx` 的 **motionFile（.ase）** 聚类。
 *
 * 为什么键是 motionFile 而不是 szLinkFile（2026-09-12 更正）：
 *   实测全部 1932 个 .inx（8 玩家 + 1924 怪物/NPC）：
 *     subModelFile 非空 = 0         ← 这套"子动作表"在我们的资产里从未使用
 *     szLinkFile → .in  = 1910      ← 全部指向明文 .in，是**溯源回链**（指回自己的文本源）
 *     szLinkFile → .inx = 0
 *   先前据 monster-loader 代码推断"szLinkFile 用于动作集继承"是**错的**——未验证数据。
 *   真正的共享键是 `motionFile`：多个模型指向同一个 `.ase` ⇒ 共享同一批动画。
 *
 * 输出：每个 animSet（= 一个 .ase）被哪些模型使用、条目数；以及 8 个玩家组归入哪些集。
 * 只读。用法：npx tsx scripts/report-anim-sets.ts
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseInx } from '../src/core/char-parser.js';

const ASSET = resolve(process.env.PT_ASSET_ROOT ?? 'E:/JPsTale/client');
const DIRS = process.argv.slice(2).length ? process.argv.slice(2) : ['char/tmabcd'];
const ab = (p: string): ArrayBuffer => {
  const b = readFileSync(p);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

interface Row { key: string; motionCount: number; ase: string; model: string }
const rows = new Map<string, Row>();
let failed = 0;
for (const d of DIRS) {
  const dir = resolve(ASSET, d);
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir)) {
    if (!/\.inx$/i.test(f)) continue;
    let i; try { i = parseInx(ab(resolve(dir, f))); } catch { failed++; continue; }
    rows.set(f.replace(/\.inx$/i, '').toLowerCase(), {
      key: f.replace(/\.inx$/i, '').toLowerCase(),
      motionCount: i.motionCount,
      ase: i.motionFile.trim().replace(/\\/g, '/').toLowerCase(),
      model: i.modelFile.trim().replace(/\\/g, '/').toLowerCase(),
    });
  }
}
console.log(`扫描 ${rows.size} 个 .inx（解析失败 ${failed}）\n`);

/** 按 .ase 聚类 = animSet */
const bySet = new Map<string, Row[]>();
for (const r of rows.values()) {
  if (!r.ase) continue;
  bySet.set(r.ase, [...(bySet.get(r.ase) ?? []), r]);
}

const players = ['m1bip', 'm2bip', 'm3bip', 'm4bip', 'm5bip', 'm6bip', 'm7bip', 'm8bip'];
console.log('=== 8 个玩家组所属的 animSet ===');
for (const p of players) {
  const r = rows.get(p);
  if (!r) { console.log(`  ${p}: 缺`); continue; }
  const members = (bySet.get(r.ase) ?? []).map((m) => m.key);
  console.log(`  ${p.padEnd(7)} → ${r.ase}  条目 ${String(r.motionCount).padStart(4)}  共用者 ${members.length} 个 [${members.join(' ')}]`);
}

const shared = [...bySet.entries()].filter(([, m]) => m.length > 1);
console.log(`\n=== 共享情况（共 ${bySet.size} 个 animSet）===`);
console.log(`  被多模型共享的集: ${shared.length} 个`);
console.log(`  仅单模型使用的集: ${bySet.size - shared.length} 个`);
console.log('\n  共享最多的 12 个：');
for (const [ase, m] of shared.sort((a, b) => b[1].length - a[1].length).slice(0, 12)) {
  console.log(`    ${String(m.length).padStart(4)} 个模型 × ${m[0]!.motionCount} 条目  ${ase}`);
}
