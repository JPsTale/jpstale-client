import { readFileSync, readdirSync } from 'node:fs';
import { parseInx } from '../src/core/char-parser.js';
const ab = (p: string) => { const b = readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const D = 'E:/JPsTale/client/char/tmabcd';
const byModel = new Map<string, string[]>(); const byMotion = new Map<string, string[]>();
let n = 0;
for (const f of readdirSync(D)) {
  if (!/\.inx$/i.test(f)) continue;
  let i; try { i = parseInx(ab(`${D}/${f}`)); } catch { continue; }
  n++;
  const k = f.replace(/\.inx$/i, '').toLowerCase();
  const m = i.modelFile.trim().replace(/\/g, '/').toLowerCase();
  const a = i.motionFile.trim().replace(/\/g, '/').toLowerCase();
  if (m) byModel.set(m, [...(byModel.get(m) ?? []), k]);
  if (a) byMotion.set(a, [...(byMotion.get(a) ?? []), k]);
}
const sh = (mp: Map<string, string[]>) => [...mp.values()].filter(v => v.length > 1).length;
console.log(`扫 ${n} 个 .inx`);
console.log(`  按 modelFile 聚类：${byModel.size} 个集，其中被多模型共享 ${sh(byModel)} 个`);
console.log(`  按 motionFile 聚类：${byMotion.size} 个集，其中被多模型共享 ${sh(byMotion)} 个`);
const top = [...byModel.entries()].filter(([, v]) => v.length > 1).sort((a, b) => b[1].length - a[1].length).slice(0, 6);
console.log('  modelFile 共享最多的：');
for (const [k, v] of top) console.log(`    ${String(v.length).padStart(4)} 个模型  ${k}  例: ${v.slice(0, 4).join(' ')}`);
