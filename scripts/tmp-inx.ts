import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseInx, parseSmb } from '../src/core/char-parser.js';
import { buildMotionList } from '../src/render/monster-loader.js';

const t = readFileSync('.env', 'utf8');
const assetRoot = /VITE_ASSET_ROOT\s*=\s*(.+)$/m.exec(t)![1].trim();
const grp = process.argv[2] ?? 'm4';
const b = readFileSync(resolve(assetRoot, `char/tmabcd/${grp}bip.inx`));
const inx = parseInx(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
const base = String(inx.motionFile).split(String.fromCharCode(92)).join('/').replace(/\.[^.]+$/, '');
const sb = readFileSync(resolve(assetRoot, (base + '.smb').toLowerCase()));
const smb = parseSmb(sb.buffer.slice(sb.byteOffset, sb.byteOffset + sb.byteLength) as ArrayBuffer);
const motions = buildMotionList(smb, inx);
console.log(grp, 'motion count', motions.length);
console.log('keys', Object.keys(motions[0] as object).join(','));
for (const m of motions) {
  const codes = Array.from((m as unknown as { skillCodeList?: number[] }).skillCodeList ?? []);
  if (m.state === 0x0150 || codes.length) {
    console.log(`idx=${m.index} state=0x${m.state.toString(16)} frames=${m.startFrame}-${m.endFrame} codes=[${codes}]`);
  }
}
