import { readFileSync } from 'node:fs';
import { parseInx } from '../src/core/char-parser.js';

async function main() {
  const buf = readFileSync('E:/JPsTale/client/char/tmabcd/m6bip.inx').buffer.slice(0);
  const inx = parseInx(buf);
  const nullIdx = new Set<number>();
  for (const m of inx.motions) {
    for (let i = 0; i < m.itemCodeCount && i < 52; i++) {
      const idx = m.itemCodeList[i];
      if (idx !== 0xFFFF) nullIdx.add(idx);
    }
  }
  console.log('distinct non-empty index count:', nullIdx.size);
  console.log('all distinct indexes:', [...nullIdx].sort((a, b) => a - b).join(','));
}
main().catch(e => { console.error(e); process.exit(1); });
