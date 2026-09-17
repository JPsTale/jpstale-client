// 安全区（村庄）静态表：服务端 enterGame 时下发全量表，客户端本地换图时查。
// 未知地图保守按"非村庄"处理（保持战斗姿态，不影响打怪动画）。
let safeMapTable: ReadonlySet<number> | null = null;
/** 地图进入等级门槛（gamedb.maplist.levelreq 原样下发，0=无门槛、>=150=未开放） */
let mapLevelReq: ReadonlyMap<number, number> | null = null;

/** 门槛 = 未开放的哨兵值（与原版 `FieldLimitLevel_Table` 的 1000 同义；我们用 150，满级约 148） */
export const MAP_LEVEL_LOCKED = 150;

export function setSafeMaps(
  maps: Array<{ mapId?: number; isSafe?: boolean; levelReq?: number }> | null | undefined,
): void {
  if (!maps || maps.length === 0) {
    safeMapTable = null;
    mapLevelReq = null;
    return;
  }
  const ids = new Set<number>();
  const reqs = new Map<number, number>();
  for (const m of maps) {
    if (m.mapId == null) continue;
    if (m.isSafe) ids.add(m.mapId);
    reqs.set(m.mapId, m.levelReq ?? 0);
  }
  safeMapTable = ids;
  mapLevelReq = reqs;
}

/**
 * 该图的进入等级门槛；未下发过该图 → null（**未知不拦**：宁可不挡，也不要凭空挡住玩家）。
 * 与主服务端 `MapManager.canEnter` 同一份数据、同一套语义（0=无门槛 / >=150=未开放）。
 */
export function mapLevelRequirement(mapId: number): number | null {
  return mapLevelReq?.get(mapId) ?? null;
}

/** 等级够不够进该图；返回 'ok' | 'level' | 'locked' | 'unknown' */
export function canEnterMap(mapId: number, level: number): 'ok' | 'level' | 'locked' | 'unknown' {
  const req = mapLevelRequirement(mapId);
  if (req == null) return 'unknown';
  if (req >= MAP_LEVEL_LOCKED) return 'locked';
  return level >= req ? 'ok' : 'level';
}

export function isSafeMap(mapId: number): boolean {
  return safeMapTable?.has(mapId) ?? false;
}