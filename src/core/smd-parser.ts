/**
 * SMD Stage Binary Parser (SMD Stage data Ver 0.72)
 * 迁移自 maps/js/smd-parser.js,TS 化。纯解析层,无 three/DOM 依赖。
 * 只取地图渲染所需字段(几何 / 材质 / texlink UV / 场景光)。
 */
import { readCString } from './binary';

export interface SMDMaterial {
  inUse: boolean;
  texCounter: number;
  animTexCounter: number;
  /** 漫反射纹理名(每 slot),origin 相对路径如 `Field\Forest\xx.bmp` */
  tex: string[];
  /** 帧动画纹理名 */
  animTextures: string[];
  blendType: number;
  shade: number;
  twoSide: boolean;
  /** sDef diffuse [r,g,b] */
  diffuse: number[];
  transparency: number;
  useState: number;
  meshState: number;
  windMeshBottom: number;
  textureStageState: number[];
  textureFormState: number[];
}

export interface SMDLight {
  type: number;
  x: number; y: number; z: number;
  range: number;
  r: number; g: number; b: number;
}

export interface SMDData {
  nVertex: number;
  nFace: number;
  nTexLink: number;
  nLight: number;
  /** 每顶点 xyz(raw 整数坐标) */
  verts: Float32Array;
  /** 每顶点 sDef_Color RGBA(0-255) */
  vertColors: Uint8Array;
  /** 每面 3 顶点索引 */
  triIdx: Uint16Array;
  /** 每面材质索引 */
  faceMat: Uint16Array;
  /** 每面 diffuse texlink 索引(或 -1) */
  faceTexLink: Int32Array;
  /** texlink UV: 每 link [u0,u1,u2, v0,v1,v2] */
  texUVs: Float32Array;
  /** 每面 lightmap texlink 索引(沿 NextTex 链,或 -1) */
  faceLightmapUV: Int32Array;
  materials: SMDMaterial[];
  lights: SMDLight[];
  bounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
}

export function parseSMD(buffer: ArrayBuffer): SMDData {
  const dv = new DataView(buffer);

  let hdr = '';
  for (let i = 0; i < 24; i++) {
    const c = dv.getUint8(i);
    if (c !== 0) hdr += String.fromCharCode(c);
  }
  if (!hdr.startsWith('SMD Stage data')) throw new Error('Invalid SMD: ' + hdr);
  if (buffer.byteLength < 556) throw new Error('SMD too small: ' + buffer.byteLength);

  let off = 556;

  // smLegacySTAGE3D: Head(4) + StageArea[256][256](262144)
  off += 4 + 262144;

  // Tail: ptrAreaList, AreaListCnt, MemMode, SumCount, CalcSumCount,
  //        ptrVertex, ptrFace, lpOldTexLink, ptrSmLight, ptrSmMaterialGroup, ptrStageObject, ptrSmMaterial
  const lpOldTexLink = dv.getUint32(off + 7 * 4, true);
  off += 48;

  const nVertex = dv.getInt32(off, true); off += 4;
  const nFace = dv.getInt32(off, true); off += 4;
  const nTexLink = dv.getInt32(off, true); off += 4;
  const nLight = dv.getInt32(off, true); off += 4;
  off += 48;

  // Material group header: 88 bytes
  const MaterialCount = dv.getInt32(off + 8, true);
  off += 88;

  const materials: SMDMaterial[] = new Array(MaterialCount);
  for (let i = 0; i < MaterialCount; i++) {
    const inUseRaw = dv.getUint32(off, true);
    const texCounter = dv.getUint32(off + 4, true);
    const textureStageState = [...Array(8)].map((_, k) => dv.getUint32(off + 40 + k * 4, true));
    const textureFormState = [...Array(8)].map((_, k) => dv.getUint32(off + 72 + k * 4, true));
    const blendType = dv.getUint32(off + 116, true);
    const shade = dv.getUint32(off + 120, true);
    const twoSide = dv.getUint32(off + 124, true) !== 0;
    const diffuse = [dv.getFloat32(off + 132, true), dv.getFloat32(off + 136, true), dv.getFloat32(off + 140, true)];
    const transparency = dv.getFloat32(off + 144, true);
    const useState = dv.getUint32(off + 164, true);
    const meshState = dv.getUint32(off + 168, true);
    const windMeshBottom = dv.getInt32(off + 172, true);
    const animTexCounter = dv.getUint32(off + 304, true);
    off += 320;

    const tex: string[] = [];
    const animTextures: string[] = [];
    if (inUseRaw && off + 4 <= buffer.byteLength) {
      const strLen = dv.getInt32(off, true);
      off += 4;
      const strEnd = off + (strLen > 0 && strLen < 100000 ? strLen : 0);
      for (let j = 0; j < texCounter && off < strEnd; j++) {
        const name = readCString(dv, off);
        off += name.length + 1;
        tex.push(name);
        const nameA = readCString(dv, off);
        off += nameA.length + 1;
      }
      for (let j = 0; j < animTexCounter && off < strEnd; j++) {
        const name = readCString(dv, off);
        off += name.length + 1;
        animTextures.push(name);
        const nameA = readCString(dv, off);
        off += nameA.length + 1;
      }
      off = strEnd;
    }
    materials[i] = { inUse: inUseRaw !== 0, texCounter, animTexCounter, tex, animTextures, blendType, shade, twoSide, diffuse, transparency, useState, meshState, windMeshBottom, textureStageState, textureFormState };
  }

  const verts = new Float32Array(nVertex * 3);
  const vertColors = new Uint8Array(nVertex * 4);
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < nVertex; i++) {
    const x = dv.getInt32(off + 8, true);
    const y = dv.getInt32(off + 12, true);
    const z = dv.getInt32(off + 16, true);
    verts[i * 3] = x; verts[i * 3 + 1] = y; verts[i * 3 + 2] = z;
    // sDef_Color: short[4] BGRA
    const b = dv.getInt16(off + 20, true);
    const g = dv.getInt16(off + 22, true);
    const r = dv.getInt16(off + 24, true);
    const a = dv.getInt16(off + 26, true);
    vertColors[i * 4] = Math.max(0, Math.min(255, r));
    vertColors[i * 4 + 1] = Math.max(0, Math.min(255, g));
    vertColors[i * 4 + 2] = Math.max(0, Math.min(255, b));
    vertColors[i * 4 + 3] = Math.max(0, Math.min(255, a));
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    off += 28;
  }

  const triIdx = new Uint16Array(nFace * 3);
  const faceMat = new Uint16Array(nFace);
  const faceTexLink = new Int32Array(nFace);
  for (let i = 0; i < nFace; i++) {
    triIdx[i * 3] = dv.getUint16(off + 8, true);
    triIdx[i * 3 + 1] = dv.getUint16(off + 10, true);
    triIdx[i * 3 + 2] = dv.getUint16(off + 12, true);
    faceMat[i] = dv.getUint16(off + 14, true);
    const lpTexLink = dv.getUint32(off + 16, true);
    faceTexLink[i] = lpTexLink !== 0 ? (lpTexLink - lpOldTexLink) / 32 : -1;
    off += 28;
  }

  const texUVs = new Float32Array(nTexLink * 6);
  const texNext = new Int32Array(nTexLink);
  for (let i = 0; i < nTexLink; i++) {
    texUVs[i * 6] = dv.getFloat32(off, true);
    texUVs[i * 6 + 1] = dv.getFloat32(off + 4, true);
    texUVs[i * 6 + 2] = dv.getFloat32(off + 8, true);
    texUVs[i * 6 + 3] = dv.getFloat32(off + 12, true);
    texUVs[i * 6 + 4] = dv.getFloat32(off + 16, true);
    texUVs[i * 6 + 5] = dv.getFloat32(off + 20, true);
    const lpNext = dv.getUint32(off + 28, true);
    texNext[i] = lpNext !== 0 ? (lpNext - lpOldTexLink) / 32 : -1;
    off += 32;
  }

  const faceLightmapUV = new Int32Array(nFace).fill(-1);
  for (let i = 0; i < nFace; i++) {
    const tl = faceTexLink[i];
    if (tl >= 0 && texNext[tl] >= 0) faceLightmapUV[i] = texNext[tl];
  }

  const lights: SMDLight[] = [];
  for (let i = 0; i < nLight; i++) {
    const type = dv.getInt32(off, true);
    const x = dv.getInt32(off + 4, true);
    const y = dv.getInt32(off + 8, true);
    const z = dv.getInt32(off + 12, true);
    const range = dv.getInt32(off + 16, true);
    const r = dv.getInt16(off + 20, true);
    const g = dv.getInt16(off + 22, true);
    const b = dv.getInt16(off + 24, true);
    lights.push({ type: type >>> 0, x, y, z, range, r, g, b });
    off += 28;
  }

  return {
    nVertex, nFace, nTexLink, nLight,
    verts, vertColors, triIdx, faceMat, faceTexLink, texUVs, faceLightmapUV,
    materials, lights,
    bounds: { minX, maxX, minY, maxY, minZ, maxZ },
  };
}
