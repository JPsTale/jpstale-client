/**
 * 动画求值黄金样本回归（`npm run verify-anim`）。
 *
 * 为什么需要：`evalSkeleton` 是**游戏与检查器共用**的核心实现，而它要被反复优化
 * （分配复用、跳过 three 的 TRS 往返……）。这类"只改怎么算、不改算什么"的重构，
 * 一旦数值漂了，症状是"角色横躺/武器错位"这种看起来像资产问题的怪象 —— 极难归因。
 * 所以先把一段**已知正确的输出**冻成黄金样本，之后任何改动都要逐元素对得上。
 *
 * 生成/更新（仅在**确认新输出正确**之后才该跑）：
 *   npx tsx scripts/verify-anim-eval.ts --update
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parseSmb } from '../src/core/char-parser.js';
import { evalSkeleton } from '../src/char/animation.js';

const SMB = 'E:/JPsTale/client/char/monster/monbagon/monbagon-a.smb';
const GOLDEN = 'src/game/data/source/anim-eval-golden.json';
/** 覆盖：段首、段中、跨段边界、接近末尾 —— 求值的分支（插值/回退绑定姿态）都会走到 */
const FRAMES = [0, 160, 1000, 5512, 9599];
const TOL = 1e-5;

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

function sample(): { name: string; l: number[]; w: number[] }[][] {
  const buf = readFileSync(SMB);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const smb = parseSmb(ab);
  return FRAMES.map((f) =>
    evalSkeleton(smb, f, false).map((sf) => ({
      name: sf.name,
      l: sf.local.map(r6),
      w: sf.world.map(r6),
    })));
}

const cur = sample();

if (process.argv.includes('--update') || !existsSync(GOLDEN)) {
  writeFileSync(GOLDEN, JSON.stringify({ smb: SMB, frames: FRAMES, tol: TOL, data: cur }));
  console.log(`黄金样本已写入 ${GOLDEN}（${FRAMES.length} 帧，骨骼 ${cur[0]!.length} 根）`);
  process.exit(0);
}

const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as {
  frames: number[]; tol: number; data: { name: string; l: number[]; w: number[] }[][];
};

let fails = 0;
let maxDev = 0;
let worst = '';
const check = (name: string, pass: boolean, extra = '') => {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
  if (!pass) fails++;
};

check('骨骼根数与顺序一致', cur[0]!.length === golden.data[0]!.length,
  `${cur[0]!.length} vs ${golden.data[0]!.length}`);

for (let fi = 0; fi < FRAMES.length; fi++) {
  const f = FRAMES[fi]!;
  const a = golden.data[fi]!;
  const b = cur[fi]!;
  if (a.length !== b.length) { check(`帧 ${f} 骨骼数`, false, `${a.length} vs ${b.length}`); continue; }
  let dev = 0;
  let where = '';
  for (let bi = 0; bi < a.length; bi++) {
    if (a[bi]!.name !== b[bi]!.name) { where = `骨名 ${a[bi]!.name}≠${b[bi]!.name}`; dev = Infinity; break; }
    for (const key of ['l', 'w'] as const) {
      const av = a[bi]![key]!;
      const bv = b[bi]![key]!;
      for (let k = 0; k < av.length; k++) {
        const d = Math.abs(av[k]! - bv[k]!);
        if (d > dev) { dev = d; where = `${a[bi]!.name}.${key}[${k}] ${av[k]} → ${bv[k]}`; }
      }
    }
  }
  if (dev > maxDev) { maxDev = dev; worst = `帧 ${f} ${where}`; }
  check(`帧 ${f}：${a.length} 根骨 × local+world 逐元素一致（容差 ${TOL}）`, dev <= TOL,
    `最大偏差 ${dev.toExponential(2)}`);
}

console.log(`\n最大偏差 ${maxDev.toExponential(2)}  @ ${worst || '-'}`);
console.log(fails === 0 ? '全部通过' : `${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
