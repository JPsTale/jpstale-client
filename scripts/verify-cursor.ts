/**
 * 光标热点回归（`npm run verify-cursor`）。
 *
 * 守的是"**瞄哪儿就等于点哪儿**"：热点必须是该图内**第一个不透明像素**（可见的尖），
 * 而不是写死的 `3 3` —— 用拾取图去点地上的物品时，偏 7~15px 就是"应该点中了却没点中"。
 *
 * 期望值来自资产实测（2026-09-14）；图换了/被替换会在这里红。
 * 注意 default/attack/talk 三张图的尖确实在 (0,0)：热点为 0 不代表"没设"，而是那张图的尖就在左上角。
 *
 * 用法：npx tsx scripts/verify-cursor.ts
 */
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { decodeTexture } from '../src/core/texture.js';

const DIR = resolve(process.env.PT_ASSET_ROOT ?? 'E:/JPsTale/client', 'image/sinimage/cursor');

/** 文件 → 期望热点（实测） */
const EXPECT: Record<string, [number, number]> = {
  'defaultcursor.tga': [0, 0],
  'attack_cursor.tga': [0, 0],
  'talk_cursor.tga': [0, 0],
  'getitem_cursor1.tga': [7, 1],
  'getitem_cursor2.tga': [15, 5],
  'buycursor.tga': [1, 0],
  'sellcursor.tga': [3, 0],
  'repaircursor.tga': [3, 0],
};

function firstOpaque(px: Uint8Array, w: number, h: number): [number, number] {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3] > 8) return [x, y];
    }
  }
  return [0, 0];
}

let files: string[] = [];
try {
  files = readdirSync(DIR).filter((f) => f.toLowerCase().endsWith('.tga'));
} catch {
  console.error(`找不到光标目录：${DIR}（设 PT_ASSET_ROOT 指向资产根）`);
  process.exit(1);
}
if (files.length === 0) {
  console.error(`光标目录里没有 .tga：${DIR}`);
  process.exit(1);
}

let fail = 0;
console.log(`光标热点核对（${DIR}）`);
for (const f of files.sort()) {
  const buf = readFileSync(resolve(DIR, f));
  const dec = decodeTexture(new Uint8Array(buf));
  if (!dec) {
    console.log(`  ✗ ${f}：解码失败`);
    fail++;
    continue;
  }
  const got = firstOpaque(dec.pixels, dec.width, dec.height);
  const want = EXPECT[f];
  if (!want) {
    console.log(`  · ${f}：${dec.width}x${dec.height} 热点 ${got}（未登记期望值；新增图请补进 EXPECT）`);
    continue;
  }
  const ok = got[0] === want[0] && got[1] === want[1];
  if (!ok) fail++;
  console.log(`  ${ok ? '✓' : '✗'} ${f}：${dec.width}x${dec.height} 热点 ${got}${ok ? '' : `（期望 ${want}）`}`);
}

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 张不符`);
process.exit(fail === 0 ? 0 : 1);
