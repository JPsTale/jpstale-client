/**
 * 物品音效：`gamedb.itemlist.sound`（= 原版 `sItem.SoundIndex`）→ `wav/effects/items/*.wav`。
 *
 * 索引定义（原版权威）：`NewSourcePT-2023/SrcGame/src/sinbaram/sinItem.h:262-286` 的 `SIN_SOUND_*`：
 *   1 斧 2 爪 3 锤 4 魔法材料 5 枪 6 弓 7 剑 8 标枪 9 甲 10 靴 11 护手 12 盾
 *   13 项链 14 护腕 15 戒指 16 宝石 17 药水 18 金币 19 法杖 20 喝药
 *   21 界面 22 修理 23 合成失败 24 甲(第二套) 25 喝药2
 * 文件对应关系用**资产目录反查**确定（`client/wav/effects/items/` 28 个 wav 与上面的语义名逐一吻合）。
 *
 * 用法：拿起/放下/装备/丢弃时 `playItemSound(def.sound)` —— 原版在这些位置一律
 * `sinPlaySound(pItem->SoundIndex)`（`sinInvenTory.cpp` 多处），所以**音效来自物品本身**，不按位置另配。
 * 丢弃另有专用音 `item drop.wav`（原版 `ThrowInvenItemToField`）。
 */
import { sfx } from './sfx.js';

const DIR = '/res/wav/effects/items/';

/** SoundIndex → 文件名（与 sinItem.h 的 SIN_SOUND_* 对应；目录里没有对应文件的索引不列） */
export const ITEM_SOUND_FILES: Record<number, string> = {
  1: 'axes.wav',
  2: 'claws.wav',
  3: 'hammer.wav',
  4: 'magicial_stuffs.wav',
  5: 'poles.wav',
  6: 'shooters.wav',
  7: 'swords.wav',
  8: 'throwing.wav',
  9: 'armor.wav',
  10: 'boots.wav',
  11: 'gloves.wav',
  12: 'shields.wav',
  13: 'amulet.wav',
  14: 'armlet.wav',
  15: 'ring.wav',
  16: 'sheltom.wav',
  17: 'potion.wav',
  18: 'coin.wav',
  19: 'magicial_weapon.wav',
  20: 'drink1.wav',
  21: 'interface.wav',
  22: 'repair.wav',
  23: 'sheltom-failure.wav',
  24: 'armor-m.wav',   // SIN_SOUND_ARMOR2：另一套甲音（资产里分 m/w 两版，取男版；女版 armor-w.wav）
  25: 'drink2.wav',
};

/** 物品被丢到地面时的音（原版 ThrowInvenItemToField 专用，不在 SoundIndex 表内） */
export const ITEM_DROP_FILE = 'item drop.wav';

/** 播物品音效（按物品自带的 SoundIndex；没有索引就不播，不猜别的音） */
export function playItemSound(soundIndex: number | null | undefined): void {
  const f = soundIndex == null ? undefined : ITEM_SOUND_FILES[soundIndex];
  if (!f) return;
  sfx.play(DIR + f);
}

/** 播"丢到地面"音 */
export function playItemDropSound(): void {
  sfx.play(DIR + ITEM_DROP_FILE);
}
