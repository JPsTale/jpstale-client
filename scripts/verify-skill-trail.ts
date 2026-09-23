/**
 * T1（枪兵一转三技能特效 · 玩家侧武器残影染色）的结构闸门。
 *
 * 钉住三件事：① 染色表的值按 `SetSkillMotionBlurColor` 逐字节换算（任务书 §附A / §0.1-4）；
 * ② 消费点只一处且 `setTint` 在 `update` 之前（AGENTS #15，防止第二份判定漂移）；
 * ③ 设值点只在 playSkillByIcon 与普攻 onset 两处（§5.2）。
 *
 * 用法：`npx tsx scripts/verify-skill-trail.ts`
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { SKILL_TRAIL_TINTS, trailTintOfSkill, trailTintOf, WEAPON_TINT_MIX } from '../src/render/effects/weapon-trail.js';
import { agingRowOf, craftRowOf } from '../src/game/agingBlink.js';
import { SKILL_INDEX_BY_ICON } from '../src/game/data/skillIndexByIcon.js';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, '../src');
const wv = readFileSync(resolve(SRC, 'ui/WorldView.ts'), 'utf8');
const wt = readFileSync(resolve(SRC, 'render/effects/weapon-trail.ts'), 'utf8');

let fails = 0;
const ok = (label: string, cond: boolean): void => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}`);
  if (!cond) fails++;
};

console.log('[校验 1] 染色表值（源码逐字节换算，§0.1-4 / §附A）');
const c43 = SKILL_TRAIL_TINTS.get(43);
const c52 = SKILL_TRAIL_TINTS.get(52);
ok('43 Critical Hit → (1.000, 0.749, 1.000) claims=true',
  !!c43 && c43.r === 1.0 && c43.g === 0.749 && c43.b === 1.0 && c43.claims === true);
ok('52 Chain Lance → (1.000, 0.749, 0.749) claims=false（禁止改 TRUE，§0.1-2）',
  !!c52 && c52.r === 1.0 && c52.g === 0.749 && c52.b === 0.749 && c52.claims === false);
ok('g 通道 = 0.749（任务书 §附A 钉死的截断十进制；精确值 191/255）',
  Math.abs(c43!.g - 191 / 255) < 1e-3);
// ── 2026-09-23 补齐的 4 条（战士一转/二转）：值同样按源码增量逐字节换算 ──
// 取证链见 weapon-trail.ts 表内注释（技能 → 播放码 → 图标号 → 我方下标）。
const c23 = SKILL_TRAIL_TINTS.get(23);
const c24 = SKILL_TRAIL_TINTS.get(24);
const c25 = SKILL_TRAIL_TINTS.get(25);
const c26 = SKILL_TRAIL_TINTS.get(26);
ok('23 Raving（+256/-64/-64，return TRUE）→ (1.000, 0.749, 0.749) claims=true',
  !!c23 && c23.r === 1.0 && c23.g === 0.749 && c23.b === 0.749 && c23.claims === true);
ok('24 Impact（+256/+256/-64，return TRUE）→ (1.000, 1.000, 0.749) claims=true',
  !!c24 && c24.r === 1.0 && c24.g === 1.0 && c24.b === 0.749 && c24.claims === true);
ok('25 Triple Impact（+256/-64/+256，return TRUE）→ (1.000, 0.749, 1.000) claims=true',
  !!c25 && c25.r === 1.0 && c25.g === 0.749 && c25.b === 1.0 && c25.claims === true);
ok('26 Brutal Swing（-64/+256/+128 ⇒ B 截到 255，return TRUE）→ (0.749, 1.000, 1.000) claims=true',
  !!c26 && c26.r === 0.749 && c26.g === 1.0 && c26.b === 1.0 && c26.claims === true);
ok('全 6 个源码 case 都在表里（43/52/23/24/25/26），没有多余的键',
  SKILL_TRAIL_TINTS.size === 6
  && [43, 52, 23, 24, 25, 26].every((k) => SKILL_TRAIL_TINTS.has(k)));
ok('只有 Chain Lance 是 claims=false（源码唯一 break 后落到 return FALSE 的那条）',
  [...SKILL_TRAIL_TINTS.entries()].filter(([, v]) => v.claims === false).map(([k]) => k).join(',') === '52');
// ★ 键的可复算性：图标 → 我方下标这一段读**我们的数据表**（不是写死在断言里）。
//   图标号来自源码信息表首列（14/17/20/23），见 weapon-trail.ts 表内注释 ③④。
ok('23 ↔ tf14 raving.bmp（图标号 14 来自源码信息表首列）', SKILL_INDEX_BY_ICON['tf14 raving.bmp'] === 23);
ok('24 ↔ tf17 impact.bmp（图标号 17）', SKILL_INDEX_BY_ICON['tf17 impact.bmp'] === 24);
ok('25 ↔ tf20 t_impact.bmp（图标号 20）', SKILL_INDEX_BY_ICON['tf20 t_impact.bmp'] === 25);
ok('26 ↔ tf23 b_swing.bmp（图标号 23）', SKILL_INDEX_BY_ICON['tf23 b_swing.bmp'] === 26);
ok('trailTintOfSkill(null) → null（不染色）', trailTintOfSkill(null) === null);
ok('trailTintOfSkill(99)（未登记）→ null（不染色）', trailTintOfSkill(99) === null);
ok('trailTintOfSkill(43) → 紫', trailTintOfSkill(43)?.g === 0.749);

console.log('\n[校验 1b] 武器色 ⊕ 技能色（锻造/合成武器染曳光；原版 DrawMotionBlurTool 的第二段）');
const rowAged = agingRowOf(12)!;    // 锻造 +12 的色表行 → RGB(10,220,30)
const rowCraft = craftRowOf(0)!;    // 合成行 0        → RGB(13,0,5)
const mixW = (base: number, target: number): number => base + (target - base) * WEAPON_TINT_MIX;
const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;
{
  // ① 普攻（技能=null）+ 锻造武器：从白向武器色走一半（期望值**现算**，不写死结果）
  const t = trailTintOf(null, rowAged);
  ok('普攻 + 锻造武器 → mix(白, 色表色, 0.5)',
    !!t && near(t.r, mixW(1, 10 / 255)) && near(t.g, mixW(1, 220 / 255)) && near(t.b, mixW(1, 30 / 255)));
  // ② 技能 claims=true（Critical Hit）⇒ **武器色被独占**：传了行也不变
  const excl = trailTintOf(43, rowAged);
  const solo = trailTintOf(43, null);
  ok('43（claims=true）传武器行 == 不传（独占，禁止叠）',
    !!excl && !!solo && excl.r === solo.r && excl.g === solo.g && excl.b === solo.b);
  // ③ 技能 claims=false（Chain Lance）⇒ 技能色与武器色**都叠**
  const both = trailTintOf(52, rowAged);
  ok('52（claims=false）→ 以技能色为基础再向武器色走一半',
    !!both && near(both.r, mixW(1.0, 10 / 255)) && near(both.g, mixW(0.749, 220 / 255))
    && near(both.b, mixW(0.749, 30 / 255)));
  // ④ 未登记技能：源码里它也落到 return FALSE ⇒ **仍叠武器色**（≠"未登记=白"）
  const unknown = trailTintOf(99, rowCraft);
  ok('未登记技能 + 武器 → 仍叠武器色（与"未登记=白"不同）',
    !!unknown && near(unknown.r, mixW(1, 13 / 255)) && near(unknown.g, 0.5) && near(unknown.b, mixW(1, 5 / 255)));
  // ⑤ 未锻造/未合成（row=null）
  ok('普攻 + 未锻造武器 → null（不染色）', trailTintOf(null, null) === null);
  ok('未登记技能 + 未锻造 → null', trailTintOf(99, null) === null);
  ok('武器色强度常量 = 0.5（我们的映射决定，见 WEAPON_TINT_MIX 的说明）', WEAPON_TINT_MIX === 0.5);
}

console.log('\n[校验 2] 设值点只在 playSkillByIcon 与普攻 onset（§5.2）');
ok('WorldView import 了 trailTintOf（合成函数，不是只引技能表）', /import\s*\{[^}]*\btrailTintOf\b/.test(wv));
ok('普攻路径 / 无下标路径 / 普攻循环 onset 三处置 null（≥2 处即成立）',
  (wv.match(/selfTrailSkillIndex = null/g) ?? []).length >= 2);
ok('playSkillByIcon 的 idx 分支设了 selfTrailSkillIndex = idx（含普攻回退子分支）',
  wv.includes('selfTrailSkillIndex = idx;'));
ok('设值只有一处（idx 分支）—— 染色来源唯一',
  (wv.match(/selfTrailSkillIndex = idx;/g) ?? []).length === 1);

console.log('\n[校验 3] 消费点：染色只经 trailTintOf，且自机/远端共用同一份曳光实现');
// 2026-09-23：这段编排（建/驱/销 + 染色）收进了 weapon-trail 的 `PlayerTrails`，
// 自机与远端玩家**同一份**（原版 `playmain.cpp:3245` 对每个其他玩家也逐帧 DrawMotionBlur）。
ok('自机走 PlayerTrails（不再就地写编排）', wv.includes('selfTrails.update({'));
ok('远端玩家走同一个类（用户 2026-09-23 报"看不到 remote 曳光"）', wv.includes('actor.trails.update({'));
ok('自机染色 = trailTintOf(技能下标, rig 的行)', wv.includes('tint: trailTintOf(selfTrailSkillIndex, selfRig.mainRow)'));
ok('远端染色 = 只有武器色（无技能下标可用，注释写明原因）',
  wv.includes('tint: trailTintOf(null, actor.rig.mainRow)'));
ok('玩家侧实现只有一份（类定义在 weapon-trail.ts）', wt.includes('export class PlayerTrails'));
// 带子每帧的顺序：**先染色再推进**（顺序反了这一帧的色是上一帧的）
const setIdx = wt.indexOf('this.trails[hi]!.setTint(fr.tint);');
const updIdx = wt.indexOf('this.trails[hi]!.update(fr.frame, fr.startFrame);');
ok('PlayerTrails 内 setTint 在 update 之前', setIdx !== -1 && updIdx !== -1 && setIdx < updIdx);
// ★ 2026-09-23 修的 bug：`selfAppearance` 原先只在"模型真的变了"时才写 ⇒ 只改发光输入（锻造+1）
//   时它保持旧值，曳光拿到旧的四个字段 ⇒ 带子不染色。次序也要对：**先写外观，再判指纹**。
const appSet = wv.indexOf('if (appearance) selfAppearance = appearance;', wv.indexOf('function applySelfAppearance'));
const keyChk = wv.indexOf('const key = appearanceModelKey(appearance);', wv.indexOf('function applySelfAppearance'));
ok('applySelfAppearance 无条件写 selfAppearance，且在指纹判断之前',
  appSet !== -1 && keyChk !== -1 && appSet < keyChk);
// 起手广播的迟到补播（一次性的动作事件不能在"演员还在加载"时丢掉）
ok('远端起手有"演员未建好"的队列 + 建好后补播', wv.includes('pendingRemoteAttacks') && wv.includes('playRemoteAttack(actorObj, pend.targetId'));
// ★ 反例守卫：排队**不许**看 `remoteSpawning` —— 那会漏掉"先收到起手、后收到 playerAppear"这一整类
//   （演员当时既不在演员表也不在加载中），正是"经常丢掉远端第一下攻击动画"的成因之一。
ok('排队不按 remoteSpawning 过滤（反例守卫）', !wv.includes('if (remoteSpawning.has(attackerId))'));
// 能不能补播只由**那一招还剩多久**决定，不是拍死的窗口常量
ok('补播窗口按该招自己的时长算（attackRemainMs）', wv.includes('function attackRemainMs(') && wv.includes('attackRemainMs(actorObj, pend.animIndex, pend.at)'));


console.log('\n[校验 4] setTint 写入 uColor；null = 复位白');
ok('weapon-trail.ts 实现了 setTint', wt.includes('setTint(t: TrailTint | null): void {'));
ok('null → 白 (1,1,1)', /c\.set\(1,\s*1,\s*1\)/.test(wt));
ok('命中 → 按 t.r/g/b 赋值', /c\.set\(t\.r,\s*t\.g,\s*t\.b\)/.test(wt));

console.log(fails === 0
  ? '\n✓ verify-skill-trail 通过（T1 染色链路结构与取值齐备）'
  : `\n✗ ${fails} 条不符 —— 对照 docs/handoff/2026-09-21-枪兵一转三技能特效-任务书.md §5.2 / §附A 修实现，别改断言`);
process.exit(fails === 0 ? 0 : 1);