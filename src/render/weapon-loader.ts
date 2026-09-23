/**
 * PT 纸娃娃系统 — 武器加载器
 *
 * 移植自 pviewer/js/weapon-loader.js，改用项目内 parseSmb / cachedFetch。
 * 加载武器 DropItem .smd，构建静态 Mesh 挂到骨骼上。
 * 依据 C++ 源码：
 *  - character.cpp:SetTool — sinGetItemInfo → "Image\sinImage\Items\DropItem\it{DorpItem}.ASE"
 *  - character.cpp:RenderD3D — LinkParentObject(AnimPattern, ObjBip) → 父子跟随
 *  - 骨骼名："Bip weapon01"（右手武器），"Bip01 L Hand"（左手），"Bip01 L Forearm"（盾）
 */

import * as THREE from 'three';
import { parseSmb } from '../core/char-parser.js';
import { cachedFetch } from '../core/asset-cache.js';
import { getSheatheSlot } from '../char/weapon-type.js';
import type { BlinkFx } from './blink-fx.js';

const DROPITEM_DIR = 'image/sinimage/items/dropitem/';

/**
 * 加载武器模型（.smd），构建静态 Three.js Group
 *
 * 武器 .smd 格式与角色相同（parseSmb），但无骨骼动画，
 * 顶点直接在武器局部空间（origin = 握把，+Z = 刀刃方向）。
 *
 * @param dorpItem 武器模型代码，如 "WA102"、"WS201"
 */
export async function loadWeaponModel(dorpItem: string): Promise<{ group: THREE.Group; texturesToLoad: { url: string; mat: THREE.MeshPhongMaterial; nodeName: string }[] }> {
  const smdName = 'it' + dorpItem.toLowerCase();
  return loadSmdFromUrl('/res/' + DROPITEM_DIR + smdName + '.smd', 'weapon_' + dorpItem);
}

/**
 * 地面掉落物品模型（忠于 C++ 客户端 scITEM）：
 * 优先加载该物品的 DropItem 模型（it{DorpItem}.smd）；
 * 无模型码或加载失败 → 回退到原版兜底 "char\flag\wow.smd"（旗帜标记），
 * 而不是自造占位几何体。
 */
export async function loadDropItemModel(dorpItem: string | null): Promise<{ group: THREE.Group; texturesToLoad: { url: string; mat: THREE.MeshPhongMaterial; nodeName: string }[] }> {
  if (dorpItem) {
    try {
      return await loadWeaponModel(dorpItem);
    } catch (e) {
      console.warn('[DropItem] 无模型 it' + dorpItem.toLowerCase() + '.smd，回退旗帜', e);
    }
  }
  return loadSmdFromUrl('/res/char/flag/wow.smd', 'dropflag');
}

/**
 * 武器的「长度」—— 等价于原版 `smCHARTOOL::SizeMax`。**按需算，调用方自己缓存**（形状不变）。
 *
 * 原版怎么拿的（exm `character.cpp:1413-1424`，`SetTool` 装武器时）：
 *   加载武器 mesh，遍历**所有子网格**取 `maxY` 的最大值 ⇒ `HvRightHand.SizeMax`；
 *   随后 `GetAttackPoint`（`:301`）用它算出手点：`tz = SizeMax / 2`，
 *   沿**右手武器骨的局部 Z**（= 武器伸出方向）偏移 ⇒ 出手点是"武器中部"而非骨根部。
 *
 * ⚠ 轴向差异：原版量的是**模型局部 Y**，前提是"武器模型以 Y 为长轴"。我方
 * `loadSmdFromUrl` 统一做过 Z-up→Y-up 转换，原版那个 Y 在我方未必还是 Y
 * ⇒ 这里取**包围盒最长的那一维**：语义仍是"从挂点到顶端的长度"，但不依赖建模约定。
 */
export function weaponSizeMax(group: THREE.Object3D): number {
  // ⚠ **必须在武器自己的局部空间里量**。原先直接 `new Box3().setFromObject(group)` ——
  //   那是**世界轴对齐盒**，而本函数通常在武器**已挂到骨上**之后调用 ⇒ 斜握的武器其 AABB
  //   会把旋转后的斜向跨度一并算进来 ⇒ 量出"比武器长很多"（用户实测：双手斧的曳光
  //   "光比武器长很多"）。源码量的是**武器模型自己**的尺寸（`character.cpp:1981-1988`，
  //   逐子网格取 `maxY`），**与挂载姿态无关** ⇒ 先把每个子网格的盒变换回 group 局部再并。
  group.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  const mat = new THREE.Matrix4();
  let any = false;
  group.traverse((o) => {
    const m = o as THREE.Mesh & { isMesh?: boolean };
    if (!m.isMesh || !m.geometry) return;
    m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox;
    if (!bb || !Number.isFinite(bb.max.x)) return;
    mat.copy(inv).multiply(m.matrixWorld);      // 网格局部 → 世界 → group 局部
    tmp.copy(bb).applyMatrix4(mat);
    if (any) box.union(tmp); else { box.copy(tmp); any = true; }
  });
  if (!any || !Number.isFinite(box.max.x)) return 0;
  const size = box.getSize(new THREE.Vector3());
  return Math.max(size.x, size.y, size.z);
}

/**
 * 从任意 .smd 构建静态 Group（角色/武器/物品同构），Y-up 顶点转换在此统一。
 */
export async function loadSmdFromUrl(url: string, label: string): Promise<{ group: THREE.Group; texturesToLoad: { url: string; mat: THREE.MeshPhongMaterial; nodeName: string }[] }> {
  const buf = await cachedFetch(url);
  const smd = parseSmb(buf);

  const group = new THREE.Group();
  group.name = label;
  const texturesToLoad: { url: string; mat: THREE.MeshPhongMaterial; nodeName: string }[] = [];

  const meshObjs = smd.objects.filter(o => o.nVertex > 0);
  if (meshObjs.length === 0) {
    throw new Error('模型无顶点: ' + label);
  }

  const objMats = smd.materials || [];

  for (const meshObj of meshObjs) {
    const usedMatIdx = new Set<number>();
    for (const f of meshObj.faces) {
      const mi = f.v[3];
      if (mi >= 0 && mi < objMats.length) usedMatIdx.add(mi);
      else usedMatIdx.add(-1);
    }
    const matIdxs = [...usedMatIdx];

    for (const matIdx of matIdxs) {
      const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [];
      let triCount = 0;

      meshObj.faces.forEach((f, fi) => {
        const mi = f.v[3];
        const isThisMat = (mi >= 0 && mi < objMats.length) ? (mi === matIdx) : (matIdx === -1);
        if (!isThisMat) return;

        let tl = null;
        if (meshObj.texLinkPtr && f.lpTexLink) {
          const tlIdx = (f.lpTexLink - meshObj.texLinkPtr) / 32;
          if (tlIdx >= 0 && tlIdx < meshObj.texLinks.length) tl = meshObj.texLinks[tlIdx];
        }
        if (!tl) tl = meshObj.texLinks[fi];

        for (let k = 0; k < 3; k++) {
          const vidx = f.v[k];
          const v = meshObj.vertices[vidx];

          // Z-up → Y-up 坐标转换
          positions.push(v.x, v.z, -v.y);
          normals.push(v.nx, v.nz, -v.ny);

          if (tl) {
            uvs.push(tl.u[k], 1.0 - tl.v[k]);
          } else {
            uvs.push(0, 0);
          }
        }
        indices.push(triCount * 3, triCount * 3 + 1, triCount * 3 + 2);
        triCount++;
      });

      if (triCount === 0) continue;

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(indices);

      const material = objMats[matIdx];
      const mat = new THREE.MeshPhongMaterial({ color: 0x8899aa, side: THREE.DoubleSide });
      if (matIdx >= 0 && material) {
        if (material.twoSide === 1) mat.side = THREE.DoubleSide;
        else mat.side = THREE.FrontSide;
        if (material.blendType === 4 || material.blendType === 5) {
          mat.transparent = true;
          mat.blending = THREE.AdditiveBlending;
        } else if (material.blendType === 1) {
          mat.transparent = true;
        }
        if (material.texturePaths && material.texturePaths.length > 0) {
          texturesToLoad.push({ url: material.texturePaths[0], mat, nodeName: meshObj.nodeName });
        }
      }

      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = meshObj.nodeName || 'weapon_part';
      group.add(mesh);
    }
  }

  return { group, texturesToLoad };
}

/**
 * 在骨架骨骼树中查找骨骼 Object3D（大小写不敏感）
 */
export function findBone(root: THREE.Object3D, name: string): THREE.Object3D | null {
  const lower = name.toLowerCase();
  let found: THREE.Object3D | null = null;
  root.traverse(obj => {
    if (!found && obj.name && obj.name.toLowerCase() === lower) {
      found = obj;
    }
  });
  return found;
}

/**
 * 武器挂载点名称（与 C++ szBipName_* 对应）
 */
export const WEAPON_BONES = {
  RIGHT_HAND: 'Bip weapon01',
  LEFT_HAND: 'Bip01 L Hand',
  SHIELD: 'Bip01 L Forearm',      // 盾 **与法球（sinOM1）** 共用 —— 见 SetTool 的 LHAND 分支
  ASSASSIN_LEFT: 'Bip weapon05',  // szBipName_Assassin_LeftHand（仅 sinWD1 + JOBCODE_ASSASSINE）
  // 收起姿态（character.cpp szBipName_ 系列，L398 起）
  SHEATHE_BACK: 'Bip in01',       // 剑/斧/锤/标枪/镰/杖入背（BackObjBip[0]）
  SHEATHE_BOW: 'Bip in-bow',      // 弓入背（BackObjBip[2]）
  SHEATHE_CROSSBOW: 'Bip in-cro', // 弩入背（BackObjBip[1]）
  // 刺客匕首腰挂：**只存在于 m6 骨架**（两版 C++ 未引用，见 sheathe-rules.ts 的说明）
  SHEATHE_DAGGER_L: 'Bip in_DaggerL',
  SHEATHE_DAGGER_R: 'Bip in_DaggerR',
};


/**
 * 收械（sheathed）时的挂载骨。**唯一实现** —— WorldView / CharSelect 都必须调它。
 *
 * 槽位由 `sheathe-rules` + 生成物决定（源码三张表 → 族规则 → default），
 * 这里只做"语义槽 → 客户端骨骼名"的映射，骨骼名是客户端资产、不写进语义数据。
 */
export function sheatheBone(idcode: number | null | undefined): string {
  const slot = getSheatheSlot(idcode ?? 0).slot;
  switch (slot) {
    case 'hand': return WEAPON_BONES.RIGHT_HAND;      // 留手上（手弩 WS102/103/109、爪、WS201-203…）
    case 'bow': return WEAPON_BONES.SHEATHE_BOW;      // "Bip in-bow"（BackSpineCross）
    case 'crossbow': return WEAPON_BONES.SHEATHE_CROSSBOW; // "Bip in-cro"（BackSpineBow）
    case 'dagger_l': return WEAPON_BONES.SHEATHE_DAGGER_L; // "Bip in_DaggerL"（仅 m6 骨架有）
    case 'dagger_r': return WEAPON_BONES.SHEATHE_DAGGER_R; // "Bip in_DaggerR"（仅 m6 骨架有）
    default: return WEAPON_BONES.SHEATHE_BACK;        // "Bip in01"（BackSpine）
  }
}

/**
 * 主手武器是否还要**镜像一份到左侧**（同一个武器挂两侧）。返回左侧骨名，无则 null。
 *
 * 目前只有**刺客匕首（WD 族）**会镜像 —— 用户实测 + 源码双证：
 *   `character.cpp` `SetTool` 的左手分支：`sinWD1 && JOB_CODE == JOBCODE_ASSASSINE`
 *   → `HvLeftHand.ObjBip = szBipName_Assassin_LeftHand`（= `"Bip weapon05"`，L696）；
 *   装备时 `sinInvenTory.cpp` 走 `sinSetCharItem(CODE, LHAND)` **加** `(CODE, RHAND)`
 *   → **同一把匕首在两手同时显示**（左右手各一把）。
 * 安全区（收械）时同理镜像到**左右腰**：`Bip in_DaggerR` + `Bip in_DaggerL`
 *   —— 这两根骨只存在于 m6（刺客）骨架，正是为此。
 *
 * 调用方保留自己的"主手骨"判定（如弓用左手、持械用右手），只额外问本函数要不要镜像。
 *
 * ⚠ **只对匕首有意义**（用户明确）：刺客拿其他武器（剑/斧/弓…）时**仍按原规则** ——
 * 收械入背或留手上，单侧单份，绝不镜像。故本函数的唯一触发条件是"收械槽是匕首"，
 * 与职业无关；又因 WD 匕首的职业清单本就是 Assassin 专属（见 AGENTS.md 纠错 #8c），
 * 实际只会在刺客身上出现。
 */
export function mirrorLeftBone(idcode: number | null | undefined, stance: 'combat' | 'sheathed'): string | null {
  const slot = getSheatheSlot(idcode ?? 0).slot;
  if (slot !== 'dagger_r' && slot !== 'dagger_l') return null;
  return stance === 'combat' ? WEAPON_BONES.ASSASSIN_LEFT : WEAPON_BONES.SHEATHE_DAGGER_L;
}

/** 主手战斗骨：weaponPos=2 → 左手，其余右手（character.cpp SetTool） */
export function combatBoneOf(weaponPos: number | null | undefined): string {
  return weaponPos === 2 ? WEAPON_BONES.LEFT_HAND : WEAPON_BONES.RIGHT_HAND;
}

/**
 * 副手件（盾 / 匕首）的挂载骨 —— 与主手同族的骨判定，自机 / 远端 / 检查器共用。
 * 盾固定在左小臂（含法球，见 SetTool 的 LHAND 分支）；匕首按 `mirrorLeftBone`
 * （战斗左手 / 收械左腰）——刺客双持时主手镜像到左手武器骨，副手匕首才走这里。
 */
export function offMountBoneOf(idcode: number | null | undefined, offKind: number, stance: 'combat' | 'sheathed'): string {
  if (offKind === 1) return WEAPON_BONES.SHIELD;
  return mirrorLeftBone(idcode, stance) ?? WEAPON_BONES.LEFT_HAND;
}

/** 一次挂载/搬运的结果 —— 调用方据此打日志、上报降级 */
export interface MountResult {
  /** 主手实际挂到的骨（null = 没找到可用骨，未挂上） */
  mainBone: string | null;
  /** 镜像份实际挂到的骨（null = 该武器不需要镜像，或镜像骨不存在） */
  mirrorBone: string | null;
  /** 找不到的骨名（供调用方 `reportFallback`；null = 一切正常） */
  missingBone: string | null;
}

/**
 * 主手武器挂载（含**双手武器的镜像份**）—— 自机 / 远端 / 检查器的**唯一实现**。
 *
 * 它收敛的是三件以前被各写一遍、于是彼此不一致的事：
 *   1. **主手骨判定**：持械 = `weaponPos=2 ? 左手 : 右手`；收械 = `sheatheBone(idcode)` 的槽位；
 *   2. **镜像份**：`mirrorLeftBone` 非空时（即刺客匕首）在另一侧 `clone()` 一份
 *      —— 此前只有检查器做了这一步，游戏内左手永远空着（用户实测"刺客没有双持"）；
 *   3. **姿态搬运**：持械 ↔ 收械时主手与镜像份**成对**搬（攻击=双手 / 安全区=双腰）。
 *
 * ⚠ 镜像份是 `clone()`（three 的 Object3D 只能有一个父节点），它**不随主手组更新** ——
 *   换武器必须重建，否则左手会一直显示上一把（检查器踩过这个坑）。
 *   `mount()` 每次都会重建，调用方只管在换武器时调它。
 */
export class WeaponMount {
  private mainGroup: THREE.Group | null = null;
  private mirrorGroup: THREE.Group | null = null;
  private idcode = 0;
  private combatBone: string = WEAPON_BONES.RIGHT_HAND;
  private stance: 'combat' | 'sheathed' = 'combat';
  private blinkFx: BlinkFx | null = null;

  /** 当前主手组（null = 没武器）；所有权仍归调用方 */
  get group(): THREE.Group | null { return this.mainGroup; }
  /** 当前镜像份（null = 该武器不镜像） */
  get mirror(): THREE.Group | null { return this.mirrorGroup; }
  get currentStance(): 'combat' | 'sheathed' { return this.stance; }
  /**
   * 挂在这件武器上的锻造/合成呼吸发光（null = 没建/已卸）。
   * 用 `blink.update(nowMs)` 每帧推进 —— 自机与远端的**主手**都由挂载器持有它，
   * 副手（盾/匕首）另建一份（见 WorldView 的 offHandBlink）。
   */
  get blink(): BlinkFx | null { return this.blinkFx; }

  /**
   * 换/设主手武器并立即按 `stance` 挂好（`group=null` = 卸下）。
   * 换武器**必须**走这里（镜像份要重建）。
   *
   * `blink` 由调用方用 `BlinkFx.create(group, row)` 建好（**必须在挂载之前**：
   * 叠加层是挂在网格子节点上的，晚于 `clone()` 建立的镜像份就带不上它了）。
   * 换武器时旧的发光效果在这里被 `dispose()`（那件已经换下，不该继续占着材质）。
   */
  mount(
    root: THREE.Object3D,
    group: THREE.Group | null,
    idcode: number | null | undefined,
    weaponPos: number | null | undefined,
    stance: 'combat' | 'sheathed',
    blink: BlinkFx | null = null,
  ): MountResult {
    this.detach();
    this.blinkFx?.dispose();
    this.blinkFx = blink;
    this.mainGroup = group;
    this.idcode = idcode ?? 0;
    this.combatBone = combatBoneOf(weaponPos);
    this.stance = stance;
    if (!group) return { mainBone: null, mirrorBone: null, missingBone: null };
    return this.place(root);
  }

  /** 姿态切换（持械 ↔ 收械）：主手与镜像份成对搬运。无武器时是空操作。 */
  setStance(root: THREE.Object3D, stance: 'combat' | 'sheathed'): MountResult {
    this.stance = stance;
    if (!this.mainGroup) return { mainBone: null, mirrorBone: null, missingBone: null };
    return this.place(root);
  }

  /** 摘除主手与镜像（不销毁组本身 —— 组的所有权在调用方；发光效果也不在这里销毁，
   *  因为可能只是姿态搬运/临时摘除，真正的销毁发生在换武器 `mount()` 或调用方明确丢弃时） */
  detach(): void {
    this.mainGroup?.parent?.remove(this.mainGroup);
    this.mirrorGroup?.parent?.remove(this.mirrorGroup);
    this.mirrorGroup = null;
  }

  /** 按当前 (stance, idcode) 把主手与镜像放到正确骨上 */
  private place(root: THREE.Object3D): MountResult {
    const mainBoneName = this.stance === 'combat' ? this.combatBone : sheatheBone(this.idcode);
    // 镜像骨：只有需要镜像的武器（刺客匕首）才有；战斗=左手武器骨、收械=左腰
    const mirrorBoneName = mirrorLeftBone(this.idcode, this.stance);

    if (mirrorBoneName && this.mainGroup) {
      if (!this.mirrorGroup) this.mirrorGroup = this.mainGroup.clone();
    } else if (this.mirrorGroup) {
      this.mirrorGroup.parent?.remove(this.mirrorGroup);
      this.mirrorGroup = null;
    }

    const mainTarget = this.findMountBone(root, mainBoneName);
    if (mainTarget && this.mainGroup) mainTarget.add(this.mainGroup);
    // 镜像骨**不做回退**：找不到就不挂。回退到右手只会让两份武器重叠在同一个位置，
    // 比"少一份"更难诊断（该骨架本就没有那根骨，属数据/职业不匹配，由调用方上报）。
    const mirrorTarget = mirrorBoneName ? findBone(root, mirrorBoneName) : null;
    if (mirrorTarget && this.mirrorGroup) mirrorTarget.add(this.mirrorGroup);

    return {
      mainBone: mainTarget ? mainTarget.name : null,
      mirrorBone: mirrorTarget ? mirrorTarget.name : null,
      missingBone: !mainTarget ? mainBoneName : (mirrorBoneName && !mirrorTarget ? mirrorBoneName : null),
    };
  }

  /** 挂载骨查找：指定骨 → 右手 → 左手（旧实现遗留的回退链，三处一致） */
  private findMountBone(root: THREE.Object3D, name: string): THREE.Object3D | null {
    return findBone(root, name)
      || findBone(root, WEAPON_BONES.RIGHT_HAND)
      || findBone(root, WEAPON_BONES.LEFT_HAND);
  }
}

/**
 * 角色 .smd 的骨骼绑定用角色本身骨骼（不引用武器骨骼），
 * 武器是静态 Group 挂到骨骼 Object3D 下。此函数无参版本供外部置空。
 */
export const isPreloadedWeapons = (): boolean => false;
