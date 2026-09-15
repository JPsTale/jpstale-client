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

/** 世界图（大陆）成员：世界图上每张单独可点 */
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
  mapIds: number[];
  /** 依据/备注，显示在界面上方便复核 */
  note?: string;
}

/** 世界图之外的分组（只在左栏出现） */
export const OFFWORLD_GROUPS: OffworldGroup[] = [
  { id: 'lostisle', name: '迷失岛', mapIds: [37, 38], note: '迷失之岛 + 失落神殿（用户 2026-09-15 定为独立区域）' },
  { id: 'prison', name: '古代监狱', mapIds: [13, 14, 15], note: 'F1~F3（dun-1/2/3）' },
  { id: 'cursedtemple', name: '诅咒神殿', mapIds: [22, 23, 42], note: 'F1~F3（dun-4/5/6）' },
  { id: 'darktemple', name: '黑暗神殿', mapIds: [24, 25, 26], note: '蘑菇洞 / 蜂窝洞 / 黑暗圣殿（tcave/mcave/dcave）' },
  { id: 'endlesstower', name: '无尽之塔', mapIds: [40, 41, 43], note: 'F1~F3（dun-7/8/9）' },
  { id: 'blessedcastle', name: '祝福城堡', mapIds: [33], note: 'castle（原版的 @4 洞穴图）' },
  {
    id: 'kelvezu', name: '凯尔维祖巢穴', mapIds: [36],
    note: '独立地图（用户 2026-09-15）。它的世界坐标落在冰封圣殿范围内 —— 游戏里是从圣殿内部进去的，'
      + '所以与圣殿共用坐标；不画在世界图上（会压住圣殿那块）',
  },
  { id: 'battlefields', name: '竞技场与战场', mapIds: [30, 32, 39, 59, 60, 62], note: '贝拉塔 / 竞技场 / 坠落之地 / 海底深渊' },
  {
    id: 'federation', name: '神秘联邦', mapIds: [45, 46, 47, 48, 49, 50, 51, 52],
    note: '亚特兰蒂斯城 / 战斗之城 / 神秘森林一~三 / 神秘沙漠一~三'
      + '（Atlantis Town / Battle Town / Mystery Forest 1-3 / Mystery Desert 1-3；用户 2026-09-15 定为独立区域，'
      + '即 custom 的 town1/fo1-3/ba1-4）',
  },
  { id: 'newworlds', name: '新区域', mapIds: [44, 53, 54, 55, 56, 57, 58, 61], note: '冰矿山1F / 遗忘神殿一~二 / 古代地牢一~三 / 远古兵器 / 秘密实验室' },
  { id: 'misc', name: '特殊', mapIds: [16], note: '棋房（GM 房间）' },
];

const GROUP_BY_MAP = new Map<number, OffworldGroup>();
for (const g of OFFWORLD_GROUPS) for (const id of g.mapIds) GROUP_BY_MAP.set(id, g);

/** 这张图在世界图之外的哪个分组；大陆地图返回 null */
export function offworldGroupOf(mapId: number): OffworldGroup | null {
  return GROUP_BY_MAP.get(mapId) ?? null;
}

export function groupById(id: string | null): OffworldGroup | null {
  return OFFWORLD_GROUPS.find((g) => g.id === id) ?? null;
}

/** 自检：世界图与分组必须不重不漏地覆盖所有地图 */
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
