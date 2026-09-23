import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { installDomStub } from '../scripts/dom-stub.js';
installDomStub();
const root = 'E:/JPsTale/client';
const bytes = (p: string) => { const b = readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const { parseInx, parseSmb } = await import('../src/core/char-parser.js');
const { buildMotionList } = await import('../src/char/anim-player.js');
const { classIdToFlag } = await import('../src/char/anim-match.js');
const { STATE } = await import('../src/char/anim-state-machine.js');
const { SITEM_CODE_BY_INDEX } = await import('../src/char/sitem-weapon-index.js');

const groups = process.argv.slice(2);
for (const grp of groups.length ? groups : ['m5']) {
  const inxPath = resolve(root, 'char/tmabcd/' + grp + 'bip.inx');
  const inx = parseInx(bytes(inxPath));
  const smbRel = String(inx.motionFile).split('\\').join('/').replace(/\.[^.]+$/, '').toLowerCase() + '.smb';
  const motions = buildMotionList(parseSmb(bytes(resolve(root, smbRel))), inx);
  const skills = motions.filter((m) => m.state === STATE.SKILL);
  console.log(grp + ': motionFile=' + inx.motionFile + ' total=' + motions.length + ' skill=' + skills.length);
  for (const m of skills) {
    const codes = Array.from(m.skillCodeList ?? []);
    const items = Array.from(m.itemCodeList).slice(0, m.itemCodeCount).map((i) => i + '=>' + (SITEM_CODE_BY_INDEX[i] != null ? '0x' + (SITEM_CODE_BY_INDEX[i]! >>> 0).toString(16) : '?'));
    console.log('  idx=' + m.index + ' f=' + m.startFrame + '-' + m.endFrame + ' jobBit=0x' + (m.dwJobCodeBit >>> 0).toString(16) + ' mapPos=' + m.mapPosition + ' itemCount=' + m.itemCodeCount + ' codes=[' + codes + '] items=[' + items + ']');
  }
  for (const j of [1, 4, 8]) console.log('job' + j + ' flag = 0x' + classIdToFlag(j).toString(16));
}
