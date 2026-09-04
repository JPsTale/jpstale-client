/**
 * 点击拾取诊断：点击画布 → 命中点世界坐标 + 该 (x,z) 柱上所有深度邻近面的材质/配置。
 * 用于分析 z-fighting 是谁与谁共面。数据取自原始 SMD,非渲染网格。
 */
import * as THREE from 'three';
import type { Fore1Map } from './fore1';
import type { SMDData } from '../core/smd-parser';

export interface PickFace {
  faceIndex: number;
  matIdx: number;
  rawY: number;
  worldY: number;
  transparent: boolean;
  depthWrite: boolean;
  blendType: number;
  twoSide: boolean;
  hasTex: boolean;
  tex: string;
  hasLightmap: boolean;
  hasSecondTex: boolean;
  hasWind: boolean;
  hasWater: boolean;
  hasScroll: boolean;
  meshStateHex: string;
  useStateHex: string;
}

export interface PickResult {
  rawX: number; rawY: number; rawZ: number;
  worldX: number; worldY: number; worldZ: number;
  /** 命中的最近面 */
  hit: PickFace | null;
  /** 同一 (x,z) 柱上所有面（按 rawY 升序）,含 hit */
  faces: PickFace[];
}

const TO_WORLD = 1 / 256;

/** 该材质在渲染端的配置,用于判断是否可能与之共面冲突 */
function matRenderFlags(fore: Fore1Map, matIdx: number): PickFace {
  const mat = fore.data.materials[matIdx];
  let hasLightmap = false, hasSecondTex = false, hasWind = false, hasWater = false, hasScroll = false;
  let mapHasAlpha = false; // 贴图 alpha（BMP 恒无,TGA 才有）→ isTransparent 判定用
  const mrd = fore.mapRenderer.materials.find((m) => m.matIdx === matIdx);
  if (mrd) {
    const mat3 = mrd.mesh.material as THREE.MeshBasicMaterial;
    const sh = mat3.userData.shader;
    hasLightmap = !!sh?.uniforms.uLightMap;
    hasSecondTex = !!sh?.uniforms.uSecondTex;
    hasWind = !!sh?.uniforms.uWindTime;
    hasWater = !!sh?.uniforms.uWaterTime;
    hasScroll = !!(mat3.userData.scrollSlots as unknown[] | undefined)?.length;
    mapHasAlpha = !!(mat3.map?.userData.hasAlpha);
  }
  // 与 render/fore1.ts getMatConfig 的 isTransparent 完全一致：
  //   blendType=1(ALPHA) 需 贴图有alpha 或 transparency>0；其余 blendType!=0 混合也算透明
  const isTransparent =
    (mat.blendType === 1 && (mapHasAlpha || mat.transparency > 0)) ||
    (mat.blendType !== 1 && mat.blendType !== 0);
  return {
    faceIndex: 0, matIdx,
    rawY: 0, worldY: 0,
    transparent: isTransparent,
    depthWrite: mat.transparency <= 0.2,
    blendType: mat.blendType,
    twoSide: mat.twoSide,
    hasTex: mat.tex.length > 0,
    tex: mat.tex[0] ?? '',
    hasLightmap, hasSecondTex, hasWind, hasWater, hasScroll,
    meshStateHex: '0x' + (mat.meshState >>> 0).toString(16),
    useStateHex: '0x' + (mat.useState >>> 0).toString(16),
  };
}

/** 收集某 (rawA, rawC) 点上所有投影包含它的面;返回按 rawY 升序 */
export function facesAtColumn(data: SMDData, rawX: number, rawZ: number, fore: Fore1Map): PickFace[] {
  const verts = data.verts, triIdx = data.triIdx, faceMat = data.faceMat;
  const out: PickFace[] = [];
  for (let fi = 0; fi < data.nFace; fi++) {
    const i0 = triIdx[fi * 3], i1 = triIdx[fi * 3 + 1], i2 = triIdx[fi * 3 + 2];
    const ax = verts[i0 * 3], az = verts[i0 * 3 + 2];
    const bx = verts[i1 * 3], bz = verts[i1 * 3 + 2];
    const cx = verts[i2 * 3], cz = verts[i2 * 3 + 2];
    // 点在三角形内（XZ 投影,重心符号法）
    const d0 = (bx - ax) * (rawZ - az) - (bz - az) * (rawX - ax);
    const d1 = (cx - bx) * (rawZ - bz) - (cz - bz) * (rawX - bx);
    const d2 = (ax - cx) * (rawZ - cz) - (az - cz) * (rawX - cx);
    const hasNeg = d0 < 0 || d1 < 0 || d2 < 0;
    const hasPos = d0 > 0 || d1 > 0 || d2 > 0;
    if (hasNeg && hasPos) continue;
    if (!fore.data.materials[faceMat[fi]]) continue; // 跳过不可见材质组
    const rawY = verts[i0 * 3 + 1];
    const f = matRenderFlags(fore, faceMat[fi]);
    f.faceIndex = fi;
    f.rawY = rawY;
    f.worldY = rawY * TO_WORLD;
    out.push(f);
  }
  out.sort((a, b) => a.rawY - b.rawY);
  return out;
}

export function attachPick(
  dom: HTMLElement,
  camera: THREE.Camera,
  fore: Fore1Map,
  onPick: (result: PickResult) => void,
): void {
  dom.style.cursor = 'crosshair';
  dom.addEventListener('click', (e) => {
    const rect = dom.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const py = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(px, py), camera);

    const meshes = fore.mapRenderer.materials.map((m) => m.mesh);
    const hits = raycaster.intersectObjects(meshes, false);
    if (!hits.length) { onPick({ rawX: NaN, rawY: NaN, rawZ: NaN, worldX: NaN, worldY: NaN, worldZ: NaN, hit: null, faces: [] }); return; }
    hits.sort((a, b) => a.distance - b.distance);
    const wp = hits[0].point;

    const rawX = wp.x * 256, rawY = wp.y * 256, rawZ = -wp.z * 256;
    const faces = facesAtColumn(fore.data, rawX, rawZ, fore);
    const nearest = faces.reduce<PickFace | null>((best, f) =>
      (best === null || Math.abs(f.rawY - rawY) < Math.abs(best.rawY - rawY)) ? f : best, null);

    onPick({
      rawX: Math.round(rawX), rawY: Math.round(rawY), rawZ: Math.round(rawZ),
      worldX: wp.x, worldY: wp.y, worldZ: wp.z,
      hit: nearest,
      faces,
    });
  });
}
