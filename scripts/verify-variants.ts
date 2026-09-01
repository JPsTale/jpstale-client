import { readFileSync } from 'fs';
import { parseInx } from '../src/core/char-parser.js';
import { findMotions } from '../src/char/anim-match.js';

const ROOT = 'E:/JPsTale/client/';
function loadRes(p: string): ArrayBuffer {
  const b = readFileSync(ROOT + p);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}
const base = 'char/tmabcd/';
const jobBip: Record<number, string> = { 1: 'm1bip', 3: 'm2bip', 4: 'm4bip', 5: 'm2bip', 6: 'm1bip', 7: 'm3bip', 8: 'm5bip', 9: 'm6bip', 10: 'm7bip' };

for (const [jobIdStr, bip] of Object.entries(jobBip)) {
  const jobId = Number(jobIdStr);
  const inx = parseInx(loadRes(base + bip + '.inx'));
  const res = findMotions(inx.motions as any, 0x0040, 0, jobId);
  console.log(`job ${jobId} (${bip}) bare-hand STAND 候选索引: ${res.map((m: any) => m.index).join(',')}`);
}
