/**
 * 地图目录唯一数据源：读取同目录 fields.json（与 jpstale-server resources 同一生成文件）。
 * fields.json = 纯数组，EU MapGame.cpp 生成；z = -(MapGame rawZ)，正北为正。
 * name/levelReq 等由服务端 DB 控制；本文件只含静态 field 数据。
 */
import raw from './fields.json';

export interface FieldGate {
  to: number
  x: number
  z: number
}

export interface WarpDestination {
  map: number
  x: number
  z: number
  y: number
  level: number
}

export interface WarpGate {
  x: number
  z: number
  y: number
  size: number
  height: number
  mode: number
  destinations: WarpDestination[]
}

export interface StageObject {
  model: string
  bip: boolean
}

export interface FieldInfo {
  id: number
  shortname: string
  model: string
  minimap: string | null
  center: number[]
  startPoints: number[][]
  fieldGates: FieldGate[]
  warpGates: WarpGate[]
  stageObjects: StageObject[]
}

export const FIELDS: FieldInfo[] = raw as FieldInfo[];

const BY_ID = new Map<number, FieldInfo>();
for (const f of FIELDS) BY_ID.set(f.id, f);

export function fieldOf(mapId: number): FieldInfo | null {
  return BY_ID.get(mapId) ?? null;
}

/** 碰撞网格相对 /res/field/ 的路径 */
export function fieldSmdPath(mapId: number): string | null {
  return fieldOf(mapId)?.model ?? null;
}

/** 小地图 tile 基名（field/map/{base}.tga）；无小地图为 null */
export function minimapBase(mapId: number): string | null {
  return fieldOf(mapId)?.minimap ?? null;
}

/** 兼容旧 map-catalog：mapId -> smd 相对路径 */
export const MAP_CATALOG: Record<number, string> = {};
for (const f of FIELDS) MAP_CATALOG[f.id] = f.model;

export function mapSmdPath(mapId: number): string | null {
  const rel = MAP_CATALOG[mapId];
  return rel ? '/res/field/' + rel : null;
}

/** 双向相邻关系（fieldGates = 可走图边界，忽略 to==self） */
function adjacency(): Map<number, number[]> {
  const adj = new Map<number, number[]>();
  const add = (a: number, b: number) => {
    if (a === b) return;
    let l = adj.get(a);
    if (!l) adj.set(a, l = []);
    if (!l.includes(b)) l.push(b);
  };
  for (const f of FIELDS) {
    for (const g of f.fieldGates) {
      add(f.id, g.to);
      add(g.to, f.id);
    }
  }
  return adj;
}

const ADJ = adjacency();

/** 某地图所有相邻 field id（无相邻返回空数组） */
export function neighborMaps(mapId: number): number[] {
  return ADJ.get(mapId) ?? [];
}
