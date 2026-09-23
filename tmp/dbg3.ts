import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
const paths = [
  'E:/BaiduNetdiskDownload/精灵/精灵11职业单机版一键端/精灵11职业单机版一键端/Game客户端/char/tmABCD/M1Bip.inx',
  'E:/BaiduNetdiskDownload/精灵/精灵11职业单机版一键端/精灵11职业单机版一键端/Server服务端/char/tmABCD/M1Bip.inx',
  'E:/EU/Pristontale EU/char/tmABCD/M1Bip.inx',
  'E:/JPsTale/client/char/tmabcd/m1bip.inx',
  'E:/JPsTale/downloads/char/tmABCD/M1Bip.inx',
  'E:/PristonTale-EU/Game/char/tmABCD/M1Bip.inx',
  'E:/PristonTale-EU/Server/game-server/char/tmABCD/M1Bip.inx',
];
const { parseInx, parseSmb } = await import('../src/core/char-parser.js');
const { buildMotionList } = await import('../src/char/anim-player.js');
const { STATE } = await import('../src/char/anim-state-machine.js');
const b = (p: string) => { const x = readFileSync(p); return x.buffer.slice(x.byteOffset, x.byteOffset + x.byteLength) as ArrayBuffer; };
for (const p of paths) {
  let md5 = '?';
  try { md5 = execSync(`certutil -hashfile "${p}" MD5`).toString().split('\n')[1].trim().slice(0, 12); } catch { /* ignore */ }
  try {
    const inx = parseInx(b(p));
    let skm = 0, codes = new Set<number>();
    // 只统计 .inx 本身（不配对 .in）：需要 smb 才能建 MotionInfo，这里直接读 inx 行
    for (const r of inx.motions ?? []) {
      if (r.state !== STATE.SKILL) continue;
      skm++;
      for (const c of Array.from(r.skillCodeList ?? [])) if (c > 0) codes.add(c);
    }
    const arr = [...codes].sort((a, c) => a - c);
    console.log(p.slice(0, 78));
    console.log('   md5', md5, 'motions', inx.motions?.length, 'SKILL', skm, 'has23', codes.has(23), 'codes', arr.join(','));
  } catch (e) {
    console.log(p.slice(0, 78), 'ERR', (e as Error).message.slice(0, 80));
  }
}
