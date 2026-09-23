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
for (const [bip, want] of [['char/tmabcd/m5bip.inx', 123], ['char/tmabcd/m1bip.inx', 24]] as Array<[string, number]>) {
  const inx = parseInx(b(resolve(root, bip)));
  const base = String(inx.motionFile).split('\\').join('/');
  const src = base.slice(0, base.lastIndexOf('.')).toLowerCase() + '.smb';
  const motions = buildMotionList(parseSmb(b(resolve(root, src))), inx);
  for (const m of motions.filter((x) => x.state === STATE.SKILL)) {
    if (!Array.from(m.skillCodeList || []).includes(want)) continue;
    const raw = Array.from(m.itemCodeList.slice(0, m.itemCodeCount));
    console.log(bip, 'idx', m.index, 'codes', Array.from(m.skillCodeList || []).filter((c) => c > 0).join(','));
    console.log('   raw item idx', raw.join(' '), '| hasFFFF', raw.includes(0xffff), '| hasFF', raw.includes(0xff));
    console.log('   decoded', raw.map((i) => SITEM_CODE_BY_INDEX[i] == null ? '?' : '0x' + SITEM_CODE_BY_INDEX[i]!.toString(16)).join(' '));
    break;
  }
}
