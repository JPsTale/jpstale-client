/**
 * T2 命中外观暴击判定的唯一实现检查（任务书 :164-181 的验收断言 :179-180）。
 *
 * `lookCritOf` 是唯一判定：外观/武器音按它走，伤害/飘字仍只跟 isCritical。
 * 断言即任务书的验收矩阵：
 *   - attackEffect:true（Jumping Crash 44 起手置位，character.cpp:13354）→ 判暴击外观
 *   - 其余任意组合与今天行为一致（critical 才暴击；missed 恒不暴击）
 *
 * 用法：`npm run verify-attack-crit-look`
 */
import { installDomStub } from './dom-stub.js';
installDomStub();
const { lookCritOf } = await import('../src/ui/WorldView.js');

let fails = 0;
const ok = (label: string, cond: boolean): void => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}`);
  if (!cond) fails++;
};

const seg = {
  attackEffectTrue: (attackEffect: boolean) =>
    lookCritOf({ missed: false, critical: false, attackEffect }),
};

ok('attackEffect:true + 非miss → 外观暴击（任务书 :179 第一断言）', lookCritOf({ missed: false, critical: false, attackEffect: true }) === true);
ok('attackEffect:false + 非miss + 非crit → 常外观（与今天一致）', lookCritOf({ missed: false, critical: false, attackEffect: false }) === false);
ok('attackEffect 缺省（undefined）→ 与今天一致', lookCritOf({ missed: false, critical: false }) === false);
ok('critical:true（真暴击）→ 外观暴击', lookCritOf({ missed: false, critical: true, attackEffect: false }) === true);
ok('missed:true 恒不暴击，即使 attackEffect/critical 为真', lookCritOf({ missed: true, critical: true, attackEffect: true }) === false);
ok('null/undefined → false（不抛错，计划未到的降级路径）', lookCritOf(null ?? null) === false);

// T3 之后：attackEffect:true 必须能由真实施放到达客户端。
// 接线护栏（源码级）：onCastSkill 定义 + playEquippedSkill 触发 + main.ts 接 sendUseSkill。
// 任一环被重构去掉，下文即红（不发上行 = #44 闪光永远看不到）。
import { readFile } from 'node:fs/promises';
const wv = await readFile(new URL('../src/ui/WorldView.ts', import.meta.url), 'utf8');
const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');
ok('WorldViewOpts 声明 onCastSkill 回调', /onCastSkill\?:\s*\(skillId: number, monsterId: number\) => void/.test(wv));
ok('playEquippedSkill 按 kind:monster + skillIdx 触发 onCastSkill', /opts\?\.onCastSkill\?\.\(skillIdx, aimId\)/.test(wv));
ok('playEquippedSkill 有技能才上行（skillIdx != null 条件）', wv.slice(wv.indexOf('const skillIdx')).split('if (skillIdx != null && aim)').length >= 2);
ok('main.ts 将 onCastSkill 接 sendUseSkill', /onCastSkill:\s*\(skillId, monsterId\) => sendUseSkill\(skillId, monsterId\)/.test(main));
ok('main.ts 导入 sendUseSkill', /import \{[^}]*sendUseSkill[^}]*\} from '\.\/net\/bridge\.js'/.test(main));

console.log(fails === 0 ? '\nPASS' : `\nFAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);