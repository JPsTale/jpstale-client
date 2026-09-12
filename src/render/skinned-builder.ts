/**
 * PT 模型 → Three.js SkinnedMesh 构建器
 *
 * 严格依据 exm C++ 源码：
 *  - smOBJ3D::WorldForm（smObj3d.cpp:1320）顶点蒙皮变换
 *  - smMatrixMult（smmatrix.cpp:30）：行主序矩阵
 *
 * 支持多网格对象：每个有顶点的 GeomObject 独立构建一个 SkinnedMesh。
 */

import { reportFallback } from '../char/fallback-log.js';
import * as THREE from 'three';
import type { SmbData, MaterialInfo } from '../char/char-format.js';
import { evalSkeleton, matMulRow } from '../char/animation.js';

export interface SkinnedMeshResult {
  group: THREE.Group;
  meshes: THREE.SkinnedMesh[];
  skeleton: THREE.Skeleton;
  bones: THREE.Bone[];
  texturesToLoad: { url: string; mat: THREE.MeshPhongMaterial; nodeName: string }[];
  skeletonGroup: THREE.Group;
  /** 构建诊断。**把静默兜底变可见**：未知骨名会让顶点绑到根骨/首个绑定矩阵而表现为"变形"，
   *  只报数字很难查，故直接列出骨名与顶点数。 */
  diag: {
    /** 顶点引用了骨架里不存在的骨名 → 被兜底到根骨（值 = 顶点数）。非空即模型/骨架不匹配 */
    unknownBones: Array<{ name: string; count: number }>;
    /** 请求的网格名一个都没匹配到 → 回退成"用该模型全部网格"（通常是命名不一致） */
    meshFilterMissed: boolean;
    /** 实际使用的网格数 */
    meshCount: number;
  };
}

export interface SkeletonResult {
  bones: THREE.Bone[];
  skeleton: THREE.Skeleton;
  skeletonGroup: THREE.Group;
  boneByObj: Map<unknown, THREE.Bone>;
  bindLocalByName: Map<string, number[]>;
  bindWorldByName: Map<string, number[]>;
  boneIndexByName: Map<string, number>;
}

function intToFloat(intM: number[]): number[] {
  return intM.map(v => v / 256);
}

const ROT_X_NEG90 = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1];
const ROT_X_NEG90_INV = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1];

function toYup(rm: number[]): number[] {
  return matMulRow(ROT_X_NEG90, matMulRow(rm, ROT_X_NEG90_INV));
}

export function buildSkeleton(smb: SmbData, rawMode: boolean): SkeletonResult {
  const bones: THREE.Bone[] = [];
  const objByName = new Map(smb.objects.map(o => [o.nodeName, o]));

  const boneByObj = new Map<unknown, THREE.Bone>();
  for (const obj of smb.objects) {
    const bone = new THREE.Bone();
    bone.name = obj.nodeName || ('bone' + bones.length);
    bone.userData.nodeName = obj.nodeName;
    bone.userData.obj = obj;
    bone.userData.bindMatrixRowMajor = intToFloat(obj.tm.m);
    boneByObj.set(obj, bone);
    bones.push(bone);
  }

  for (const obj of smb.objects) {
    const bone = boneByObj.get(obj)!;
    if (obj.nodeParent) {
      const p = objByName.get(obj.nodeParent);
      if (p && boneByObj.has(p)) boneByObj.get(p)!.add(bone);
    }
  }

  const boneIndexByName = new Map<string, number>();
  bones.forEach((b, i) => boneIndexByName.set(b.userData.nodeName, i));

  const bindSkel = evalSkeleton(smb, 0, true);
  const bindLocalByName = new Map(bindSkel.map(sf => [sf.name, sf.local]));
  const bindWorldByName = new Map<string, number[]>();
  for (const sf of bindSkel) {
    bindWorldByName.set(sf.name, sf.world);
  }

  const skeleton = new THREE.Skeleton(bones);

  const tmp = new THREE.Matrix4();
  const posV = new THREE.Vector3();
  const quatQ = new THREE.Quaternion();
  const sclV = new THREE.Vector3();
  const boneWorld = (rowMajor: number[]) => rawMode ? rowMajor : toYup(rowMajor);

  for (const obj of smb.objects) {
    const bone = boneByObj.get(obj)!;
    const local = bindLocalByName.get(obj.nodeName);
    if (local) {
      tmp.fromArray(boneWorld(local));
      tmp.decompose(posV, quatQ, sclV);
      bone.position.copy(posV);
      bone.quaternion.copy(quatQ);
      bone.scale.copy(sclV);
    }
    bone.matrixWorldNeedsUpdate = true;
  }
  bones.forEach(b => { b.updateMatrixWorld(true); });
  skeleton.calculateInverses();

  const skeletonGroup = new THREE.Group();
  // 所有 root 骨骼（无 parent）都加入，确保孤立根骨骼（如武器 waraxe）的 matrixWorld 随动画/场景更新。
  // 只加 bones[0] 会让其他根骨骼脱离场景图 → 蒙皮矩阵僵死 → 武器等不显示。
  for (const b of bones) {
    if (!b.parent) skeletonGroup.add(b);
  }
  bones.forEach(b => { b.updateMatrixWorld(true); });

  return { bones, skeleton, skeletonGroup, boneByObj, bindLocalByName, bindWorldByName, boneIndexByName };
}

export function buildSkinnedMesh(
  smd: SmbData,
  smb: SmbData,
  meshNames: string[] | null,
  rawMode: boolean,
  sharedSkel: SkeletonResult,
): SkinnedMeshResult {
  const skel = sharedSkel;
  const { bones, skeleton, skeletonGroup, bindWorldByName, boneIndexByName } = skel;

  const objByName = new Map();
  smb.objects.forEach(obj => objByName.set(obj.nodeName, obj));

  let meshObjs = smd.objects.filter(o => o.nVertex > 0);
  let meshFilterMissed = false;
  if (meshNames && meshNames.length > 0) {
    const filtered = meshObjs.filter(o => {
      const lower = o.nodeName.toLowerCase();
      return meshNames.some(n => n.toLowerCase() === lower);
    });
    if (filtered.length > 0) meshObjs = filtered;
    else meshFilterMissed = true;   // 请求的名字一个都没中 → 回退用全部网格（下面会报出来）
  }
  if (meshObjs.length === 0) throw new Error('网格对象无顶点');

  const boneMatByName = new Map<string, number[]>();
  bones.forEach(b => boneMatByName.set(b.userData.nodeName, b.userData.bindMatrixRowMajor));

  const group = new THREE.Group();
  const meshes: THREE.SkinnedMesh[] = [];
  /** 顶点引用了骨架里不存在的骨名（→ 被兜底到根骨/首个绑定矩阵，表现为变形） */
  const unknownBones = new Map<string, number>();
  const texturesToLoad: { url: string; mat: THREE.MeshPhongMaterial; nodeName: string }[] = [];

  const transformVertex = (rx: number, ry: number, rz: number) => rawMode ? [rx, ry, rz] : [rx, rz, -ry];
  const transformNormal = (fx: number, fy: number, fz: number) => rawMode ? [fx, fy, fz] : [fx, fz, -fy];

  for (const meshObj of meshObjs) {
    const objMats = smd.materials || [];
    const usedMatIdx = new Set<number>();
    for (const f of meshObj.faces) {
      const mi = f.v[3];
      if (mi >= 0 && mi < objMats.length) usedMatIdx.add(mi);
      else usedMatIdx.add(-1);
    }

    for (const matIdx of usedMatIdx) {
      const positions: number[] = [];
      const normals: number[] = [];
      const uvs: number[] = [];
      const skinIndices: number[] = [];
      const skinWeights: number[] = [];
      const indices: number[] = [];

      let triCount = 0;
      for (const [fi, f] of meshObj.faces.entries()) {
        const mi = f.v[3];
        const isThisMat = (mi >= 0 && mi < objMats.length) ? (mi === matIdx) : (matIdx === -1);
        if (!isThisMat) continue;

        let tl = null;
        if (meshObj.texLinkPtr && f.lpTexLink) {
          const tlIdx = (f.lpTexLink - meshObj.texLinkPtr) / 32;
          if (tlIdx >= 0 && tlIdx < meshObj.texLinks.length) tl = meshObj.texLinks[tlIdx];
        }
        if (!tl) tl = meshObj.texLinks[fi];

        for (let k = 0; k < 3; k++) {
          const vidx = f.v[k];
          const v = meshObj.vertices[vidx];
          const name = meshObj.boneNames && meshObj.boneNames[vidx] ? meshObj.boneNames[vidx] : '';
          // ⚠ 两处兜底都会造成"变形"：未知骨名 → 用**首个**绑定矩阵 + 绑到**根骨**。
          // 只统计、不改变行为（改了会静默丢几何），但把名字报进 diag 便于一眼定位。
          if (name && !bindWorldByName.has(name)) unknownBones.set(name, (unknownBones.get(name) ?? 0) + 1);
          const m = bindWorldByName.has(name) ? bindWorldByName.get(name)! : bindWorldByName.values().next().value!;

          const lx = v.x, ly = v.y, lz = v.z;
          const rx = lx * m[0] + ly * m[4] + lz * m[8] + m[12];
          const ry = lx * m[1] + ly * m[5] + lz * m[9] + m[13];
          const rz = lx * m[2] + ly * m[6] + lz * m[10] + m[14];
          positions.push(...transformVertex(rx, ry, rz));

          const nx = v.nx, ny = v.ny, nz = v.nz;
          const fx = nx * m[0] + ny * m[4] + nz * m[8];
          const fy = nx * m[1] + ny * m[5] + nz * m[9];
          const fz = nx * m[2] + ny * m[6] + nz * m[10];
          normals.push(...transformNormal(fx, fy, fz));

          if (tl) {
            uvs.push(tl.u[k], 1.0 - tl.v[k]);
          } else {
            uvs.push(0, 0);
          }

          const boneIdx = boneIndexByName.has(name) ? boneIndexByName.get(name)! : 0;
          skinIndices.push(boneIdx, 0, 0, 0);
          skinWeights.push(1, 0, 0, 0);
        }
        indices.push(triCount * 3, triCount * 3 + 1, triCount * 3 + 2);
        triCount++;
      }

      if (triCount === 0) continue;

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
      geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
      geo.setIndex(indices);

      const matData: MaterialInfo | undefined = matIdx >= 0 ? objMats[matIdx] : undefined;
      const mat = new THREE.MeshPhongMaterial({ color: 0x8899aa, side: THREE.DoubleSide });
      if (matData) {
        if (matData.twoSide === 1) mat.side = THREE.DoubleSide;
        else mat.side = THREE.FrontSide;
        if (matData.blendType === 4 || matData.blendType === 5) {
          mat.transparent = true;
          mat.blending = THREE.AdditiveBlending;
        } else if (matData.blendType === 1) {
          mat.transparent = true;
          mat.blending = THREE.NormalBlending;
        }
        if (matData.texturePaths && matData.texturePaths.length > 0) {
          texturesToLoad.push({ url: matData.texturePaths[0], mat, nodeName: meshObj.nodeName });
        }
      }

      const mesh = new THREE.SkinnedMesh(geo, mat);
      mesh.userData.nodeName = meshObj.nodeName;
      mesh.userData.materialIndex = matIdx;
      group.add(mesh);
      meshes.push(mesh);
    }
  }

  // ⚠ **必须显式传 bindMatrix**：three 的 `bind(skeleton)` 在矩阵缺省时会调用
  // `skeleton.calculateInverses()` —— 即**按骨骼"当前"矩阵重算逆绑定矩阵**。
  // 本骨架被身体与头（以及每次换头）**共享**：初次加载时骨骼仍在绑定姿势，重算无害；
  // 但 `swapHead` 发生在动画已摆过姿势之后，重算就把"当前姿势"当成了绑定姿势，
  // 于是**所有共享该骨架的网格一起变形**（手/四肢扭成麻花），且每次换头累积一次
  //（用户实测：换头饰 tier 后手部变形 → 切战斗姿态后全身扭曲）。
  // 顶点几何本就在骨架绑定空间里（见上方 bindWorldByName 变换），故用单位矩阵；
  // 骨架的 `boneInverses` 只由 `buildSkeleton` 在绑定姿势下算一次。
  const BIND_IDENTITY = new THREE.Matrix4();
  for (const m of meshes) {
    m.bind(skeleton, BIND_IDENTITY);
  }
  group.userData.smd = smd;
  group.userData.smb = smb;
  // 未知骨名 = 顶点被兜底绑到根骨/首个绑定矩阵 → 表现为"变形"。**必须上报**，
  // 否则只能从画面异常反推（用户明确反对静默兜底）。
  if (unknownBones.size) {
    const names = [...unknownBones].sort((a, b) => b[1] - a[1]);
    reportFallback('skin', `骨架中不存在这些骨名（顶点已绑到根骨）：`
      + names.slice(0, 5).map(([n, c]) => `${n}×${c}`).join(', ')
      + (names.length > 5 ? ` …共 ${names.length} 个` : ''));
  }
  if (meshFilterMissed) {
    reportFallback('skin', `请求的网格名一个未匹配 → 回退用该模型全部 ${meshObjs.length} 个网格`);
  }
  return {
    group, meshes, skeleton, bones, texturesToLoad, skeletonGroup,
    diag: {
      unknownBones: [...unknownBones].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name, count })),
      meshFilterMissed,
      meshCount: meshObjs.length,
    },
  };
}
