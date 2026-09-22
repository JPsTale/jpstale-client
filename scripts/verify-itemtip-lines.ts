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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
// ⑩ 锻造（Age）染色 —— 口径 = **服务端实际会改哪些字段**（EU `CAgeHandler::OnUpAge`，
//    `PristonTale-EU-main/Server/server/AgeHandler.cpp:404`），因为玩家看到的值就是它算的。
//    ⚠ 本块原来照的是 **11 职业私服客户端**的 `sinSetAgingItemIncreState`（`sinSubMain.cpp:2452`），
//    两者逐族不同（锤：客户端 AR+10/动耐久 vs EU AR+8/+必杀；图腾：客户端 +Life20 vs EU 走法杖支；
//    斧的耐久：客户端 `sinSetDurabilityAging` vs EU 不碰耐久）—— 两个私服的版本差异，
//    按 AGENTS #72「EU 为准」取 EU。⑧ 里有一条**跨仓比对**把这张表与 `AgeGrowth.java` 钉在一起。
{
  const axe = (agingLevel: number) => buildLines(item({
    itemListId: 0, itemCode: 0x01010000, agingLevel,   // sinWA1 斧：Damage + 命中 +10
    damageMin: 20, damageMax: 40, attackRating: 30, critical: 4, defence: 12,
    absorb: 8, blockRating: 50, speed: 15, increaseLife: 25, lifeRegen: 5,
    durability: 20, durabilityMax: 30,
  }), 4, null);
  const agedOf = (lines: ReturnType<typeof buildLines>, label: string) => !!lines.find((l) => l.label === label)?.age;

  const a3 = axe(3);
  check('斧·攻击 标强化（Damage 在族清单里）', agedOf(a3, '攻击'), '');
  check('斧·命中 标强化（每级 +10）', agedOf(a3, '命中率'), '');
  check('斧·必杀率**不**标（EU 的斧不含 critical）', !agedOf(a3, '必杀率'), '');
  check('斧·速度**不**标（锻造不改移速）', !agedOf(a3, '速度'), '');
  check('斧·生命提高**不**标（EU 的斧不含 life）', !agedOf(a3, '生命提高'), '');
  check('斧·生命再生**不**标（锻造不改再生）', !agedOf(a3, '生命再生'), '');
  check('耐久行**不**标（EU 的 OnUpAge 不碰耐久，只由 UpdateIntegrity 扣）', !agedOf(a3, '耐久度'), '');
  check('特效行一律**不**标（源码的锻造不碰特效字段）', !a3.some((l) => l.spec && l.age), '');

  // 剑 sinWS2（0x0107）：Damage / 命中 +5 / 必杀（每两级 +1）
  const sword = (agingLevel: number) => buildLines(item({
    itemCode: 0x01070000, agingLevel, damageMin: 10, attackRating: 40, critical: 3,
  }), 4, null);
  check('剑 +1：必杀率**不**标（第一次增长在到达 +2）', !agedOf(sword(1), '必杀率'), '');
  check('剑 +2：必杀率标强化', agedOf(sword(2), '必杀率'), '');
  check('剑 +3：必杀率**仍**标（值还是 +2 那次加的 —— 判据是"涨过没有"，不是奇偶）', agedOf(sword(3), '必杀率'), '');
  check('剑 +3：命中率标强化（每级 +5）', agedOf(sword(3), '命中率'), '');
  const bow = buildLines(item({ itemCode: 0x01060000, agingLevel: 5, damageMin: 10, critical: 3, increaseLife: 15 }), 4, null);
  check('弓 WS1：必杀率标强化', agedOf(bow, '必杀率'), '');
  check('弓 WS1：生命提高**不**标（EU 的弓不含 life —— 旧表照 11 职业客户端错列了它）', !agedOf(bow, '生命提高'), '');

  // 盾 DS1：防御 +5% / 格挡（每两级 +1）/ 吸收 +0.4
  const shield = buildLines(item({ itemCode: 0x02040000, agingLevel: 3, defence: 55, blockRating: 60, absorb: 10 }), 2, null);
  check('盾 +3：抵挡率标强化', agedOf(shield, '抵挡率'), '');
  check('盾 +3：躲避（防御）标强化', agedOf(shield, '躲避'), '');
  const shield1 = buildLines(item({ itemCode: 0x02040000, agingLevel: 1, defence: 55, blockRating: 60, absorb: 10 }), 2, null);
  check('盾 +1：抵挡率**不**标（第一次增长在 +2）', !agedOf(shield1, '抵挡率'), '');

  // 靴 / 护手 / 护腕：EU 的 switch **没有**这些 case ⇒ 一行都不标（旧表给它们列了 def/absorb/life，是错的）
  const boots = buildLines(item({ itemCode: 0x02020000, agingLevel: 2, defence: 32, absorb: 10 }), 2, null);
  check('靴：一行都不标（EU 里靴不涨）', !boots.some((l) => l.age && !l.sub), '');

  // 家族不在清单里 ⇒ 一行都不标（不猜）
  const unknown = buildLines(item({ itemCode: 0x99990000, agingLevel: 5, damageMin: 5, defence: 5 }), 4, null);
  check('未知家族不标任何强化行', !unknown.some((l) => l.age && !l.sub), '');

  // 名字下方那行：锻造等级
  const first = a3[0]!;
  // 2026-09-22 改：`+N` 不再单独出一行 —— 原版把它画在进度条里（`AgingLevel4`），
  // 所以"名字下方"现在是**进度条**那一行（没有进度数据时才是第一条属性行）
  check('行首不再是无标签的 +N 行', !(first.sub === true && first.value.startsWith('+')), `首行=${first.label ?? first.value}`);
  const plain = buildLines(item({ itemCode: 0x01010000, defence: 10 }), 8, null);
  check('未锻造时不出 +N 行、也不出进度条', !plain.some((l) => l.sub || l.bar), '');
}
// ⑧ 锻造染色：① 与服务端 `AgeGrowth` 的**逐族一致**（跨仓比对）② "涨过没有"的标记语义
{
  // ① 从服务端 `AgeGrowth.java` 的 switch 抽"族 → 涨了哪些属性"，与客户端那张表比。
  //    这张表决定"哪些行染成锻造色" —— 错了玩家就会看到"没涨的行是蓝的、涨了的行是白的"。
  //    ⚠ 服务端 `grows()` 在 `apply()` **之前**（第一版切反了，解析出 0 个族）。
  const AG = resolve('..', 'jpstale-server', 'modules', 'common-service', 'src', 'main', 'java',
    'org', 'jpstale', 'common', 'service', 'item', 'AgeGrowth.java');
  const java = readFileSync(AG, 'utf8');
  // ⚠ 切片必须**收在 `apply` 方法体内**：文件里 `applyDown`（降级）也有同名 `case 0x01010000…`，
  //   一直切到文件末尾会把降级那张表当成升级表读进来、并**覆盖**掉刚解析好的族
  //   （表现：服务端的 dmg/def/crit 全丢，只剩 `it.setXxx` 那类 —— 排查了两轮才定位）。
  const applyAt = java.indexOf('public static void apply(');
  // 下一个方法声明（`applyDown` 是 **public** static —— 只找 'private static' 会切过头把它读进来）
  const nextPublic = java.indexOf('public static', applyAt + 10);
  const nextPrivate = java.indexOf('private static', applyAt + 10);
  const ends = [nextPublic, nextPrivate].filter((i) => i > 0);
  const body = java.slice(applyAt, ends.length ? Math.min(...ends) : undefined);
  if (!body.includes('switch')) throw new Error('AgeGrowth.apply 的切片没拿到 switch —— 切片口径变了');
  // ⚠ 用**字符串包含**判断，不用正则：同一批正则在隔离测试里正常、在这个脚本里却只认出一半
  //   （排查了一轮没找到根因，而这里的语义根本不需要正则 —— 换成 includes 既等价又不会踩坑）。
  // ⚠ 服务端 2026-09-22 改成"写加成"（`addFlat(it, ItemStat.X, v)` / `setEffective`）后，
  //   原来按 `it.setAttackRating(` 这类写法认的 token 全部失配 —— 这条守卫当场变红（它该红）。
  //   现在按 `ItemStat.<常量>` 认，写法换了只要还引用这些常量就仍然有效。
  const TOKEN: [string, string][] = [
    ['upDamage(', 'dmg'], ['ItemStat.ATTACK_RATING', 'hit'], ['upCritical(', 'crit'],
    ['ItemStat.INCREASE_MANA', 'mana'], ['upDefense(', 'def'], ['upAbsorb(', 'absorb'], ['upBlock(', 'block'],
  ];
  const server: Record<number, string[]> = {};
  // 逐 `case` 块切开（刻意不用含换行的正则 —— 那种写法过几层转义容易被吃掉，见 AGENTS 的 heredoc 教训）
  for (const part of body.split('case ').slice(1)) {
    const arrow = part.indexOf('->');
    const open = part.indexOf('{', arrow);
    const close = part.indexOf('}', open);
    if (arrow < 0 || open < 0 || close < 0) continue;
    // ⚠ 按 `'case '` 切是**不安全**的：注释里也会出现这个词（`default` 那支就写着
    //   "EU 的 switch 没有这些 case"），切出来的垃圾段会把已解析的族**覆盖**掉
    //   （表现：0x0101 从 [dmg,hit] 变成 [hit] —— 排查了一轮才找到）。
    //   故这里要求"箭头前只能有家族码"，纯字符白名单判断，不再用正则。
    const head = part.slice(0, arrow).trim();
    const onlyFamilies = head.length > 0
      && [...head].every((c) => '0123456789abcdefABCDEFxX, 	'.includes(c));
    if (!onlyFamilies) continue;
    const fams = [...head.matchAll(/0x([0-9A-Fa-f]{8})/g)].map((x) => parseInt(x[1], 16));
    const code = part.slice(open, close);
    const toks = TOKEN.filter(([needle]) => code.includes(needle)).map(([, t]) => t);
    for (const f of fams) server[f] = toks;
  }
  const famCount = Object.keys(server).length;
  check('从服务端 AgeGrowth 解析出族（≥16）', famCount >= 16, `实际=${famCount}`);

  // 客户端的表：从 itemInfoLines.ts 按同样形状读出来
  const src = readFileSync(resolve('src', 'ui', 'itemInfoLines.ts'), 'utf8');
  const tblStart = src.indexOf('const AGING_FAMILY_ROWS');
  const tbl = src.slice(tblStart, src.indexOf('};', tblStart));
  const client: Record<number, string[]> = {};
  for (const m of tbl.matchAll(/0x([0-9A-Fa-f]{8}):\s*\[([^\]]*)\]/g)) {
    client[parseInt(m[1], 16)] = [...m[2].matchAll(/'([a-z]+)'/g)].map((x) => x[1]);
  }
  const bad: string[] = [];
  for (const [fam, toks] of Object.entries(server)) {
    const f = Number(fam);
    const got = (client[f] ?? []).slice().sort().join(',');
    const want = toks.slice().sort().join(',');
    if (got !== want) bad.push(`0x${f.toString(16)}: 客户端[${got}] vs 服务端[${want}]`);
  }
  for (const f of Object.keys(client)) {
    if (server[Number(f)] === undefined) bad.push(`0x${Number(f).toString(16)}: 客户端列了，服务端对该族不涨`);
  }
  check('锻造染色表与服务端 AgeGrowth 逐族一致', bad.length === 0, bad.join(' | '));

  // ② "涨过没有"的语义：必杀/格挡在 +1 不标、+2 起标（含 +3/+5 —— 值仍是那次加的）
  const swordRow = (agingLevel: number) => {
    const ls = buildLines(item({ itemCode: 0x01070000, agingLevel, damageMin: 14, damageMax: 19, attackRating: 60, critical: 8 }), 1, null);
    return (label: string) => !!ls.find((l) => l.label === label)?.age;
  };
  const s1 = swordRow(1);
  const s2 = swordRow(2);
  const s3 = swordRow(3);
  check('剑 +1：必杀率不标（第一次增长在到达 +2）', !s1('必杀率'), '');
  check('剑 +2：必杀率标（到 +2 时涨过）', s2('必杀率'), '');
  check('剑 +3：必杀率仍标（值还是 +2 那次加的，判据是"涨过没有"不是奇偶）', s3('必杀率'), '');
  check('剑 +2：伤害标（每级 +1）', s2('攻击'), '');
  check('剑 +2：命中标（每级 +5）', s2('命中率'), '');
}

// ⑨ 锻造熟练度进度条（原版 `sinItem.cpp:2226-2239`）：只有"已锻造 + max>0"才出这一行
{
  const aged = buildLines(item({ itemListId: 1, itemCode: 0x01070900, agingLevel: 2,
    damageMin: 14, damageMax: 19, attackRating: 60, critical: 8 }), 1, null);
  check('未标记 kindCode=AGING ⇒ 不出进度条', !aged.some((l) => l.bar), '');
  const agedCraft = buildLines({ ...item({ itemListId: 1, itemCode: 0x01070900, agingLevel: 2, damageMin: 14, price: 19200 }), kindCode: 2, agingExp: 6, agingExpMax: 21 }, 1, null);
  const bar = agedCraft.find((l) => l.bar)?.bar;
  check('养成中 ⇒ 出进度条且 cur/max 正确（等级不写在条里）', !!bar && bar.cur === 6 && bar.max === 21,
    JSON.stringify(bar ?? null));
  const noMax = buildLines({ ...item({ itemListId: 1, itemCode: 0x01070900, agingLevel: 2 }), kindCode: 2, agingExp: 0, agingExpMax: 0 }, 1, null);
  check('max=0（原版是 AgingGageFlag=2 的另一种状态）⇒ 不画', !noMax.some((l) => l.bar), '');
  // 原版那段代码在**属性列之前**（`sinItem.cpp:2226` 早于逐条属性行），即"名字下方" ⇒
  // 位置必须早于第一条属性行（攻击/躲避…），而不是压到最后
  const barIdx = agedCraft.findIndex((l) => l.bar);
  const firstStatIdx = agedCraft.findIndex((l) => l.label === '攻击' || l.label === '躲避');
  check('进度条在**属性之前**（名字下方；原版 `sinItem.cpp:2226` 的位置）',
    barIdx >= 0 && firstStatIdx >= 0 && barIdx < firstStatIdx, `bar=${barIdx} stat=${firstStatIdx}`);
  // `+N` 只在进度条里（原版 `AgingLevel4`），**不再**另出一行
  check('不再有独立的 +N 行（避免与进度条里的 +2 重复）',
    !agedCraft.some((l) => l.sub && l.value.startsWith('+')), '');
}

// ⑩ 合成染色：① 位表与服务端 `MixEffect` **逐位一致**（跨仓比对）② 真按位染色（用盾牌 319 的真实掩码）
{
  // ① 从服务端解析常量名→位值，与客户端的 MIX_BIT 比
  const ME = resolve('..', 'jpstale-server', 'modules', 'common-service', 'src', 'main', 'java',
    'org', 'jpstale', 'common', 'service', 'item', 'MixEffect.java');
  const jv = readFileSync(ME, 'utf8');
  const serverBits: Record<string, number> = {};
  for (const m of jv.matchAll(/public static final int ([A-Z_]+) = (0x[0-9A-Fa-f]+);/g)) {
    serverBits[m[1]] = parseInt(m[2], 16);
  }
  const src = readFileSync(resolve('src', 'ui', 'itemInfoLines.ts'), 'utf8');
  const clientBits: Record<string, number> = {};
  for (const m of src.matchAll(/(\w+): (0x[0-9A-Fa-f]{8}),/g)) clientBits[m[1]] = parseInt(m[2], 16);
  check('从服务端解析出效果位（≥20）', Object.keys(serverBits).length >= 20, `实际=${Object.keys(serverBits).length}`);
  const NAME2KEY: [string, string][] = [['FIRE','fire'],['ICE','ice'],['LIGHTNING','lightning'],['POISON','poison'],
    ['ORGANIC','organic'],['CRITICAL','critical'],['ATTACK_RATING','attackRating'],['DAMAGE_MIN','damageMin'],
    ['DAMAGE_MAX','damageMax'],['ATTACK_SPEED','attackSpeed'],['ABSORB','absorb'],['DEFENCE','defence'],
    ['BLOCK','block'],['MOVE_SPEED','moveSpeed'],['HP','hp'],['MP','mp'],['SP','sp'],['HP_REGEN','hpRegen'],
    ['MP_REGEN','mpRegen'],['SP_REGEN','spRegen'],['POTION_STORAGE','potionStorage']];
  const diff = NAME2KEY.filter(([n, k]) => serverBits[n] !== clientBits[k])
    .map(([n, k]) => `${n}=0x${(serverBits[n] ?? 0).toString(16)} vs ${k}=0x${(clientBits[k] ?? 0).toString(16)}`);
  check('客户端的合成位表与服务端 MixEffect 逐位一致（跨仓）', diff.length === 0, diff.join(' | '));

  // ② 真按位染色：掩码 0x1800 = 防御(2048) | 格挡(4096)，正是盾牌配方 319
  const shield = buildLines({ ...item({ itemlistId: 2, itemCode: 0x02040700, defence: 75, absorb: 24, blockRating: 198 }),
    craftMask: 0x1800 }, 2, null);
  const byLabel = (lb: string) => shield.find((l) => l.label === lb);
  check('盾（掩码 0x1800）：躲避行染色（配方改了 defence）', byLabel('躲避')?.age === true, '');
  check('盾（掩码 0x1800）：抵挡率行染色（配方改了 block）', byLabel('抵挡率')?.age === true, '');
  check('盾（掩码 0x1800）：防御(吸收)行**不**染（配方没碰 absorb）', byLabel('防御')?.age !== true, '');
}

// ⑪ 锻造等级**另起一行**（用户 2026-09-23 按原版截图更正：不再拼在名字后面）
{
  const agedLines = buildLines(item({ itemlistId: 1, itemCode: 0x01070900, agingLevel: 2, damageMin: 14 }), 1, null);
  const lv = agedLines.find((l) => l.level);
  check('锻造过的装备：有一条“等级行”（值为 +2）', !!lv && lv.value === '+2', JSON.stringify(lv ?? null));
  check('等级行在属性行之前（名字下方）',
    agedLines.findIndex((l) => l.level) < agedLines.findIndex((l) => l.label === '攻击'),
    '');
  const plain = buildLines(item({ itemlistId: 1, itemCode: 0x01070900, damageMin: 12 }), 1, null);
  check('没锻造过 ⇒ 没有等级行', !plain.some((l) => l.level), '');
}


// ⑬ 类别小图标 —— 逐字照原版 `sinItem.cpp:2114-2125` 的五个条件
{
  const { classIconFile } = await import('../src/ui/itemInfoLines.js');
  check('甲 DA1 ⇒ Weapon_Knight', classIconFile(item({ itemCode: 0x02010100 })) === 'weapon_knight.bmp', '');
  check('法袍 DA2 ⇒ Weapon_Wizard', classIconFile(item({ itemCode: 0x02050100 })) === 'weapon_wizard.bmp', '');
  check('法球 OM1 ⇒ Weapon_Wizard', classIconFile(item({ itemCode: 0x03030100 })) === 'weapon_wizard.bmp', '');
  check('盾 DS1 ⇒ 不画（原版五条件不含盾）', classIconFile(item({ itemCode: 0x02040100 })) === null, '');
  check('靴 DB1 ⇒ 不画', classIconFile(item({ itemCode: 0x02020100 })) === null, '');
}

console.log(failed === 0 ? '\n信息框行回归：全部通过' : `\n信息框行回归：${failed} 条失败`);
process.exit(failed === 0 ? 0 : 1);
