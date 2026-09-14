/**
 * 显示预算回归（`npm run verify-mvis`）。
 *
 * 钉住的是**用户明确要的几条行为**，而不是实现细节：
 *  ① 关掉预算 = 全部可见（退回旧行为的逃生门）
 *  ② **怪少时一只都不裁** —— 连"超出距离档"的也不裁
 *     （用户 2026-09-14 反馈："怪本来数量就少的时候，不应该仅按距离来不显示"）
 *  ③ 装得下就不轮换（这是常态，"不闪"的保证）
 *  ④ 保底：最近的那批**与时间片无关**（贴脸/正在打的怪永不因轮换消失）
 *  ⑤ 轮换：跨时间片换一批，且长期公平（"避免有些怪永远看不到"）
 *  ⑥ 强制可见永不被裁（选中/攻击中/正在打我的）
 *  ⑦ 距离档**只在需要裁剪时**才生效
 *  ⑧ 数量预算按怪数单调，阈值处不出现"忽多忽少"
 */
import {
  pickVisibleMonsters, VIS_TIERS, visEpoch, ROTATE_PERIOD_MS, capForCount,
  type VisibilityCandidate,
} from '../src/render/monster-visibility.js';

let fails = 0;
function check(name: string, pass: boolean, extra = ''): void {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
  if (!pass) fails++;
}

const eq = (a: Set<number>, b: number[]) => {
  const bb = new Set(b);
  return a.size === bb.size && [...a].every((v) => bb.has(v));
};

/** 造一批怪：id 1..n，距离默认 = id，可指定强制可见的 id */
function makeCands(n: number, forcedIds: number[] = [], distOf?: (i: number) => number): VisibilityCandidate[] {
  const f = new Set(forcedIds);
  return Array.from({ length: n }, (_, k) => {
    const id = k + 1;
    return { id, dist: distOf ? distOf(id) : id, forced: f.has(id) };
  });
}

const T0 = 1_000_000;
const mid = VIS_TIERS.mid;

console.log('=== ① 关闭预算 ===');
{
  const r = pickVisibleMonsters(makeCands(500), { enabled: false, tier: mid, nowMs: T0 });
  check('visible 为 null（= 不限制，调用方恢复全可见）', r.visible === null);
  check('hidden = 0', r.hidden === 0);
  check('tier 为 null（未启用）', r.tier === null);
}

console.log('\n=== ② 怪少 → 一只都不裁（含超出距离档的）===');
{
  // 30 只怪，全部在 800~1000 之间；玩家选了最紧的 near 档（400）
  const cands = makeCands(30, [], (i) => 800 + i * 7);
  const r = pickVisibleMonsters(cands, { enabled: true, tier: VIS_TIERS.near, nowMs: T0 });
  check('30 只（≤64）即使全在距离档外也全部显示', r.visible!.size === 30, `实际 ${r.visible!.size}`);
  check('capped=false（根本没裁）', r.capped === false);
  check('cap = Infinity（无性能压力）', r.cap === Infinity);

  // 正好 64 只（阈值上）也不裁
  const edge = makeCands(64, [], (i) => 900 + i);
  const r2 = pickVisibleMonsters(edge, { enabled: true, tier: VIS_TIERS.near, nowMs: T0 });
  check('64 只（阈值）同样不裁', r2.visible!.size === 64, `实际 ${r2.visible!.size}`);

  // 65 只开始进入裁剪 —— 但 cap=64，所以只丢 1 只，不会"忽多忽少"
  const over = makeCands(65);   // dist = 1..65，全在 near 档 400 内
  const r3 = pickVisibleMonsters(over, { enabled: true, tier: VIS_TIERS.near, nowMs: T0 });
  check('65 只（刚过阈值）只裁掉极少数（cap=64）', r3.visible!.size === 64, `实际 ${r3.visible!.size}`);

  // 语义澄清（**这条是有意的，不是 bug**）：距离档是"玩家说了只看这么远"，
  // 它硬砍；cap 是性能上限。两者相遇时"档内一只都没有 → 显示 0 只"是正确结果 ——
  // 玩家自己选了"近"，而近处确实没怪。这也是为什么"怪少时完全不裁"必须排在最前面
  // （否则怪少 + 玩家选了近档 = 屏幕上空无一物）。
  const allFar = makeCands(200, [], (i) => 900 + i);
  const rFar = pickVisibleMonsters(allFar, { enabled: true, tier: VIS_TIERS.near, nowMs: T0 });
  check('怪多且全在档外 → 显示 0 只（玩家自选近档的结果，符合语义）',
    rFar.visible!.size === 0, `实际 ${rFar.visible!.size}`);
}

console.log('\n=== ③ 装得下 → 不轮换 ===');
{
  const r = pickVisibleMonsters(makeCands(20), { enabled: true, tier: mid, nowMs: T0 });
  check('全部可见', r.visible !== null && r.visible.size === 20);
  const later = pickVisibleMonsters(makeCands(20), { enabled: true, tier: mid, nowMs: T0 + 60_000 });
  check('下一个时间片仍是同一批（不闪）', eq(later.visible!, [...r.visible!]));
}

console.log('\n=== ④ 保底：最近的固定名额与时间片无关 ===');
{
  // 600 只 → capForCount(600) = 48，保底 = floor(48*0.6) = 28 → id 1..28
  const cands = makeCands(600);
  const cap = capForCount(600);
  const a = pickVisibleMonsters(cands, { enabled: true, tier: mid, nowMs: T0 });
  const b = pickVisibleMonsters(cands, { enabled: true, tier: mid, nowMs: T0 + 5_000 });
  check('发生裁剪（capped）', a.capped === true);
  check(`可见数 = 数量预算 ${cap}`, a.visible!.size === cap, `实际 ${a.visible!.size}`);
  const keepCount = Math.floor(cap * 0.6);
  let keepStable = true;
  for (let id = 1; id <= keepCount; id++) if (!a.visible!.has(id) || !b.visible!.has(id)) keepStable = false;
  check(`最近 ${keepCount} 只两个时间片都在（保底不轮换）`, keepStable);
}

console.log('\n=== ⑤ 轮换：跨时间片换一批 + 长期公平 ===');
{
  const cands = makeCands(600);
  const cap = capForCount(600);
  const sets: Set<number>[] = [];
  const seen = new Map<number, number>();
  const EPOCHS = 100;
  for (let e = 0; e < EPOCHS; e++) {
    const r = pickVisibleMonsters(cands, { enabled: true, tier: mid, nowMs: T0 + e * ROTATE_PERIOD_MS });
    sets.push(r.visible!);
    for (const id of r.visible!) seen.set(id, (seen.get(id) ?? 0) + 1);
  }
  let changed = 0;
  for (let i = 1; i < sets.length; i++) if (!eq(sets[i]!, [...sets[i - 1]!])) changed++;
  check('相邻时间片换了一批', changed === EPOCHS - 1, `${changed}/${EPOCHS - 1} 次变化`);

  const keepCount = Math.floor(cap * 0.6);
  const pool = Array.from({ length: 600 }, (_, i) => i + 1).filter((id) => id > keepCount);
  const never = pool.filter((id) => !seen.has(id));
  check('轮换池里没被轮到的 ≤ 5%（≈ 随机过程的正常尾部）',
    never.length <= pool.length * 0.05, `${never.length}/${pool.length} 只从未出现`);
  const counts = pool.filter((id) => seen.has(id)).map((id) => seen.get(id)!);
  const avg = EPOCHS * (cap - keepCount) / pool.length;
  const maxC = Math.max(...counts);
  // 判据取"期望的 4 倍"≈ 5σ 上界。它抓的是**系统性偏爱**（哈希组合写错会导致
  // "600 只里只有 20 只被反复选中、单只被选 100 次"），不是随机尾巴。
  check('没有怪被系统性偏爱（最多 ≤ 期望 4 倍）',
    maxC <= avg * 4, `期望 ${avg.toFixed(1)} 次/只，最多 ${maxC} 次`);
}

console.log('\n=== ⑥ 强制可见永不被裁 ===');
{
  const cands = makeCands(1000, [900, 950], (i) => (i >= 900 ? 900 + i : i));
  const r = pickVisibleMonsters(cands, { enabled: true, tier: VIS_TIERS.near, nowMs: T0 });
  check('远距离的选中目标仍可见（near 档只到 400）', r.visible!.has(900) && r.visible!.has(950));
  check('可见数 = 数量预算', r.visible!.size === capForCount(1000), `实际 ${r.visible!.size}`);

  // 强制可见 + 其余怪**都在档内**：预算 = cap - 强制数，其余按保底/轮换补满
  const many = makeCands(200, Array.from({ length: 40 }, (_, i) => i + 1), (i) => 200 + i);
  const r2 = pickVisibleMonsters(many, { enabled: true, tier: VIS_TIERS.near, nowMs: T0 });
  check('可见数 = 数量预算（强制可见占名额，其余补满）',
    r2.visible!.size === capForCount(200), `实际 ${r2.visible!.size}`);
  let allForced = true;
  for (let id = 1; id <= 40; id++) if (!r2.visible!.has(id)) allForced = false;
  check('40 只强制可见都在（不受距离档影响）', allForced);

  // 强制可见 + 其余怪**都在档外**：只有强制可见的能进来（距离档硬砍的又一例）
  const far = makeCands(200, Array.from({ length: 40 }, (_, i) => i + 1), (i) => 2000 + i);
  const r3 = pickVisibleMonsters(far, { enabled: true, tier: VIS_TIERS.near, nowMs: T0 });
  check('档外的非强制怪一只都不显示，但 40 只强制可见照旧',
    r3.visible!.size === 40, `实际 ${r3.visible!.size}`);
}

console.log('\n=== ⑦ 距离档只在需要裁剪时生效 ===');
{
  // 500 只怪：id 1..500，dist = id * 4（1..2000）→ near 档 400 内只有 id 1..100
  const cands = makeCands(500, [], (i) => i * 4);
  const r = pickVisibleMonsters(cands, { enabled: true, tier: VIS_TIERS.near, nowMs: T0 });
  check('裁剪后可见的都落在距离档内', [...r.visible!].every((id) => id * 4 <= 400),
    `最大距离 ${Math.max(...[...r.visible!].map((id) => id * 4))}`);
  check('可见数 = 数量预算（距离档内够多，所以由预算决定）',
    r.visible!.size === capForCount(500), `实际 ${r.visible!.size}`);

  // 同一批怪换成 max 档（不限距离）→ 仍受数量预算保护
  const r2 = pickVisibleMonsters(cands, { enabled: true, tier: VIS_TIERS.max, nowMs: T0 });
  check('max 档同样受数量预算保护（不是"不限距离就全显示"）',
    r2.visible!.size === capForCount(500), `实际 ${r2.visible!.size}`);

  // 距离正好等于档位值 → 保留（<= 而非 <）
  const edge = pickVisibleMonsters(
    makeCands(200, [], () => VIS_TIERS.far.range), { enabled: true, tier: VIS_TIERS.far, nowMs: T0 });
  check('距离正好等于档位值 → 保留', edge.visible!.has(1));
}

console.log('\n=== ⑧ 数量预算单调、阈值处不跳变 ===');
{
  check('≤64 不限', capForCount(1) === Infinity && capForCount(64) === Infinity);
  check('65 起收紧到 64（只丢 1 只，观感连续）', capForCount(65) === 64);
  // 关键：预算永远不小于"阈值处的上一个档"，否则阈值附近会"忽多忽少"
  const caps = [10, 64, 65, 100, 128, 129, 200, 256, 257, 1000].map(capForCount);
  let monotone = true;
  for (let i = 1; i < caps.length; i++) if (caps[i]! > caps[i - 1]!) monotone = false;
  check('预算随怪数单调不增', monotone, caps.map((c) => (c === Infinity ? '∞' : c)).join(' > '));
  // 阈值处"可见数"应当连续：64 只时不裁(=64)，65 只时裁到 64
  const at64 = pickVisibleMonsters(makeCands(64), { enabled: true, tier: mid, nowMs: T0 }).visible!.size;
  const at65 = pickVisibleMonsters(makeCands(65), { enabled: true, tier: mid, nowMs: T0 }).visible!.size;
  check('64→65 只的可见数连续（64 → 64）', at64 === 64 && at65 === 64, `${at64} → ${at65}`);
}

console.log('\n=== ⑨ 时间片 ===');
check('1 秒一片', ROTATE_PERIOD_MS === 1000 && visEpoch(2500) === 2 && visEpoch(1999) === 1);

console.log(fails === 0 ? '\n全部通过' : `\n${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
