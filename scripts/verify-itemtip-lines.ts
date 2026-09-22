/**
 * 信息框行列表的回归（`npm run verify-itemtip`）。
 *
 * 为什么要它：用户 2026-09-22 报"有些装备属性显示不出来"，根因是 `buildLines` 按**物品种类**
 * 开名单（`isWeapon`/`isGear`）—— 护腕（2048）的命中、戒指的必杀、时装（16384）的躲避/吸收、
 * 以及**从来没人渲染**的上限提升/每秒回复两族，都被那张名单挡在外面。
 * 这里用真 `buildLines`（不是复制一份逻辑）+ 真生成物（item-extras）钉住：
 *   ① 每条"有值"的属性都必须出现在行里（种类无关）；
 *   ② 值必须按原版精度显示（0.1 精度列除 10、抵挡率整数不带小数）；
 *   ③ 模板字段（重量 / 药水槽容量）能从生成物查到并显示；
 *   ④ **职业限制不显示**（用户 2026-09-22 决定：服务端职业门未实现，只显示不拦截会误导）。
 * 浏览器全局在 Node 下不存在，故先打桩再动态 import。
 */
import type { GameItem } from '../src/app/gameStore.js';

// i18n 在模块作用域读 localStorage/navigator → Node 下必须先打桩
// （Node 24 起 `navigator` 是只读 getter，赋值会抛，故用 defineProperty）
Object.defineProperty(globalThis, 'localStorage', {
  value: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  configurable: true,
});
Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh' }, configurable: true });

// 只 import 纯逻辑模块：组件那条依赖链会拉进 store/音频（模块作用域碰 document）
const { buildLines } = await import('../src/ui/itemInfoLines.js');

/** 全 0 的物品，只填测试关心的字段 */
function item(fields: Partial<GameItem>): GameItem {
  return {
    uid: 1, itemlistId: 0, itemCode: 0, location: 0, slot: 0, count: 1,
    durability: 0, durabilityMax: 0, damageMin: 0, damageMax: 0, attackRating: 0,
    defence: 0, blockRating: 0, absorb: 0, speed: 0,
    resBionic: 0, resFire: 0, resIce: 0, resLightning: 0, resPoison: 0,
    resEarth: 0, resWater: 0, resWind: 0,
    increaseLife: 0, increaseMana: 0, increaseStamina: 0,
    reqLevel: 0, reqStrength: 0, reqSpirit: 0, reqTalent: 0, reqAgility: 0, reqHealth: 0,
    price: 0, jobCodeMask: 0, agingLevel: 0, critical: 0, range: 0, attackSpeed: 0,
    manaRegen: 0, lifeRegen: 0, staminaRegen: 0,
    specAbsorb: 0, specDefence: 0, specSpeed: 0, specBlockRating: 0, specAttackSpeed: 0,
    specCritical: 0, specShootingRange: 0, specMagicMastery: 0,
    specResBionic: 0, specResEarth: 0, specResFire: 0, specResIce: 0, specResLighting: 0,
    specResPoison: 0, specResWater: 0, specResWind: 0,
    specLevMana: 0, specLevLife: 0, specLevAttackRating: 0, specLevDamageMax: 0,
    specLevResBionic: 0, specLevResEarth: 0, specLevResFire: 0, specLevResIce: 0,
    specLevResLighting: 0, specLevResPoison: 0, specLevResWater: 0, specLevResWind: 0,
    specPerManaRegen: 0, specPerLifeRegen: 0, specPerStaminaRegen: 0,
    ...fields,
  } as GameItem;
}

let failed = 0;
function check(name: string, cond: boolean, detail: string): void {
  console.log(`${cond ? '  ok  ' : '  FAIL'} ${name}${cond ? '' : ' —— ' + detail}`);
  if (!cond) failed++;
}
/** 行里找某标签的值 */
function valueOf(lines: { label?: string; value: string }[], label: string): string | undefined {
  return lines.find((l) => l.label === label)?.value;
}
const labels = (lines: { label?: string }[]): string[] => lines.map((l) => l.label ?? '');

// ① 护腕（classitem 2048）：命中 27 件全被旧名单挡住 —— 现在必须显示
{
  const lines = buildLines(item({ attackRating: 32, defence: 5, reqLevel: 10 }), 2048, null);
  check('护腕的命中显示出来', valueOf(lines, '命中率') === '32', `实际=${valueOf(lines, '命中率')}`);
  check('护腕的躲避也显示', valueOf(lines, '躲避') === '5', `实际=${valueOf(lines, '躲避')}`);
}
// ② 上限提升 + 每秒回复（旧版从不渲染）
{
  const lines = buildLines(item({
    increaseLife: 50, increaseMana: 20, increaseStamina: 4,
    lifeRegen: 15, manaRegen: 5, staminaRegen: 3,
  }), 8, null);
  check('生命提高显示', valueOf(lines, '生命提高') === '50', `实际=${valueOf(lines, '生命提高')}`);
  check('灵力提高显示', valueOf(lines, '灵力提高') === '20', `实际=${valueOf(lines, '灵力提高')}`);
  check('耐力提高显示', valueOf(lines, '耐力提高') === '4', `实际=${valueOf(lines, '耐力提高')}`);
  check('生命再生按 0.1 精度显示', valueOf(lines, '生命再生') === '1.5', `实际=${valueOf(lines, '生命再生')}`);
  check('灵力再生按 0.1 精度显示', valueOf(lines, '灵力再生') === '0.5', `实际=${valueOf(lines, '灵力再生')}`);
  check('耐力再生按 0.1 精度显示', valueOf(lines, '耐力再生') === '0.3', `实际=${valueOf(lines, '耐力再生')}`);
}
// ③ 时装（16384）：旧 isGear 名单没有它 → 躲避/吸收被吞
{
  const lines = buildLines(item({ defence: 20, absorb: 12 }), 16384, null);
  check('时装的躲避显示', valueOf(lines, '躲避') === '20', `实际=${valueOf(lines, '躲避')}`);
  check('时装的防御显示', valueOf(lines, '防御') === '1.2', `实际=${valueOf(lines, '防御')}`);
}
// ④ 戒指的必杀（旧名单只在武器里显示）
{
  const lines = buildLines(item({ critical: 3 }), 192, null);
  check('戒指的必杀显示', valueOf(lines, '必杀率') === '3%', `实际=${valueOf(lines, '必杀率')}`);
}
// ⑤ 抵挡率精度：整数不带小数、非整数一位（原版 `UIItemInfoBox` 的 `fabs(v-round(v))` 写法）
{
  const a = buildLines(item({ blockRating: 136 }), 2, null);
  const b = buildLines(item({ blockRating: 40 }), 2, null);
  check('抵挡率 13.6% 不被凑成 14%', valueOf(a, '抵挡率') === '13.6%', `实际=${valueOf(a, '抵挡率')}`);
  check('抵挡率 4.0 显示为 4%', valueOf(b, '抵挡率') === '4%', `实际=${valueOf(b, '抵挡率')}`);
}
// ⑥ 模板字段：重量 / 药水槽容量（查 item-extras.generated.json，靠真实 itemlist.id）
{
  // id=292 Leather Armlets（27 件护腕之一，potionspace=20 / weight=2，实测自 gamedb.itemlist）
  const lines = buildLines(item({ itemlistId: 292 }), 2048, null);
  check('药水存放数量从模板表查到并显示', valueOf(lines, '药水存放数量') === '20', `实际=${valueOf(lines, '药水存放数量')}`);
  check('重量从模板表查到并显示', valueOf(lines, '重量') === '2', `实际=${valueOf(lines, '重量')}`);
  // 没有模板附加信息的物品（材料等）不应出现这两行
  const bare = buildLines(item({ itemlistId: 0 }), 1, null);
  check('无数据时不凭空出行', valueOf(bare, '药水存放数量') === undefined && valueOf(bare, '重量') === undefined, '');
}
// ⑦ 职业限制**不显示**（用户 2026-09-22：服务端职业门未实现，只显示会误导）
{
  // wa101 = Stone Axe（源数据里有 **특화 Fighter / **특화랜덤 Pikeman）
  const lines = buildLines(item({ itemlistId: 1 }), 4, null);
  check('不出现"限定职业"行', !labels(lines).includes('限定职业'), `行=${labels(lines).filter(Boolean).join(',')}`);
  check('不出现"候选职业"行', !labels(lines).includes('候选职业'), `行=${labels(lines).filter(Boolean).join(',')}`);
}
// ⑧ 版面收尾：重量倒数第二、价格**最下方**（原版版面，用户 2026-09-22）
{
  // id=292 Leather Armlets（weight=2）+ 价格 8000 + 一段特效（压在最末两行之上）
  const lines = buildLines(item({ itemlistId: 292, price: 8000, jobCodeMask: 32, specDefence: 3 }), 2048, null);
  const last = lines[lines.length - 1]!;
  const second = lines[lines.length - 2]!;
  const third = lines[lines.length - 3]!;
  check('收尾段前有分隔空行（与上面隔开）', !!third.section, `倒数第三=${third.label ?? third.value}`);
  check('价格在最下方', last.label === '价格', `末行=${last.label ?? '(空行)'}`);
  check('价格带千分位', last.value === '8,000', `实际=${last.value}`);
  check('重量在价格之上（倒数第二）', second.label === '重量', `倒数第二=${second.label ?? '(空行)'}`);
  check('重量值来自模板表', second.value === '2', `实际=${second.value}`);
  const noPrice = buildLines(item({}), 4, null);
  check('价格 0 不显示价格行', !labels(noPrice).includes('价格'), `行=${labels(noPrice).filter(Boolean).join(',')}`);
}
// ⑨ 需求配色（用户 2026-09-22 定的口径）：满足 = **标签橙黄**（`req`）、数值白；
//    不满足 = **整行红**（`req` + `red`）。`dim`（灰）不是原版，不许再出现。
{
  const lines = buildLines(item({ reqLevel: 44, reqStrength: 120 }), 8,
    { level: 50, strength: 80, spirit: 0, talent: 0, agility: 0, health: 0 });
  const ok = lines.find((l) => l.label === '等级要求')!;
  const bad = lines.find((l) => l.label === '力量要求')!;
  check('需求行带 req 标记（标签橙黄）', !!ok.req && !!bad.req, `ok.req=${!!ok.req} bad.req=${!!bad.req}`);
  check('满足的需求不上红、也不上灰', !ok.red && !ok.dim, `red=${!!ok.red} dim=${!!ok.dim}`);
  check('不满足的需求整行红', !!bad.red, `red=${!!bad.red}`);
  check('需求值仍是原始数字（颜色由 CSS 承担）', ok.value === '44' && bad.value === '120', `${ok.value}/${bad.value}`);
}
// ⑩ 锻造（Age）染色：被 `applyAge` 缩放的行标 `age`（蓝），**不在清单里的行不许标**
//    （清单照抄管理端 js/item-effects.js 的 applyAge：攻击/命中/躲避/防御/抵挡/速度/三上限/三再生/特效四项）
{
  const agedLines = buildLines(item({
    agingLevel: 3, damageMin: 20, damageMax: 40, attackRating: 30, defence: 12, absorb: 8,
    blockRating: 50, speed: 15, increaseLife: 20, lifeRegen: 5,
    critical: 4, range: 180, attackSpeed: 6, resFire: 10, durability: 20, durabilityMax: 30,
  }), 4, null);
  const has = (label: string) => !!agedLines.find((l) => l.label === label)?.age;
  check('攻击（伤害）标为强化行', has('攻击'), '');
  check('命中标为强化行', has('命中率'), '');
  check('躲避标为强化行', has('躲避'), '');
  check('防御（吸收）标为强化行', has('防御'), '');
  check('抵挡率标为强化行', has('抵挡率'), '');
  check('速度标为强化行', has('速度'), '');
  check('生命提高标为强化行', has('生命提高'), '');
  check('生命再生标为强化行', has('生命再生'), '');
  check('必杀率**不**标（applyAge 不缩放它）', !has('必杀率'), '必杀率不该是强化行');
  check('射程**不**标', !has('射程'), '射程不该是强化行');
  check('攻击速度**不**标', !has('攻击速度'), '攻击速度不该是强化行');
  check('火防御（抗性）**不**标', !has('火防御'), '抗性不该是强化行');
  check('耐久度**不**标', !has('耐久度'), '耐久度不该是强化行');
  // 名字下方那行：锻造等级
  const first = agedLines[0]!;
  check('行首是名字下方的强化等级行', !!first.sub && first.value === '+3', `首行=${first.label ?? first.value}`);
  check('强化等级行也标 age（蓝）', !!first.age, '');
  // 未锻造时不出这行
  const plain = buildLines(item({ defence: 10 }), 8, null);
  check('未锻造时不出强化等级行', !plain.some((l) => l.sub), '');
}
console.log(failed === 0 ? '\n信息框行回归：全部通过' : `\n信息框行回归：${failed} 条失败`);
process.exit(failed === 0 ? 0 : 1);
