import { readFileSync } from 'node:fs';
import { parseSmb } from '../src/core/char-parser.js';
import { buildSkeleton } from '../src/render/skinned-builder.js';

async function main() {
  const buf = readFileSync('E:/JPsTale/client/char/tmabcd/m6.smb').buffer.slice(0);
  const smb = parseSmb(buf);
  const skel = buildSkeleton(smb, false);
  const names: string[] = [];
  skel.skeletonGroup.traverse(o => names.push(o.name));
  const targets = ['in_DaggerL', 'in_DaggerR', 'in01', 'in-bow', 'in-cro', 'in03', 'in04', 'weapon01', 'weapon05', 'weapon06', 'weapon02'];
  for (const t of targets) {
    const hit = names.filter(n => n.toLowerCase().includes(t.toLowerCase()));
    console.log(`${t}: ${hit.length ? hit.join(', ') : 'MISSING'}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
