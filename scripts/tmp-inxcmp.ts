import { readFileSync } from 'node:fs';
import { parseInx } from '../src/core/char-parser.js';

const paths = process.argv.slice(2);
for (const p of paths) {
  try {
    const b = readFileSync(p);
    const inx = parseInx(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
    console.log('=== ' + p);
    console.log('   motionFile=' + inx.motionFile + '  rows=' + inx.motions.length + '  skillRows=' + (inx.skill?.length ?? 'n/a'));
    const rows = inx.motions ?? [];
    const skill = rows.filter((m: any) => m.state === 0x150);
    console.log('   SKILL rows: ' + skill.length);
    for (const m of skill) {
      const codes = Array.from((m as any).skillCodeList ?? []);
      if (codes.some((c) => c > 0) || true) {
        console.log(`     idx=${(m as any).index ?? '?'} frames=${(m as any).startFrame}-${(m as any).endFrame} codes=[${codes}]`);
      }
    }
  } catch (e) {
    console.log('=== ' + p + '  FAILED: ' + String(e));
  }
}
