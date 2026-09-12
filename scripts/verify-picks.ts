/**
 * 手工走查的自动化版：对「动作组 × 武器 × 场所 × 状态」跑**运行时真实匹配器**
 * （`pickSemanticMotion`，检查器与游戏共用同一实现），打印选中的动画与候选。
 *
 * 用途：修完数据/改完规则后回归。被用户实测报出过的三条不变量：
 *   （1）1H 斧不得选到 2H 条目（含不得把 `run~3` 当 1H 候选）；
 *   （2）**持械时"空手/通用"条目不得出现在候选里**（持械就不该播空手动作）；
 *   （3）**收械时不得播持械动作**（武器已收起；且村庄态条目只有空手族）。
 * 手别判定背景见 src/game/data/source/weapon-hand-overrides.json 的 note。
 */
import { FIT_LABEL, pickSemanticMotion } from '../src/char/anim-match.js';
import { semanticEntriesForJob } from '../src/char/semantic-anim.js';
import m1 from '../src/game/data/anim-in/anim-m1.generated.json';
import m4 from '../src/game/data/anim-in/anim-m4.generated.json';

type G = { inxIndex: number; inxState: string; motion: string; inxFrames: number[] };
const motionsOf = (j: unknown) => (j as { entries: G[] }).entries
  .map((e) => ({ index: e.inxIndex, startFrame: e.inxFrames[0]!, endFrame: e.inxFrames[1]! }));
const label = (j: unknown, i: number) => {
  const e = (j as { entries: G[] }).entries.find((x) => x.inxIndex === i);
  return e ? `${e.motion || e.inxState} [${e.inxFrames}]` : `#${i}`;
};

const STAND = 0x40, WALK = 0x50, RUN = 0x60, ATTACK = 0x100;
type Loc = 'village' | 'field';
/** [名称, 动作组, 数据源, 状态, 武器类型, 单双手, 场所] */
type Case = [string, number, unknown, number, string | null, '1H' | '2H' | null, Loc];
const CASES: Case[] = [
  ['1H斧 站立',   1, m1, STAND,  'AXE', '1H', 'field'],
  ['1H斧 走',     1, m1, WALK,   'AXE', '1H', 'field'],
  ['1H斧 跑',     1, m1, RUN,    'AXE', '1H', 'field'],
  ['1H斧 攻击',   1, m1, ATTACK, 'AXE', '1H', 'field'],
  ['2H斧 跑',     1, m1, RUN,    'AXE', '2H', 'field'],
  ['2H斧 攻击',   1, m1, ATTACK, 'AXE', '2H', 'field'],
  ['WH151 锤 跑', 1, m1, RUN,    'HAMMER', '1H', 'field'],
  ['WS254 剑 跑', 1, m1, RUN,    'SWORD', '2H', 'field'],
  ['WS118 弩 跑', 1, m1, RUN,    'CROSSBOW', '2H', 'field'],
  ['WS102 手弩 跑', 1, m1, RUN,  'CROSSBOW', '1H', 'field'],
  ['1H斧 站立(村庄)', 1, m1, STAND, 'AXE', '1H', 'village'],
  ['1H斧 跑(村庄)',   1, m1, RUN,   'AXE', '1H', 'village'],
  ['空手 站立(村庄)', 1, m1, STAND, null, null, 'village'],
  ['空手 站立(野外)', 1, m1, STAND, null, null, 'field'],
  ['空手 跑(野外)',   1, m1, RUN,   null, null, 'field'],
  // Pikeman(m4) 单手锤：**不得出现双手锤条目**（用户实测：曾混入 정지동작10a/걷는동작2a/뛰는동작2a/공격동작3a）
  ['m4 1H锤 站立',   4, m4, STAND,  'HAMMER', '1H', 'field'],
  ['m4 1H锤 走',     4, m4, WALK,   'HAMMER', '1H', 'field'],
  ['m4 1H锤 跑',     4, m4, RUN,    'HAMMER', '1H', 'field'],
  ['m4 1H锤 攻击',   4, m4, ATTACK, 'HAMMER', '1H', 'field'],
  ['m4 2H锤 跑',     4, m4, RUN,    'HAMMER', '2H', 'field'],
];

let fail = 0;
for (const [name, job, j, state, type, hand, loc] of CASES) {
  const r = pickSemanticMotion(motionsOf(j), semanticEntriesForJob(job), {
    state, weaponType: type, hand, classId: job, location: loc,
  });
  if (!r.motion) fail++;
  const top = r.candidates.slice(0, 4).map((c) =>
    `${c.entry.clip}(${FIT_LABEL[c.fit]}/${c.purity === 0 ? '纯' : c.purity === 1 ? '混' : '—'})`).join('  ');
  console.log(`${name.padEnd(18)} → ★${r.motion ? label(j, r.motion.index) : '无'}${r.fallback ? '  ⚠回退' : ''}`);
  console.log(`    ${top || '（无候选）'}`);
  // 不变量 1：持械（野外 + 有武器）时，候选里不得出现空手/通用/任意武器
  if (loc === 'field' && type != null) {
    const bad = r.candidates.filter((c) => c.fit === 'generic' || c.fit === 'all');
    if (bad.length) { console.log(`    ✗ 不变量1失败：持械候选里含 ${bad.length} 条空手/通用`); fail++; }
  }
  // 不变量 2：收械（村庄）时选中的必须是空手/通用 —— 武器已收起，不该播持械动作
  if (loc === 'village' && !r.fallback && r.candidates.length) {
    const f0 = r.candidates[0]!.fit;
    if (f0 !== 'generic' && f0 !== 'all') { console.log(`    ✗ 不变量2失败：收械选中了 ${FIT_LABEL[f0]} 条目`); fail++; }
  }
}
console.log(fail ? `\n${fail} 项失败` : '\n全部通过（含"持械不含空手候选"与"收械不播持械动作"两条不变量）');
