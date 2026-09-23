import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { installDomStub } from '../scripts/dom-stub.js';
installDomStub();
const { parseInx, parseSmb } = await import('../src/core/char-parser.js');
const { buildMotionList } = await import('../src/char/anim-player.js');
const { STATE } = await import('../src/char/anim-state-machine.js');
const { SITEM_CODE_BY_INDEX } = await import('../src/char/sitem-weapon-index.js');
const root = 'E:/JPsTale/client';
const b = (p: string) => { const x = readFileSync(p); return x.buffer.slice(x.byteOffset, x.byteOffset + x.byteLength) as ArrayBuffer; };
const bip = process.argv[2] || 'char/tmabcd/m5bip.inx';
const want = Number(process.argv[3] || 123);
const inx = parseInx(b(resolve(root, bip)));
const base = String(inx.motionFile).split('\\').join('/');
const src = base.slice(0, base.lastIndexOf('.')).toLowerCase() + '.smb';
const motions = buildMotionList(parseSmb(b(resolve(root, src))), inx);
const sk = motions.filter((m) => m.state === STATE.SKILL);
console.log('SKILL rows', sk.length);
for (const m of sk) {
  const codes = Array.from(m.skillCodeList || []).filter((c) => c > 0);
  if (!codes.includes(want)) continue;
  const items = Array.from(m.itemCodeList.slice(0, m.itemCodeCount)).map((i) => SITEM_CODE_BY_INDEX[i]);
  console.log('idx', m.index, 'codes', codes.join(','), 'jobbit 0x' + m.dwJobCodeBit.toString(16), 'mapPos', m.mapPosition,
    'eventFrames', Array.from(m.eventFrame).join(','), 'frames', m.startFrame, m.endFrame);
  console.log('   itemCodes', items.map((v) => (v == null ? '?' : '0x' + v.toString(16))).join(' '));
}
