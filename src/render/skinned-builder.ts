/**
 * PT 模型 → Three.js SkinnedMesh 构建器
 *
 * 严格依据 exm C++ 源码：
 *  - smOBJ3D::WorldForm（smObj3d.cpp:1320）顶点蒙皮变换
 *  - smMatrixMult（smmatrix.cpp:30）：行主序矩阵
 *
 * 支持多网格对象：每个有顶点的 GeomObject 独立构建一个 SkinnedMesh。
 */

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
  skeletonGroup.add(bones[0]);
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
  if (meshNames && meshNames.length > 0) {
    const filtered = meshObjs.filter(o => {
      const lower = o.nodeName.toLowerCase();
      return meshNames.some(n => n.toLowerCase() === lower);
    });
    if (filtered.length > 0) meshObjs = filtered;
  }
  if (meshObjs.length === 0) throw new Error('网格对象无顶点');

  const boneMatByName = new Map<string, number[]>();
  bones.forEach(b => boneMatByName.set(b.userData.nodeName, b.userData.bindMatrixRowMajor));

  const group = new THREE.Group();
  const meshes: THREE.SkinnedMesh[] = [];
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

  for (const m of meshes) {
    m.bind(skeleton);
  }
  group.userData.smd = smd;
  group.userData.smb = smb;
  return { group, meshes, skeleton, bones, texturesToLoad, skeletonGroup };
}
