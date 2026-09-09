// 安全区（村庄）静态表：服务端 enterGame 时下发全量表，客户端本地换图时查。
// 未知地图保守按"非村庄"处理（保持战斗姿态，不影响打怪动画）。
let safeMapTable: ReadonlySet<number> | null = null;

export function setSafeMaps(maps: Array<{ mapId?: number; isSafe?: boolean }> | null | undefined): void {
  if (!maps || maps.length === 0) {
    safeMapTable = null;
    return;
  }
  const ids = new Set<number>();
  for (const m of maps) {
    if (m.isSafe && m.mapId != null) ids.add(m.mapId);
  }
  safeMapTable = ids;
}

export function isSafeMap(mapId: number): boolean {
  return safeMapTable?.has(mapId) ?? false;
}