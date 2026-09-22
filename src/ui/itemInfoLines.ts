/**
 * 物品信息框的**行列表**（纯函数，无 React/store 依赖）。
 *
 * 为什么单独一个文件：渲染（`ItemInfo.tsx`）与"哪些行、什么值"是两件事 ——
 * 分开后 `npm run verify-itemtip` 能在 Node 下直接 import 本模块断言行列表，
 * 而不必拖进 React 组件那条会在模块作用域碰 `document` 的依赖链。
 *
 * 版式依据原版 `cITEM::ShowItemInfo` / `UIItemInfoBox`：两列（左标签 / 右数值），
 * 需求不满足行红字，职业特效行金色居中，段落之间空一行。
 */
import type { GameItem } from '../app/gameStore.js';
import { potionEffect } from '../game/data/potionEffects.js';
import { itemExtras } from '../game/data/itemExtras.js';
import { getWeaponTypeFromIdCode } from '../char/weapon-type.js';
import { itemDefById } from '../game/data/itemDefs.js';
import { ITEM_CLASS } from '../game/itemClass.js';
import { t } from '../i18n/index.js';

/**
 * 信息框的一行。**颜色分工（用户 2026-09-22 定的口径）**：
 *   · 普通属性：标签与数值都是**白**（框的默认色就是白）；
 *   · `req`（等级要求/力量要求…六项）：**标签橙黄**、数值仍白；
 *   · `req` + `red`（不达标）：**整行红**（标签与数值都红）；
 *   · `age`（被锻造强化的那一行）：**整行蓝**（管理端 `mod-age` = `#6ea8ff`）；
 *   · `spec`（职业特效段）：整行绿（原版 `RGB(33,205,95)` / 管理端 `mod-spec` `#7cd47c`）；
 *   · `sub`（名字**下方**那行）：只有值、居中，显示锻造等级 `+N`（合成配方名待 Mix 系统落地）。
 *
 * 依据与两处冲突的如实记录（读源码得来，别再凭想象改）：
 *   · 需求行"标签橙黄/数值白"= **ex-machina** 的口径（`RGB(255,180,100)` 给需求行，见 AGENTS 纠错 #70）；
 *     11 职业私服客户端（`sinItem.cpp:7714-7726`）则把需求行**两列**都画成 `RGB(150,149,144)`（灰）——
 *     用户以游戏内实测为准否掉了灰色那套，`dim` 因此无生产者（保留字段与 CSS 但别接回去）。
 *   · `age` 该染哪几行 = 照抄管理端 `js/item-effects.js` 的 `applyAge` 列清单（**同一份规则，别写第二份**）：
 *     攻击力/命中/躲避/防御/抵挡率/速度/三种上限/三种再生 + 特效的躲避/速度/吸收/灵力再生。
 *     注意它只缩放**非 0** 的列（`x ? round(x*rate) : x`），而我们这边"有值才出行"，故判据就是 `agingLevel > 0`。
 */
export interface Line {
  label?: string;
  value: string;
  /** 不达标（红，整行） */
  red?: boolean;
  /** 需求类行（标签橙黄） */
  req?: boolean;
  /** 被锻造强化过的行（整行蓝） */
  age?: boolean;
  /** 名字下方那行**合成配方名**（由服务端下发的 `key`+值拼出 —— i18n 自动） */
  mixName?: boolean;
  /** 名字下方那行**锻造等级**（用户 2026-09-23 按原版截图："锻造级别另起一行"，不再拼在名字后面） */
  level?: boolean;
  /** 名字下方那行（只有值、居中） */
  sub?: boolean;
  section?: boolean;
  spec?: boolean;
  specHeader?: boolean;
  /** @deprecated 见上（无生产者，保留以记录原版证据） */
  dim?: boolean;
  /**
   * 锻造**熟练度进度条**（原版 `ItemAgingCount[0]/[1]`）：整行画一条 bar + 等级。
   * 原版只在 `ItemKindCode == ITEM_KIND_AGING` 且 `max > 0` 时画，**没有文字标签**，
   * 长度 = `125 × cur/max`（`sinItem.cpp:2226-2239`：`AgingGageFlag` / `AgingBarLenght` / `AgingLevel4`）。
   */
  bar?: { cur: number; max: number };
}

/** 锻造会改动哪些**显示行**（`AgeRow` 是显示行的标识，不是列名）。 */
type AgeRow = 'dmg' | 'hit' | 'crit' | 'def' | 'absorb' | 'block' | 'dur' | 'life' | 'mana';

/**
 * 锻造按族会动的行 —— **逐字照抄** `sinSubMain.cpp:2455-2610` 的 `sinSetAgingItemIncreState`
 * （每族的 `sinSet*` 调用），家族码见 `sinItem.h:60-88`（idcode 高 16 位）。
 *
 * ⚠ **不要参考管理端 `item-effects.js` 的 `applyAge`** —— 它是前一轮 AI 分析 C++ 后的产物、且与源码不符
 * （它按 `1 + level*0.02` 统一乘一批列，源码是按族逐项加；逐项对照见
 * `docs/锻造与合成-源码分析.md` §3.6）。本表才是源码。 
 * 关键差异（源码侧）：命中是**固定值**、防御是**按当前值百分比**（复利）、吸收每级 +0.5（≥9/≥19 再叠一次）、
 * 必杀/格挡**只在奇数等级** +1、耐久每级 -1%+1、只有部分族给 `fIncrease_Life/Mana`。
 * 速度/再生/耐力上限**从来不在**锻造加成里（旧 JS 列了它们，是错的）。
 */
const AGING_FAMILY_ROWS: Record<number, AgeRow[]> = {
  // ⚠ 本表必须与服务端 `AgeGrowth.java` 的 switch **逐族一致** —— 它决定"哪些行是锻造加上去的"（要染色）。
  // 2026-09-22 按 EU `CAgeHandler::OnUpAge`（`PristonTale-EU-main/Server/server/AgeHandler.cpp:404`）
  // 重写了一遍：旧表与增长规则大面积对不上（杖/锤/图腾缺 crit、弓/匕首多了 life、
  // 靴/护手/护腕根本不涨却列了属性、盾缺 def、拳套没条目）—— 那些行会被错染或漏染，
  // 而玩家看到的正是这个。`npm run verify-itemtip` 里有一条**跨仓比对**钉住它。
  // 只在 Case 里出现的族才列；"不涨"的族（靴 DB1 / 护手 DG1 / 护腕 OA2 / 戒指…）**不写在这里**（写了就是谎）。
  // ⚠ 也**刻意不含 `dur`**：11 职业客户端有 `sinSetDurabilityAging()`（斧/锤那几族会动耐久），
  //   但 EU 的 `OnUpAge` **不碰**耐久（只由 `UpdateIntegrity` 扣 −1/−3/−5）⇒ 我们的实现只扣不加，
  //   把耐久行标成"锻造加成"就是谎。旧表里的 `dur` 因此删掉。
  0x01010000: ['dmg', 'hit'],                    // 斧 WA：Damage + 命中 +10
  0x01020000: ['dmg', 'hit', 'crit'],            // 爪 WC：Damage + 命中 +5 + 必杀
  0x01030000: ['dmg', 'hit', 'crit'],            // 锤 WH：Damage + 命中 +8 + 必杀
  0x01040000: ['dmg', 'hit', 'crit', 'mana'],    // 杖 WM：Damage + 命中 +8 + 必杀 + 灵力 +10
  0x01050000: ['dmg', 'hit', 'crit'],            // 镰/矛 WP：Damage + 命中 +5 + 必杀
  0x01060000: ['dmg', 'crit'],                   // 弓 WS1：Damage + 必杀
  0x01070000: ['dmg', 'hit', 'crit'],            // 剑 WS2：Damage + 命中 +5 + 必杀
  0x01080000: ['dmg', 'crit'],                   // 标枪 WT：Damage + 必杀
  0x01090000: ['dmg', 'hit', 'crit', 'mana'],    // 图腾 WN（EU 的 Phantom 与 Wand 同支）
  0x010A0000: ['dmg', 'hit', 'crit'],            // 匕首 WD（EU 的 Dagger 与剑/爪同支）
  0x010B0000: ['dmg', 'hit', 'crit'],            // ★ 拳套 WV（我们的新族，按爪）
  0x02040000: ['def', 'block', 'absorb'],        // 盾 DS1：防御 +5% + 格挡 + 吸收 0.4
  0x03030000: ['def', 'block', 'absorb'],        // 法球 OM1（同盾）
  0x02010000: ['def', 'absorb'],                 // 甲 DA1：防御 +5% + 吸收 0.5
  0x02050000: ['def', 'absorb'],                 // 法袍 DA2
  0x02120000: ['def', 'absorb'],                 // DA3
  0x02130000: ['def', 'absorb'],                 // DA4
};

/**
 * **合成效果位** —— 与服务端 `MixEffect.java` 的 `SIN_ADD_*` **逐位一致**（三仓库一致的原版位值）。
 * 用途只有一个：判断"这一行的值是不是被合成加上去的"（染色）。
 * ⚠ 必须与文案无关地判位：靠 label 文案匹配的话，改一个字就静默失效（纠错 #24 的同一类）。
 * `npm run verify-itemtip` 里有一条**跨仓比对**钉住它（解析 `MixEffect.java` 的常量）。
 */
const MIX_BIT = {
  fire: 0x00000001, ice: 0x00000002, lightning: 0x00000004, poison: 0x00000008,
  organic: 0x00000010, critical: 0x00000020, attackRating: 0x00000040,
  damageMin: 0x00000080, damageMax: 0x00000100, attackSpeed: 0x00000200,
  absorb: 0x00000400, defence: 0x00000800, block: 0x00001000, moveSpeed: 0x00002000,
  hp: 0x00004000, mp: 0x00008000, sp: 0x00010000,
  hpRegen: 0x00020000, mpRegen: 0x00040000, spRegen: 0x00080000, potionStorage: 0x00100000,
} as const;

/** 这一行的值是否被合成加过（`mask` = 服务端下发的派生掩码 = 该配方效果位的并集） */
const mixed = (mask: number, ...bits: number[]): boolean => bits.some((b) => (mask & b) !== 0);

/**
 * 配方里一条效果的**显示值**：格式与"该属性在信息框里的行"保持一致（同一单位 ⇒ 同一写法）。
 * ⚠ 判据是**协议 key**（`mixe.block` 这种稳定标识），不是文案 —— 改译文不会让它失效。
 */
function mixValueText(key: string, value: number): string {
  const name = key.startsWith('mixe.') ? key.slice(5) : key;
  if (name === 'block' || name === 'critical') return `${pct(value)}`;          // 与"抵挡率/必杀率"行同为百分比
  if (name === 'absorb' || name === 'speed' || name.endsWith('-regen')) {
    return value.toFixed(1);                                                     // 与那几行的 0.1 精度一致
  }
  return String(Math.round(value));
}

/** 合成配方名：`躲避 +20 / 抵挡率 +4%`（每条效果 = `mixe.*` 文案 + 值） */
export function mixRecipeName(it: GameItem): string {
  return (it.mixEffects ?? [])
    .map((e) => `${t(e.key)} +${mixValueText(e.key, e.value)}`)
    .join(' / ');
}

/** 百分比显示：整数就 `N%`，否则一位小数 —— 原版 `UIItemInfoBox` 的 `fabs(v-round(v))` 写法 */
function pct(v: number): string {
  return Number.isInteger(v) ? `${v}%` : `${v.toFixed(1)}%`;
}

/**
 * **物品信息框右上那个 18×16 小图标** —— 逐字照原版：
 * 选图逻辑 `sinItem.cpp:2114-2125`（五个条件）+ 绘制 `:1974-1984` + 四张图的载入 `sinInvenTory.cpp:285-288`：
 * <pre>
 *   Class == ITEM_CLASS_WEAPON_ONE (4)      → Weapon_Onehand
 *   Class == ITEM_CLASS_WEAPON_TWO (6)      → Weapon_Twohand
 *   家族 == sinDA1 (0x0201 甲)               → Weapon_Knight
 *   家族 == sinDA2 (0x0205 法袍) / sinOM1 (0x0303 法球) → Weapon_Wizard
 *   其余物品**不画**
 * </pre>
 * ⚠ 我两次都改错了方向（用户 2026-09-23 追问"原版到底怎么取的"）：第一次用这套图但**渲染错**（塞进
 * 文字徽标的 CSS 里、裸 `<img>` 没透明化），第二次竟跟着"技能面板"的说法换成**武器族**那套图标 ✗✗ ——
 * 那是另一个维度，原版物品框没有它。**以源码为准**：维度是"类别"，图就是这四张。
 * 透明化走渲染层的 `useItemImg`/`transparentBmp`（黑底当作透明）。
 */
export function classIconFile(it: GameItem): string | null {
  const cls = itemDefById(it.itemlistId)?.class ?? 0;
  if (cls === ITEM_CLASS.ONE_HAND_WEAPON) return 'weapon_onehand.bmp';
  if (cls === ITEM_CLASS.TWO_HAND_WEAPON) return 'weapon_twohand.bmp';
  const fam = (it.itemCode ?? 0) & 0xffff0000;
  if (fam === 0x02010000) return 'weapon_knight.bmp';                       // DA1 甲
  if (fam === 0x02050000 || fam === 0x03030000) return 'weapon_wizard.bmp'; // DA2 法袍 / OM1 法球
  return null;
}

export function weaponTypeName(code: number): string {
  const t1 = getWeaponTypeFromIdCode(code);
  return t1 ? t(`itemtip.wtype.${t1}`) : '';
}

export function buildLines(it: GameItem, _cls: number, ch: GameCharacterLike | null): Line[] {
  const out: Line[] = [];
  // 锻造：按**家族**决定哪几行被强化（源码规则），必杀/格挡还只在**奇数等级** +1。
  // ⚠ `aging_num` 是合成与锻造**共用**的字段（合成时它 = 材料槽位+1，见 sinTrade.cpp:5010）
  //   ⇒ 严格判"这是锻造物"要看 `kind_code == ITEM_KIND_AGING`；该字段目前没进 proto，
  //   而库里合成物为 0 行（craft_mask/kind_code 全 0），故当前不会误判。接合成系统时必须补。
  const ageRows = it.agingLevel > 0 ? (AGING_FAMILY_ROWS[it.itemCode & 0xffff0000] ?? []) : [];
  // 标记的含义是"**这一行的值是被锻造加上去的**"（不是"这一级刚好加了"）：
  //  · 伤害/命中/防御/吸收/灵力：每级都涨 ⇒ +1 起就是锻造值；
  //  · 必杀/格挡：EU `CAgeHandler::UpCritical`/`UpBlockRating` 是"每两级 +1"
  //    （判 `sAgeLevel && sAgeLevel % 2 == 1`，且在 `sAgeLevel++` **之前**调用 ⇒ 第一次增长发生在**到达 +2** 时，
  //     见 `PristonTale-EU-main/Server/server/AgeHandler.cpp:281-299,459-470`）
  //    ⇒ +2 及以后（含 +3/+5 这些奇数级，值仍是那次加上的）该染色，+1 不该。
  // ⚠ 这里先后错过两次：先写 `% 2 === 1`（把"何时增长"当成了"何时染色"，差一级），
  //   再写 `% 2 === 0`（又漏掉 +3/+5 —— 那些级的值同样是锻造加上去的）。判据是**涨过没有**，不是奇偶。
  const grownOk = (r: AgeRow) => (r === 'crit' || r === 'block') ? it.agingLevel >= 2 : true;
  const aged = (r: AgeRow) => ageRows.includes(r) && grownOk(r);
  // 每行都是"**有值就显示**"，不再按物品种类开名单 —— 旧版把攻击侧整组框在"武器/盾"里、
  // 把防御侧框在"武器+防具"里，于是护腕（2048，设计属性就是命中+药水槽）的命中、
  // 戒指的必杀、时装（16384）的躲避/吸收全都不显示（用户 2026-09-22 "有些装备属性显示不出来"）。
  // 原版信息框也是按物品种类列字段的（cITEM::ShowItemInfo），但它的种类判断在**数据**里，
  // 我们按"值是否为 0"判等价且永不漏项。
  // 顺序同角色面板的分组：攻击侧 → 防御侧 → 上限/回复。
  // 锻造等级：**另起一行**（用户 2026-09-23 更正：不是拼在名字后面；名字本身改成黄色由 CSS 上色）
  if (it.agingLevel > 0) out.push({ value: `+${it.agingLevel}`, level: true });

  // 合成配方名：**紧跟名字下方**（原版与管理端都在这个位置；用户 2026-09-22 报"盾牌看不到配方描述"）
  const recipeName = mixRecipeName(it);
  if (recipeName) {
    out.push({ value: recipeName, mixName: true });
  }

  // 锻造熟练度进度条：**紧跟在名字下方、属性之前**（原版 `sinItem.cpp:2226-2239` 那段就在属性列之前，
  // 占两行；`+N` 画在条内 —— 所以**不再另出一行 +N**，那是重复）
  if (it.kindCode === 2 && it.agingExpMax > 0) {
    out.push({ value: '', bar: { cur: it.agingExp, max: it.agingExpMax } });
  }

  if (it.damageMin > 0 || it.damageMax > 0) {
    out.push({ label: t('itemtip.atk'), value: `${it.damageMin}-${it.damageMax}`, age: aged('dmg') || mixed(it.craftMask, MIX_BIT.damageMin, MIX_BIT.damageMax) });
  }
  if (it.attackSpeed > 0) out.push({ label: t('itemtip.attackSpeed'), value: String(it.attackSpeed), age: mixed(it.craftMask, MIX_BIT.attackSpeed) });
  // ⚠ 这是**装备自身**的射程模板值：近战武器该列为 0（近战距离按手别定 40/80，与装备无关），
  //   所以近战不显示这一行；远程武器才有值（弓/弩/杖）。
  if (it.range > 0) out.push({ label: t('itemtip.range'), value: String(it.range) });
  if (it.attackRating > 0) out.push({ label: t('itemtip.hit'), value: String(it.attackRating), age: aged('hit') || mixed(it.craftMask, MIX_BIT.attackRating) });
  if (it.critical > 0) out.push({ label: t('itemtip.crit'), value: `${it.critical}%`, age: aged('crit') || mixed(it.craftMask, MIX_BIT.critical) });
  if (it.defence > 0) out.push({ label: t('itemtip.def'), value: String(it.defence), age: aged('def') || mixed(it.craftMask, MIX_BIT.defence) });
  if (it.absorb > 0) out.push({ label: t('itemtip.absorb'), value: (it.absorb / 10).toFixed(1), age: aged('absorb') || mixed(it.craftMask, MIX_BIT.absorb) });
  // 抵挡率按原版 `UIItemInfoBox` 的写法：整数就 "%"，否则一位小数（13.6% 不再被凑成 14%）
  if (it.blockRating > 0) out.push({ label: t('itemtip.block'), value: pct(it.blockRating / 10), age: aged('block') || mixed(it.craftMask, MIX_BIT.block) });
  if (it.speed > 0) out.push({ label: t('itemtip.speed'), value: (it.speed / 10).toFixed(1), age: mixed(it.craftMask, MIX_BIT.moveSpeed) });   // 锻造不改移速，合成会
  // 上限提升（实例值，原版 `sinfIncre*`；曾经完全不显示）
  if (it.increaseLife > 0) out.push({ label: t('itemtip.incLife'), value: String(it.increaseLife), age: aged('life') || mixed(it.craftMask, MIX_BIT.hp) });
  if (it.increaseMana > 0) out.push({ label: t('itemtip.incMana'), value: String(it.increaseMana), age: aged('mana') || mixed(it.craftMask, MIX_BIT.mp) });
  if (it.increaseStamina > 0) out.push({ label: t('itemtip.incStm'), value: String(it.increaseStamina), age: mixed(it.craftMask, MIX_BIT.sp) });   // 锻造不改耐力上限，但**合成会**（Add STM）
  // 每秒回复（实例值，0.1 精度；原版 `sinfRegen*`；曾经完全不显示）
  if (it.lifeRegen > 0) out.push({ label: t('itemtip.regenLife'), value: (it.lifeRegen / 10).toFixed(1), age: mixed(it.craftMask, MIX_BIT.hpRegen) });   // 锻造不改再生，合成会
  if (it.manaRegen > 0) out.push({ label: t('itemtip.regenMana'), value: (it.manaRegen / 10).toFixed(1), age: mixed(it.craftMask, MIX_BIT.mpRegen) });
  if (it.staminaRegen > 0) out.push({ label: t('itemtip.regenStm'), value: (it.staminaRegen / 10).toFixed(1), age: mixed(it.craftMask, MIX_BIT.spRegen) });
  // —— 回复类（药水）：模板字段，不在实例里 → 查 `potion-effects.generated.json` ——
  // （判据与服务端 rollRecovery 一致：三对列至少一个有值；显示区间与使用时掷点范围相同）
  const rec = potionEffect(it.itemlistId);
  if (rec) {
    out.push({ section: true, value: '' });
    if (rec.hp) out.push({ label: t('itemtip.recHp'), value: `${rec.hp[0]}-${rec.hp[1]}` });
    if (rec.mp) out.push({ label: t('itemtip.recMp'), value: `${rec.mp[0]}-${rec.mp[1]}` });
    if (rec.stm) out.push({ label: t('itemtip.recStm'), value: `${rec.stm[0]}-${rec.stm[1]}` });
  }
  // 8 系抗性（逐条非 0）
  // 每系抗性带上"合成会改它吗"的位（原版 `SIN_ADD_*` 只有生物/火/冰/雷/毒 5 位；地/水/风**没有** →
  // 那三行永远不因合成染色，因为原版的合成配方根本改不到它们）
  const resVals: [string, number, number][] = [
    [t('itemtip.resBionic'), it.resBionic, MIX_BIT.organic],
    [t('itemtip.resEarth'), it.resEarth, 0],
    [t('itemtip.resFire'), it.resFire, MIX_BIT.fire],
    [t('itemtip.resIce'), it.resIce, MIX_BIT.ice],
    [t('itemtip.resLightning'), it.resLightning, MIX_BIT.lightning],
    [t('itemtip.resPoison'), it.resPoison, MIX_BIT.poison],
    [t('itemtip.resWater'), it.resWater, 0],
    [t('itemtip.resWind'), it.resWind, 0],
  ];
  if (resVals.some(([, v]) => v !== 0)) {
    out.push({ section: true, value: '' });
    for (const [label, v, bit] of resVals) {
      if (v !== 0) out.push({ label, value: String(v), age: bit !== 0 && mixed(it.craftMask, bit) });
    }
  }
  // —— 耐久度（属性区最后）——
  if (it.durabilityMax > 0) out.push({ label: t('itemtip.durability'), value: `${it.durability}/${it.durabilityMax}`, age: aged('dur') });
  // —— 模板附加信息（药水存放数量）：proto 里没有这一列，查 `item-extras.generated.json` ——
  // （重量也来自这张表，但按原版版面排在信息栏**最下方倒数第二**，见函数末尾）
  const ex = itemExtras(it.itemlistId);
  if (ex && ex.potionSpace > 0) out.push({ label: t('itemtip.potionSpace'), value: String(ex.potionSpace) });
  // —— 需求（**满足 = 原版默认的偏黄字色**，不满足 = 红；置于属性区之后）——
  // ⚠ 旧版给满足的行加了 `dim`（灰色）——那是我擅自定义的，原版没有"灰"这一档：
  //   原版是"默认色（偏黄）→ 不满足才红"（用户 2026-09-22 指出）。
  const lv = ch?.level ?? 0;
  const st = ch?.strength ?? 0, sp = ch?.spirit ?? 0, ta = ch?.talent ?? 0;
  const ag = ch?.agility ?? 0, hp = ch?.health ?? 0;
  const req: [string, number, number][] = [
    [t('itemtip.reqLv'), it.reqLevel, lv],
    [t('itemtip.reqStr'), it.reqStrength, st],
    [t('itemtip.reqSpirit'), it.reqSpirit, sp],
    [t('itemtip.reqTalent'), it.reqTalent, ta],
    [t('itemtip.reqAgility'), it.reqAgility, ag],
    [t('itemtip.reqHealth'), it.reqHealth, hp],
  ];
  if (req.some(([, v]) => v > 0)) {
    out.push({ section: true, value: '' });
    for (const [label, need, have] of req) {
      if (need > 0) out.push({ label, value: String(need), req: true, red: have < need });
    }
  }
  // —— 职业特效（sITEM_SPECIAL；居中金/黄；数据 userdb.item.spec_*）——
  if (it.jobCodeMask !== 0 && hasSpec(it)) {
    out.push({ section: true, value: '' });
    const job = jobName(it.jobCodeMask);
    if (job) out.push({ specHeader: true, value: t('itemtip.specHeader', { job }) });
    if (it.specAbsorb > 0) out.push({ spec: true, label: t('itemtip.specAbsorb'), value: (it.specAbsorb / 10).toFixed(1) });
    if (it.specLevAttackRating > 0) out.push({ spec: true, label: t('itemtip.specHit'), value: `Lv/${it.specLevAttackRating}` });
    if (it.specLevDamageMax > 0) out.push({ spec: true, label: t('itemtip.specAtk'), value: `Lv/${it.specLevDamageMax}` });
    if (it.specAttackSpeed > 0) out.push({ spec: true, label: t('itemtip.specAttackSpeed'), value: String(it.specAttackSpeed) });
    if (it.specCritical > 0) out.push({ spec: true, label: t('itemtip.specCrit'), value: `${it.specCritical}%` });
    if (it.specDefence > 0) out.push({ spec: true, label: t('itemtip.specDef'), value: String(it.specDefence) });
    if (it.specBlockRating > 0) out.push({ spec: true, label: t('itemtip.specBlock'), value: pct(it.specBlockRating / 10) });
    if (it.specSpeed > 0) out.push({ spec: true, label: t('itemtip.specSpeed'), value: (it.specSpeed / 10).toFixed(1) });
    if (it.specShootingRange > 0) out.push({ spec: true, label: t('itemtip.specRange'), value: String(it.specShootingRange) });
    if (it.specMagicMastery > 0) out.push({ spec: true, label: t('itemtip.specMagicMastery'), value: (it.specMagicMastery / 10).toFixed(1) });
    const specRes: [string, number][] = [
      [t('itemtip.specResBionic'), it.specResBionic],
      [t('itemtip.specResEarth'), it.specResEarth],
      [t('itemtip.specResFire'), it.specResFire],
      [t('itemtip.specResIce'), it.specResIce],
      [t('itemtip.specResLightning'), it.specResLighting],
      [t('itemtip.specResPoison'), it.specResPoison],
      [t('itemtip.specResWater'), it.specResWater],
      [t('itemtip.specResWind'), it.specResWind],
    ];
    for (const [label, v] of specRes) if (v !== 0) out.push({ spec: true, label, value: String(v) });
    const specLevRes: [string, number][] = [
      [t('itemtip.specResBionic'), it.specLevResBionic],
      [t('itemtip.specResEarth'), it.specLevResEarth],
      [t('itemtip.specResFire'), it.specLevResFire],
      [t('itemtip.specResIce'), it.specLevResIce],
      [t('itemtip.specResLightning'), it.specLevResLighting],
      [t('itemtip.specResPoison'), it.specLevResPoison],
      [t('itemtip.specResWater'), it.specLevResWater],
      [t('itemtip.specResWind'), it.specLevResWind],
    ];
    for (const [label, v] of specLevRes) if (v !== 0) out.push({ spec: true, label, value: `Lv/${v}` });
    if (it.specLevLife > 0) out.push({ spec: true, label: t('itemtip.specMaxHpBoost'), value: `Lv/${it.specLevLife}` });
    if (it.specLevMana > 0) out.push({ spec: true, label: t('itemtip.specMaxMpBoost'), value: `Lv/${it.specLevMana}` });
    if (it.specPerLifeRegen > 0) out.push({ spec: true, label: t('itemtip.specRegenLife'), value: (it.specPerLifeRegen / 100).toFixed(2) });
    if (it.specPerManaRegen > 0) out.push({ spec: true, label: t('itemtip.specRegenMana'), value: (it.specPerManaRegen / 100).toFixed(2) });
    if (it.specPerStaminaRegen > 0) out.push({ spec: true, label: t('itemtip.specRegenStm'), value: (it.specPerStaminaRegen / 100).toFixed(2) });
  }
  // —— 收尾两行（原版版面：重量在倒数第二、价格在**最下方**）——
  // 用户 2026-09-22："重量和价格，这 2 个东西要跟上面的内容隔开一点点空间" ⇒ 段前空一行
  // （与需求/特效段同一种 `section` 分隔；两者都没有时不出这个空行）
  if ((ex && ex.weight > 0) || it.price > 0) out.push({ section: true, value: '' });
  if (ex && ex.weight > 0) out.push({ label: t('itemtip.weight'), value: String(ex.weight) });
  if (it.price > 0) out.push({ label: t('itemtip.price'), value: it.price.toLocaleString('en-US') });
  return out;
}

function hasSpec(it: GameItem): boolean {
  return it.specAbsorb > 0 || it.specDefence > 0 || it.specSpeed > 0
    || it.specBlockRating > 0 || it.specAttackSpeed > 0 || it.specCritical > 0
    || it.specShootingRange > 0 || it.specMagicMastery > 0
    || it.specResBionic > 0 || it.specResEarth > 0 || it.specResFire > 0
    || it.specResIce > 0 || it.specResLighting > 0 || it.specResPoison > 0
    || it.specResWater > 0 || it.specResWind > 0
    || it.specLevMana > 0 || it.specLevLife > 0
    || it.specLevAttackRating > 0 || it.specLevDamageMax > 0
    || it.specLevResBionic > 0 || it.specLevResEarth > 0 || it.specLevResFire > 0
    || it.specLevResIce > 0 || it.specLevResLighting > 0 || it.specLevResPoison > 0
    || it.specLevResWater > 0 || it.specLevResWind > 0
    || it.specPerManaRegen > 0 || it.specPerLifeRegen > 0 || it.specPerStaminaRegen > 0;
}

/** job_code_mask → 职业显示名（位 → JobDataBase 中文表；取最大位）。 */
function jobName(mask: number): string {
  if (!mask) return '';
  for (let i = 31; i >= 0; i--) {
    const bit = (1 << i) >>> 0;
    if ((mask & bit) === 0) continue;
    const name = t(`itemtip.job.${bit}`);
    if (name !== `itemtip.job.${bit}`) return name; // t 兜底返回 key 本身
  }
  return '';
}

interface GameCharacterLike {
  level?: number;
  strength?: number;
  spirit?: number;
  talent?: number;
  agility?: number;
  health?: number;
}
