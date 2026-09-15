/**
 * 追击停步环回归（`npm run verify-chase`）。
 *
 * 守的是一条**跨文件、跨仓库**的不变量：**追怪时的停步环必须严格小于攻击距离**。
 * 违反了就是"看得见怪、走不过去、也打不着"——而且全程没有任何报错，只有 900ms 后的
 * 一条"寻路受阻，放弃目标"（详见 `src/game/combatRange.ts` 文件头）。
 *
 * 2026-09-15 就是这么出的事：服务端把近战单手/徒手从 40 调成 30（另一仓库的一次调参，
 * 客户端毫不知情），而环是硬编码的 32 ⇒ 空手与全部单手武器卡死。
 * 所以这个脚本**不写死期望值**，而是去读真正的两个来源：
 *   ① 服务端源码里的 `MELEE_RANGE_ONE_HAND / TWO_HAND`（近战两档）
 *   ② `items-11job.json` 里全部远程武器的 `range`（远程档）
 * 对每一个值断言 `ring < range`，顺带核对几个**落点数值**（谁改了比例会在这里红）。
 *
 * 用法：npx tsx scripts/verify-chase-range.ts
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { monsterStopRing, MONSTER_RING_CAP } from '../src/game/combatRange.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = resolve(HERE, '..');

let fail = 0;
function check(label: string, got: unknown, want: unknown): void {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}：${JSON.stringify(got)}${ok ? '' : `（期望 ${JSON.stringify(want)}）`}`);
}
/** 不变量断言：环必须**严格**落在射程以内（留出的余量也一并报出来） */
function checkInside(label: string, range: number): void {
  const ring = monsterStopRing(range);
  const ok = ring < range;
  if (!ok) fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}：射程 ${range} → 环 ${ring}`
    + `${ok ? `（余量 ${(range - ring).toFixed(1)}）` : '  ← 环 ≥ 射程，会卡在够不着的位置'}`);
}

// ── ① 落点数值（改了比例/上限先在这里红，再看是不是有意的） ────────────────
console.log('落点数值（cap=' + MONSTER_RING_CAP + '，比例 0.8）');
check('徒手 / 近战单手 30 →', monsterStopRing(30), 24);
check('近战双手 60 →', monsterStopRing(60), 32);
check('远程下限 140 →', monsterStopRing(140), 32);
check('远程上限 270 →', monsterStopRing(270), 32);
check('射程缺失 0 →', monsterStopRing(0), 0);

// ── ② 全局不变量：任何正射程都必须严格大于环 ──────────────────────────────
console.log('\n全局不变量（射程 1..1000 逐一断言）');
let bad = 0;
for (let r = 1; r <= 1000; r++) if (!(monsterStopRing(r) < r)) bad++;
check('ring < range 全通过', bad, 0);
check('非正 / NaN 射程（服务端漏发字段）→ 环 0，不造兜底值',
  [monsterStopRing(-5), monsterStopRing(0), monsterStopRing(NaN)], [0, 0, 0]);

// ── ③ 服务端源码的两档近战射程（另一个仓库，但就是这个数字把环顶穿的） ──────
console.log('\n服务端近战射程（pt-game-server PlayerStatCalculator）');
const CALC = resolve(CLIENT_ROOT, '../jpstale-server/pt-game-server/src/main/java'
  + '/org/jpstale/server/game/service/PlayerStatCalculator.java');
if (!existsSync(CALC)) {
  // 不静默跳过：明确说出"这项没验"，让人知道覆盖范围少了一块
  console.log(`  ! 未找到服务端源码，跳过往返核对：${CALC}`);
} else {
  const src = readFileSync(CALC, 'utf8');
  const tiers: Array<[string, number]> = [];
  for (const m of src.matchAll(/MELEE_RANGE_(ONE|TWO)_HAND\s*=\s*(\d+)/g)) {
    tiers.push([m[1] === 'ONE' ? '近战单手/徒手' : '近战双手', Number(m[2])]);
  }
  if (tiers.length === 0) {
    console.log('  ✗ 源码里没解析到 MELEE_RANGE_*_HAND —— 常量改名了？本脚本要跟着改');
    fail++;
  }
  for (const [name, r] of tiers) checkInside(`${name}`, r);
}

// ── ④ 远程武器射程（真实物品数据，139 件） ────────────────────────────────
console.log('\n远程武器射程（items-11job.json 全量）');
const ITEMS = resolve(CLIENT_ROOT, 'src/game/data/source/items-11job.json');
const items = JSON.parse(readFileSync(ITEMS, 'utf8')) as Array<{ code: string; range?: number }>;
const ranged = items.filter((it) => (it.range ?? 0) > 0);
check('带射程的物品数 > 0', ranged.length > 0, true);
let rBad = 0;
for (const it of ranged) if (!(monsterStopRing(it.range!) < it.range!)) { rBad++; console.log(`    ✗ ${it.code} range=${it.range}`); }
check(`${ranged.length} 件带射程的武器 ring < range`, rBad, 0);

// ── ⑤ 接线：环只有一份实现，且updateMovement 用的是它 ─────────────────────
console.log('\n接线（单一实现）');
const WV = readFileSync(resolve(CLIENT_ROOT, 'src/ui/WorldView.ts'), 'utf8');
check('WorldView 用 monsterStopRing(攻击距离) 做怪物停步环',
  WV.includes('monsterStopRing(selfAttackRange())'), true);
check('WorldView 不再有硬编码的怪物停步环 NEAR_RANGE', WV.includes('NEAR_RANGE'), false);

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项不符`);
process.exit(fail === 0 ? 0 : 1);
