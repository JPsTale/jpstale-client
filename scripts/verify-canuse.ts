/**
 * 装备职业门（`itemRules.canUse`）核对 —— 守的是**我搞错过两次**的那条规则。
 *
 * ① **甲的男女限制必须按"低 16 位码"判，不是按家族。**
 *    证据不是推论而是**数据里的同名对**：原版 `CharOnlySetItem` 把 `DA1/DA2` 两族的
 *    20 个低 16 位码分成男女两套（各 10 个），同一件甲因此有**两个同名的 idcode**。
 *    本脚本直接在我方 `itemDefs.ts` 里找这些同名对 —— 找得到，就说明"按码判"这个维度是对的
 *    （若按家族判，`da151` 与 `da152` 会被判成同一种，男女限制就无从表达）。
 * ② 四条**全族一致**的职业锁（`OM/WD/WN/WV` ← 服务端 OpenItem `**특화랜덤`）必须真的生效。
 *
 * 用法：npx tsx scripts/verify-canuse.ts
 */
import { canUse } from '../src/game/itemRules.js';
import { ITEM_DEFS } from '../src/game/data/itemDefs.js';

let fail = 0;
function check(label: string, got: unknown, want: unknown): void {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}：${JSON.stringify(got)}${ok ? '' : `（期望 ${JSON.stringify(want)}）`}`);
}

const DA1 = 0x02010000, DA2 = 0x02050000;
/**
 * 原版 `CharOnlySetItem` 的 20 个码。**命名按语义**（谁是这一款的主人）：
 * 第一分支判的是"女性职业不可用" ⇒ 那 10 个码是**男款**；第二分支（其余职业不可用）⇒ **女款**。
 * ⚠ 这里搞反过一次（代码对、名字反），所以本脚本按"谁是主人"来断言，而不是按源码的分支顺序。
 */
const MALE_VARIANT = [0x2f00, 0x3000, 0x3300, 0x3400, 0x3700, 0x3800, 0x3b00, 0x3c00, 0x4300, 0x4600];
const FEMALE_VARIANT = [0x3100, 0x3200, 0x3500, 0x3600, 0x3900, 0x3a00, 0x3d00, 0x3e00, 0x4400, 0x4700];

console.log('① 数据自证：男/女码是"同名的两个 idcode"');
{
  const da = ITEM_DEFS.filter((d) => {
    const f = d.code & 0xffff0000;
    return f === DA1 || f === DA2;
  });
  const byName = new Map<string, number[]>();
  for (const d of da) {
    const arr = byName.get(d.name) ?? [];
    arr.push(d.code & 0xffff);
    byName.set(d.name, arr);
  }
  const pairs = [...byName.entries()].filter(
    ([, codes]) => codes.some((c) => MALE_VARIANT.includes(c)) && codes.some((c) => FEMALE_VARIANT.includes(c)),
  );
  console.log(`     我方 DA1/DA2 共 ${da.length} 件；同一名字下同时带"男码 + 女码"的有 ${pairs.length} 组：`);
  for (const [name, codes] of pairs.slice(0, 6)) {
    console.log(`       ${name} → ${codes.map((c) => '0x' + c.toString(16)).join(' / ')}`);
  }
  check('至少存在 1 组同名对（否则"按码判"这个维度就无从证实）', pairs.length > 0, true);
}

console.log('\n② 男/女甲：只能穿自己那一款');
{
  const femaleJob = 3, maleJob = 4;
  check('男职业 + 男款甲 → 允许', canUse(maleJob, DA1 | MALE_VARIANT[0]), true);
  check('男职业 + 女款甲 → 拒绝', canUse(maleJob, DA1 | FEMALE_VARIANT[0]), false);
  check('女职业 + 女款甲 → 允许', canUse(femaleJob, DA1 | FEMALE_VARIANT[0]), true);
  check('女职业 + 男款甲 → 拒绝', canUse(femaleJob, DA1 | MALE_VARIANT[0]), false);
  check('未知职业（null）→ 不拦', canUse(null, DA1 | MALE_VARIANT[0]), true);
  // 这 20 个码只在 DA1/DA2 两族里才是"男/女款"；别的族里同样的低 16 位是别的东西
  check('别的族 + 同一个低 16 位码 → 不受甲的限制', canUse(maleJob, 0x01010000 | FEMALE_VARIANT[0]), true);
}

console.log('\n③ 法系/物理：铠甲 vs 法袍、法球');
{
  check('法师 + 铠甲 → 拒绝', canUse(7, DA1 | 0x0100), false);
  check('战士 + 铠甲 → 允许', canUse(1, DA1 | 0x0100), true);
  check('战士 + 法袍 → 拒绝', canUse(1, DA2 | 0x0100), false);
  check('祭司 + 法袍 → 允许', canUse(8, DA2 | 0x0100), true);
  check('战士 + 法球 → 拒绝', canUse(1, 0x03030000 | 0x0500), false);
  check('祭司 + 法球 → 允许', canUse(8, 0x03030000 | 0x0500), true);
}

console.log('\n④ 四条全族一致的职业锁（OpenItem `**특화랜덤`）');
{
  const cases: Array<[number, number, string]> = [
    [9, 0x010a0000, 'WD 匕首'],
    [10, 0x01090000, 'WN 图腾'],
    [11, 0x010b0000, 'WV 拳套'],
    [7, 0x03030000, 'OM 法球'],
  ];
  for (const [ownerJob, family, label] of cases) {
    check(`${label}：本职业 ${ownerJob} 允许`, canUse(ownerJob, family | 0x0100), true);
    const others = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].filter((j) => j !== ownerJob
      && !(family === 0x03030000 && j === 8));   // OM 是 Priestess(8) 与 Magician(7) 共享
    const denied = others.every((j) => canUse(j, family | 0x0100) === false);
    check(`${label}：其余职业全部拒绝`, denied, true);
  }
}

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项不符`);
process.exit(fail === 0 ? 0 : 1);
