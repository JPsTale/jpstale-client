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
import { SKILL_TRAIL_TINTS, trailTintOfSkill } from '../src/render/effects/weapon-trail.js';
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

console.log('\n[校验 2] 设值点只在 playSkillByIcon 与普攻 onset（§5.2）');
ok('WorldView import 了 trailTintOfSkill', /import\s*\{[^}]*\btrailTintOfSkill\b/.test(wv));
ok('普攻路径 / 无下标路径 / 普攻循环 onset 三处置 null（≥2 处即成立）',
  (wv.match(/selfTrailSkillIndex = null/g) ?? []).length >= 2);
ok('playSkillByIcon 的 idx 分支设了 selfTrailSkillIndex = idx（含普攻回退子分支）',
  wv.includes('selfTrailSkillIndex = idx;'));
ok('设值只有一处（idx 分支）—— 染色来源唯一',
  (wv.match(/selfTrailSkillIndex = idx;/g) ?? []).length === 1);

console.log('\n[校验 3] 消费点只一处且 setTint 在 update 之前，双手槽都覆盖');
const setLine = wv.indexOf('tr.setTint(trailTintOfSkill(selfTrailSkillIndex))');
const updLine = wv.indexOf('tr.update(curF, motion.startFrame * 160)');
ok('消费点在曳光循环内（双手槽共用同一份）', setLine !== -1 && updLine !== -1);
ok('setTint 在 update 之前调用', setLine !== -1 && updLine !== -1 && setLine < updLine);

console.log('\n[校验 4] setTint 写入 uColor；null = 复位白');
ok('weapon-trail.ts 实现了 setTint', wt.includes('setTint(t: TrailTint | null): void {'));
ok('null → 白 (1,1,1)', /c\.set\(1,\s*1,\s*1\)/.test(wt));
ok('命中 → 按 t.r/g/b 赋值', /c\.set\(t\.r,\s*t\.g,\s*t\.b\)/.test(wt));

console.log(fails === 0
  ? '\n✓ verify-skill-trail 通过（T1 染色链路结构与取值齐备）'
  : `\n✗ ${fails} 条不符 —— 对照 docs/handoff/2026-09-21-枪兵一转三技能特效-任务书.md §5.2 / §附A 修实现，别改断言`);
process.exit(fails === 0 ? 0 : 1);