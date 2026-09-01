/**
 * 地图目录：mapId → 碰撞网格 smd 相对路径（相对 /res/field/）。
 * 权威来源：服务端 FieldMap.java（对齐 EU C++ InitField() 顺序，mapId 0-43）。
 */
export const MAP_CATALOG: Record<number, string> = {
  0: 'forest/fore-3.smd',
  1: 'forest/fore-2.smd',
  2: 'forest/fore-1.smd',
  3: 'ricarten/village-2.smd',
  4: 'ruin/ruin-4.smd',
  5: 'ruin/ruin-3.smd',
  6: 'ruin/ruin-2.smd',
  7: 'ruin/ruin-1.smd',
  8: 'desert/de-1.smd',
  9: 'forest/village-1.smd',
  10: 'desert/de-2.smd',
  11: 'desert/de-3.smd',
  12: 'desert/de-4.smd',
  13: 'dungeon/dun-1.smd',
  14: 'dungeon/dun-2.smd',
  15: 'dungeon/dun-3.smd',
  16: 'room/office.smd',
  17: 'forever-fall/forever-fall-04.smd',
  18: 'forever-fall/forever-fall-03.smd',
  19: 'forever-fall/forever-fall-02.smd',
  20: 'forever-fall/forever-fall-01.smd',
  21: 'forever-fall/pilai.smd',
  22: 'dungeon/dun-4.smd',
  23: 'dungeon/dun-5.smd',
  24: 'cave/tcave.smd',
  25: 'cave/mcave.smd',
  26: 'cave/dcave.smd',
  27: 'iron/iron-1.smd',
  28: 'iron/iron-2.smd',
  29: 'ice/ice_ura.smd',
  30: 'sod/sod-1.smd',
  31: 'ice/ice1.smd',
  32: 'quest/quest_iv.smd',
  33: 'castle/castle.smd',
  34: 'greedy/greedy.smd',
  35: 'ice/ice_2.smd',
  36: 'boss/boss.smd',
  37: 'lost/lostisland.smd',
  38: 'losttemple/lost_temple.smd',
  39: 'fall_game/fall_game.smd',
  40: 'endless/dun-7.smd',
  41: 'endless/dun-8.smd',
  42: 'dungeon/dun-6a.smd',
  43: 'endless/dun-9.smd',
};

export function mapSmdPath(mapId: number): string | null {
  const rel = MAP_CATALOG[mapId];
  if (!rel) return null;
  return '/res/field/' + rel;
}
