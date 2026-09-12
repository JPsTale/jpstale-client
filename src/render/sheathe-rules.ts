/**
 * 收械（sheathed）挂载规则 —— **从 C++ 源码逐字移植，不用启发式**。
 *
 * **权威来源 = 11 职业源码**（与目标客户端同期）：
 *   `NewSourcePT-2023/SrcGame/src/character.cpp`（服务器上 `/data/PristonTale/src/`）
 *   `dwItemCodeFromVillage[]` / `_Bow[]` / `_Cross[]`
 *   ✓ 已逐条比对：**11 职业版三张表严格包含** 8 职业版（`ex-machina/.../character.cpp`
 *     L1356/L1371/L1376）的全部条目，并多出若干 —— 故以 11 职业版为准，不再用 8 职业版。
 *   赋值逻辑：按"当前动作物品码是否在这三张表里"依次赋 `dwItemSetting`（默认 1）——
 *     命中 Village → 0；命中 `_Bow` → 2；命中 `_Cross` → 3
 *   `BackObjBip[0..2] = { BackSpine, BackSpineBow, BackSpineCross }`，取 `BackObjBip[setting-1]`。
 *
 * ⚠ **列表命名与骨骼字符串是互换的**（名叫 `_Bow` 的表装的是弩、叫 `_Cross` 的装的是弓），
 *   以**列表内容 + 数组槽位**为准（骨骼名表见下），照行为移植、不照命名：
 *     Village 表 → setting 0 → 不挂背（留手上）
 *     `_Bow`   表 → setting 2 → BackObjBip[1] = BackSpineBow    = "Bip in-cro"（弩背）
 *     `_Cross` 表 → setting 3 → BackObjBip[2] = BackSpineCross  = "Bip in-bow"（弓背）
 *     其余       → setting 1 → BackObjBip[0] = BackSpine        = "Bip in01"（通用背点）
 *   骨骼名表（`szBipName_*`，`character.cpp` L398 起，8 名字全在这）：
 *     RightHand="Bip weapon01" / LeftHand="Bip01 L Hand" / Shield="Bip01 L Forearm"
 *     BackSpine="Bip in01" / BackSpineBow="Bip in-cro" / BackSpineCross="Bip in-bow"
 *
 * ⚠⚠ **`sinNN` 宏不是 `NN × 0x100`** —— 只对 `sin01..sin25` 成立。头文件里
 *   （`src/sinbaram/sinItem.h`）从 `sin26` 起高位被偏移过：
 *     `sin26 = 0x2A00`（索引 **42**）· `sin28 = 0x2C00`（44）· `sin30 = 0x2E00`（46）
 *     `sin50 = 0x4200`（66）· `sin53 = 0x4500`（**69**）· `sin60 = 0x4C00`（76）· `sin61 = 0x4D00`（77）
 *   本文件一律用**索引值**（= 低 16 位 / 0x100），注释标出宏名，避免这个陷阱。
 *
 * ⚠ 这是**硬编码白名单**：表外武器一律走默认（`in01` 背）。原版就是如此，
 *   别把"表外武器挂到通用背点"当成 bug 去"修好"。已知两族例外见 `SHEATHE_FAMILY_RULES`。
 */

/** idcode 家族前缀（= 头文件里的 sinXX1 宏，已逐条核对） */
const FAM = {
  CLAW: 0x01020000,   // sinWC1
  STAFF: 0x01040000,  // sinWM1
  BOW: 0x01060000,    // sinWS1（弓 + 弩）
  SWORD: 0x01070000,  // sinWS2（剑）
} as const;

/**
 * `sinNN` 宏名 → idcode。**NN ≥ 26 时头文件的值被偏移过**：
 *   sin26=0x2A00(索引 42) · sin30=0x2E00(46) · sin50=0x4200(66) · sin53=0x4500(69)
 *   sin60=0x4C00(76) · sin61=0x4D00(77)
 * 规律：`索引 = NN ≤ 25 ? NN : NN + 16`（已对 sin01..sin31、sin50..sin62 逐条核对）。
 * **本文件一律写宏名、由此函数解码** —— 手抄"宏名 ↔ 算好的索引"两步极易出错
 *（曾据此把 `_Cross` 的 sin26..sin29 当成索引 26..29，导致 WS142/144 被错挂到通用背点）。
 */
const SIN_IDX = (nn: number): number => (nn <= 25 ? nn : nn + 16);
/** 族前缀 + `sinNN` 宏名 → idcode */
const sin = (fam: number, nn: number): number => fam | (SIN_IDX(nn) * 0x100);

/**
 * `dwItemCodeFromVillage[]`（11 职业版原文，**逐字照抄宏名**）→ setting 0 = 不挂背（留手上）：
 *   sinWC1 | sin01…sin25, sin26…sin30, sin60, sin61, sin53   ← 爪
 *   sinWM1 | sin01, sin02, sin03, sin06                      ← 法杖
 *   sinWS2 | sin01, sin02, sin03                             ← 剑（含名为 "Dagger"/"Sword Breaker" 的三件）
 *   sinWS1 | sin02, sin03, sin09, sin60 · sinWS2 | sin60     ← 手弩 + 两件 sin60
 */
export const SHEATHE_NONE_CODES: number[] = [
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
    26, 27, 28, 29, 30, 60, 61, 53].map((nn) => sin(FAM.CLAW, nn)),   // 爪
  ...[1, 2, 3, 6].map((nn) => sin(FAM.STAFF, nn)),                    // 法杖
  ...[1, 2, 3].map((nn) => sin(FAM.SWORD, nn)),                       // 剑 WS201/202/203
  ...[2, 3, 9, 60].map((nn) => sin(FAM.BOW, nn)),                     // 手弩 WS102/103/109 + sin60
  sin(FAM.SWORD, 60),                                                // sinWS2|sin60
];

/** `dwItemCodeFromVillage_Bow[]` → setting 2 → **"Bip in-cro"（弩背）**：
 *  `sinWS1 | sin04, sin08, sin10, sin13, sin17, sin20, sin61` */
export const SHEATHE_CROSS_CODES: number[] =
  [4, 8, 10, 13, 17, 20, 61].map((nn) => sin(FAM.BOW, nn));

/**
 * `dwItemCodeFromVillage_Cross[]` → setting 3 → **"Bip in-bow"（弓背）**：
 * `sinWS1 | sin01,05,06,07,11,12,14,15,16,18,19,21,22,23,24,25,26,27,28,29,53`
 * （8 职业版只到 `sin16`；WS119/WS121–125/WS142–145/WS169 因此曾被错落，**WS118 亦在此表**）
 */
export const SHEATHE_BOW_CODES: number[] = [
  1, 5, 6, 7, 11, 12, 14, 15, 16, 18, 19, 21, 22, 23, 24, 25, 26, 27, 28, 29, 53,
].map((nn) => sin(FAM.BOW, nn));

/**
 * 收械挂点槽位（**面向语义，不绑骨骼名**）。
 * 生成物里每件武器都显式带一个值；`weapon-loader.sheatheBone` 负责槽→骨骼。
 * `hand/back/bow/crossbow` 对应源码 `BackObjBip[0..2]` 与"留手上"；
 * `dagger_l/dagger_r` **不在源码的机制里**，见 `SHEATHE_FAMILY_RULES` 里匕首那条的说明。
 */
export type SheatheSlot = 'hand' | 'back' | 'bow' | 'crossbow' | 'dagger_l' | 'dagger_r';

/**
 * **族规则** —— 源码三张表是 2003 年的硬编码白名单，表外武器一律落到默认 `in01`（挂背）。
 * 之后新增的同族武器因此全部被挂上背：用户实测 `WC124/142/144/145`（高阶爪）都被当成了背挂。
 *
 * 只登记**整族语义无歧义**的族：爪是戴在手上的武器，不存在"背在背后"的形态。
 * 有歧义的族（锤/杖/剑等——族内本就既有挂手也有挂背）**不得**进入此表，
 * 那些只能逐码覆盖（`weapon-sheathe-overrides.json`）。
 *
 * `sheatheSlotFromSource` 仍与源码一一对应、不混入本表 —— provenance 必须分得开：
 * 源码表命中 = `character.cpp`，本表命中 = `family-rule`，都没有 = `default`(背)。
 */
export const SHEATHE_FAMILY_RULES: Array<{ family: number; slot: SheatheSlot; label: string }> = [
  { family: FAM.CLAW, slot: 'hand', label: '爪族' },
  // 刺客匕首（WD 族）→ **挂右腰**。这条**不是**源码判定，是照资产 + 用户实测定的：
  //  ① 源码两版的三张表里都没有匕首 → 按机制应落 `dwItemSetting` 默认 1 → `Bip in01`（背）。
  //  ② 但 m6（**仅刺客**模型）骨架里有 `Bip in_DaggerL` / `Bip in_DaggerR` 两根腰挂骨，
  //     两版 C++ 都没引用 —— "资产要求腰挂、代码路径表达不了"。
  //  ③ 原因已查明：刺客是**双持**（`SetTool`：`sinWD1 && JOB_CODE == JOBCODE_ASSASSINE`
  //     → 左手用 `szBipName_Assassin_LeftHand = "Bip weapon05"`；装备时
  //     `sinSetCharItem(CODE, LHAND)` + `(CODE, RHAND)` 两把一起显示），
  //     而通用的 `BackObjBip` 只有 1 个槽，**结构上无法表达"两把匕首各挂一侧"** ——
  //     这正是那两根腰挂骨存在、且只存在于刺客模型的原因。
  //  ④ 用户实测：刺客匕首收械应挂腰而非背。
  // 主手匕首 → 右腰；副手匕首 → 左腰（见 `WEAPON_BONES.SHEATHE_DAGGER_L`，由 WorldView 用）。
  // 若日后证实应为背挂，删掉本行即可（其余逻辑不变）。
  { family: 0x010a0000, slot: 'dagger_r', label: '刺客匕首(腰挂)' },
];

/** idcode → 族规则命中（无则 null） */
export function sheatheSlotFromFamily(idcode: number): { slot: SheatheSlot; label: string } | null {
  if (!idcode) return null;
  const fam = idcode & 0xffff0000;
  const hit = SHEATHE_FAMILY_RULES.find((r) => r.family === fam);
  return hit ? { slot: hit.slot, label: hit.label } : null;
}

/**
 * **源码表判定**（只回答"源码三张表里怎么说"）。
 * 未收录返回 null —— 由调用方依次再问族规则、最后显式写 'back' 并标 `src='default'`，
 * 不在这里藏隐式默认（用户要求：显式优于规则计算）。
 * 匕首的左右腰由挂点(pos)决定、不在这三张表里，故此处不涉及。
 */
export function sheatheSlotFromSource(idcode: number): SheatheSlot | null {
  if (!idcode) return null;
  if (SHEATHE_NONE_CODES.includes(idcode)) return 'hand';        // Village 表 = 留手上
  if (SHEATHE_CROSS_CODES.includes(idcode)) return 'crossbow';   // → "Bip in-cro"
  if (SHEATHE_BOW_CODES.includes(idcode)) return 'bow';          // → "Bip in-bow"
  return null;                                                   // 表外 → 交由调用方
}
