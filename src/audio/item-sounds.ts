/**
 * 物品音效：`gamedb.itemlist.sound`（= 原版 `sItem.SoundIndex`）→ `wav/effects/items/*.wav`。
 *
 * 索引定义（原版权威）：`NewSourcePT-2023/SrcGame/src/sinbaram/sinItem.h:262-286` 的 `SIN_SOUND_*`
 * 与**同项目 `sinSubMain.cpp` 的 `sinSoundWav[]` 表**（那张表逐项给出文件名，是本文件的第二证人）：
 *   0 界面(interface-on，UI 用，见 sfx.ts) 1 斧 2 爪 3 锤 4 魔法材料 5 枪 6 弓 7 剑 8 标枪
 *   9 甲 10 靴 11 护手 12 盾 13 项链 14 护腕 15 戒指 16 宝石 17 药水 18 金币 19 法杖
 *   20 喝药 21 界面 22 修理 23 合成失败 24 甲(女版 Armor-w) 25 喝药2
 *
 * 用法：拿起/放下/装备/丢弃时 `playItemSound(def.sound)` —— 原版在这些位置一律
 * `sinPlaySound(pItem->SoundIndex)`（`sinInvenTory.cpp` 多处），所以**音效来自物品本身**，不按位置另配。
 * 丢弃另有专用音 `item drop.wav`（原版 `ThrowInvenItemToField`）。
 * ⚠ 失败（拿起/放下/交换/拾取被拒）**不是**这里的音，见 `sfx.ts` 的 `denied`。
 */
import { sfx } from './sfx.js';

/**
 * 相对路径（**不带 `/res/`**）：`sfx.play()` 内部会自己拼 `RES_BASE = '/res/'`
 * （`sfx.ts` 的 `loadBuffer`：`fetch(encodeAssetPath(RES_BASE + path))`）。
 * 这里曾写成 `'/res/wav/effects/items/'` ⇒ 实际请求 `/res//res/wav/...` ⇒ 404 ⇒
 * `loadBuffer` 静默 `return null` ⇒ **道具音从来没响过**（用户 2026-09-14 报"点击背包道具没声音"，
 * 此前听得到的其实只有那条错配的 UI 点击音）。同类"双前缀"错误一律按此改。
 */
const DIR = 'wav/effects/items/';

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
  24: 'armor-w.wav',   // 原版 `sinSoundWav[24] = Armor-w.wav`（另一套甲音，女版）——此前按"男女取男版"猜成 armor-m ✗
  25: 'drink2.wav',
};

/** 物品被丢到地面时的音（原版 ThrowInvenItemToField 专用，不在 SoundIndex 表内） */
export const ITEM_DROP_FILE = 'item drop.wav';

/**
 * 播物品音效（按物品自带的 SoundIndex）。
 *
 * **每一次都留日志**（用户 2026-09-14 要求"能加 log 吗"）：这类"没声音"最难查的地方在于
 * "没播"和"播了但取不到文件"在界面上完全一样 —— 所以入口打印"索引 → 文件"，
 * 拿不到文件时**不是静默 return**，而是 `console.warn` 说明原因（AGENTS #12：不静默）。
 * `soundIndex == 0` 是**原版的"无音"约定**（0 号音是 UI 的 interface-on，不进道具表），不算异常。
 */
export function playItemSound(soundIndex: number | null | undefined): void {
  if (soundIndex == null || soundIndex === 0) {
    console.log('[sfx] 道具音：该物品没有 SoundIndex（sound=', soundIndex, '）→ 不播');
    return;
  }
  const f = ITEM_SOUND_FILES[soundIndex];
  if (!f) {
    console.warn('[sfx] 道具音：SoundIndex=' + soundIndex + ' 在 ITEM_SOUND_FILES 里没有对应文件 → 不播'
      + '（要么该索引在本项目资产里不存在，要么表漏了一项）');
    return;
  }
  console.log('[sfx] 道具音 SoundIndex=' + soundIndex + ' → ' + DIR + f);
  sfx.play(DIR + f);
}

/** 播"丢到地面"音 */
export function playItemDropSound(): void {
  console.log('[sfx] 丢弃音 → ' + DIR + ITEM_DROP_FILE);
  sfx.play(DIR + ITEM_DROP_FILE);
}
