/**
 * Map Renderer — setDrawRange + CPU index 打包架构。
 * 迁移自 maps/js/map-renderer.js,TS 化;去掉 window.__ptWindAmpScale 全局钩子(恒 1)。
 * 每材质按 cell 排序索引缓冲;CPU 视锥剔除于 cell 级(交集打包到 index buffer 前部)。
 * 顶点着色注入: wind / water / fog / lightmap / 昼夜光 / 火把。
 */
import * as THREE from 'three';
import type { SMDData } from '../core/smd-parser';

const WORLD_SCALE = 1 / 256;

/** map-renderer 的材质判定配置（由调用方 getMatConfig 回调提供,源自 index.html:1453-1483） */
export interface MatConfig {
  hasTex: boolean;
  hasLM: boolean;
  diffuseTex: THREE.Texture | null;
  lightmapTex: THREE.Texture | null;
  hasSecondTex: boolean;
  secondTex: THREE.Texture | null;
  twoSide?: boolean;
  isTransparent: boolean;
  isRendLatter: boolean;
  blendType: number;
  hasAnimation: boolean;
}

interface CellRange { start: number; count: number; }

interface MaterialRenderData {
  matIdx: number;
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  cellLookup: Map<number, CellRange>;
  cellKeys: Uint32Array;
  sortedFaces: Uint32Array;
  fullIndices: Uint32Array;
  outIndices: Uint32Array;
  packedCount: number;
  seenFaces: Uint32Array;
  aabb: THREE.Box3;
  faceCount: number;
  isTransparent: boolean;
  hasAnimation: boolean;
}

export interface SceneLightWorld {
  type: number;
  wx: number; wy: number; wz: number;
  range: number;
  r: number; g: number; b: number;
}

export class MapRenderer {
  scene: THREE.Scene;
  materials: MaterialRenderData[] = [];
  cellWorldSize = 0;
  worldMin = [0, 0, 0];
  worldMax = [0, 0, 0];
  worldWidth = 0;
  worldDepth = 0;
  visibleCellCount = 0;
  drawCallCount = 0;
  visibleFaceCount = 0;
  totalFaceCount = 0;
  totalTriangleCount = 0;
  totalVertexCount = 0;
  drawnVertexCount = 0;
  lights: SceneLightWorld[] = [];
  buildTimeMs = 0;
  buildCellTimeMs = 0;
  private renderStamp = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  build(smdData: SMDData, texMap: Map<string, THREE.Texture>, getMatConfig: (matIdx: number, mat: import('../core/smd-parser').SMDMaterial) => MatConfig | null): void {
    const S = WORLD_SCALE;
    const t0 = performance.now();

    const b = smdData.bounds;
    const wx1 = -b.maxZ * S, wx2 = -b.minZ * S;
    const wy1 = b.minY * S, wy2 = b.maxY * S;
    const wz1 = -b.maxX * S, wz2 = -b.minX * S;
    this.worldMin = [Math.min(wx1, wx2), wy1, Math.min(wz1, wz2)];
    this.worldMax = [Math.max(wx1, wx2), wy2, Math.max(wz1, wz2)];
    this.worldWidth = this.worldMax[0] - this.worldMin[0];
    this.worldDepth = this.worldMax[2] - this.worldMin[2];
    this.cellWorldSize = this.worldWidth / 256;

    this.totalFaceCount = smdData.nFace;

    this.lights = [];
    for (const l of smdData.lights || []) {
      this.lights.push({
        type: l.type,
        wx: -l.z * S, wy: l.y * S, wz: -l.x * S,
        range: l.range, r: l.r, g: l.g, b: l.b,
      });
    }

    const matFaces = new Map<number, number[]>();
    for (let i = 0; i < smdData.nFace; i++) {
      const m = smdData.faceMat[i];
      const arr = matFaces.get(m);
      if (arr) arr.push(i);
      else matFaces.set(m, [i]);
    }

    for (const [matIdx, faceList] of matFaces) {
      const mat = smdData.materials[matIdx];
      const config = getMatConfig(+matIdx, mat);
      if (!config) continue;
      const mrd = this.buildMaterialGeometry(+matIdx, faceList, smdData, config, texMap);
      if (mrd) {
        this.materials.push(mrd);
        this.scene.add(mrd.mesh);
      }
    }

    this.materials.sort((a, b) => {
      if (a.isTransparent !== b.isTransparent) return a.isTransparent ? 1 : -1;
      return a.matIdx - b.matIdx;
    });

    this.totalVertexCount = 0;
    this.totalTriangleCount = 0;
    for (const mrd of this.materials) {
      this.totalVertexCount += mrd.geometry.attributes.position.count;
      this.totalTriangleCount += mrd.fullIndices.length / 3;
    }

    this.buildTimeMs = performance.now() - t0;
  }

  private buildMaterialGeometry(
    matIdx: number,
    faceList: number[],
    smdData: SMDData,
    config: MatConfig,
    texMap: Map<string, THREE.Texture>,
  ): MaterialRenderData | null {
    const S = WORLD_SCALE;
    const nFaces = faceList.length;

    const pos2 = new Float32Array(nFaces * 9);
    const nrm2 = new Float32Array(nFaces * 9);
    const col2 = new Float32Array(nFaces * 9);
    const uv0 = config.hasTex ? new Float32Array(nFaces * 6) : null;
    const uv1 = (config.hasLM || config.hasSecondTex) ? new Float32Array(nFaces * 6) : null;

    const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
    const ab = new THREE.Vector3(), ac = new THREE.Vector3(), fn = new THREE.Vector3();

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    for (let fi = 0; fi < nFaces; fi++) {
      const i = faceList[fi];
      const a = smdData.triIdx[i * 3], bb = smdData.triIdx[i * 3 + 1], c = smdData.triIdx[i * 3 + 2];

      const vids = [a, bb, c];
      for (let j = 0; j < 3; j++) {
        const vi = vids[j];
        const wx = -smdData.verts[vi * 3 + 2] * S;
        const wy = smdData.verts[vi * 3 + 1] * S;
        const wz = -smdData.verts[vi * 3] * S;
        pos2[fi * 9 + j * 3] = wx;
        pos2[fi * 9 + j * 3 + 1] = wy;
        pos2[fi * 9 + j * 3 + 2] = wz;
        col2[fi * 9 + j * 3] = smdData.vertColors[vi * 4] / 255;
        col2[fi * 9 + j * 3 + 1] = smdData.vertColors[vi * 4 + 1] / 255;
        col2[fi * 9 + j * 3 + 2] = smdData.vertColors[vi * 4 + 2] / 255;
        if (wx < minX) minX = wx; if (wx > maxX) maxX = wx;
        if (wy < minY) minY = wy; if (wy > maxY) maxY = wy;
        if (wz < minZ) minZ = wz; if (wz > maxZ) maxZ = wz;
      }

      va.set(pos2[fi * 9], pos2[fi * 9 + 1], pos2[fi * 9 + 2]);
      vb.set(pos2[fi * 9 + 3], pos2[fi * 9 + 4], pos2[fi * 9 + 5]);
      vc.set(pos2[fi * 9 + 6], pos2[fi * 9 + 7], pos2[fi * 9 + 8]);
      ab.subVectors(vb, va); ac.subVectors(vc, va);
      fn.crossVectors(ab, ac).normalize();
      for (let j = 0; j < 3; j++) {
        nrm2[fi * 9 + j * 3] = fn.x;
        nrm2[fi * 9 + j * 3 + 1] = fn.y;
        nrm2[fi * 9 + j * 3 + 2] = fn.z;
      }

      if (uv0) {
        const tlIdx = smdData.faceTexLink[i];
        if (tlIdx >= 0) {
          const base = tlIdx * 6;
          if (base + 5 < smdData.texUVs.length) {
            uv0[fi * 6] = smdData.texUVs[base];
            uv0[fi * 6 + 1] = smdData.texUVs[base + 3];
            uv0[fi * 6 + 2] = smdData.texUVs[base + 1];
            uv0[fi * 6 + 3] = smdData.texUVs[base + 4];
            uv0[fi * 6 + 4] = smdData.texUVs[base + 2];
            uv0[fi * 6 + 5] = smdData.texUVs[base + 5];
          }
        }
      }
      if (uv1) {
        const lmIdx = smdData.faceLightmapUV[i];
        if (lmIdx >= 0) {
          const base = lmIdx * 6;
          if (base + 5 < smdData.texUVs.length) {
            uv1[fi * 6] = smdData.texUVs[base];
            uv1[fi * 6 + 1] = smdData.texUVs[base + 3];
            uv1[fi * 6 + 2] = smdData.texUVs[base + 1];
            uv1[fi * 6 + 3] = smdData.texUVs[base + 4];
            uv1[fi * 6 + 4] = smdData.texUVs[base + 2];
            uv1[fi * 6 + 5] = smdData.texUVs[base + 5];
          }
        }
      }
    }

    const cellBuildStart = performance.now();
    const cellSize = this.cellWorldSize;
    const wmX = this.worldMin[0], wmZ = this.worldMin[2];

    const pairs: Array<[number, number]> = [];
    for (let fi = 0; fi < nFaces; fi++) {
      const wx0 = pos2[fi * 9], wz0 = pos2[fi * 9 + 2];
      const wx1 = pos2[fi * 9 + 3], wz1 = pos2[fi * 9 + 5];
      const wx2 = pos2[fi * 9 + 6], wz2 = pos2[fi * 9 + 8];

      const bxMin = Math.min(wx0, wx1, wx2), bxMax = Math.max(wx0, wx1, wx2);
      const bzMin = Math.min(wz0, wz1, wz2), bzMax = Math.max(wz0, wz1, wz2);

      const cMinX = Math.floor((bxMin - wmX) / cellSize);
      const cMaxX = Math.floor((bxMax - wmX) / cellSize);
      const cMinZ = Math.floor((bzMin - wmZ) / cellSize);
      const cMaxZ = Math.floor((bzMax - wmZ) / cellSize);

      for (let cx = cMinX; cx <= cMaxX; cx++) {
        for (let cz = cMinZ; cz <= cMaxZ; cz++) {
          if (!this.triCellIntersect(wx0, wz0, wx1, wz1, wx2, wz2, wmX + cx * cellSize, wmZ + cz * cellSize, cellSize)) continue;
          pairs.push([cx * 4096 + cz, fi]);
        }
      }
    }

    pairs.sort((x, y) => x[0] - y[0]);

    // 每面只存一份顶点（pos2/nrm2/col2/uv0/uv1 已按 fi 紧凑布局），
    // cellLookup 记录每个 cell 覆蓋的面区间（面可跨 cell，被多个 cell 记录）；
    // 渲染时对可见 cell 收集面并去重提交——同一个面跨多个 cell 也只画一次。
    const sortedFaces = new Uint32Array(pairs.length);
    for (let ni = 0; ni < pairs.length; ni++) sortedFaces[ni] = pairs[ni][1];

    const fullIndices = new Uint32Array(nFaces * 3);
    for (let fi = 0; fi < nFaces; fi++) {
      fullIndices[fi * 3] = fi * 3;
      fullIndices[fi * 3 + 1] = fi * 3 + 1;
      fullIndices[fi * 3 + 2] = fi * 3 + 2;
    }
    const outIndices = new Uint32Array(nFaces * 3).fill(0);

    const cellKeys = new Uint32Array(pairs.length);
    for (let ni = 0; ni < pairs.length; ni++) cellKeys[ni] = pairs[ni][0];

    const cellLookup = new Map<number, CellRange>();
    if (pairs.length > 0) {
      let cellStart = 0;
      let currentCell = pairs[0][0];
      let cellCount = 0;
      for (let i = 0; i < pairs.length; i++) {
        if (pairs[i][0] !== currentCell) {
          cellLookup.set(currentCell, { start: cellStart, count: cellCount });
          currentCell = pairs[i][0];
          cellStart = i;
          cellCount = 0;
        }
        cellCount += 1;
      }
      cellLookup.set(currentCell, { start: cellStart, count: cellCount });
    }
    this.buildCellTimeMs = (this.buildCellTimeMs || 0) + (performance.now() - cellBuildStart);

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(pos2, 3));
    geom.setAttribute('normal', new THREE.BufferAttribute(nrm2, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(col2, 3));
    if (uv0) geom.setAttribute('uv', new THREE.BufferAttribute(uv0, 2));
    if (uv1) geom.setAttribute('uv2', new THREE.BufferAttribute(uv1, 2));
    geom.setIndex(new THREE.BufferAttribute(outIndices, 1));

    const mat = smdData.materials[matIdx];
    let windKind = 0;
    let waterKind = false;
    if (mat.windMeshBottom && !(mat.useState & 0x4000)) {
      const wc = mat.windMeshBottom & 0x7FF;
      if (wc === 0x20) windKind = 1;
      else if (wc === 0x40) windKind = 2;
      else if (wc === 0x80) windKind = 3;
      else if (wc === 0x100) windKind = 4;
      else if (wc === 0x200) waterKind = true;
    }
    const threeMat = this.buildThreeMaterial(matIdx, mat, config, texMap, windKind, minY, maxY, waterKind);

    const mesh = new THREE.Mesh(geom, threeMat);
    mesh.frustumCulled = false;
    mesh.userData.mapMesh = true;
    if (config.isRendLatter) mesh.renderOrder = 1;

    return {
      matIdx,
      mesh,
      geometry: geom,
      cellLookup,
      cellKeys,
      fullIndices,
      outIndices,
      packedCount: 0,
      sortedFaces,
      seenFaces: new Uint32Array(nFaces),
      aabb: new THREE.Box3(
        new THREE.Vector3(minX, minY, minZ),
        new THREE.Vector3(maxX, maxY, maxZ),
      ),
      faceCount: faceList.length,
      isTransparent: config.isTransparent,
      hasAnimation: config.hasAnimation,
    };
  }

  private pointInTriangle(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, px: number, pz: number): boolean {
    const v0x = cx - ax, v0z = cz - az;
    const v1x = bx - ax, v1z = bz - az;
    const v2x = px - ax, v2z = pz - az;
    const dot00 = v0x * v0x + v0z * v0z;
    const dot01 = v0x * v1x + v0z * v1z;
    const dot02 = v0x * v2x + v0z * v2z;
    const dot11 = v1x * v1x + v1z * v1z;
    const dot12 = v1x * v2x + v1z * v2z;
    const denom = dot00 * dot11 - dot01 * dot01;
    if (Math.abs(denom) < 1e-12) return false;
    const inv = 1 / denom;
    const u = (dot11 * dot02 - dot01 * dot12) * inv;
    if (u < 0 || u > 1) return false;
    const v = (dot00 * dot12 - dot01 * dot02) * inv;
    if (v < 0 || v > 1) return false;
    return u + v <= 1;
  }

  private lineCross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
    const delta = (bx - ax) * (cy - dy) - (by - ay) * (cx - dx);
    if (Math.abs(delta) <= 1e-9) return false;
    const namenda = ((cx - ax) * (cy - dy) - (cy - ay) * (cx - dx)) / delta;
    if (namenda > 1 || namenda < 0) return false;
    const miu = ((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) / delta;
    if (miu > 1 || miu < 0) return false;
    return true;
  }

  private triCellIntersect(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, boxX: number, boxZ: number, cellSize: number): boolean {
    const bx0 = boxX, bz0 = boxZ;
    const bx1 = boxX + cellSize, bz1 = boxZ + cellSize;
    const box: Array<[number, number]> = [[bx0, bz0], [bx1, bz0], [bx1, bz1], [bx0, bz1]];

    const vInBox = (px: number, pz: number) => px >= bx0 && px <= bx1 && pz >= bz0 && pz <= bz1;
    if (vInBox(ax, az) || vInBox(bx, bz) || vInBox(cx, cz)) return true;

    for (const [px, pz] of box) {
      if (this.pointInTriangle(ax, az, bx, bz, cx, cz, px, pz)) return true;
    }

    const triEdges: Array<[number, number, number, number]> = [[ax, az, bx, bz], [bx, bz, cx, cz], [cx, cz, ax, az]];
    for (const [e1x, e1z, e2x, e2z] of triEdges) {
      for (let k = 0; k < 4; k++) {
        const [qb0, qz0] = box[k];
        const [qb1, qz1] = box[(k + 1) % 4];
        if (this.lineCross(e1x, e1z, e2x, e2z, qb0, qz0, qb1, qz1)) return true;
      }
    }
    return false;
  }

  private buildThreeMaterial(
    matIdx: number,
    mat: import('../core/smd-parser').SMDMaterial,
    config: MatConfig,
    texMap: Map<string, THREE.Texture>,
    windKind: number,
    windYMin: number,
    windYMax: number,
    waterKind: boolean,
  ): THREE.MeshBasicMaterial {
    void matIdx; void texMap;
    const opts: THREE.MeshBasicMaterialParameters = {
      vertexColors: true,
      side: config.twoSide ? THREE.DoubleSide : THREE.FrontSide,
    };

    if (config.hasTex) {
      opts.map = config.diffuseTex || null;
      opts.color = config.diffuseTex ? 0xffffff : 0xcccccc;
    } else {
      opts.color = 0xcccccc;
    }

    if (config.isTransparent) {
      opts.transparent = true;
      opts.alphaTest = 60 / 255;
      opts.depthWrite = mat.transparency <= 0.2;
      switch (config.blendType) {
        case 2:
          opts.blending = THREE.CustomBlending;
          opts.blendSrc = THREE.SrcColorFactor;
          opts.blendDst = THREE.OneMinusSrcColorFactor;
          break;
        case 3:
          opts.blending = THREE.CustomBlending;
          opts.blendSrc = THREE.ZeroFactor;
          opts.blendDst = THREE.SrcColorFactor;
          break;
        case 4:
          opts.blending = THREE.AdditiveBlending;
          break;
        case 5:
          opts.blending = THREE.CustomBlending;
          opts.blendSrc = THREE.SrcColorFactor;
          opts.blendDst = THREE.OneFactor;
          break;
        case 6:
          opts.blending = THREE.CustomBlending;
          opts.blendSrc = THREE.ZeroFactor;
          opts.blendDst = THREE.OneMinusSrcColorFactor;
          break;
        default:
          opts.blending = THREE.NormalBlending;
          break;
      }
    }

    const threeMat = new THREE.MeshBasicMaterial(opts);

    interface ScrollSlot { slot: number; kind: 'scroll' | 'slow'; mult: number; factor: number; }
    const scrollSlot: ScrollSlot[] = [];
    for (const slot of [0, 1]) {
      const fs = mat.textureFormState ? mat.textureFormState[slot] : 0;
      if (fs === 4) scrollSlot.push({ slot, kind: 'scroll', mult: 1, factor: 0 });
      else if (fs >= 6 && fs <= 14) scrollSlot.push({ slot, kind: 'scroll', mult: fs - 4, factor: 0 });
      else if (fs >= 15 && fs <= 18) scrollSlot.push({ slot, kind: 'slow', mult: 1, factor: 22 - fs });
    }
    const hasScroll = scrollSlot.length > 0;
    const needLM = !!(config.hasLM && config.lightmapTex);
    const need2Tex = !!(config.hasSecondTex && config.secondTex);
    const scrollU0 = hasScroll && scrollSlot.some((s) => s.slot === 0);
    const scrollU1 = hasScroll && scrollSlot.some((s) => s.slot === 1);

    {
      const ckParts: string[] = [];
      if (hasScroll) ckParts.push('S' + scrollSlot.map((s) => s.slot + s.kind + s.mult).join(''));
      if (windKind) ckParts.push('W' + windKind);
      if (waterKind) ckParts.push('A');
      if (needLM) ckParts.push('L');
      if (need2Tex) ckParts.push('T');
      if (ckParts.length > 0) threeMat.customProgramCacheKey = () => ckParts.join('');
    }

    const baseWindMag = windKind ? (windKind === 1 || windKind === 3 ? 1.4 : 2.6) : 0;
    const windAmpScale = 1; // 原 maps 用 window.__ptWindAmpScale 调试钩子,迁移固定为 1
    const baseWindMagScaled = baseWindMag * windAmpScale;
    const vWindDX = (windKind === 1 || windKind === 2) ? baseWindMagScaled : 0;
    const vWindDZ = (windKind === 3 || windKind === 4) ? baseWindMagScaled : 0;

    threeMat.userData.scrollSlots = scrollSlot;
    threeMat.onBeforeCompile = (shader) => {
      let declInline = '#include <common>';
      if (needLM || need2Tex) declInline += '\nout vec2 vMyLightMapUv;';
      if (scrollU0 || scrollU1) declInline += '\nuniform vec2 uScrollU;';
      if (windKind) {
        declInline += '\nuniform float uWindTime;';
        declInline += '\nuniform vec2 uWindMag;';
      }
      if (waterKind) declInline += '\nuniform float uWaterTime;';
      declInline += '\nvarying float vPtFogZ;';
      declInline += '\nvarying vec3 vPtWorldPos;';
      declInline += '\nuniform vec3 uEnvLight;';
      declInline += '\nuniform vec3 uTorchPos;';
      declInline += '\nuniform vec3 uTorchColor;';
      declInline += '\nuniform float uTorchRange;';
      declInline += '\nuniform vec3 uSceneLightPos[8];';
      declInline += '\nuniform vec3 uSceneLightColor[8];';
      declInline += '\nuniform float uSceneLightRange[8];';
      shader.vertexShader = shader.vertexShader.replace('#include <common>', declInline);

      let uvInline = '#include <uv_vertex>';
      if (needLM || need2Tex) {
        uvInline += '\nvMyLightMapUv = uv2;';
        if (scrollU1) uvInline += '\nvMyLightMapUv.x += uScrollU.y;';
      }
      if (scrollU0) uvInline += '\nvMapUv.x += uScrollU.x;';
      shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', uvInline);

      if (windKind) {
        const windCode =
          '#include <begin_vertex>\n' +
          '  {\n' +
          `    float _ptH = clamp((transformed.y - ${windYMin.toFixed(1)}) / ${(windYMax - windYMin).toFixed(1)}, 0.0, 1.0);\n` +
          '    float _ph = transformed.x * 0.05 + transformed.z * 0.045 + uWindTime * 2.0;\n' +
          '    float _sw = sin(_ph) * 0.6 + sin(_ph * 1.55 + transformed.x * 0.013 + transformed.z * 0.011) * 0.4;\n' +
          '    float _amp = 1.0 + _ptH * 0.5;\n' +
          '    transformed.x += uWindMag.x * _sw * _amp;\n' +
          '    transformed.z += uWindMag.y * _sw * _amp;\n' +
          '  }';
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', windCode);
      }

      if (waterKind) {
        const waterCode =
          '#include <begin_vertex>\n' +
          '  {\n' +
          '    float _rx = (-transformed.z * 256.0 * 8.0 + uWaterTime) * 0.5;\n' +
          '    float _rz = (-transformed.x * 256.0 * 8.0 + uWaterTime) * 0.5;\n' +
          '    float _wa = _rx / 4096.0 * 6.28318530718;\n' +
          '    float _wb = _rz / 4096.0 * 6.28318530718;\n' +
          '    transformed.z += sin(_wa) * 8.0;\n' +
          '    transformed.x += sin(_wb) * 8.0;\n' +
          '  }';
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', waterCode);
      }

      {
        const fogCode =
          '#include <project_vertex>\n' +
          '  vPtFogZ = -mvPosition.z;\n' +
          '  vPtWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\n' +
          '  vColor.rgb += uEnvLight;\n' +
          '  { for (int _i = 0; _i < 8; _i++) { if (uSceneLightRange[_i] <= 0.0) continue; float _ld = distance(vPtWorldPos, uSceneLightPos[_i]); if (_ld < uSceneLightRange[_i]) { float _lp = 1.0 - _ld / uSceneLightRange[_i]; vColor.rgb += uSceneLightColor[_i] * _lp; } } }\n' +
          '  { float _td = distance(vPtWorldPos, uTorchPos); if (uTorchRange > 0.0 && _td < uTorchRange) { float _tp = 1.0 - _td / uTorchRange; vColor.rgb += uTorchColor * _tp; } }';
        shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', fogCode);
      }

      {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <common>',
          '#include <common>\n' +
          (needLM ? 'uniform sampler2D uLightMap;\nin vec2 vMyLightMapUv;\n' : '') +
          (need2Tex ? 'uniform sampler2D uSecondTex;\nin vec2 vMyLightMapUv;\n' : '') +
          'varying float vPtFogZ;',
        );
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <color_fragment>',
          '#include <color_fragment>\n' +
          (needLM ? '  diffuseColor.rgb *= texture2D(uLightMap, vMyLightMapUv).rgb;\n' : '') +
          (need2Tex ? '  diffuseColor.rgb *= texture2D(uSecondTex, vMyLightMapUv).rgb;\n' : '') +
          '  { float _z = vPtFogZ; if (_z > 1152.0) { float _dlev = (_z - 1152.0) * 0.5; if (_dlev > 255.0) _dlev = 255.0; diffuseColor.rgb *= 1.0 - _dlev / 256.0; } }',
        );
        if (needLM) shader.uniforms.uLightMap = { value: config.lightmapTex };
        if (need2Tex) shader.uniforms.uSecondTex = { value: config.secondTex };
        shader.uniforms.uEnvLight = { value: new THREE.Vector3(0, 0, 0) };
        shader.uniforms.uTorchPos = { value: new THREE.Vector3(0, 0, 0) };
        shader.uniforms.uTorchColor = { value: new THREE.Vector3(0, 0, 0) };
        shader.uniforms.uTorchRange = { value: 0 };
        shader.uniforms.uSceneLightPos = { value: Array.from({ length: 8 }, () => new THREE.Vector3()) };
        shader.uniforms.uSceneLightColor = { value: Array.from({ length: 8 }, () => new THREE.Vector3()) };
        shader.uniforms.uSceneLightRange = { value: new Float32Array(8) };
      }

      if (scrollU0 || scrollU1) shader.uniforms.uScrollU = { value: new THREE.Vector2(0, 0) };
      if (windKind) {
        shader.uniforms.uWindTime = { value: 0 };
        shader.uniforms.uWindMag = { value: new THREE.Vector2(vWindDX, vWindDZ) };
      }
      if (waterKind) shader.uniforms.uWaterTime = { value: 0 };
      threeMat.userData.shader = shader;
    };

    return threeMat;
  }

  updateScroll(animMs: number): void {
    const ms = animMs | 0;
    const baseW = (ms >>> 6) & 0xff;
    const baseFw = baseW / 256;
    for (const mrd of this.materials) {
      const threeMat = mrd.mesh.material as THREE.MeshBasicMaterial;
      const shader = threeMat.userData.shader;
      const slots = threeMat.userData.scrollSlots as Array<{ slot: number; kind: 'scroll' | 'slow'; mult: number; factor: number }> | undefined;
      if (!shader || !slots || slots.length === 0) continue;
      const off = shader.uniforms.uScrollU ? shader.uniforms.uScrollU.value as THREE.Vector2 : null;
      if (!off) continue;
      for (const s of slots) {
        let v: number;
        if (s.kind === 'slow') {
          const mask = 0xffff >> s.factor;
          v = ((ms >>> 6) & mask) / mask;
        } else {
          v = baseFw * s.mult;
        }
        if (s.slot === 0) off.x = v;
        else off.y = v;
      }
    }
  }

  updateWind(animMs: number): void {
    const ms = animMs | 0;
    let ttCnt = (ms >>> 2) & 0xff;
    const ttFlag = (ms >>> 10) & 1;
    if (!ttFlag) ttCnt = 255 - ttCnt;
    const uTime = (ttCnt / 255) * Math.PI * 2;
    for (const mrd of this.materials) {
      const threeMat = mrd.mesh.material as THREE.MeshBasicMaterial;
      const shader = threeMat.userData.shader;
      if (!shader || !shader.uniforms.uWindTime) continue;
      shader.uniforms.uWindTime.value = uTime;
    }
  }

  updateWater(animMs: number): void {
    const ms = animMs | 0;
    for (const mrd of this.materials) {
      const threeMat = mrd.mesh.material as THREE.MeshBasicMaterial;
      const shader = threeMat.userData.shader;
      if (!shader || !shader.uniforms.uWaterTime) continue;
      shader.uniforms.uWaterTime.value = ms;
    }
  }

  updateDayNight(
    envLight: THREE.Vector3,
    sceneLights: Array<{ pos: THREE.Vector3; color: THREE.Vector3; range: number }>,
    torchPos: THREE.Vector3,
    torchColor: THREE.Vector3,
    torchRange: number,
  ): void {
    for (const mrd of this.materials) {
      const threeMat = mrd.mesh.material as THREE.MeshBasicMaterial;
      const shader = threeMat.userData.shader;
      if (!shader) continue;
      if (shader.uniforms.uEnvLight) shader.uniforms.uEnvLight.value.copy(envLight);
      const up = shader.uniforms.uSceneLightPos;
      const uc = shader.uniforms.uSceneLightColor;
      const ur = shader.uniforms.uSceneLightRange;
      if (up && uc && ur) {
        const n = Math.min(sceneLights.length, 8);
        for (let i = 0; i < 8; i++) {
          if (i < n) {
            (up.value as THREE.Vector3[])[i].copy(sceneLights[i].pos);
            (uc.value as THREE.Vector3[])[i].copy(sceneLights[i].color);
            (ur.value as Float32Array)[i] = sceneLights[i].range;
          } else {
            (up.value as THREE.Vector3[])[i].set(0, 0, 0);
            (uc.value as THREE.Vector3[])[i].set(0, 0, 0);
            (ur.value as Float32Array)[i] = 0;
          }
        }
      }
      if (shader.uniforms.uTorchPos) shader.uniforms.uTorchPos.value.copy(torchPos);
      if (shader.uniforms.uTorchColor) shader.uniforms.uTorchColor.value.copy(torchColor);
      if (shader.uniforms.uTorchRange) shader.uniforms.uTorchRange.value = torchRange;
    }
  }

  render(camera: THREE.Camera, extraCameras: THREE.Camera[] = []): void {
    const frustums: THREE.Frustum[] = [];
    for (const cam of [camera, ...extraCameras]) {
      const projScreenMatrix = new THREE.Matrix4();
      projScreenMatrix.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      const f = new THREE.Frustum();
      f.setFromProjectionMatrix(projScreenMatrix);
      frustums.push(f);
    }

    this.visibleCellCount = 0;
    this.drawCallCount = 0;
    this.visibleFaceCount = 0;

    const testFrustums = (box: THREE.Box3): boolean => {
      for (const f of frustums) {
        if (f.planes && !f.intersectsBox(box)) return false;
      }
      return true;
    };

    const stamp = ++this.renderStamp;
    for (const mrd of this.materials) {
      if (!testFrustums(mrd.aabb)) {
        mrd.mesh.visible = false;
        continue;
      }

      const idxArr = mrd.geometry.index!.array as Uint32Array;
      const fullIdx = mrd.fullIndices;
      const faces = mrd.sortedFaces;
      const seen = mrd.seenFaces;
      let packed = 0;
      for (const [cellKey, range] of mrd.cellLookup) {
        const cx = Math.floor(cellKey / 4096);
        const cz = cellKey % 4096;
        const cellMinX = this.worldMin[0] + cx * this.cellWorldSize;
        const cellMinZ = this.worldMin[2] + cz * this.cellWorldSize;
        const cellMaxX = cellMinX + this.cellWorldSize;
        const cellMaxZ = cellMinZ + this.cellWorldSize;

        const cellAABB = new THREE.Box3(
          new THREE.Vector3(cellMinX, mrd.aabb.min.y, cellMinZ),
          new THREE.Vector3(cellMaxX, mrd.aabb.max.y, cellMaxZ),
        );

        if (!testFrustums(cellAABB)) continue;
        this.visibleCellCount++;
        const start = range.start;
        const end = range.start + range.count;
        for (let k = start; k < end; k++) {
          const fi = faces[k];
          if (seen[fi] === stamp) continue; // 面跨多 cell，去重
          seen[fi] = stamp;
          const off = fi * 3;
          idxArr[packed] = fullIdx[off];
          idxArr[packed + 1] = fullIdx[off + 1];
          idxArr[packed + 2] = fullIdx[off + 2];
          packed += 3;
        }
      }
      mrd.packedCount = packed;
      if (packed === 0) {
        mrd.mesh.visible = false;
        continue;
      }
      mrd.geometry.index!.needsUpdate = true;
      mrd.geometry.setDrawRange(0, packed);
      mrd.mesh.visible = true;
      this.drawCallCount++;
      this.visibleFaceCount += packed / 3;
    }
    this.drawnVertexCount = Math.round(this.visibleFaceCount) * 3;
  }

  dispose(): void {
    for (const mrd of this.materials) {
      mrd.geometry.dispose();
      (mrd.mesh.material as THREE.Material).dispose();
      this.scene.remove(mrd.mesh);
    }
    this.materials = [];
  }
}
