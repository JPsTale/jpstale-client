import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { installDomStub } from '../scripts/dom-stub.js';
installDomStub();
const { parseInx, parseSmb } = await import('../src/core/char-parser.js');
const { buildMotionList } = await import('../src/char/anim-player.js');
const { STATE } = await import('../src/char/anim-state-machine.js');
const { classIdToFlag } = await import('../src/char/anim-match.js');
const { JOB_DATA } = await import('../src/render/char-loader.js');
const root = 'E:/JPsTale/client';
const b = (p: string) => { const x = readFileSync(p); return x.buffer.slice(x.byteOffset, x.byteOffset + x.byteLength) as ArrayBuffer; };
const want = Number(process.argv[2] || 0);
for (const job of [3, 7, 8, 9, 10, 11]) {
  const bip = (JOB_DATA as Record<number, { bipInx?: string }>)[job]!.bipInx!;
  const inx = parseInx(b(resolve(root, bip)));
  const base = String(inx.motionFile).split('\\').join('/');
  const src = base.slice(0, base.lastIndexOf('.')).toLowerCase() + '.smb';
  const motions = buildMotionList(parseSmb(b(resolve(root, src))), inx);
  const sk = motions.filter((m) => m.state === STATE.SKILL);
  console.log('job', job, bip, 'rows', motions.length, 'SKILL', sk.length, 'flag 0x' + classIdToFlag(job).toString(16));
  console.log('  jobbits', [...new Set(sk.map((m) => m.dwJobCodeBit))].map((x) => '0x' + x.toString(16)).join(','),
    'mapPos', [...new Set(sk.map((m) => m.mapPosition))].join(','));
  const m = sk.find((x) => Array.from(x.skillCodeList || []).includes(want));
  if (m) console.log('  hit idx', m.index, 'jobbit 0x' + m.dwJobCodeBit.toString(16), 'mapPos', m.mapPosition, 'items', m.itemCodeCount);
  else console.log('  no entry with code', want, 'codes:', [...new Set(sk.flatMap((x) => Array.from(x.skillCodeList || [])))].sort((a, b2) => a - b2).join(','));
}
