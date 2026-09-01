/**
 * 地图门数据（移植自 /pt/maps/ GATES，源自 field.cpp InitField() AddGate/AddWarpOutGate）。
 * 门坐标是全局 world 坐标（与出生点一致：world = 原值，不除 256）。
 * from/to = 地图 id；x/z/y = 门位置（world）；warp = 传送门（true）或普通门（false）。
 */
export interface Gate {
  from: number;
  to: number;
  x: number;
  z: number;
  y: number;
  warp?: boolean;
}

export const MAP_GATES: Gate[] = [
  { from: 0, to: 1, x: -8508, z: -10576, y: 0 },
  { from: 1, to: 2, x: -292, z: -9548, y: 0 },
  { from: 1, to: 1, x: -3408, z: -12447, y: 251, warp: true },
  { from: 2, to: 4, x: 4844, z: -6835, y: 0 },
  { from: 2, to: 3, x: 2275, z: -14828, y: 0 },
  { from: 3, to: 3, x: 734, z: -20119, y: 312, warp: true },
  { from: 4, to: 5, x: 410, z: 4902, y: 0 },
  { from: 5, to: 6, x: 3051, z: 16124, y: 0 },
  { from: 6, to: 7, x: 10019, z: 18031, y: 0 },
  { from: 6, to: 17, x: 4470, z: 27774, y: 0 },
  { from: 6, to: 34, x: 12713, z: 23409, y: 0 },
  { from: 6, to: 6, x: 4428, z: 22511, y: 845, warp: true },
  { from: 7, to: 8, x: 13319, z: 7102, y: 0 },
  { from: 7, to: 13, x: 16809, z: 15407, y: 501, warp: true },
  { from: 8, to: 10, x: 13466, z: -5953, y: 0 },
  { from: 8, to: 9, x: 20041, z: -892, y: 0 },
  { from: 9, to: 11, x: 27110, z: -479, y: 0 },
  { from: 9, to: 30, x: 21840, z: 1062, y: 0 },
  { from: 9, to: 9, x: 16809, z: 15407, y: 501, warp: true },
  { from: 11, to: 12, x: 34372, z: 4277, y: 0 },
  { from: 11, to: 22, x: 35872, z: -2016, y: 804, warp: true },
  { from: 12, to: 27, x: 44545, z: 13063, y: 0 },
  { from: 12, to: 12, x: 34100, z: 6214, y: 940, warp: true },
  { from: 13, to: 7, x: 16649, z: 15238, y: 501, warp: true },
  { from: 13, to: 14, x: -6027, z: -26881, y: 99, warp: true },
  { from: 14, to: 13, x: -15314, z: -28718, y: 58, warp: true },
  { from: 14, to: 15, x: 1810, z: -28802, y: 0, warp: true },
  { from: 14, to: 15, x: 1810, z: -28802, y: 0, warp: true },
  { from: 15, to: 14, x: -8176, z: -25775, y: 77, warp: true },
  { from: 15, to: 14, x: -3738, z: -27990, y: 73, warp: true },
  { from: 17, to: 18, x: -2949, z: 40442, y: 0 },
  { from: 18, to: 19, x: -2349, z: 49830, y: 0 },
  { from: 18, to: 18, x: -4615, z: 48002, y: 1146, warp: true },
  { from: 18, to: 25, x: 119025, z: 35680, y: 499, warp: true },
  { from: 19, to: 20, x: 667, z: 59371, y: 0 },
  { from: 20, to: 21, x: -8508, z: -10576, y: 0 },
  { from: 20, to: 21, x: 1993, z: 73134, y: 449, warp: true },
  { from: 21, to: 20, x: 1958, z: 70922, y: 536, warp: true },
  { from: 21, to: 21, x: 2252, z: 78041, y: 754, warp: true },
  { from: 22, to: 11, x: 35872, z: -2016, y: 804, warp: true },
  { from: 22, to: 23, x: -2527, z: -37196, y: 727, warp: true },
  { from: 22, to: 23, x: -3669, z: -36444, y: 727, warp: true },
  { from: 22, to: 23, x: -4795, z: -37198, y: 727, warp: true },
  { from: 23, to: 22, x: -12073, z: -40701, y: 95, warp: true },
  { from: 23, to: 22, x: -12073, z: -40701, y: 95, warp: true },
  { from: 23, to: 22, x: -12073, z: -40701, y: 95, warp: true },
  { from: 23, to: 42, x: -3650, z: -45312, y: 116, warp: true },
  { from: 23, to: 42, x: -3668, z: -50022, y: 3, warp: true },
  { from: 23, to: 42, x: -3650, z: -45312, y: 116, warp: true },
  { from: 23, to: 42, x: -3668, z: -50022, y: 3, warp: true },
  { from: 24, to: 26, x: 158627, z: 20504, y: 240, warp: true },
  { from: 24, to: 0, x: -16490, z: -6930, y: 298, warp: true },
  { from: 25, to: 26, x: 158543, z: 19557, y: 290, warp: true },
  { from: 25, to: 18, x: -6056, z: 43245, y: 787, warp: true },
  { from: 26, to: 25, x: 124396, z: 33291, y: 37, warp: true },
  { from: 26, to: 24, x: 125566, z: 24825, y: 480, warp: true },
  { from: 27, to: 28, x: 45316, z: 21407, y: 0 },
  { from: 28, to: 29, x: 33618, z: 24011, y: 0 },
  { from: 29, to: 31, x: 31848, z: 27225, y: 0 },
  { from: 29, to: 29, x: 30610, z: 22164, y: 1304, warp: true },
  { from: 31, to: 35, x: 33729, z: 38029, y: 0 },
  { from: 35, to: 31, x: 35364, z: 39518, y: 0 },
  { from: 35, to: 36, x: 33000, z: 50036, y: 1512, warp: true },
  { from: 36, to: 35, x: 37971, z: 50460, y: 1209, warp: true },
  { from: 37, to: 38, x: -11586, z: 7704, y: 0 },
  { from: 37, to: 37, x: -12555, z: -1113, y: 668, warp: true },
  { from: 33, to: 33, x: 32739, z: -30474, y: 711, warp: true },
  { from: 39, to: 21, x: 2981, z: 75486, y: 0, warp: true },
  { from: 39, to: 21, x: 2981, z: 75486, y: 0, warp: true },
  { from: 39, to: 39, x: 9992, z: 36750, y: 830, warp: true },
  { from: 39, to: 39, x: 7254, z: 36750, y: 830, warp: true },
  { from: 40, to: 41, x: 5255, z: -37897, y: 86, warp: true },
  { from: 40, to: 38, x: -12272, z: 11299, y: 509, warp: true },
  { from: 41, to: 40, x: 14242, z: -41199, y: 220, warp: true },
  { from: 41, to: 43, x: 4896, z: -42220, y: 202, warp: true },
  { from: 41, to: 43, x: 6408, z: -42220, y: 202, warp: true },
  { from: 42, to: 23, x: -2851, z: -43792, y: 642, warp: true },
  { from: 42, to: 23, x: -4422, z: -43801, y: 642, warp: true },
  { from: 42, to: 23, x: -2851, z: -43792, y: 642, warp: true },
  { from: 42, to: 23, x: -4422, z: -43801, y: 642, warp: true },
  { from: 43, to: 41, x: 5254, z: -41361, y: 139, warp: true },
  { from: 43, to: 41, x: 5254, z: -41361, y: 139, warp: true },
  { from: 0, to: 24, x: -16638, z: -6737, y: 267, warp: true },
];

/**
 * 地图相邻关系（离线计算）：从普通门（非 warp）推导，双向。
 * warp 门是传送门（self-warp / 跨区传送），不构成常规相邻；普通门才是相邻可走的地图。
 * 返回 Map<mapId, number[]>（mapId → 相邻图 id 列表）。
 */
export function buildAdjacency(): Map<number, number[]> {
  const adj = new Map<number, number[]>();
  const add = (a: number, b: number) => {
    if (a === b) return;
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.get(a)!.includes(b)) adj.get(a)!.push(b);
  };
  for (const g of MAP_GATES) {
    if (g.warp) continue;
    add(g.from, g.to);
    add(g.to, g.from);
  }
  return adj;
}

/** 某地图的所有相邻图 id（无相邻返回空数组） */
export function neighborMaps(mapId: number): number[] {
  return buildAdjacency().get(mapId) || [];
}

