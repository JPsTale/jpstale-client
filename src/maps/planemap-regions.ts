/**
 * 大地图的层级与分组。
 *
 * **世界图（大陆）不分区**（用户 2026-09-15 定：*"大陆分区域是个很傻的行为，应该直接每个地图
 * 可以单独点击查看"*）—— 世界图上每张地图**单独可点**，点进就是那张图。
 *
 *   · **世界图成员** = "原版给了独立 guide-map 贴图"的那 26 张（`s_lpFzmINamePtrBuff` 里非 `@4`
 *     的条目；`@4` 那 5 个洞穴区域原版直接写 "Guide map isn't provided in this area."）。
 *     实测这 26 张两两包围盒间隙 <= 200 world 单位，是**紧贴的一整块大陆**，拼起来无缝。
 *   · **世界图之外的 37 张**（副本/洞窟/竞技场/新区域）在世界坐标上要么与野外图**重叠**
 *     （`ba2`/`seab` 重叠 95%、`ice2`/`boss` 85%），要么被丢在很远的地方 —— 它们不上世界图，
 *     所以按家族/类型分组，从**左栏**进入（组视图是把该组成员按世界坐标平铺）。
 *     家族的划分由用户指定（古代监狱/诅咒神殿/黑暗神殿/无尽之塔 F1~F3 各算一组）。
 */

/** 大陆（世界图的主体）：世界图上每张单独可点 */
export const WORLD_MAP_IDS: number[] = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, // 森林一~三 / 里查顿城 / 废墟一~四 / 沙漠一~四 / 纳维斯科
  17, 18, 19, 20, 21,                        // 永恒之林四张 + 菲拉伊镇
  27, 28,                                    // 混沌铁路 / 佩鲁姆之心
  29, 31, 34, 35,                            // 艾拉 / 加鲁比亚峡谷 / 贪婪之湖 / 冰封圣殿
  // #36 凯尔维祖巢穴 不在这里 —— 用户 2026-09-15 定为**独立地图**（见下）；
  // #37 迷失之岛 / #38 失落神殿 也不在这里 —— 定为独立区域「迷失岛」（见下）
];

export interface OffworldGroup {
  id: string;
  /** 显示名（我们起的，可改） */
  name: string;
  /**
   * 是否**野外**（玩家默认就能在大地图上看到这一层）。
   *
   * 依据 = 原版 `gamedb.maplist.typemap`：野外类型是
   * `Grasslands / Forests / Deserts / Wastelands / Iron Lands / Ice Lands / Cities / Islands`；
   * `Underworld / Special Maps / Quest Map / Underwater / GM Room` 都不是野外（副本/战场/特殊）。
   *
   * 非野外的层级**只在玩家身处其中时**才出现在侧栏（用户 2026-09-15 定，见 docs/worldmap.md）。
   */
  wild: boolean;
  mapIds: number[];
  /** 依据/备注，显示在界面上方便复核 */
  note?: string;
}

/** 世界图之外的分组（只在左栏出现） */
export const OFFWORLD_GROUPS: OffworldGroup[] = [
  { id: 'lostisle', name: '迷失岛', wild: true, mapIds: [37, 38], note: '迷失之岛 + 失落神殿（typemap=Islands，野外）' },
  { id: 'prison', name: '古代监狱', wild: false, mapIds: [13, 14, 15], note: 'F1~F3 / dun-1/2/3（typemap=Underworld）' },
  { id: 'cursedtemple', name: '诅咒神殿', wild: false, mapIds: [22, 23, 42], note: 'F1~F3 / dun-4/5/6（Underworld）' },
  { id: 'darktemple', name: '黑暗神殿', wild: false, mapIds: [24, 25, 26], note: '蘑菇洞 / 蜂窝洞 / 黑暗圣殿（Underworld）' },
  { id: 'endlesstower', name: '无尽之塔', wild: false, mapIds: [40, 41, 43], note: 'F1~F3 / dun-7/8/9（Underworld）' },
  // typemap 说它是 Special Maps（与贝拉塔同类战场），**不是**野外 —— 与用户 2026-09-15 的裁定一致
  { id: 'blessedcastle', name: '祝福城堡', wild: false, mapIds: [33], note: 'castle（typemap=Special Maps，非野外）' },
  {
    id: 'kelvezu', name: '凯尔维祖巢穴', wild: false, mapIds: [36],
    note: '独立地图（用户 2026-09-15 定为非野外；注意 typemap=Ice Lands 是野外类型，这里按用户裁定）。'
      + '世界坐标落在冰封圣殿范围内（从圣殿内部进入），不画在世界图上以免压住圣殿那块',
  },
  { id: 'battlefields', name: '竞技场与战场', wild: false, mapIds: [30, 32, 39, 59, 60, 62], note: '贝拉塔 / 竞技场 / 坠落之地 / 海底深渊' },
  {
    id: 'federation', name: '神秘联邦', wild: true, mapIds: [45, 46, 47, 48, 49, 50, 51, 52],
    note: '亚特兰蒂斯城 / 战斗之城 / 神秘森林一~三 / 神秘沙漠一~三'
      + '（Atlantis Town / Battle Town / Mystery Forest 1-3 / Mystery Desert 1-3；用户 2026-09-15 定为独立区域，'
      + '即 custom 的 town1/fo1-3/ba1-4）',
  },
  { id: 'newworlds', name: '新区域', wild: false, mapIds: [44, 53, 54, 55, 56, 57, 58, 61], note: '冰矿山1F / 遗忘神殿一~二 / 古代地牢一~三 / 远古兵器 / 秘密实验室' },
  { id: 'misc', name: '特殊', wild: false, mapIds: [16], note: '棋房（typemap=GM Room）' },
];

/**
 * **大陆本身也是一个层级**（不是"整个世界"）——用户 2026-09-15 纠正：
 * *"大陆不等于世界地图。你现在搞了一个大陆出来把所有野外地图全展示了。"*
 *
 * 层级结构（照 FF14 的 区域 → 城市 → 世界地图）：
 *   · **世界**（顶层）= 所有野外地图放在同一套世界坐标里 → `wildMapIds()`
 *   · **区域层** = `大陆` / `迷失岛` / `神秘联邦`（野外的），以及副本家族（非野外）
 *   · **地图** = 单张
 * 一张野外图的"上级地图" = 它所属的那个区域（在里查顿 → 大陆；在亚特兰蒂斯 → 神秘联邦）。
 */
export const CONTINENT_GROUP: OffworldGroup = {
  id: 'continent',
  name: '大陆',
  wild: true,
  mapIds: WORLD_MAP_IDS,
  note: '世界图的主体：森林/废墟/沙漠/永恒之林/铁路/冰原/贪婪之湖 一带',
};

/** 所有层级（含大陆）：`OFFWORLD_GROUPS` 是"大陆之外"的那些 */
export const ALL_LAYERS: OffworldGroup[] = [CONTINENT_GROUP, ...OFFWORLD_GROUPS];

/** **世界层**该画哪些图 = 所有**野外**（大陆 + wild 家族）。副本/战场永不进世界图。 */
export function wildMapIds(): number[] {
  return ALL_LAYERS.filter((g) => g.wild).flatMap((g) => g.mapIds);
}

/** 这张图是不是野外（在世界图上、玩家默认能看到） */
export function isWildMap(mapId: number): boolean {
  return ALL_LAYERS.some((g) => g.wild && g.mapIds.includes(mapId));
}

const LAYER_BY_MAP = new Map<number, OffworldGroup>();
for (const g of ALL_LAYERS) for (const id of g.mapIds) LAYER_BY_MAP.set(id, g);

/** 这张图属于哪个层级（大陆地图 → 大陆；副本 → 它那个家族） */
export function layerOf(mapId: number): OffworldGroup | null {
  return LAYER_BY_MAP.get(mapId) ?? null;
}

export function groupById(id: string | null): OffworldGroup | null {
  return ALL_LAYERS.find((g) => g.id === id) ?? null;
}

/** 自检：大陆 / 分组必须不重不漏地覆盖所有地图 */
export function checkGroups(allIds: number[]): string[] {
  const problems: string[] = [];
  const seen = new Set<number>();
  for (const id of WORLD_MAP_IDS) {
    if (seen.has(id)) problems.push(`地图 ${id} 在世界图里出现两次`);
    seen.add(id);
  }
  for (const g of OFFWORLD_GROUPS) {
    for (const id of g.mapIds) {
      if (seen.has(id)) problems.push(`地图 ${id} 同时属于世界图和分组 ${g.id}`);
      seen.add(id);
    }
  }
  for (const id of allIds) if (!seen.has(id)) problems.push(`地图 ${id} 既不在世界图也不在任何分组`);
  for (const id of seen) if (!allIds.includes(id)) problems.push(`引用了不存在的地图 ${id}`);
  return problems;
}
