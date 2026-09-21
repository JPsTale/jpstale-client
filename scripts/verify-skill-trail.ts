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