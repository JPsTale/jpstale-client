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
  /**
   * **烘焙空间指纹** = 这套绑定姿势的精确摘要。进 `meshPartCache` 的键：
   * 顶点几何是在绑定姿势空间里烘出来的，换一套绑定姿势就不能复用同一份几何
   * （完整推导见 `meshPartCache` 的注释）。
   */
  bindKey: string;
}

/**
 * 绑定姿势指纹：按骨名 + 16 个数逐项量化（1/65536 单位 —— 远小于任何可见差异，
 * 但足以区分"lite 包 / 完整包"这种整骨级别的差异）。
 * 用**精确字符串**而不是哈希：哈希碰撞会静默地让两套姿势共用一份几何 —— 正是本键要防的错
 *（AGENTS #12：降级/巧合都不能静默）。同一姿势算出的字符串相等，`Map` 自动共享同一条目。
 */
function bindKeyOf(bindWorldByName: Map<string, number[]>): string {
  const parts: string[] = [];
  for (const [name, m] of bindWorldByName) {
    let s = name + ':';
    for (let i = 0; i < 16; i++) s += Math.round(m[i] * 65536) + ',';
    parts.push(s);
  }
  return parts.join(';');
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

  return { bones, skeleton, skeletonGroup, boneByObj, bindLocalByName, bindWorldByName, boneIndexByName, bindKey: bindKeyOf(bindWorldByName) };
}

/**
 * 骨架**无关**的产物缓存：**geometry + material**（按网格数据实例存）。
 *
 * 为什么能共享：这两样只依赖 `(网格数据, rawMode, 骨架的绑定姿势矩阵)`，不依赖具体哪一副
 * 骨架**实例** —— 同一个 modelFile 解析出来的 SmbData 是同一份（AssetManager 的解析缓存保证），
 * 而绑定姿势相同 ⇒ 数值必然相同。
 *
 * ⚠ **key 必须含"绑定姿势"（`SkeletonResult.bindKey`），不能只有 smd**：
 * 顶点在 `buildSkinnedMesh` 里被**预乘进绑定姿势的世界空间**（下面 `bindWorldByName`），
 * 而蒙皮用的是这具骨架自己的 `boneInverses`（= 同一个绑定姿势的逆）——**两者必须出自同一套姿势**。
 * 同一份 .smd 会被**不同的动画包**装配：lite 包（选角预览）与完整包（进游戏）。
 * lite 包只保留一条 STAND、帧轴从 1 开始（`client/char/tmabcd/lite/README.md`），于是它的
 * `evalSkeleton(smb, 0)` ≠ 完整包的帧 0 —— 两套"绑定姿势"差最多 4.3 个单位（逐骨常量错位）。
 * 谁先烘这份几何，另一套骨架就会按**自己的**绑定姿势去解释它 ⇒ 四肢/手被常量矩阵扭开。
 * 用户 2026-09-21 实测：进游戏（完整包先烘）再回选角，预览角色手部变形 —— 就是这条。
 *
 * 为什么 **SkinnedMesh 实例不能共享**：它要 `bind()` 到各自的 skeleton（每只怪的动画相位、
 * 位置都不同）。所以这里缓存的是"原料"，每只怪仍新建自己的 SkinnedMesh。
 *
 * 实测背景：222 只怪 = 222 套 geometry/material（"几何体 655 / 不同材质 556"就是这么来的），
 * 而它们只来自少数几种模型；顺带每只怪都会重新解码一遍贴图（下面用 `material.map` 已存在来短路）。
 */
interface CachedMeshPart {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshPhongMaterial;
  /** 该材质要加载的贴图（undefined = 无贴图材质） */
  url?: string;
  nodeName: string;
  materialIndex: number;
}
/** smd 实例 → **绑定姿势指纹** → (网格名|材质索引) → 原料 */
const meshPartCache = new WeakMap<SmbData, Map<string, WeakMap<object, Map<number, CachedMeshPart>>>>();

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
  /** 单位矩阵（行主序，16 元）—— 未知骨名的顶点用它预乘 ⇒ 顶点停在局部坐标、位置明显不对。
   *  **这是有意为之的"明确失败"**：此前用"首个绑定矩阵"顶替，会把数据错画成"看起来正常"，
   *  事后只能从画面反推（用户明确要求删掉这类兜底）。 */
  const IDENTITY_ROW = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const texturesToLoad: { url: string; mat: THREE.MeshPhongMaterial; nodeName: string }[] = [];
  // 原料缓存（见 CachedMeshPart 的说明）：同一个 smd 反复装配时复用 geometry/material。
  // ⚠ key 必须按【obj 实例】分层：`.smd` 里多个 obj 可以**同名**（本模型 6 个都叫 `pr_d`），
  // 若按 `nodeName + 材质号` 做 key，不同 obj 的同号材质会互相命中缓存 → 复用错几何 → 
  // 整段部件消失（用户实测：D_PR 缺胸口以下，实测顶点数与预期逐组对账差 159）。
  let byBind = meshPartCache.get(smd);
  if (!byBind) {
    byBind = new Map();
    meshPartCache.set(smd, byBind);
  }
  // 烘焙空间 = 骨架的绑定姿势（+ rawMode：`transformVertex` 按它换轴，见下）。
  // 同姿势的多副骨架（例如同一只怪的每次生成）算出**同一个 key 字符串** ⇒ 仍共用原料。
  const bindSpace = (rawMode ? 'raw|' : 'yup|') + skel.bindKey;
  let partCache = byBind.get(bindSpace);
  if (!partCache) {
    partCache = new WeakMap();
    byBind.set(bindSpace, partCache);
  }
  const transformVertex = (rx: number, ry: number, rz: number) => rawMode ? [rx, ry, rz] : [rx, rz, -ry];
  const transformNormal = (fx: number, fy: number, fz: number) => rawMode ? [fx, fy, fz] : [fx, fz, -fy];

  for (const meshObj of meshObjs) {
    // 本 obj 的分组缓存（按 obj 实例分层，见上方说明）
    let objCache = partCache.get(meshObj);
    if (!objCache) {
      objCache = new Map();
      partCache.set(meshObj, objCache);
    }
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
          // 未知骨名：**不兜底**（此前拿"首个绑定矩阵"顶替 —— 那会把"数据错"画成"看起来正常"）。
          // 现在的行为是**明确的错**：单位阵预乘 ⇒ 顶点停在局部坐标 ⇒ 位置明显不对、看得见。
          const known = bindWorldByName.has(name);
          if (!known) unknownBones.set(name || '(空骨名)', (unknownBones.get(name || '(空骨名)') ?? 0) + 1);
          const m = known ? bindWorldByName.get(name)! : IDENTITY_ROW;

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

          // 未知骨名 ⇒ **权重 0**：该顶点不被任何骨骼驱动（停在预乘后的位置）。
          // 此前是"绑到 bones[0]"（= Bip01 Head）—— 那会把"骨名对不上"伪装成"绑上了某根骨"，
          // 症状是部件被拉到头上还看不出原因（用户明确要求删掉这个兜底，只保留上报）。
          const boneIdx = boneIndexByName.get(name);
          skinIndices.push(boneIdx ?? 0, 0, 0, 0);
          skinWeights.push(boneIdx === undefined ? 0 : 1, 0, 0, 0);
        }
        indices.push(triCount * 3, triCount * 3 + 1, triCount * 3 + 2);
        triCount++;
      }

      if (triCount === 0) continue;

      // ① 先查"原料缓存"（geometry + material）：同一模型被多只怪复用时只建一次。
      //    key = 材质号即可 —— 缓存的层级已经按 obj 实例分开了（见上方 partCache 说明）
      const partKey = matIdx;
      let part = objCache.get(partKey);
      if (!part) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
        geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
        geo.setIndex(indices);

        const matData: MaterialInfo | undefined = matIdx >= 0 ? objMats[matIdx] : undefined;
        const mat = new THREE.MeshPhongMaterial({ color: 0x8899aa, side: THREE.DoubleSide });
        let url: string | undefined;
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
          if (matData.texturePaths && matData.texturePaths.length > 0) url = matData.texturePaths[0];
        }
        part = { geometry: geo, material: mat, url, nodeName: meshObj.nodeName, materialIndex: matIdx };
        objCache.set(partKey, part);
      }

      // ② 贴图：`material.map` 已存在说明这个共享材质的贴图早加载过了 —— 不再重复交给调用方
      //    （否则每只怪都会把同一张贴图重新解码一遍；实测"纹理 867 个"有一部分来自这里）。
      if (part.url && !part.material.map) {
        texturesToLoad.push({ url: part.url, mat: part.material, nodeName: part.nodeName });
      }

      // ③ 实例**不能**共享（要 bind 各自的骨架），每次新建
      const mesh = new THREE.SkinnedMesh(part.geometry, part.material);
      mesh.userData.nodeName = part.nodeName;
      mesh.userData.materialIndex = part.materialIndex;
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
