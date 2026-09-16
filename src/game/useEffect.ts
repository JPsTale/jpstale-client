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
