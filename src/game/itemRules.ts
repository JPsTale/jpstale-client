/**
 * 物品使用规则 —— **Java 侧 `org.jpstale.server.game.item.ItemRules` 的同一份定义**（改一边要改另一边）。
 *
 * 原版权威：`sinItem.cpp:64-72` 的
 * `NotSell_/NotDrow_/NotSet_Item_{CODE,MASK,KIND}` 三张同源表；
 * 判据（`sinInvenTory.cpp`）：三张表任一命中即不许。
 *   NotDrow_Item_CODE[] = { (sinQT1|sin07), (sinQT1|sin08), 0 }  → 0x07010007 / 0x07010008
 *   NotDrow_Item_KIND[] = { ITEM_KIND_QUEST_WEAPON, 0 }
 *   sinQT1 = 0x07010000
 *
 * ⚠ 第三张表按 `ItemKindCode` 判，而我们的数据**没有这个字段** → 用**任务家族**近似
 * （宁可不让丢，也不误丢任务物品）。客户端这里只做**预校验**（拦住就不发请求，
 * 免得本地先移除、服务端却拒绝导致两端不一致）；最终仍以服务端为准。
 */

/** 原版 `sinITEM_MASK2`：idcode 的高 16 位 */
const MASK2 = 0xffff0000;
/** 原版 `sinQT1`：任务物品家族 */
const FAMILY_QUEST = 0x07010000;

/** `NotDrow_Item_CODE[]`：不能丢到地面的具体码 */
const NOT_DROP_CODES = [0x07010007, 0x07010008];
/** `NotSell_Item_CODE[]`：不能卖给 NPC（原版与禁丢同表） */
const NOT_SELL_CODES = [0x07010007, 0x07010008];

const inQuestFamily = (idCode: number): boolean => (idCode & MASK2) === FAMILY_QUEST;

/** 能否丢到地面（原版 `NotDrow_Item_*`） */
export function isDroppable(idCode: number | undefined | null): boolean {
  if (!idCode) return true;
  if (NOT_DROP_CODES.includes(idCode)) return false;
  return !inQuestFamily(idCode);
}

/** 能否卖给 NPC（原版 `NotSell_Item_*`） */
export function isSellable(idCode: number | undefined | null): boolean {
  if (!idCode) return true;
  if (NOT_SELL_CODES.includes(idCode)) return false;
  return !inQuestFamily(idCode);
}

// ================= 装备职业门（与 Java `ItemRules.canUse` 同一份，改一边要改另一边）=================
//
// 出处：`ex-machina/src/game/Legacy/Game/Interface/sinInvenTory.cpp:4341-4440`（`CharOnlySetItem`）
// + `:4470-4520`（`CheckRequireItem` / `CheckRequireItemToSet`）—— 原版放装备时按这些**硬编码规则**
// 置 `NotUseFlag`，命中就不许放进槽（`CheckSetOk` → `MESSAGE_NO_USE_ITEM`）。家族码见 `sinItem.h`。
// **只做预校验**（避免"先动了再回滚"的闪烁），最终以服务端为准。
const DA1 = 0x02010000;   // 铠甲（物理系）
const DA2 = 0x02050000;   // 法袍（法系）
const OM1 = 0x03030000;   // 法球（副手）
const WD1 = 0x010a0000;   // 匕首（刺客专属）
const WN1 = 0x01090000;   // 图腾（萨满专属）
const WV1 = 0x010b0000;   // 拳套（格斗家专属）

/** 原版 `sinITEM_MASK3`（playmain.h:220）：低 16 位 —— 男/女外观变体在这一层区分 */
const MASK3 = 0x0000ffff;

/**
 * 原版 `CharOnlySetItem` **第一分支**的 10 个甲码 —— **女性职业被拒绝** ⇒ 它们是**男款**：
 * `sin31 sin32 sin35 sin36 sin39 sin40 sin43 sin44 sin51 sin54`。
 * ⚠ 命名按语义（谁是这一款的主人），不按"源码里谁被判" —— 搞反会让下一个人误判。
 * 同一批甲在男/女两套外观下是**两个不同的 idcode**（同名的两件）——实测我方数据：
 * `da151`/`da152` 都叫 Dark Gaia Armor，`da251`/`da252` 都叫 Dark Iria Robe。
 * 回归：`npm run verify-canuse`（用"同名对"反向自证这个维度）。
 */
const MALE_VARIANT_CODES = [0x2f00, 0x3000, 0x3300, 0x3400, 0x3700, 0x3800, 0x3b00, 0x3c00, 0x4300, 0x4600];
/** 原版 `CharOnlySetItem` **第二分支**的 10 个甲码 —— **其余职业被拒绝** ⇒ 它们是**女款** */
const FEMALE_VARIANT_CODES = [0x3100, 0x3200, 0x3500, 0x3600, 0x3900, 0x3a00, 0x3d00, 0x3e00, 0x4400, 0x4700];

/**
 * 女性职业集合 = `JOB_DATA[].gender === 'f'`（3 弓手 / 5 女战神 / 8 祭司 / 9 刺客 / 11 格斗家）。
 * 原版写死的是 `PRIESTESS || ATALANTA || ARCHER`（8 职业时代那 3 个女性职业，与我们吻合）；
 * 新增的 9/10/11 按**体型性别**外推（刺客 m6 / 格斗家 m8 用女性体型 `tfb`，萨满 m7 用男性体型）。
 */
const isFemaleJob = (job: number): boolean =>
  job === 3 || job === 5 || job === 8 || job === 9 || job === 11;

/** 该职业能否使用这件装备（job：3 弓手 / 5 女战神 / 7 法师 / 8 祭司 / 9 刺客 / 10 萨满 / 11 格斗家） */
export function canUse(job: number | undefined | null, idCode: number | undefined | null): boolean {
  if (!idCode) return true;
  if (job == null) return true;                  // 职业未知（未进图）→ 不拦，交给服务端
  const f = idCode & MASK2;
  // ① 甲（DA1/DA2）按男/女外观码分派：只能穿自己那一款（女性 → 男款不可用，反之亦然）
  if (f === DA1 || f === DA2) {
    if ((isFemaleJob(job) ? MALE_VARIANT_CODES : FEMALE_VARIANT_CODES).includes(idCode & MASK3)) return false;
  }
  // ② 铠甲法系穿不了；法袍、法球非魔法职业用不了
  const magicJob = job === 7 || job === 8 || job === 10;
  if (magicJob ? f === DA1 : (f === DA2 || f === OM1)) return false;
  // ③ 全族一致的职业锁（来源：服务端 OpenItem 的 `**특화`/`**특화랜덤`，AGENTS 纠错 #8）
  if (f === OM1) return job === 7 || job === 8;
  if (f === WD1) return job === 9;
  if (f === WN1) return job === 10;
  if (f === WV1) return job === 11;
  return true;
}

// ================= 负重（原版 `CheckSetOk` 的重量分支）=================
//
// 出处：`sinInvenTory.cpp:6021` —— `Weight[0] + 该件重量 > Weight[1]` 即拒，
// 且 `Weight[0]`（背包+装备合计）**不含鼠标上那件**，所以加上该件恰好就是"搬运后的总重"。
// 背包↔装备槽 / 背包↔药水槽之间搬运**不改变总重** ⇒ 该判定等价于"**当前已超重就拒绝搬运**"，
// 于是客户端**不需要任何逐件重量表**（这正是能省掉一张表的原因）。
// 例外：原版对 `ITEM_KIND_QUEST_WEAPON` 豁免；我们无该列 → 用任务家族近似（与禁丢同一份）。

/** 是否属于**任务物品家族**（`sinQT1 = 0x07010000`） */
export function isQuestFamily(idCode: number | undefined | null): boolean {
  return !!idCode && inQuestFamily(idCode);
}

/**
 * 本次搬运是否因超重被拒（= 原版 `CheckSetOk` 的负重分支）。
 * 调用点：装备槽、药水槽、地面拾取之外的**一切"把手上的东西放下"**动作。
 */
export function overweightBlocks(
  currentWeight: number | undefined | null,
  maxWeight: number | undefined | null,
  idCode: number | undefined | null,
): boolean {
  const cur = currentWeight ?? 0;
  const max = maxWeight ?? 0;
  if (max <= 0 || cur <= max) return false;      // 未超重 → 不拦
  return !isQuestFamily(idCode);                 // 超重时任务武器仍可搬运
}
