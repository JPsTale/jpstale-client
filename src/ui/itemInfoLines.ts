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
  /** 名字下方那行（只有值、居中） */
  sub?: boolean;
  section?: boolean;
  spec?: boolean;
  specHeader?: boolean;
  /** @deprecated 见上（无生产者，保留以记录原版证据） */
  dim?: boolean;
}

/** 百分比显示：整数就 `N%`，否则一位小数 —— 原版 `UIItemInfoBox` 的 `fabs(v-round(v))` 写法 */
function pct(v: number): string {
  return Number.isInteger(v) ? `${v}%` : `${v.toFixed(1)}%`;
}

/** 武器类型小图标（原版 lpShowWeaponClass：名字行右上 18×16 图标）→ 用字符徽标呈现 */
export function weaponTypeChar(code: number): string | null {
  const map: Record<string, string> = {
    SWORD: '剑', AXE: '斧', HAMMER: '锤', SPEAR: '枪', STAFF: '杖',
    BOW: '弓', CROSSBOW: '弩', DAGGER: '匕', SHIELD: '盾', MACE: '锤',
  };
  const type = getWeaponTypeFromIdCode(code);
  return type ? (map[type] ?? type.charAt(0)) : null;
}

export function weaponTypeName(code: number): string {
  const t1 = getWeaponTypeFromIdCode(code);
  return t1 ? t(`itemtip.wtype.${t1}`) : '';
}

export function buildLines(it: GameItem, _cls: number, ch: GameCharacterLike | null): Line[] {
  const out: Line[] = [];
  // 锻造等级 > 0 ⇒ 上面那些被 `applyAge` 缩放的列都是"被强化过的行"（只缩放非 0 列，故无需再判值）
  const aged = it.agingLevel > 0;
  // 名字**下方**那行：锻造等级 `+N`（用户 2026-09-22："在名字下方显示强化等级或合成配方名称"）。
  // 放在行列表最前 ⇒ 渲染时紧跟名字。合成配方名待 Mix 系统落地（实例 `craft_mask` 目前全库为 0）。
  if (aged) out.push({ sub: true, age: true, value: `+${it.agingLevel}` });
  // 每行都是"**有值就显示**"，不再按物品种类开名单 —— 旧版把攻击侧整组框在"武器/盾"里、
  // 把防御侧框在"武器+防具"里，于是护腕（2048，设计属性就是命中+药水槽）的命中、
  // 戒指的必杀、时装（16384）的躲避/吸收全都不显示（用户 2026-09-22 "有些装备属性显示不出来"）。
  // 原版信息框也是按物品种类列字段的（cITEM::ShowItemInfo），但它的种类判断在**数据**里，
  // 我们按"值是否为 0"判等价且永不漏项。
  // 顺序同角色面板的分组：攻击侧 → 防御侧 → 上限/回复。
  if (it.damageMin > 0 || it.damageMax > 0) {
    out.push({ label: t('itemtip.atk'), value: `${it.damageMin}-${it.damageMax}`, age: aged });
  }
  if (it.attackSpeed > 0) out.push({ label: t('itemtip.attackSpeed'), value: String(it.attackSpeed) });
  // ⚠ 这是**装备自身**的射程模板值：近战武器该列为 0（近战距离按手别定 40/80，与装备无关），
  //   所以近战不显示这一行；远程武器才有值（弓/弩/杖）。
  if (it.range > 0) out.push({ label: t('itemtip.range'), value: String(it.range) });
  if (it.attackRating > 0) out.push({ label: t('itemtip.hit'), value: String(it.attackRating), age: aged });
  if (it.critical > 0) out.push({ label: t('itemtip.crit'), value: `${it.critical}%` });
  if (it.defence > 0) out.push({ label: t('itemtip.def'), value: String(it.defence), age: aged });
  if (it.absorb > 0) out.push({ label: t('itemtip.absorb'), value: (it.absorb / 10).toFixed(1), age: aged });
  // 抵挡率按原版 `UIItemInfoBox` 的写法：整数就 "%"，否则一位小数（13.6% 不再被凑成 14%）
  if (it.blockRating > 0) out.push({ label: t('itemtip.block'), value: pct(it.blockRating / 10), age: aged });
  if (it.speed > 0) out.push({ label: t('itemtip.speed'), value: (it.speed / 10).toFixed(1), age: aged });
  // 上限提升（实例值，原版 `sinfIncre*`；曾经完全不显示）
  if (it.increaseLife > 0) out.push({ label: t('itemtip.incLife'), value: String(it.increaseLife), age: aged });
  if (it.increaseMana > 0) out.push({ label: t('itemtip.incMana'), value: String(it.increaseMana), age: aged });
  if (it.increaseStamina > 0) out.push({ label: t('itemtip.incStm'), value: String(it.increaseStamina), age: aged });
  // 每秒回复（实例值，0.1 精度；原版 `sinfRegen*`；曾经完全不显示）
  if (it.lifeRegen > 0) out.push({ label: t('itemtip.regenLife'), value: (it.lifeRegen / 10).toFixed(1), age: aged });
  if (it.manaRegen > 0) out.push({ label: t('itemtip.regenMana'), value: (it.manaRegen / 10).toFixed(1), age: aged });
  if (it.staminaRegen > 0) out.push({ label: t('itemtip.regenStm'), value: (it.staminaRegen / 10).toFixed(1), age: aged });
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
  const resVals: [string, number][] = [
    [t('itemtip.resBionic'), it.resBionic],
    [t('itemtip.resEarth'), it.resEarth],
    [t('itemtip.resFire'), it.resFire],
    [t('itemtip.resIce'), it.resIce],
    [t('itemtip.resLightning'), it.resLightning],
    [t('itemtip.resPoison'), it.resPoison],
    [t('itemtip.resWater'), it.resWater],
    [t('itemtip.resWind'), it.resWind],
  ];
  if (resVals.some(([, v]) => v !== 0)) {
    out.push({ section: true, value: '' });
    for (const [label, v] of resVals) if (v !== 0) out.push({ label, value: String(v) });
  }
  // —— 耐久度（属性区最后）——
  if (it.durabilityMax > 0) out.push({ label: t('itemtip.durability'), value: `${it.durability}/${it.durabilityMax}` });
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
    if (it.specAbsorb > 0) out.push({ spec: true, age: aged, label: t('itemtip.specAbsorb'), value: (it.specAbsorb / 10).toFixed(1) });
    if (it.specLevAttackRating > 0) out.push({ spec: true, label: t('itemtip.specHit'), value: `Lv/${it.specLevAttackRating}` });
    if (it.specLevDamageMax > 0) out.push({ spec: true, label: t('itemtip.specAtk'), value: `Lv/${it.specLevDamageMax}` });
    if (it.specAttackSpeed > 0) out.push({ spec: true, label: t('itemtip.specAttackSpeed'), value: String(it.specAttackSpeed) });
    if (it.specCritical > 0) out.push({ spec: true, label: t('itemtip.specCrit'), value: `${it.specCritical}%` });
    if (it.specDefence > 0) out.push({ spec: true, age: aged, label: t('itemtip.specDef'), value: String(it.specDefence) });
    if (it.specBlockRating > 0) out.push({ spec: true, label: t('itemtip.specBlock'), value: pct(it.specBlockRating / 10) });
    if (it.specSpeed > 0) out.push({ spec: true, age: aged, label: t('itemtip.specSpeed'), value: (it.specSpeed / 10).toFixed(1) });
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
    if (it.specPerManaRegen > 0) out.push({ spec: true, age: aged, label: t('itemtip.specRegenMana'), value: (it.specPerManaRegen / 100).toFixed(2) });
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
