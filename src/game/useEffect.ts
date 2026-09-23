/**
 * 「使用道具」的**表现种类** —— 决定 EAT 事件帧播哪张粒子、哪段音。
 *
 * 原版按 idcode 家族分派（`sinSubMain.cpp:737 sinUsePotion()` 返回 PotionKind，
 * `character.cpp:6336 switch (PotionLog)` 据此 `StartEffect` + `sinPlaySound`）：
 *
 *   `sinPL1`(0x0402) 生命药水 → `EFFECT_POTION1` = `Potion1.ini`（红 PartRed）
 *   `sinPM1`(0x0401) 魔法药水 → `EFFECT_POTION2` = `Potion2.ini`（蓝 PartBlue）
 *   `sinPS1`(0x0403) 体力药水 → `EFFECT_POTION3` = `Potion3.ini`（绿 PartGreen）
 *   `sinEC1`(0x0601) 以太核心 → `EFFECT_RETURN1` = `ReturnParticle1.ini` + `SKILL_SOUND_LEARN`
 *
 * 家族常量出处 `sinItem.h:75-82`；`EFFECT_*` 定义 `HoEffect.h:457-475`。
 * 家族值在我们 `itemDefs` 里实测对得上（0x0401=Mana / 0x0402=Life / 0x0403=Stamina / 0x0601=Ether Core）。
 *
 * 未列入的家族返回 null —— **不猜**（AGENTS #12：不编造数据；没有对应表现就不播）。
 */
export type UseEffectKind = 'potion1' | 'potion2' | 'potion3' | 'return' | null;

export function useEffectKindOf(idcode: number | null | undefined): UseEffectKind {
  if (!idcode) return null;
  switch ((idcode >>> 16) & 0xFFFF) {
    case 0x0402: return 'potion1';   // sinPL1 生命
    case 0x0401: return 'potion2';   // sinPM1 魔法
    case 0x0403: return 'potion3';   // sinPS1 体力
    case 0x0601: return 'return';    // sinEC1 以太核心
    default: return null;
  }
}

/** 种类 → 粒子 INI 名（`effect/animationdata/<名>.ini`） */
export const USE_EFFECT_INI: Record<Exclude<UseEffectKind, null>, string> = {
  potion1: 'Potion1',
  potion2: 'Potion2',
  potion3: 'Potion3',
  return: 'ReturnParticle1',
};

/**
 * 「右键使用、但**不播** EAT 动作」的物品家族 —— 服务端有使用分支、原版也不播吃药用动作的那些。
 *
 * 判据必须与服务端一一对应（这是同一条判据的两半，客户端必须知道"要不要发请求"，无法合并）：
 *   `0x0306` = 力量石     → `ForceOrbService.activate()`（走 USE，EU `netplay.cpp:2233` 的物品使用分支）
 *   `0x0802` = 怪物水晶   → 服务端 `ItemNetworkHandler.useCrystal()`（见下方 `SUPPORTED_CRYSTALS`）
 *   `0x080B` 的 34/35/36  → `AgeService.maxAgeKindOf()` 那三颗**一键拉满**石（原版同样走 USE，
 *                          目标由**服务端**挑当前装备 —— 见 AGENTS"一件拉满应由服务端判断"）
 *
 * ⚠ 为什么必须有它（真 bug）：`ItemPanel.onUseBag` 原来只在 `requestPlayEat()` 返回 true 时才发
 * `C2S_UseItem`，而这两族没有使用表现 → `requestPlayEat(null)` 返回 false → **右键毫无反应**
 * （连请求都不发，服务端日志里也什么都看不到）。
 * ⚠ 新增这类物品时，服务端分支与这里要一起加 —— `npm run verify-use-crystal` 会把两边的集合
 *   钉在一起（它直接读服务端的 `CrystalService.java`，不是各存一份名单）。
 */
export function useWithoutAnimation(idcode: number | null | undefined): boolean {
  if (!idcode) return false;
  const fam = (idcode >>> 16) & 0xFFFF;
  if (fam === 0x0306) return true;                       // 力量石（sinFO1）
  if (fam === 0x0802) return isSummonCrystal(idcode);    // 怪物水晶（sinGP1）——只认已实现的那几颗
  if (fam === 0x080B) {
    const sub = (idcode >>> 8) & 0xFF;
    return sub === 0x34 || sub === 0x35 || sub === 0x36; // 拉满石 A(武器)/B(盾·法球)/C(防具)
  }
  return false;
}

/**
 * **已实现**的怪物水晶码（`sinGP1 = 0x08020000` 族）。
 *
 * 来源 = 服务端 `CrystalService.CRYSTALS`（`modules/common-service/.../item/CrystalService.java`），
 * 一份分派表两个消费者：服务端据此决定召哪只怪，客户端据此决定"右键要不要发请求"。
 * 未列入的水晶（GP114-116 城堡兵、GP117-121/125 事件档、GP2xx 灵魂石）**右键不发请求** ——
 * 与服务端一致（服务端对它们走 `chat.cmd.useItemUnsupported` 兜底，不会误消耗）。
 *
 * ⚠ 改这里必须同时改服务端的表：`npm run verify-use-crystal` 会比对两边（含 `MYSTIC_CRYSTAL` 常量）。
 */
export const SUPPORTED_CRYSTALS: readonly number[] = [
  0x08020100, // GP101 独角兽水晶        Hopy
  0x08020200, // GP102 魔兽兵水晶        Hobgoblin
  0x08020300, // GP103 浮灵水晶          Decoy
  0x08020400, // GP104 刀斧手水晶        Bargon
  0x08020500, // GP105 魔剑士水晶        Head Cutter
  0x08020600, // GP106 火灵王水晶        Figon
  0x08020700, // GP107 独角兽王水晶      King Hopy
  0x08020800, // GP108 绿巨人水晶        Hulk
  0x08020900, // GP109 神秘水晶（随机）  Mystic
  0x08020A00, // GP110 守护圣徒水晶      Guardian Saint
  0x08020B00, // GP111 大头蜘蛛水晶      Web
  0x08020C00, // GP112 鬼影魔神水晶      Dark Specter
  0x08020D00, // GP113 铁甲狂魔水晶      Iron Guard
];

export function isSummonCrystal(idcode: number | null | undefined): boolean {
  return !!idcode && SUPPORTED_CRYSTALS.includes(idcode);
}
