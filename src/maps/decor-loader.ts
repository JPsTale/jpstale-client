/**
 * 装饰模型加载器：parseSmb 读装饰 .smd（MODEL 0.62），
 * 复刻原版 smOBJ3D::WorldForm（顶点 × mWorld 变换到世界坐标），纯色材质渲染。
 * 材质逆向/动画装饰为后续工作（见 docs/plans/2026-09-01-map-decor-objects.md）。
 */
import * as THREE from 'three';
import { parseSmb } from '../core/char-parser.js';
import { cachedFetch } from '../core/asset-cache.js';
import type { DecorEntry } from './map-decor.js';
import { DECOR_PATHS } from './decor-paths.js';

// 装饰 ASE 路径 → 客户端 .smd 路径：按文件名反查（客户端打包分散，不能靠目录转换）
export function decorSmdPath(asePath: string): string | null {
  const file = asePath.replace(/\\/g, '/').split('/').pop()!.replace(/\.ase$/i, '').toLowerCase();
  return DECOR_PATHS[file] || null;
}

/** 地图空间位置：raw 定点 → world（绕 Y 镜面），装饰位置用地图坐标 */
function mapRawToWorld(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(-z / 256, y / 256, -x / 256);
}

export interface DecorLoadResult {
  group: THREE.Group;
  // 单个装饰 = 一个 group（含所有对象），位置已摆好
}

/**
 * 加载单个装饰模型并摆到世界位置。返回 group（挂到 scene 即可）。
 * @param asePath 装饰 ASE 路径（来自 map-decor.ts）
 * @param color 纯色渲染颜色（材质逆向前）
 */
export async function loadDecor(asePath: string, color: number): Promise<THREE.Group | null> {
  const smdPath = decorSmdPath(asePath);
  if (!smdPath) {
    console.warn('[decor] 无路径: ' + asePath);
    return null;
  }
  let buf: ArrayBuffer;
  try {
    buf = await cachedFetch(smdPath);
  } catch {
    console.warn('[decor] 缺失: ' + smdPath);
    return null;
  }
  const smb = parseSmb(buf);
  if (!smb.objects || smb.objects.length === 0) return null;

  // 装饰位置 = 第一个对象 tm 平移（地图空间 raw 定点），用地图变换（绕 Y 镜面）÷256
  // （之前实测此位置在 village-2 内，正确）
  const first = smb.objects.find(o => o.tm?.m);
  if (!first || !first.tm) return null;
  const pos = mapRawToWorld(first.tm.m[12], first.tm.m[14], first.tm.m[13]);

  const group = new THREE.Group();
  // 顶点已是 world float（parseSmb 已 ÷256），乘对象 tm 旋转（int 矩阵 /256）应用自身朝向，
  // 再加位置（tm 平移，地图变换 ÷256）。
  // 角色坐标变换 ROT_X_NEG90 → (x, z, -y)（docs/pt-character-rendering-authority.md §4.1）
  for (const obj of smb.objects) {
    if (!obj.vertices || obj.vertices.length === 0) continue;
    const tm = obj.tm?.m;
    const positions: number[] = [];
    const indices: number[] = [];
    let triIdx = 0;
    for (const f of obj.faces) {
      for (let k = 0; k < 3; k++) {
        const v = obj.vertices[f.v[k]];
        let x = v.x, y = v.y, z = v.z;
        if (tm) {
          // tm 旋转分量（int 定点 /256）：行主序 × 列向量
          x = (v.x * tm[0] + v.y * tm[4] + v.z * tm[8]) / 256;
          y = (v.x * tm[1] + v.y * tm[5] + v.z * tm[9]) / 256;
          z = (v.x * tm[2] + v.y * tm[6] + v.z * tm[10]) / 256;
        }
        // 角色变换 + 位置
        positions.push(x + pos.x, z + pos.y, -y + pos.z);
      }
      indices.push(triIdx * 3, triIdx * 3 + 1, triIdx * 3 + 2);
      triIdx++;
    }
    if (triIdx === 0) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    group.add(mesh);
  }

  return group;
}

/**
 * 加载一张地图的全部装饰，挂到 scene。返回所有 group（用于卸载）。
 */
export async function loadMapDecor(scene: THREE.Scene, mapId: number, entries: DecorEntry[], color: number): Promise<THREE.Group[]> {
  const groups: THREE.Group[] = [];
  let loaded = 0;
  await Promise.all(entries.map(async (e) => {
    try {
      const g = await loadDecor(e.path, color);
      if (g) {
        scene.add(g);
        groups.push(g);
        loaded++;
      }
    } catch (err) {
      console.warn('[decor] 加载失败 ' + e.path, err);
    }
  }));
  if (loaded > 0) console.log(`[decor] 地图${mapId} 装饰: ${loaded}/${entries.length}`);
  return groups;
}

/** 卸载装饰 */
export function unloadDecor(groups: THREE.Group[], scene: THREE.Scene): void {
  for (const g of groups) {
    scene.remove(g);
    g.traverse(o => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material)?.dispose();
      }
    });
  }
}
