// src/maps/map-light.ts
// 每张地图的光照档案（忠实 C++ 客户端 field.cpp InitField State + HoSky.cpp MainSky 固定暗度表）。
// mode=fixed: 地牢/室内恒夜，无视昼夜（原版 BackImageCode=0、不画天空、DarkLevel 固定）；
// mode=daynight: 户外/村庄按游戏小时昼夜渐变；village 额外在夜间接暗（原版 playmain Color>>=1）。

export interface MapLightProfile {
  mode: 'daynight' | 'fixed';
  village: boolean;
  dark: number;                       // fixed 目标 DarkLevel
  back: [number, number, number];     // fixed BackColor
}

// 地牢/室内固定暗度表（HoSky.cpp MainSky；其余 DUNGEON/ROOM 默认 110/(0,0,0)）
// mapId: DarkLevel / BackColor(r,g,b)
const DUNGEON_FIXED: Record<number, [number, [number, number, number]]> = {
  22: [40, [0, 0, 0]],     // dun-4
  23: [40, [0, 0, 0]],     // dun-5
  24: [60, [0, 10, 40]],   // tcave
  25: [60, [10, 0, -20]],  // mcave
  26: [40, [0, 10, 40]],   // dcave
  40: [40, [0, 10, 40]],   // endless dun-7
  41: [40, [0, 10, 40]],   // endless dun-8
};
// DUNGEON(含 QUEST_ARENA 0x500)/ROOM：固定 110 纯黑
const DUNGEON_DEFAULT = new Set([13, 14, 15, 16, 32, 36, 42, 43]);
// 村庄（field.cpp State=VILLAGE，仅这两图），夜间地形色减半
const VILLAGE_IDS = new Set([3, 21]);

export function mapLightProfile(mapId: number): MapLightProfile {
  const f = DUNGEON_FIXED[mapId];
  if (f || DUNGEON_DEFAULT.has(mapId)) {
    const [dark, back] = f ?? [110, [0, 0, 0] as [number, number, number]];
    return { mode: 'fixed', village: false, dark, back };
  }
  return { mode: 'daynight', village: VILLAGE_IDS.has(mapId), dark: 0, back: [0, 0, 0] };
}
