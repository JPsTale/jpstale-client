/** 临时：对比 m1~m8 的骨架是否同一套（objects 数量/名字），并量各职业预览体积 */
import { readFileSync, statSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseSmb } from '../src/core/char-parser.js';

const ROOT = 'E:/JPsTale/client';
const sigs: string[] = [];
for (let g = 1; g <= 8; g++) {
  const p = resolve(ROOT, `char/tmabcd/m${g}.smb`);
  const buf = readFileSync(p);
  const smb = parseSmb(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  const names = smb.objects.map((o) => o.nodeName).join('|');
  sigs.push(names);
  console.log(`m${g}.smb: ${(buf.byteLength / 1048576).toFixed(1)}MB  objects=${smb.objects.length}  骨名哈希=${hash(names)}`);
}
console.log('\n8 组骨架名字序列完全一致？', sigs.every((s) => s === sigs[0]!));

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0; }
  return (h >>> 0).toString(16);
}
