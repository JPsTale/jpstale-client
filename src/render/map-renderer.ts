/**
 * Map Renderer — setDrawRange + CPU index 打包架构。
 * 迁移自 maps/js/map-renderer.js,TS 化;去掉 window.__ptWindAmpScale 全局钩子(恒 1)。
 *
 * **剔除是两级的**（2026-09-21 改，见 `KEY_SHIFT` / `blockOfKey` / `render()` 的注释）：
 *   ① 材质级 AABB → ② **大格子级**（每图一次、所有材质共用；完全在内的大格子直接收下，
 *   压边界的才逐细格判）。一级只按材质 AABB 判是不够的 —— 铺满全图的材质其 AABB ≈ 整张图，
 *   永远过不了"整图不可见"，于是每帧都要把它全部细格走一遍（实测 49 万次/帧、150 万个临时对象）。
 * 细格按**大格子主序**排序（不是 cellKey 升序），跳表才能是连续区间。
 * 几何按**恒等索引 + 全量 drawRange** 建好（天生可画），`render()` 只负责**收窄**。
 * 顶点着色注入: wind / water / fog / lightmap / 昼夜光 / 火把 / 动态光。
 */
import * as THREE from 'three';
import { DYN_LIGHT_MAX } from './effects/dyn-light.js';
import type { SMDData } from '../core/smd-parser';

const WORLD_SCALE = 1 / 256;

/** 距离雾默认区间（world 单位）：游戏内表现，用户 2026-09-12 指定。烘图用 setFogRange(0,0) 关掉 */
const FOG_NEAR = 2400;
const FOG_FAR = 3000;

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

/**
 * 细格 key 的编码步长：`key = cx * KEY_STRIDE + cz`。
 * **必须 ≥ 单图细格 Z 数**（cellWorldSize = worldWidth/256 ⇒ Z 数 = 256 × 图高/图宽，
 * 实测最大 ~302）—— 它只保证编码不自撞，同时让升序排序 = "cx 主序、cz 次序"的行主序，
 * **大格子跳表就建立在这个行主序上**（同一大格子的细格必然是连续区间）。
 */
const KEY_STRIDE = 4096;

/**
 * 细格**排序键**的高位偏移：`sortKey = block * KEY_SHIFT + cellKey`。
 *
 * 为什么细格要按 **大格子主序** 排（而不是单纯按 cellKey 排）：跳表要求"同一个大格子的细格是
 * **连续区间**"。而 `cellKey = cx*KEY_STRIDE + cz` 的升序是 (cx, cz) 字典序 —— `cz` 会对每个 cx
 * 完整扫一遍，于是"大格子索引"沿这个顺序**来回震荡**（cz 回绕时跳回本行开头），同一大格子的细格
 * **不连续**。这不是可以绕过的细节：按 (cx,cz) 序硬建跳表会把细格分错桶（实测外侧世界相机下
 * 打包面数对不上，见 `scripts/verify-map-culling.ts`）。
 *
 * 取 2^21：`cellKey` 上界 = (256-1)*KEY_STRIDE + cz < 2^20，留一倍余量；`block * KEY_SHIFT`
 * 最大约 600 × 2^21 ≈ 1.3e9，远小于 2^53，故 double 精确、排序无误差。
 */
const KEY_SHIFT = 1 << 21;

/** 一个大格子 = `SUPER_CELLS × SUPER_CELLS` 个细格。细格是 `worldWidth/256`（实测 32~45 世界单位），
 *  故一个大格子约 510~715 世界单位 —— 相对雾距（2400~3000）足够细，剔除不会白画多少。 */
const SUPER_CELLS = 16;

interface MaterialRenderData {
  matIdx: number;
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  /**
   * 大格子跳表（**每帧剔除的核心**）：长度 `superCount + 1`，`[superStart[s], superStart[s+1])`
   * 是"本材质在大格子 s 里占的细格"在下面三张数组里的区间。空格子时区间为空。
   *
   * 为什么需要它：一级筛用的是 `aabb`（材质整体包围盒），而**铺满全图的材质其 aabb ≈ 整张图**
   * （实测 fore-1 有 58 个材质覆盖全图 84~90%，village-2 有 1 个覆盖 100%）—— 这类材质永远过不了
   * "整图不可见"的判定，于是旧代码每帧都要把它**全部**细格走一遍（village-2 单材质 58,835 个）。
   * 有了这张表，每帧只走"可见大格子里的细格"，开销才与**看得见多少**挂钩。
   */
  superStart: Int32Array;
  /** 本材质占用的细格（key 升序）、其在 `sortedFaces` 里的面区间起点与个数；三数组等长 */
  fineKeys: Uint32Array;
  fineStarts: Uint32Array;
  fineCounts: Uint32Array;
  sortedFaces: Uint32Array;
  fullIndices: Uint32Array;
  outIndices: Uint32Array;
  seenFaces: Uint32Array;
  aabb: THREE.Box3;
  faceCount: number;
  isTransparent: boolean;
  hasAnimation: boolean;
  /** 引擎的水面材质（`windMeshBottom & 0x7FF == 0x200`）：运行时用来做水波，
   *  离线烘图时会按它剔除水面（用户 2026-09-15：海水不烘进平面图） */
  isWater: boolean;
  /** 构建期筛好的特性标记。**不能用 `material.userData.shader` 当筛子**：它要等首帧编译后才存在，
   *  构建期读不到 ⇒ 三个 updater 无法提前缩到子集。 */
  hasScroll: boolean;
  hasWind: boolean;
  hasWaterTime: boolean;
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
  /** 本帧**实际检查过**的细格数（剖析器计数器 `剔除(cell)` 用）。与 `visibleCellCount`
   *  （通过判定的细格数）一起看，就能证明"大格子跳过"真的把工作量压下去了。 */
  scannedCellCount = 0;
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
  /** 出现于任一水面材质的原始顶点索引集合（B'：让共享顶点的岸边也吃水波）。beginBuild 填 */
  private waterVertSet: Uint8Array | null = null;
  /** 距离雾区间：所有材质的 uFogRange 都引用这一个实例（见 setFogRange） */
  readonly fogRange = new THREE.Vector2(FOG_NEAR, FOG_FAR);

  // ─────────── 大格子（二级剔除）───────────
  /** 大格子边长 = cellWorldSize × SUPER_CELLS */
  superCellSize = 0;
  /** 大格子网格尺寸（细格数 ÷ 16 向上取整）与总数。**三者是公开的**：
   *  `blockOfKey` 的算法与它们绑定，外部（校验脚本）必须用同一份实现，不许自己再推一遍。 */
  superX = 0;
  superZ = 0;
  superCount = 0;
  /** 非空大格子清单（构建期算一次）：每帧只测这些。空大格子若进了"可见清单"，
   *  每个材质都要为它做一次空区间查表 —— 1283 材质 × 几十个空格子就是白白几万次。 */
  private superUsedList = new Int32Array(0);
  private superUsedCount = 0;

  // ─────────── 每帧复用缓冲（**热路径零分配**）───────────
  /** 视锥（每相机一个；`extraCameras` 目前无人使用，但接口保留） */
  private readonly frustumScratch: THREE.Frustum[] = [];
  private readonly projScreenScratch = new THREE.Matrix4();
  /** 细格/大格子判定用的复用盒：旧代码每个 (材质, 细格) 都要 `new Box3(new Vector3, new Vector3)`，
   *  即每帧约 150 万个对象。盒子的 6 个分量每次原地重写即可。 */
  private readonly cellBoxScratch = new THREE.Box3();
  private readonly superBoxScratch = new THREE.Box3();
  /** 每帧的大格子可见性分类（0=外 / 1=压边界 / 2=完全在内）；`beginBuild` 按 superCount 重分配 */
  private superMode = new Uint8Array(0);
  /** 本帧可见大格子（升序）；`beginBuild` 按 superCount 重分配 */
  private visibleSuper = new Int32Array(0);

  // ─────────── 构建期筛好的 updater 子集 ───────────
  /** 只有真的带 scroll / wind / water uniform 的材质才进这三张表 —— 三个 updater 因此
   *  不再每帧遍历全部材质（旧实现是 3 趟 × 全部材质，且对没有该特性的材质也在查 `userData.shader`） */
  private scrollMats: MaterialRenderData[] = [];
  private windMats: MaterialRenderData[] = [];
  private waterMats: MaterialRenderData[] = [];

  // ─────────── 共享 uniform 值实例 ───────────
  /**
   * 全图材质**共用同一份值对象**（本文件里 `fogRange` / `uDynLight*` 早已是这么做的）。
   * 理由：这些值对所有材质**完全相同**（都是每帧一次算出来的全局值）。逐材质各持一份时，
   * `updateDayNight` 每帧要对 ~950 个材质各 `copy` 8 组场景光 ≈ **4.5 万次 Vector3.copy（实测 1.03ms）**；
   * 共享后这些循环整个消失。`uTorchRange` 是 float（标量，无法共享引用），故单独按"变了才写"处理。
   */
  private readonly sharedEnvLight = new THREE.Vector3();
  private readonly sharedTorchPos = new THREE.Vector3();
  private readonly sharedTorchColor = new THREE.Vector3();
  private readonly sharedSceneLightPos = Array.from({ length: 8 }, () => new THREE.Vector3());
  private readonly sharedSceneLightColor = Array.from({ length: 8 }, () => new THREE.Vector3());
  private readonly sharedSceneLightRange = new Float32Array(8);
  private torchRangeApplied = 0;
  /** 动态光池的共享数组（`updateDayNight` 第一次拿到时把已建材质切过去；之后新建的材质直接用它） */
  private sharedDynPos: Float32Array | null = null;
  private sharedDynCol: Float32Array | null = null;

  // ─────────── 相机未变的快路径 ───────────
  /** 上一帧打包时的相机：投影矩阵 + 视图矩阵各 16 个 double，位相等 ⇒ 视锥完全相同 ⇒
   *  上一帧的打包结果与 `mesh.visible` 仍然有效，整张图跳过重打包，**也不置 `needsUpdate`**
   *  （静止帧因此不再付每帧约 1.65MB 的索引重传）。 */
  private readonly lastCamKey = new Float64Array(32);
  private hasLastCam = false;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  build(smdData: SMDData, texMap: Map<string, THREE.Texture>, getMatConfig: (matIdx: number, mat: import('../core/smd-parser').SMDMaterial) => MatConfig | null): void {
    const t0 = performance.now();
    const matFaces = this.beginBuild(smdData);
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
    this.endBuild(t0);
  }

  /**
   * **分帧构建**：与 `build()` 等价，但每构建若干材质就**让出一帧**，
   * 把一次 ~300ms 的阻塞摊到多帧（每帧只吃几毫秒）。
   *
   * 为什么不丢给 Worker：本函数产出的是 `THREE.BufferGeometry`/`Material`/`Mesh` ——
   * **three 对象只能在主线程创建**。实测（desert/de-3.smd，5.6MB、57k 面、101 个材质）：
   *   `parseSMD` 14.5ms / `CollisionMesh.build` 27.9ms / **`build` 297.4ms**
   * —— 卡顿的绝对大头在这里，所以解法是"让它可让出"，而不是"换个线程解析"。
   *
   * @param yieldMs 连续构建超过该毫秒数就让出一帧。
   *   **让出的是整整一帧**（`await rAF`），所以预算取小（默认 6ms）——取 16ms 会让总时长翻倍。
   *   代价：总时长比一次性构建多约 30%（实测 288ms → 327ms），换来"每帧只占几毫秒"。
   * @param shouldCancel 返回 true → 立即停止并返回 false（调用方丢弃；已建几何由 `dispose()` 清理）
   * @returns true=已完整入场景；false=被取消（**不是出错**）
   *
   * ⚠ 剩余瓶颈：让出点在**材质之间**，所以单次最长占用 ≈ `yieldMs` + 最重那个材质的构建时间
   *   （实测最长块 36.5ms，>1 帧但远小于 288ms）。要再平滑就得在单个材质内部按面分块。
   */
  async buildAsync(
    smdData: SMDData,
    texMap: Map<string, THREE.Texture>,
    getMatConfig: (matIdx: number, mat: import('../core/smd-parser').SMDMaterial) => MatConfig | null,
    opts?: { yieldMs?: number; shouldCancel?: () => boolean },
  ): Promise<boolean> {
    const t0 = performance.now();
    const matFaces = this.beginBuild(smdData);
    const yieldMs = opts?.yieldMs ?? 6;
    let sliceStart = performance.now();
    for (const [matIdx, faceList] of matFaces) {
      if (opts?.shouldCancel?.()) return false;
      const mat = smdData.materials[matIdx];
      const config = getMatConfig(+matIdx, mat);
      if (!config) continue;
      const mrd = this.buildMaterialGeometry(+matIdx, faceList, smdData, config, texMap);
      if (mrd) {
        this.materials.push(mrd);
        this.scene.add(mrd.mesh);
      }
      if (performance.now() - sliceStart >= yieldMs) {
        // 让出一帧：浏览器得以渲染/处理输入，玩家感受不到这 300ms 是连续的
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        sliceStart = performance.now();
      }
    }
    if (opts?.shouldCancel?.()) return false;
    this.endBuild(t0);
    return true;
  }

  /** 构建前准备：世界包围盒 / 光源 / 按材质分组的面表（同步版与分帧版**共用**，避免两套漂移） */
  private beginBuild(smdData: SMDData): Map<number, number[]> {
    const S = WORLD_SCALE;
    this.materials = [];

    const b = smdData.bounds;
    // raw→GL：+A(东)→+X，北(+C)→−Z（对齐 pt-game-server RenderMapPng 世界语义）
    const wx1 = b.minX * S, wx2 = b.maxX * S;
    const wy1 = b.minY * S, wy2 = b.maxY * S;
    const wz1 = -b.maxZ * S, wz2 = -b.minZ * S;
    this.worldMin = [Math.min(wx1, wx2), wy1, Math.min(wz1, wz2)];
    this.worldMax = [Math.max(wx1, wx2), wy2, Math.max(wz1, wz2)];
    this.worldWidth = this.worldMax[0] - this.worldMin[0];
    this.worldDepth = this.worldMax[2] - this.worldMin[2];
    this.cellWorldSize = this.worldWidth / 256;
    // 细格索引由 `Math.floor((v - min) / cs)` 得到 ⇒ 顶点**正好落在远边界**上时索引可达
    // `floor(width / cs)`，故格数是"最大索引 + 1"＝ `floor(width/cs) + 1`。
    // ⚠ 少算这一格不是"少一个空格子"：贴着边界的那一格会落到格网外，建跳表时它的大格子索引
    //   溢出（`(floor(cx/16)+1) * superZ`）→ **撞进隔壁 cx 带的桶**，于是那一带的材质会把它的面
    //   一起收下（表现为"多画"）。实测由 `npm run verify-map-culling` 抓出：多画 65~320 面/位姿、
    //   且总有 1 个材质"跳表区间求和 ≠ 细格总数"。
    const cellsX = Math.floor(this.worldWidth / this.cellWorldSize) + 1;
    const cellsZ = Math.floor(this.worldDepth / this.cellWorldSize) + 1;
    this.superX = Math.ceil(cellsX / SUPER_CELLS);
    this.superZ = Math.ceil(cellsZ / SUPER_CELLS);
    this.superCount = this.superX * this.superZ;
    this.superCellSize = this.cellWorldSize * SUPER_CELLS;
    // 复用缓冲：容量随 superCount 走（重建一张图会换尺寸，故在此重分配）
    this.superMode = new Uint8Array(this.superCount);
    this.visibleSuper = new Int32Array(this.superCount);
    this.superUsedList = new Int32Array(0);
    this.superUsedCount = 0;
    // 本图尚未打包过 ⇒ 首次 render() 必须走完整流程
    this.hasLastCam = false;
    this.scrollMats = [];
    this.windMats = [];
    this.waterMats = [];
    this.buildCellTimeMs = 0;

    this.totalFaceCount = smdData.nFace;

    this.lights = [];
    for (const l of smdData.lights || []) {
      this.lights.push({
        type: l.type,
        wx: l.x * S, wy: l.y * S, wz: -l.z * S,
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

    // 水面顶点集合：凡出现在任一水面材质（windMeshBottom & 0x7FF == 0x200）面里的原始顶点索引。
    // 这些顶点在水面 mesh 里被水波位移；原版靠"全局顶点池共享"让引用同一顶点的岸边面也一起动，
    // 我们按材质拆了 mesh、顶点按面平铺，共享关系丢失 —— 于是给这些顶点的**岸边副本**打上 mask，
    // 在岸边 shader 里用同一坐标公式位移（坐标相同 → 位移逐位一致 → 无缝）。
    const waterMatSet = new Set<number>();
    for (let i = 0; i < smdData.materials.length; i++) {
      const m = smdData.materials[i];
      if (m.windMeshBottom && !(m.useState & 0x4000) && (m.windMeshBottom & 0x7FF) === 0x200) {
        waterMatSet.add(i);
      }
    }
    this.waterVertSet = null;
    if (waterMatSet.size > 0) {
      const set = new Uint8Array(smdData.nVertex);
      for (let i = 0; i < smdData.nFace; i++) {
        if (!waterMatSet.has(smdData.faceMat[i])) continue;
        set[smdData.triIdx[i * 3]] = 1;
        set[smdData.triIdx[i * 3 + 1]] = 1;
        set[smdData.triIdx[i * 3 + 2]] = 1;
      }
      this.waterVertSet = set;
    }

    return matFaces;
  }

  /** 构建收尾：透明排序 + 统计（同步版与分帧版共用） */
  private endBuild(t0: number): void {
    this.materials.sort((a, b) => {
      if (a.isTransparent !== b.isTransparent) return a.isTransparent ? 1 : -1;
      return a.matIdx - b.matIdx;
    });

    this.totalVertexCount = 0;
    this.totalTriangleCount = 0;
    // 构建期一次性产出"每帧要用的三张子集表 + 非空大格子清单"（每帧再算就是白花）
    this.scrollMats = [];
    this.windMats = [];
    this.waterMats = [];
    const used = new Uint8Array(this.superCount);
    for (const mrd of this.materials) {
      this.totalVertexCount += mrd.geometry.attributes.position.count;
      this.totalTriangleCount += mrd.fullIndices.length / 3;
      if (mrd.hasScroll) this.scrollMats.push(mrd);
      if (mrd.hasWind) this.windMats.push(mrd);
      if (mrd.hasWaterTime) this.waterMats.push(mrd);
      const ss = mrd.superStart;
      for (let s = 0; s < this.superCount; s++) if (ss[s] < ss[s + 1]) used[s] = 1;
    }
    let n = 0;
    for (let s = 0; s < this.superCount; s++) if (used[s]) n++;
    this.superUsedList = new Int32Array(n);
    this.superUsedCount = n;
    let w = 0;
    for (let s = 0; s < this.superCount; s++) if (used[s]) this.superUsedList[w++] = s;

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

    // 材质级的风/水判定（几何循环前就要知道，才能决定是否建 aWaterEdge）
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
    // 非水面材质、且全图存在水面顶点时才建 mask。wind 材质不参与（原版一个顶点只按先碰它的面算一次，
    // wind 与 water 并存属另一种顺序分支；此处沿用现状：wind 顶点不做水波，避免叠加两套位移公式）。
    const wantsWaterEdge = !waterKind && !windKind && this.waterVertSet != null;
    const waterEdge = wantsWaterEdge ? new Float32Array(nFaces * 3) : null;
    let waterEdgeCount = 0;

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
        if (waterEdge && this.waterVertSet![vi]) { waterEdge[fi * 3 + j] = 1; waterEdgeCount++; }
        const wx = smdData.verts[vi * 3] * S;         // raw A(东) → +X
        const wy = smdData.verts[vi * 3 + 1] * S;
        const wz = -smdData.verts[vi * 3 + 2] * S;    // raw C(北) → −Z
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
          const key = cx * KEY_STRIDE + cz;
          // 排序键 = 大格子主序（见 KEY_SHIFT 说明）
          pairs.push([this.blockOfKey(key) * KEY_SHIFT + key, fi]);
        }
      }
    }

    pairs.sort((x, y) => x[0] - y[0]);
    // 排序键的低位就是 cellKey
    for (let i = 0; i < pairs.length; i++) pairs[i]![0] = pairs[i]![0] % KEY_SHIFT;

    // 每面只存一份顶点（pos2/nrm2/col2/uv0/uv1 已按 fi 紧凑布局），
    // `fineKeys/fineStarts/fineCounts` 记录每个细格覆蓋的面区间（面可跨细格，被多个细格记录）；
    // 渲染时对可见细格收集面并去重提交——同一个面跨多个细格也只画一次。
    const sortedFaces = new Uint32Array(pairs.length);
    for (let ni = 0; ni < pairs.length; ni++) sortedFaces[ni] = pairs[ni][1];

    const fullIndices = new Uint32Array(nFaces * 3);
    for (let fi = 0; fi < nFaces; fi++) {
      fullIndices[fi * 3] = fi * 3;
      fullIndices[fi * 3 + 1] = fi * 3 + 1;
      fullIndices[fi * 3 + 2] = fi * 3 + 2;
    }
    // ⚠ 索引缓冲**初始化为恒等置换**（而不是全 0），并把 drawRange 设成全量：
    //   全 0 时每个三角形都是退化三角形（(0,0,0)），必须等第一次 `render()` 打包完才画得出东西
    //   —— 那是条**静默**契约（漏调 `render()` 的表现是"提交了几万个三角面但一个像素都没有"，见
    //   `docs/planemap-bake.md §二.2`）。恒等置换下几何"天生可画"，`render()` 只负责**收窄**它。
    const outIndices = new Uint32Array(fullIndices);

    // 紧凑化成三张等长数组（key 升序 ⇒ 同一大格子的细格必然是连续区间）
    const fineCellCount = (() => {
      let n = 0;
      for (let i = 0; i < pairs.length; i++) if (i === 0 || pairs[i][0] !== pairs[i - 1][0]) n++;
      return n;
    })();
    const fineKeys = new Uint32Array(fineCellCount);
    const fineStarts = new Uint32Array(fineCellCount);
    const fineCounts = new Uint32Array(fineCellCount);
    {
      let w = 0, start = 0, cur = pairs.length > 0 ? pairs[0][0] : -1, cnt = 0;
      for (let i = 0; i < pairs.length; i++) {
        if (pairs[i][0] !== cur) {
          if (w > 0 || cnt > 0) { fineKeys[w] = cur; fineStarts[w] = start; fineCounts[w] = cnt; w++; }
          cur = pairs[i][0]; start = i; cnt = 0;
        }
        cnt++;
      }
      if (pairs.length > 0) { fineKeys[w] = cur; fineStarts[w] = start; fineCounts[w] = cnt; w++; }
    }
    // 大格子跳表：细格已按**大格子主序**排好（见 `KEY_SHIFT`），故大格子索引单调不减 ⇒ 单趟分桶即可。
    const superStart = new Int32Array(this.superCount + 1);
    {
      let w = 0;
      for (let s = 0; s < this.superCount; s++) {
        superStart[s] = w;
        while (w < fineCellCount && this.blockOfKey(fineKeys[w]!) <= s) w++;
      }
      superStart[this.superCount] = w;
    }
    this.buildCellTimeMs = (this.buildCellTimeMs || 0) + (performance.now() - cellBuildStart);

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(pos2, 3));
    geom.setAttribute('normal', new THREE.BufferAttribute(nrm2, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(col2, 3));
    if (uv0) geom.setAttribute('uv', new THREE.BufferAttribute(uv0, 2));

    if (uv1) geom.setAttribute('aLightMapUv', new THREE.BufferAttribute(uv1, 2));
    geom.setIndex(new THREE.BufferAttribute(outIndices, 1));
    geom.setDrawRange(0, nFaces * 3);   // 与恒等索引配套 = 全量可画（`render()` 之后收窄）

    const waterEdgeKind = waterEdgeCount > 0;
    if (waterEdgeKind) geom.setAttribute('aWaterEdge', new THREE.BufferAttribute(waterEdge!, 1));

    const threeMat = this.buildThreeMaterial(matIdx, mat, config, texMap, windKind, minY, maxY, waterKind, waterEdgeKind);

    const mesh = new THREE.Mesh(geom, threeMat);
    mesh.frustumCulled = false;
    mesh.userData.mapMesh = true;
    if (config.isRendLatter) mesh.renderOrder = 1;

    const ud = threeMat.userData as { scrollSlots?: unknown[]; fxWind?: boolean; fxWaterTime?: boolean };
    return {
      matIdx,
      mesh,
      geometry: geom,
      superStart,
      fineKeys,
      fineStarts,
      fineCounts,
      fullIndices,
      outIndices,
      sortedFaces,
      seenFaces: new Uint32Array(nFaces),
      aabb: new THREE.Box3(
        new THREE.Vector3(minX, minY, minZ),
        new THREE.Vector3(maxX, maxY, maxZ),
      ),
      faceCount: faceList.length,
      isTransparent: config.isTransparent,
      hasAnimation: config.hasAnimation,
      isWater: waterKind,
      hasScroll: !!(ud.scrollSlots && ud.scrollSlots.length > 0),
      hasWind: ud.fxWind === true,
      hasWaterTime: ud.fxWaterTime === true,
    };
  }

  /** 细格 key → 大格子索引（`sx * superZ + sz`）。**必须与细格排序键同一套算法**（见 `KEY_SHIFT`）。
   *  公开是为了让校验脚本用同一份实现 —— 这种"两处各写一遍公式"正是会静默漂移的那类代码。 */
  blockOfKey(key: number): number {
    const cx = (key / KEY_STRIDE) | 0;
    const cz = key % KEY_STRIDE;
    return ((cx / SUPER_CELLS) | 0) * this.superZ + ((cz / SUPER_CELLS) | 0);
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
    waterEdgeKind: boolean,
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
      if (waterEdgeKind) ckParts.push('E');
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
    // 构建期特性标记：`updateScroll/Wind/Water` 靠它们把遍历缩到子集。
    // **不能用 `userData.shader` 代替** —— 它要等首帧编译后才存在，构建期读不到。
    threeMat.userData.fxWind = windKind !== 0;
    threeMat.userData.fxWaterTime = waterKind || waterEdgeKind;
    threeMat.onBeforeCompile = (shader) => {
      let declInline = '#include <common>';
      if (needLM || need2Tex) {
        declInline += '\nout vec2 vMyLightMapUv;';
        // ⚠ **自己声明 attribute，不要用 three 的 `uv1`**：three 只在材质真的用到 uv1 贴图
        // （如 `aoMap`）时才注入 `attribute vec2 uv1;` —— 我们只是在自己的注入 shader 里读它，
        // three 不会替我们声明 ⇒ `'uv1' : undeclared identifier`、shader 编译失败、材质整体不渲染。
        // 与 `aWaterEdge` 同一做法：用自有名字，绕开 three 的 UV 声明机制。
        declInline += '\nattribute vec2 aLightMapUv;';
      }
      if (scrollU0 || scrollU1) declInline += '\nuniform vec2 uScrollU;';
      if (windKind) {
        declInline += '\nuniform float uWindTime;';
        declInline += '\nuniform vec2 uWindMag;';
      }
      if (waterKind) declInline += '\nuniform float uWaterTime;';
      if (waterEdgeKind) {
        declInline += '\nattribute float aWaterEdge;';
        declInline += '\nuniform float uWaterTime;';
      }
      declInline += '\nvarying float vPtFogZ;';
      declInline += '\nvarying vec3 vPtWorldPos;';
      declInline += '\nuniform vec3 uEnvLight;';
      declInline += '\nuniform vec3 uTorchPos;';
      declInline += '\nuniform vec3 uTorchColor;';
      declInline += '\nuniform float uTorchRange;';
      declInline += '\nuniform vec3 uSceneLightPos[8];';
      declInline += '\nuniform vec3 uSceneLightColor[8];';
      declInline += '\nuniform float uSceneLightRange[8];';
      declInline += '\nuniform vec4 uDynLightPos[80];';
      declInline += '\nuniform vec4 uDynLightColor[80];';
      declInline += '\nvarying vec3 vDynLight;';
      shader.vertexShader = shader.vertexShader.replace('#include <common>', declInline);

      let uvInline = '#include <uv_vertex>';
      if (needLM || need2Tex) {
        uvInline += '\nvMyLightMapUv = aLightMapUv;';
        if (scrollU1) uvInline += '\nvMyLightMapUv.x += uScrollU.y;';
      }
      // three 的 vUv 仅在 USE_UV 时声明（有 map/uv 的材质）；无则跳过滚动避免编译错
      if (scrollU0) uvInline += '\n#if defined(USE_UV)\nvUv.x += uScrollU.x;\n#endif';
      shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', uvInline);

      // **动态光累加**（逐顶点 = 原版 Gouraud；原版 `smRENDER3D::SetDynamicObjLight`）。
      // 与原版两处**有意差异**（台账 §18.4）：① 剔除用**世界空间**（原版相机空间 ⇒ 盒跟着相机转，判为缺陷）
      // 其余照抄：盒式 `|Δ|<R`、衰减 `1 − d²/R²`（**不是反平方**）、每通道上限 540/256。
      // `R = 0` 是尾槽哨兵（`packData` 已按 count 压紧并清零尾部）⇒ 不需要 count uniform。
      const dynLightCode =
        '#include <project_vertex>\n' +
        '  {\n' +
        '    vec3 _wp = (modelMatrix * vec4(transformed, 1.0)).xyz;\n' +
        '    vec3 _acc = vec3(0.0);\n' +
        '    for (int _i = 0; _i < 80; _i++) {\n' +
        '      vec4 _lp = uDynLightPos[_i];\n' +
        '      float _R = _lp.w;\n' +
        '      if (_R <= 0.0) break;\n' +
        '      vec3 _d = abs(_wp - _lp.xyz);\n' +
        '      if (_d.x < _R && _d.y < _R && _d.z < _R) {\n' +
        '        float _dd = dot(_d, _d);\n' +
        '        float _R2 = _R * _R;\n' +
        '        if (_dd < _R2) _acc += uDynLightColor[_i].rgb * (1.0 - _dd / _R2);\n' +
        '      }\n' +
        '    }\n' +
        '    vDynLight = min(_acc, vec3(540.0 / 256.0));\n' +
        '  }';
      shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', dynLightCode);

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

      // 岸边共享顶点：与水面试**同一坐标公式**，位移乘 aWaterEdge（0/1）。
      // 与水面顶点坐标相同 → 位移逐位一致 → 水岸边界无缝同动；岸边其余顶点 mask=0 静止。
      // 与 windKind/waterKind 互斥（见 buildMaterialGeometry 的 wantsWaterEdge），故 replace 目标必存在。
      if (waterEdgeKind) {
        const waterEdgeCode =
          '#include <begin_vertex>\n' +
          '  {\n' +
          '    float _rx = (-transformed.z * 256.0 * 8.0 + uWaterTime) * 0.5;\n' +
          '    float _rz = (-transformed.x * 256.0 * 8.0 + uWaterTime) * 0.5;\n' +
          '    float _wa = _rx / 4096.0 * 6.28318530718;\n' +
          '    float _wb = _rz / 4096.0 * 6.28318530718;\n' +
          '    transformed.z += sin(_wa) * 8.0 * aWaterEdge;\n' +
          '    transformed.x += sin(_wb) * 8.0 * aWaterEdge;\n' +
          '  }';
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', waterEdgeCode);
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
          'uniform vec2 uFogRange;\nvarying float vPtFogZ;',
        );
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <color_fragment>',
          '#include <color_fragment>\n' +
          (needLM ? '  diffuseColor.rgb *= texture2D(uLightMap, vMyLightMapUv).rgb;\n' : '') +
          (need2Tex ? '  diffuseColor.rgb *= texture2D(uSecondTex, vMyLightMapUv).rgb;\n' : '') +
          // 距离雾（远处压暗）：原版权值是 1152 起衰减、约 1664 全黑 —— 太近，地图大半看不见。
          // 用户 2026-09-12 指定：**2400 开始渐变、3000 完全看不见**（线性；1.0 处等于全黑，
          // 所以两端都是准确值，不像原版 255/256 那样留 0.4% 残影）。相机 far=4000，仍在其内。
          // ⚠ 阈值走 uniform：**离线烘图（俯视正交，相机必然在很远处）必须关掉它**
          //   —— 这是第三人称的距离雾，俯视图整张都超过 3000，不关就是全黑。
          //   `uFogRange.x <= 0` = 关闭。默认值 (2400,3000) 与游戏内完全一致。
          '  { float _z = vPtFogZ; if (uFogRange.x > 0.0 && _z > uFogRange.x) {'
          + ' float _dlev = (_z - uFogRange.x) / (uFogRange.y - uFogRange.x);'
          + ' if (_dlev > 1.0) _dlev = 1.0; diffuseColor.rgb *= 1.0 - _dlev; } }',
        );
        // 动态光：varying 必须在**两个阶段都声明**（GLSL ES 1.0 要求一致声明；只在顶点段声明
        // 会让片元段报 `'vDynLight' : undeclared identifier` ⇒ 材质编译失败 ⇒ 地图整个不渲染 —— 实测踩到）
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <common>',
          '#include <common>\nvarying vec3 vDynLight;',
        );
        // 加在**顶点色相乘之前**（原版 `AddLight` 是加进顶点色、再乘贴图 ⇒ 与 `<color_fragment>` 同序）
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <color_fragment>',
          'diffuseColor.rgb += vDynLight;\n#include <color_fragment>',
        );
        if (needLM) shader.uniforms.uLightMap = { value: config.lightmapTex };
        if (need2Tex) shader.uniforms.uSecondTex = { value: config.secondTex };
        shader.uniforms.uFogRange = { value: this.fogRange };
        // **共享值实例**（见字段区的说明）：这些值对所有材质完全相同，逐材质各持一份会让
        // `updateDayNight` 每帧做材质数 × 8 组 × 2 次 Vector3.copy（实测 1.03ms）。共享后它只写一次。
        shader.uniforms.uEnvLight = { value: this.sharedEnvLight };
        shader.uniforms.uTorchPos = { value: this.sharedTorchPos };
        shader.uniforms.uTorchColor = { value: this.sharedTorchColor };
        shader.uniforms.uTorchRange = { value: this.torchRangeApplied };
        shader.uniforms.uSceneLightPos = { value: this.sharedSceneLightPos };
        shader.uniforms.uSceneLightColor = { value: this.sharedSceneLightColor };
        shader.uniforms.uSceneLightRange = { value: this.sharedSceneLightRange };
        // 动态光：**共享引用**（池原地改内容 ⇒ three 每次绘制自动上传，无需每帧 JS）。
        // 池已就绪（`updateDayNight` 跑过）就直接挂它的数组；否则先挂本渲染器的占位数组，
        // 由 `updateDayNight` 的首次切换把已建材质统一换过去 —— 这样**构建顺序无关**。
        shader.uniforms.uDynLightPos = { value: this.sharedDynPos ?? new Float32Array(DYN_LIGHT_MAX * 4) };
        shader.uniforms.uDynLightColor = { value: this.sharedDynCol ?? new Float32Array(DYN_LIGHT_MAX * 4) };
      }

      if (scrollU0 || scrollU1) shader.uniforms.uScrollU = { value: new THREE.Vector2(0, 0) };
      if (windKind) {
        shader.uniforms.uWindTime = { value: 0 };
        shader.uniforms.uWindMag = { value: new THREE.Vector2(vWindDX, vWindDZ) };
      }
      if (waterKind) shader.uniforms.uWaterTime = { value: 0 };
      if (waterEdgeKind) shader.uniforms.uWaterTime = { value: 0 };
      threeMat.userData.shader = shader;
    };

    return threeMat;
  }

  // 下面三个 updater 都只遍历**构建期筛好的子集**（`endBuild` 填）。
  // 旧实现各自遍历全部材质（一张图 250~410 个），且对没有该特性的材质也在查 `userData.shader`。
  // ⚠ 仍要查 `userData.shader`：材质要等首帧编译后才拿得到 shader 对象。
  updateScroll(animMs: number): void {
    if (this.scrollMats.length === 0) return;
    const ms = animMs | 0;
    const baseW = (ms >>> 6) & 0xff;
    const baseFw = baseW / 256;
    for (const mrd of this.scrollMats) {
      const threeMat = mrd.mesh.material as THREE.MeshBasicMaterial;
      const shader = threeMat.userData.shader;
      if (!shader) continue;
      const slots = threeMat.userData.scrollSlots as Array<{ slot: number; kind: 'scroll' | 'slow'; mult: number; factor: number }> | undefined;
      if (!slots || slots.length === 0) continue;
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
    if (this.windMats.length === 0) return;
    const ms = animMs | 0;
    let ttCnt = (ms >>> 2) & 0xff;
    const ttFlag = (ms >>> 10) & 1;
    if (!ttFlag) ttCnt = 255 - ttCnt;
    const uTime = (ttCnt / 255) * Math.PI * 2;
    for (const mrd of this.windMats) {
      const shader = (mrd.mesh.material as THREE.MeshBasicMaterial).userData.shader;
      if (!shader) continue;
      shader.uniforms.uWindTime.value = uTime;
    }
  }

  updateWater(animMs: number): void {
    if (this.waterMats.length === 0) return;
    const ms = animMs | 0;
    for (const mrd of this.waterMats) {
      const shader = (mrd.mesh.material as THREE.MeshBasicMaterial).userData.shader;
      if (!shader) continue;
      shader.uniforms.uWaterTime.value = ms;
    }
  }

  setFogRange(near: number, far: number): void {
    this.fogRange.set(near, far);
  }

  updateDayNight(
    envLight: THREE.Vector3,
    sceneLights: Array<{ pos: THREE.Vector3; color: THREE.Vector3; range: number }>,
    torchPos: THREE.Vector3,
    torchColor: THREE.Vector3,
    torchRange: number,
    dyn?: { posRange: Float32Array; colAlpha: Float32Array },
  ): void {
    // 这些值对**所有材质完全相同**，而材质共用同一批值实例（见字段区说明）⇒ 每帧只写一次。
    // 旧实现是"逐材质各 copy 8 组场景光" = 材质数 × 8 × 2 次 Vector3.copy ≈ 4.5 万次/帧（实测 1.03ms）。
    this.sharedEnvLight.copy(envLight);
    const n = Math.min(sceneLights.length, 8);
    for (let i = 0; i < 8; i++) {
      if (i < n) {
        this.sharedSceneLightPos[i].copy(sceneLights[i].pos);
        this.sharedSceneLightColor[i].copy(sceneLights[i].color);
        this.sharedSceneLightRange[i] = sceneLights[i].range;
      } else {
        this.sharedSceneLightPos[i].set(0, 0, 0);
        this.sharedSceneLightColor[i].set(0, 0, 0);
        this.sharedSceneLightRange[i] = 0;
      }
    }
    this.sharedTorchPos.copy(torchPos);
    this.sharedTorchColor.copy(torchColor);

    // `uTorchRange` 是 float（标量，无法共享同一个对象引用）⇒ 只能逐材质写。
    // 好在它几乎不变，故"变了才写一趟"；构建期读 `torchRangeApplied` 初始化，
    // 于是**构建顺序无关**（新材质天生带着当前值）。
    if (torchRange !== this.torchRangeApplied) {
      this.torchRangeApplied = torchRange;
      for (const mrd of this.materials) {
        const shader = (mrd.mesh.material as THREE.MeshBasicMaterial).userData.shader;
        if (shader?.uniforms.uTorchRange) shader.uniforms.uTorchRange.value = torchRange;
      }
    }

    // 动态光池换实例时（第一次拿到、或宿主重建池）把**已建**材质切到共享数组上；之后建的直接用它。
    if (dyn && this.sharedDynPos !== dyn.posRange) {
      this.sharedDynPos = dyn.posRange;
      this.sharedDynCol = dyn.colAlpha;
      for (const mrd of this.materials) {
        const shader = (mrd.mesh.material as THREE.MeshBasicMaterial).userData.shader;
        if (!shader?.uniforms.uDynLightPos) continue;
        shader.uniforms.uDynLightPos.value = dyn.posRange;
        shader.uniforms.uDynLightColor.value = dyn.colAlpha;
      }
    }
  }

  /** 相机位姿是否与上次打包时**逐位相同**（相同则视锥完全相同，可整图跳过重打包） */
  private camUnchanged(camera: THREE.Camera): boolean {
    const k = this.lastCamKey;
    const pe = camera.projectionMatrix.elements;
    const ve = camera.matrixWorldInverse.elements;
    for (let i = 0; i < 16; i++) if (k[i] !== pe[i]) return false;
    for (let i = 0; i < 16; i++) if (k[16 + i] !== ve[i]) return false;
    return true;
  }

  /**
   * 盒子是否**完全落在**视锥内（`Frustum.containsBox` 在 three r165 里**并不存在** ——
   * 只有 `Box3/Box2.containsBox`，类型定义里也没有，别照名字假设）。
   *
   * 符号约定（实测 `three@0.165`）：平面法线**朝内**，`distanceToPoint` 在内侧为**正**。
   * 于是两种判定取的是**相反**的角：
   *   - `Frustum.intersectsBox`（有没有交集）取"沿法线最远"的角，判 `distance < 0 ⇒ 无交集`；
   *   - 本函数（是否完全在内）取"沿法线最近"的角，判 `distance < 0 ⇒ 没全在内`（有角在外侧）。
   * ⚠ 这两条只差**取哪个角 + 不等号方向**，写错任何一处都表现为"把只相交、没全在内的盒子当成
   *   完全在内"⇒ 多画面（不是少画，所以画面看不出问题）。实测由 `verify-map-culling` 抓出
   *   （多画 47~234 面/位姿、零漏画）。
   */
  private boxInFrustum(f: THREE.Frustum, box: THREE.Box3): boolean {
    if (!f.planes) return true;
    for (let i = 0; i < 6; i++) {
      const pl = f.planes[i];
      const nx = pl.normal.x, ny = pl.normal.y, nz = pl.normal.z;
      const x = nx >= 0 ? box.min.x : box.max.x;
      const y = ny >= 0 ? box.min.y : box.max.y;
      const z = nz >= 0 ? box.min.z : box.max.z;
      if (nx * x + ny * y + nz * z + pl.constant < 0) return false;
    }
    return true;
  }

  private recordCam(camera: THREE.Camera): void {
    const k = this.lastCamKey;
    const pe = camera.projectionMatrix.elements;
    const ve = camera.matrixWorldInverse.elements;
    for (let i = 0; i < 16; i++) { k[i] = pe[i]; k[16 + i] = ve[i]; }
    this.hasLastCam = true;
  }

  /**
   * 每帧入口：**只负责收窄**。几何建好时就是"恒等索引 + 全量 drawRange"，不调它也能画全量。
   *
   * 两级剔除，**画出来的面与旧实现逐面相同**：
   *   ① 材质级 `mrd.aabb`（旧行为逐字保留）：整张图不在视锥里时这是最便宜的一刀。
   *   ② 大格子级：**每图一次、所有材质共用**。大格子分三类 —— 0=视锥外（整块跳过）、
   *      1=压边界（逐细格判，判据与旧代码逐字相同）、2=完全在内（细格全部收下，不再逐个判）。
   *
   * 为什么 ② 是等价的：细格落在大格子内（跳表按构造保证），`containsBox(大格子)` ⇒ 细格也在视锥内
   * ⇒ 旧的 `intersectsBox(细格)` 必然为真 ⇒ 旧代码本来就会收下它。多相机时两类判定都取"全部视锥"
   * （与旧 `testFrustums` 的 AND 语义一致）。
   *
   * 开销因此从"材质 × 它覆盖的**全部**细格"（实测 49 万次/帧，且每格 `new Box3(new Vector3, new Vector3)`
   * ≈ 150 万个对象）变成"材质 × **可见大格子**里的细格"，**且热路径零分配**。
   */
  render(camera: THREE.Camera, extraCameras: THREE.Camera[] = []): void {
    // 相机未动 ⇒ 视锥完全相同 ⇒ 上一帧的打包结果与 `mesh.visible` 仍然有效：
    // 整图跳过重打包，也**不置 `needsUpdate`**（静止帧不再付每帧约 1.65MB 的索引重传）。
    // ⚠ 只在单相机时走快路径 —— 多相机时只比第一个相机是不完备的。
    if (this.hasLastCam && extraCameras.length === 0 && this.camUnchanged(camera)) return;

    const cs = this.cellWorldSize;
    const wmX = this.worldMin[0];
    const wmZ = this.worldMin[2];
    const nCam = 1 + extraCameras.length;

    // ① 视锥（复用 scratch；旧实现每帧每图 new 一个 Matrix4 + Frustum）
    for (let i = 0; i < nCam; i++) {
      const cam = i === 0 ? camera : extraCameras[i - 1];
      this.projScreenScratch.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      let f = this.frustumScratch[i];
      if (!f) f = this.frustumScratch[i] = new THREE.Frustum();
      f.setFromProjectionMatrix(this.projScreenScratch);
    }

    // ② 大格子分类（所有材质共用这一次判定）。`superUsedList` 升序 ⇒ `visibleSuper` 也升序，
    //    而细格在跳表里本就是升序 ⇒ 打包顺序与旧实现（`cellLookup` 的 key 升序）一致。
    const mode = this.superMode;
    mode.fill(0);
    const visSuper = this.visibleSuper;
    let visCount = 0;
    let partialCount = 0;
    {
      const scs = this.superCellSize;
      const box = this.superBoxScratch;
      const y0 = this.worldMin[1], y1 = this.worldMax[1];
      const sZ = this.superZ;
      const used = this.superUsedList;
      for (let ui = 0; ui < this.superUsedCount; ui++) {
        const s = used[ui];
        const x0 = wmX + ((s / sZ) | 0) * scs;
        const z0 = wmZ + (s % sZ) * scs;
        box.min.set(x0, y0, z0);
        box.max.set(x0 + scs, y1, z0 + scs);
        let hit = true;
        let inside = true;
        for (let i = 0; i < nCam; i++) {
          const f = this.frustumScratch[i];
          if (f.planes && !f.intersectsBox(box)) { hit = false; break; }
          if (!this.boxInFrustum(f, box)) inside = false;
        }
        if (!hit) continue;
        if (inside) mode[s] = 2;
        else { mode[s] = 1; partialCount++; }
        visSuper[visCount++] = s;
      }
    }
    // 整图每个非空大格子都"完全在内"（离线烘图的正交相机必走这条）⇒ 细格不必过任何判据
    const allVisible = partialCount === 0 && visCount === this.superUsedCount;

    this.scannedCellCount = 0;
    this.visibleCellCount = 0;
    this.drawCallCount = 0;
    this.visibleFaceCount = 0;

    const stamp = ++this.renderStamp;
    for (const mrd of this.materials) {
      // ① 材质级（旧行为：任一视锥判不出 ⇒ 不可见）
      let matVisible = true;
      for (let i = 0; i < nCam; i++) {
        const f = this.frustumScratch[i];
        if (f.planes && !f.intersectsBox(mrd.aabb)) { matVisible = false; break; }
      }
      if (!matVisible) {
        mrd.mesh.visible = false;
        continue;
      }

      const idxArr = mrd.outIndices;      // 与 geometry.index.array 是同一个对象
      const fullIdx = mrd.fullIndices;
      const faces = mrd.sortedFaces;
      const seen = mrd.seenFaces;
      const ss = mrd.superStart;
      const fky = mrd.fineKeys;
      const fst = mrd.fineStarts;
      const fct = mrd.fineCounts;
      const cellY0 = mrd.aabb.min.y;
      const cellY1 = mrd.aabb.max.y;
      const box = this.cellBoxScratch;
      let packed = 0;

      if (allVisible) {
        // ③ 全可见快路径：按细格升序把所有面收下（顺序与下面那条完全一致，只是省掉跳表与判据）
        for (let k = 0, kn = fky.length; k < kn; k++) {
          const st = fst[k], en = st + fct[k];
          for (let j = st; j < en; j++) {
            const fi = faces[j];
            if (seen[fi] === stamp) continue;   // 面跨多细格，去重
            seen[fi] = stamp;
            const off = fi * 3;
            idxArr[packed] = fullIdx[off];
            idxArr[packed + 1] = fullIdx[off + 1];
            idxArr[packed + 2] = fullIdx[off + 2];
            packed += 3;
          }
        }
      } else {
        for (let vi = 0; vi < visCount; vi++) {
          const s = visSuper[vi];
          const a = ss[s], b = ss[s + 1];
          if (a === b) continue;              // 本材质在这个大格子里没有面
          const mustTest = mode[s] === 1;
          for (let k = a; k < b; k++) {
            if (mustTest) {
              // 压边界的大格子：逐细格判（判据与旧实现逐字相同，这是"逐面一致"的保证）
              this.scannedCellCount++;
              const key = fky[k];
              const x0 = wmX + ((key / KEY_STRIDE) | 0) * cs;
              const z0 = wmZ + (key % KEY_STRIDE) * cs;
              box.min.set(x0, cellY0, z0);
              box.max.set(x0 + cs, cellY1, z0 + cs);
              let vis = true;
              for (let i = 0; i < nCam; i++) {
                const f = this.frustumScratch[i];
                if (f.planes && !f.intersectsBox(box)) { vis = false; break; }
              }
              if (!vis) continue;
              this.visibleCellCount++;
            }
            const st = fst[k], en = st + fct[k];
            for (let j = st; j < en; j++) {
              const fi = faces[j];
              if (seen[fi] === stamp) continue;
              seen[fi] = stamp;
              const off = fi * 3;
              idxArr[packed] = fullIdx[off];
              idxArr[packed + 1] = fullIdx[off + 1];
              idxArr[packed + 2] = fullIdx[off + 2];
              packed += 3;
            }
          }
        }
      }

      if (packed === 0) {
        mrd.mesh.visible = false;
        // ⚠ 顺手把 drawRange 压成空：**three 的 Raycaster 不看 `object.visible`**（只测 layers，
        //   见 r165 `raycaster` 的 `intersect()`），而 `Mesh.raycast` 会按 `drawRange` 裁剪 ——
        //   几何建好时 drawRange 是**全量**（为了"天生可画"），若此处留着它，被剔除的材质会以
        //   **全部面**参与拾取（hover 命中看不见的东西）。压成 0 之后"不可见 = 也不可拾取"，
        //   语义与 `visible` 一致。
        mrd.geometry.setDrawRange(0, 0);
        continue;
      }
      mrd.geometry.index!.needsUpdate = true;   // 恒等索引 → 收窄后的索引
      mrd.geometry.setDrawRange(0, packed);
      mrd.mesh.visible = true;
      this.drawCallCount++;
      this.visibleFaceCount += packed / 3;
    }
    this.drawnVertexCount = Math.round(this.visibleFaceCount) * 3;
    this.recordCam(camera);
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
