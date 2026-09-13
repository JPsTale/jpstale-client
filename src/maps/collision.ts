/**
 * Collision detection — 移植自 /pt/maps/ js/collision.js（复刻 smStage3d.cpp CheckNextMove / GetPolyHeight / smMakeTLine）
 *
 * Coordinates: x/y in raw SMD integers, z negated to match THREE.js world convention (+z = south).
 * Callers pass world z directly (no manual negation needed).
 * Distance/height still in raw SMD units (fONE = 256 per game unit).
 *
 * Original C++ flow (smStage3d.cpp:569):
 *   CheckNextMove(x,y,z,angle,dist)
 *     → MakeAreaFaceList: StageArea[256][256] 网格定位附近面（128 游戏单位范围）
 *     → for ccnt in [0,1,2] (主方向, 左偏-768, 右偏+768):
 *         → smMakeTLine 生成 4 条 T 形扫掠线
 *         → GetPolyHeight(ep) 高度收集（只限向上爬 hy < StepHeight）
 *         → GetTriangleImact 检测 T 线是否撞墙
 *         → 成功则移动；ccnt==0 失败时 dist>>=1（距离减半重试）
 *     → 全失败返回 NULL（原地不动）
 */
import type { SMDData } from '../core/smd-parser';

const fONE = 256;
const STEP_HEIGHT = 10 * fONE;
// StageArea cell：64 游戏单位 = 64*fONE 定点（smType.h:31 SizeMAPCELL=64, ShiftMAPCELL_MULT=6）
const CELL_SIZE = 64 * fONE;
/**
 * 取"附近三角形"的半径（游戏单位）—— 复刻原版 `MakeAreaFaceList` 的范围（smStage3d.cpp:615 fONE*64）。
 *
 * ⚠ **选"哪些图参与判定"的半径必须与它一致**（用户 2026-09-13 定）：
 * 这两个距离若不同，就会出现"取面能取到 64u 内的面，但那张图没被选进来" →
 * 该挡的墙不参与判定。任何可能被 `forEachNearbyTri` 取到的面，其所属图都必须在集合里。
 * 故导出它，供调用方（`WorldView` 的 `mapsInRange`）直接使用，**不要各写一个数**。
 */
export const NEARBY_RADIUS_UNITS = 64;
// MakeAreaFaceList 附近范围：±NEARBY_RADIUS_UNITS 游戏单位
const AREA_RADIUS = NEARBY_RADIUS_UNITS * fONE;

/**
 * 角色碰撞尺寸 —— 原版传的是 `Pattern->SizeWidth / SizeHeight`（character.cpp:2013），
 * 由 `smObj3D::AddVertex` 从模型顶点算出（maxX←|x|、maxZ←|y|、maxY←|z|，见 smObj3d.cpp:2334）。
 * 玩家身体模型 `char/tmABCD/tmbB01.ASE` 的实测值：maxX=2337 / maxZ=2799 / maxY=11662
 * （与 `char/tmabcd/tmbb01.smd` 头部字段逐字节一致），故：
 *   ObjWidth  = max(maxX, maxZ) = 2799 raw = 10.93u
 *   ObjHeight = maxY            = 11662 raw = 45.55u  → 上沿 T 线 = H-(H>>2) = 8747 raw = 34.17u
 * 曾用 11u / 21u：宽度基本对，高度错了（上沿掉到 15.75u），实测会让近竖直面
 * （栏杆/墙）的判定与原版差约 4 个百分点（`scripts/diag-climb.ts` 的 E 表）。
 */
export const OBJ_WIDTH_RAW = 2799;
export const OBJ_HEIGHT_RAW = 11662;

/**
 * 碰撞调试探针（`collision-debug.ts` 在开启可视化时挂上；**默认 null → 判定路径零开销**）。
 * 回传的是 mesh 引用 + 三角形下标，调用方自己反查 mapId（避免这里持有 map 信息）。
 */
export interface CollisionProbeSink {
  /** 本帧 cell 取到、且通过 AABB 预筛的**候选面**（真正进 T 线判定的那些） */
  candidate(mesh: CollisionMesh, triIndex: number): void;
  /** 真正判成"挡"的面 */
  blockedBy(mesh: CollisionMesh, triIndex: number): void;
  /**
   * 一次 `_wallBlocked` 生成的一组 T 形线（raw，按 sp.x,sp.y,sp.z, ep.x,ep.y,ep.z 连续 24 个数）。
   * ⚠ `level` 是**这次尝试的序号**：0=主方向、1=左偏 67.5°、2=右偏 67.5°
   * （`checkNextMove` 主方向被挡时会左右各试一次）。画图时必须带上它——
   * 否则看到的常常是"最后一次重试"的线，方向自然与朝向不符（曾以此误判为"T 线乱摆"）。
   * 探针是**空间**的（合并视图下不再有"哪张图"），故不带 mesh。
   */
  tlines(level: number, points: number[]): void;
  /** 一次 `checkNextMove` 的最终裁定：`level` 是走通的那次尝试 +1（1/2/3），0 = 全被挡未移动 */
  decided(level: number): void;
}

/** 全局探针槽（调试可视化挂/摘；正常游戏为 null） */
export const collisionProbe: { sink: CollisionProbeSink | null } = { sink: null };


interface CollisionTri {
  x1: number; y1: number; z1: number;
  x2: number; y2: number; z2: number;
  x3: number; y3: number; z3: number;
  matIdx: number;
  minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number;
  nx: number; ny: number; nz: number; nyNorm: number;
  /** 面法线的定长分量（±32767，short 截断）——复刻 C++ SetNormal 写进 Face.VectNormal 的值 */
  vnx: number; vny: number; vnz: number;
}

export class CollisionMesh {
  triangles: CollisionTri[] = [];
  cellMap = new Map<number, number[]>();
  minY = 0;
  maxY = 0;


  /**
   * Build collision mesh from SMD data. z is negated to match THREE.js world convention.
   * Only faces where (meshState & 1) != 0 are solid.
   */
  buildFromSMD(smdData: SMDData): void {
    this.triangles = [];
    this.cellMap = new Map();
    const pos = smdData.verts;
    const triIdx = smdData.triIdx;
    const materials = smdData.materials;
    let minY = Infinity, maxY = -Infinity;

    for (let fi = 0; fi < smdData.nFace; fi++) {
      const matIdx = smdData.faceMat[fi];
      const mat = materials[matIdx];
      if (!mat) continue;
      const meshState = mat.meshState || 0;
      if ((meshState & 1) === 0) continue;

      const i0 = triIdx[fi * 3];
      const i1 = triIdx[fi * 3 + 1];
      const i2 = triIdx[fi * 3 + 2];

      // x/y: raw SMD; z: negated to match THREE.js world (+z = south)
      const x1 = pos[i0 * 3], y1 = pos[i0 * 3 + 1], z1 = -pos[i0 * 3 + 2];
      const x2 = pos[i1 * 3], y2 = pos[i1 * 3 + 1], z2 = -pos[i1 * 3 + 2];
      const x3 = pos[i2 * 3], y3 = pos[i2 * 3 + 1], z3 = -pos[i2 * 3 + 2];

      if (y1 < minY) minY = y1; if (y1 > maxY) maxY = y1;

      const tri: CollisionTri = {
        x1, y1, z1, x2, y2, z2, x3, y3, z3, matIdx,
        minX: Math.min(x1, x2, x3), maxX: Math.max(x1, x2, x3),
        minY: Math.min(y1, y2, y3), maxY: Math.max(y1, y2, y3),
        minZ: Math.min(z1, z2, z3), maxZ: Math.max(z1, z2, z3),
        // 法线（未归一化）——用于区分垂直墙(ny小)与地面/斜坡(ny大)
        nx: 0, ny: 0, nz: 0, nyNorm: 1,
        vnx: 0, vny: 0, vnz: 0,
      };
      // 法线 = (B-A)×(C-A)
      const ux = x2 - x1, uy = y2 - y1, uz = z2 - z1;
      const vx = x3 - x1, vy = y3 - y1, vz = z3 - z1;
      tri.nx = uy * vz - uz * vy;
      tri.ny = uz * vx - ux * vz;
      tri.nz = ux * vy - uy * vx;
      const nlen = Math.hypot(tri.nx, tri.ny, tri.nz);
      if (nlen > 1) tri.nyNorm = Math.abs(tri.ny) / nlen;
      // Face.VectNormal：C++ MakeNormal 用 SetNormal(顶点>>FLOATNS) 归一化到 ±32767 再 (short) 截断
      // （smMap3d.cpp:97 SetNormal / smStage3d.cpp MakeNormal）。归一化与尺度无关，
      // 这里直接用 raw 坐标算，`Math.trunc` 对齐 C 的 (int) 向零截断。
      if (nlen > 0) {
        tri.vnx = Math.trunc((tri.nx / nlen) * 32767);
        tri.vny = Math.trunc((tri.ny / nlen) * 32767);
        tri.vnz = Math.trunc((tri.nz / nlen) * 32767);
      }
      this.triangles.push(tri);
    }
    this.minY = minY;
    this.maxY = maxY;

    // 构建 StageArea 网格：每个三角形分配到其覆盖的所有 cell
    for (let i = 0; i < this.triangles.length; i++) {
      const tri = this.triangles[i];
      const cMinX = Math.floor(tri.minX / CELL_SIZE);
      const cMaxX = Math.floor(tri.maxX / CELL_SIZE);
      const cMinZ = Math.floor(tri.minZ / CELL_SIZE);
      const cMaxZ = Math.floor(tri.maxZ / CELL_SIZE);
      for (let cx = cMinX; cx <= cMaxX; cx++) {
        for (let cz = cMinZ; cz <= cMaxZ; cz++) {
          const key = cx * 65536 + cz;
          let arr = this.cellMap.get(key);
          if (!arr) { arr = []; this.cellMap.set(key, arr); }
          arr.push(i);
        }
      }
    }
  }

  /** 获取 (x,z) 所在 cell 的三角形索引列表（含相邻 cell，范围 ±AREA_RADIUS） */
  _nearbyTriangleIdx(x: number, z: number): number[] {
    const cx0 = Math.floor((x - AREA_RADIUS) / CELL_SIZE);
    const cx1 = Math.floor((x + AREA_RADIUS) / CELL_SIZE);
    const cz0 = Math.floor((z - AREA_RADIUS) / CELL_SIZE);
    const cz1 = Math.floor((z + AREA_RADIUS) / CELL_SIZE);
    const out: number[] = [];
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const arr = this.cellMap.get(cx * 65536 + cz);
        if (arr) out.push(...arr);
      }
    }
    return out;
  }

  /**
   * **多图合并视图**（用户 2026-09-13 定的方向）：设置后，本网格的"附近三角形"
   * 不再取自己的 `cellMap`，而是取这些图（**那个 Map 的引用**，所以加载/卸载自动跟随）。
   *
   * 为什么这么做：格子索引的意义就是"按空间缩小取面范围"，而"图"只是**数据切分方式**，
   * 不是物理语义 —— 桥面与桥下的几何在世界空间里是连续的。把判定按图切开会出现：
   * 当前图的墙挡不住另一张图给出的"空地位移"（实测穿透：ruin-1 有空气墙、de-1 同位置没有
   * → 用 de-1 的结果推进 x/z，y 因落差大被丢弃 → 表现为"同一高度水平穿过空气墙"）。
   * 合并后：**任何一张图的墙都是墙**，地面仍按"最高可站立"取（原版 MoveAngle2 的双 stage 语义）。
   *
   * 判定算法因此完全不用第二份实现 —— 仍然走本类的 `_wallBlocked` / `getFloorHeight`。
   */
  private sourceMap: Map<number, CollisionMesh> | null = null;
  /** 只让这些 id 的图参与（null = sourceMap 里全部）。用于"玩家坐标 AABB 命中的图"。 */
  private sourceIds: Set<number> | null = null;

  setSourceMap(m: Map<number, CollisionMesh>): void { this.sourceMap = m; }
  /** 设参与判定的图集合（`null` = 全部）。集合按**玩家坐标**选，不按"当前地图"。 */
  setSourceIds(ids: Set<number> | null): void { this.sourceIds = ids; }
  isMergedView(): boolean { return this.sourceMap !== null; }
  /** 当前实际参与判定的图数（诊断用） */
  sourceCount(): number {
    if (!this.sourceMap) return 0;
    if (!this.sourceIds) return this.sourceMap.size;
    let n = 0;
    for (const id of this.sourceIds) if (this.sourceMap.has(id)) n++;
    return n;
  }

  /**
   * 遍历 (x,z) 附近的三角形（**唯一取面入口**）。
   * 单图模式：自己的 cellMap；合并模式：各源的 cellMap（`mesh`/`index` 回传所属图，
   * 只为调试可视化用，不参与几何判定）。`cb` 返回 false 可提前终止。
   */
  forEachNearbyTri(
    x: number, z: number,
    cb: (tri: CollisionTri, mesh: CollisionMesh, index: number) => boolean | void,
  ): void {
    if (this.sourceMap) {
      const ids = this.sourceIds;
      for (const [id, m] of this.sourceMap) {
        if (m === this) continue;
        if (ids && !ids.has(id)) continue;
        m.forEachNearbyTri(x, z, cb);
      }
      return;
    }
    const cx0 = Math.floor((x - AREA_RADIUS) / CELL_SIZE);
    const cx1 = Math.floor((x + AREA_RADIUS) / CELL_SIZE);
    const cz0 = Math.floor((z - AREA_RADIUS) / CELL_SIZE);
    const cz1 = Math.floor((z + AREA_RADIUS) / CELL_SIZE);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        const arr = this.cellMap.get(cx * 65536 + cz);
        if (!arr) continue;
        for (let k = 0; k < arr.length; k++) {
          const i = arr[k]!;
          if (cb(this.triangles[i]!, this, i) === false) return;
        }
      }
    }
  }

  /**
   * GetPolyHeight —— 复刻 C++ `smSTAGE3D::GetPolyHeight`（smStage3d.cpp:1589，返回 CLIP_OUT 表示无命中）。
   *
   * ⚠ 原版**不是重心坐标**：它按 z 把三个顶点排成 ptop/pmid/pbot，先在该 z 处算出三角形的
   * x 跨度 [x1,x2]（两条边线性插值，含 `<<8 / >>8` 定点），再在 x 上线性插值得 y。
   * 数学上对平面三角形等价，但**整数截断与在面判定（x1/x2 为定点整数）不同** ——
   * 曾在缝隙/边长不正的面附近给出与原版差一档的高度。故照抄。
   */
  getPolyHeight(x: number, z: number): { height: number; found: boolean } {
    let bestY: number | null = null;
    this.forEachNearbyTri(x, z, (tri) => {
      const y = this._polyHeightAt(tri, x, z);
      if (y !== null && (bestY === null || y > bestY)) bestY = y;
    });
    return bestY !== null ? { height: bestY, found: true } : { height: 0, found: false };
  }

  /**
   * 单个面的高度（原版 GetPolyHeight 的逐行实现）。
   * C++ 用顶点数组的 z 排序 + 定点除法；这里等价改写为显式的顶点引用。
   */
  private _polyHeightAt(tri: CollisionTri, x: number, z: number): number | null {
    // v[i] = [x,y,z]；i=0,1,2（顺序同 C++ Face.Vertex[0..2]）
    const vx = [tri.x1, tri.x2, tri.x3], vy = [tri.y1, tri.y2, tri.y3], vz = [tri.z1, tri.z2, tri.z3];
    // 按 z 排 ptop(最小) / pbot(最大) / pmid(剩下那个) —— 照抄原版的三段筛选
    let ti = 0, bi = 1, mi = 2;
    for (let i = 0; i < 3; i++) if (vz[i]! < vz[ti]!) ti = i;
    if (ti === bi) bi = mi;
    for (let i = 0; i < 3; i++) if (vz[i]! > vz[bi]! && ti !== i) bi = i;
    for (let i = 0; i < 3; i++) if (ti !== i && bi !== i) { mi = i; break; }

    if (z < vz[ti]! || z > vz[bi]!) return null;   // z 不在面的 z 跨度内 → CLIP_OUT

    const lz = vz[bi]! - vz[ti]!, tz = vz[mi]! - vz[ti]!, bz = vz[bi]! - vz[mi]!;
    const lx = lz !== 0 ? ((vx[bi]! - vx[ti]!) << 8) / lz : 0;
    const tx = tz !== 0 ? ((vx[mi]! - vx[ti]!) << 8) / tz : 0;
    const bx = bz !== 0 ? ((vx[bi]! - vx[mi]!) << 8) / bz : 0;
    let x1 = ((lx * (z - vz[ti]!)) >> 8) + vx[ti]!;
    let x2 = z < vz[mi]!
      ? ((tx * (z - vz[ti]!)) >> 8) + vx[ti]!
      : ((bx * (z - vz[mi]!)) >> 8) + vx[mi]!;

    const ly = lz !== 0 ? ((vy[bi]! - vy[ti]!) << 8) / lz : 0;
    const ty = tz !== 0 ? ((vy[mi]! - vy[ti]!) << 8) / tz : 0;
    const by = bz !== 0 ? ((vy[bi]! - vy[mi]!) << 8) / bz : 0;
    let y1 = ((ly * (z - vz[ti]!)) >> 8) + vy[ti]!;
    let y2 = z < vz[mi]!
      ? ((ty * (z - vz[ti]!)) >> 8) + vy[ti]!
      : ((by * (z - vz[mi]!)) >> 8) + vy[mi]!;

    if (x1 > x2) {
      const cx = x1; x1 = x2; x2 = cx;
      const cy = y1; y1 = y2; y2 = cy;
    }
    if (x < x1 || x > x2) return null;             // x 不在该 z 截线的跨度内 → CLIP_OUT

    const xe = x2 - x1, ye = y2 - y1;
    const yl = xe !== 0 ? (ye << 8) / xe : y1;
    return ((yl * (x - x1)) >> 8) + y1;
  }

  /**
   * GetFloorHeight — 返回 (x,z) 处"可站立"的地面高度（复刻 C++ smStage3d.cpp:720）
   * 只考虑"上升 < 步高"的面（即从 currentY 能走上去的面），
   * 忽略高处结构（梁/屋顶/帆），避免误判"要爬很高"。
   * 返回 { height, found }：最高且可站立的面高度；无则 found=false
   */
  getFloorHeight(x: number, z: number, currentY: number): { height: number; found: boolean } {
    let bestY: number | null = null;
    this.forEachNearbyTri(x, z, (tri) => {
      const y = this._polyHeightAt(tri, x, z);
      if (y === null) return;
      const rise = y - currentY;
      // C++: hy = he - ep.y; if (hy < Stage_StepHeight) 才记录为地面
      if (rise < STEP_HEIGHT) {
        if (bestY === null || y > bestY) bestY = y;
      }
    });
    return bestY !== null ? { height: bestY, found: true } : { height: 0, found: false };
  }

  /**
   * 点 p 相对三角形平面 (p1,p2,p3) 的有向距离符号 —— 全局 `smGetPlaneProduct`（smStage3d.cpp:16）
   * 逐位复刻：边向量 >>6、法线 >>2、位移 >>6（**整数截断不能省**：边的每个轴分量小于 64 raw
   * 的小三角形，截断后法线整体为 0 → 原版判为"不相交"，不截断则会把它们算成实心面）。
   * 量级核对：本仓库最大碰撞面的 |n| 分量 < 7e5，乘 (位移>>6 ≤ 256) 后 < 6e8，未触 int32 上限，
   * 故 JS 的精确整数运算与 C++ 的 int 结果一致。
   * 返回：>0 在法线侧，<0 另一侧，≈0 在平面上
   */
  _smPlaneProduct(p1: number[], p2: number[], p3: number[], p: number[]): number {
    const ux = (p2[0] - p1[0]) >> 6, uy = (p2[1] - p1[1]) >> 6, uz = (p2[2] - p1[2]) >> 6;
    const vx = (p3[0] - p1[0]) >> 6, vy = (p3[1] - p1[1]) >> 6, vz = (p3[2] - p1[2]) >> 6;
    // 法线 = u × v
    const nx = (uy * vz - uz * vy) >> 2;
    const ny = (uz * vx - ux * vz) >> 2;
    const nz = (ux * vy - uy * vx) >> 2;
    const dx = (p[0] - p1[0]) >> 6, dy = (p[1] - p1[1]) >> 6, dz = (p[2] - p1[2]) >> 6;
    return nx * dx + ny * dy + nz * dz;
  }

  /**
   * 点 p 相对**面平面**的有向距离 —— 类方法 `smSTAGE3D::GetPlaneProduct`（smStage3d.cpp:166）。
   * 与全局版不同的两点：用面预存的定长法线 `Face.VectNormal`（±32767），且位移 >>4（不是 >>6）。
   * C++ 的 GetTriangleImact 里 **c1/c2 用这个版本**、三条边测试用全局版，这里照抄。
   */
  _facePlaneProduct(tri: CollisionTri, p: number[]): number {
    const vx = (tri.vnx >> 4) * ((p[0] - tri.x1) >> 4);
    const vy = (tri.vny >> 4) * ((p[1] - tri.y1) >> 4);
    const vz = (tri.vnz >> 4) * ((p[2] - tri.z1) >> 4);
    return vx + vy + vz;
  }

  /**
   * 线段 sp→ep 与三角形相交检测 —— 精确复刻 C++ smGetTriangleImact（smStage3d.cpp:149）
   *
   * ⚠ 平面乘积要**按原版约定取反**再用（`pp`），原因是本模块的碰撞网格把 z 取负
   * （见 `buildFromSMD`，为对齐 THREE 的 +z 朝南），而 C++ 这个判定是**符号相关**的：
   * `c1<=0` 走"整段位移"分支、否则走 `vy=vz=0` 那条原版手误分支。
   * 法线是伪矢量，坐标镜像会让同一个面、同一个点的乘积整体变号 → 不取反的话，
   * **挡的是相反的一侧**（合成单面栏杆实测：原版挡 +z 到达侧、不取反时挡 -z 侧）。
   * 取反后本函数与原版对**同一物理配置**的判定逐条一致（`npm run diag-climb -- --rail2` 回归）。
   */
  _triangleImact(tri: CollisionTri, sp: number[], ep: number[]): boolean {
    const p1 = [tri.x1, tri.y1, tri.z1];
    const p2 = [tri.x2, tri.y2, tri.z2];
    const p3 = [tri.x3, tri.y3, tri.z3];
    /** 全局版平面乘积（三条边测试用），因网格 z 取负而按原版约定取反 */
    const pp = (a: number[], b: number[], c: number[], p: number[]): number =>
      -this._smPlaneProduct(a, b, c, p);
    /** 类方法版（c1/c2 用），同样取反 */
    const fp = (p: number[]): number => -this._facePlaneProduct(tri, p);

    // C++ smStage3d.cpp:330-334 —— Y 剔除
    const spBelow = sp[1] < p1[1] && sp[1] < p2[1] && sp[1] < p3[1];
    const spAbove = sp[1] > p1[1] && sp[1] > p2[1] && sp[1] > p3[1];
    const epBelow = ep[1] < p1[1] && ep[1] < p2[1] && ep[1] < p3[1];
    const epAbove = ep[1] > p1[1] && ep[1] > p2[1] && ep[1] > p3[1];
    if ((spBelow || spAbove) && (epBelow || epAbove)) return false;

    // C++ 336-340 —— 平面异侧测试（GetPlaneProduct，面法线版）
    const c1 = fp(sp);
    const c2 = fp(ep);
    if ((c1 <= 0 && c2 <= 0) || (c1 > 0 && c2 > 0)) return false;

    // C++ 355-364 —— 方向 v
    let vx: number, vy: number, vz: number;
    if (c1 <= 0) {
      vx = ep[0] - sp[0];
      vy = ep[1] - sp[1];
      vz = ep[2] - sp[2];
    } else {
      // C++ 原样：反向且 vy=vz=0
      vx = sp[0] - ep[0];
      vy = 0;
      vz = 0;
    }

    // C++ 369-419 —— 三条边平移测试
    const cp1 = [p1[0] + vx, p1[1] + vy, p1[2] + vz];
    if (pp(p1, p2, cp1, sp) > 0) return false;
    const cp2 = [p2[0] + vx, p2[1] + vy, p2[2] + vz];
    if (pp(p2, p3, cp2, sp) > 0) return false;
    const cp3 = [p3[0] + vx, p3[1] + vy, p3[2] + vz];
    if (pp(p3, p1, cp3, sp) > 0) return false;

    return true;
  }

  /**
   * 用 T 形线检测移动路径是否被墙阻挡
   * 对应 C++ smMakeTLine + GetTriangleImact
   * 原版只测 **sp→ep 一个方向**（`GetTriangleImact` 里没有任何反向/双面分支，
   * 材质是否 `*MATERIAL_TWOSIDED` 与碰撞无关 —— 它只影响渲染的背面剔除）。
   * 曾在这里补过"反向再测一次"，用来让单面栏杆从背面也挡；但实测那会让
   * 30-50° 坡面的被挡率涨到 3 倍（见 `scripts/diag-climb.ts` 的因子隔离表）。
   * 单面几何该不该两面都挡，属于**数据**问题：要么对齐原版（按原版的挡侧），
   * 要么在建网格时给指定面补一份反向绕序副本，不要在这里每次判定测两遍。
   */
  _wallBlocked(x: number, y: number, z: number, dx: number, dz: number, bodyWidth: number, bodyHeight: number, level = 0): boolean {
    const bw = (bodyWidth * fONE) >> 2;   // C++ width = ObjWidth>>2
    const footY = y + fONE * 12;          // 脚底线（C++ PosiMinY = fONE*12）
    const chestY = y + bodyHeight * fONE - ((bodyHeight * fONE) >> 2); // 胸口线（C++ PosiMaxY = H-(H>>2)）

    const dLen = Math.hypot(dx, dz) || 1;
    const probeLen = dLen + 12 * fONE;    // C++ dist2 = dist + fONE*12
    const ux = dx / dLen, uz = dz / dLen;
    const px = ux * probeLen, pz = uz * probeLen; // 探测点偏移
    // 横杆方向：C++ smMakeTLine 用 GetMoveLocation(∓width, …, dist2) 在**垂直于前进方向**上偏移，
    // 右方 = (cosY, -sinY)，而前进方向 = (sinY, cosY) = (ux, uz) → 右方 = (uz, -ux)。
    // 曾误写成"只沿世界 X 偏移"（朝 ±Z 走时碰巧对，朝东西走时横杆退化成与轨道共线）。
    const rxp = uz * bw, rzp = -ux * bw;

    const sink = collisionProbe.sink;

    // 4 条 T 形线：两条沿路径的轨道（脚底 / 胸口）+ 两条在探测点末端的横杆
    const lines = [
      { sp: [x, footY, z], ep: [x + px, footY, z + pz] },
      { sp: [x, chestY, z], ep: [x + px, chestY, z + pz] },
      { sp: [x + px - rxp, footY, z + pz - rzp], ep: [x + px + rxp, footY, z + pz + rzp] },
      { sp: [x + px - rxp, chestY, z + pz - rzp], ep: [x + px + rxp, chestY, z + pz + rzp] },
    ];

    const pathMinX = Math.min(x, x + px) - bw;
    const pathMaxX = Math.max(x, x + px) + bw;
    const pathMinZ = Math.min(z, z + pz) - bw;
    const pathMaxZ = Math.max(z, z + pz) + bw;

    if (sink) {
      const pts: number[] = [];
      for (const l of lines) { for (const p2 of [l.sp, l.ep]) pts.push(p2[0]!, p2[1]!, p2[2]!); }
      sink.tlines(level, pts);
    }

    let hit = false;
    this.forEachNearbyTri((x + x + px) / 2, (z + z + pz) / 2, (tri, mesh, i) => {
      if (hit) return false;   // 已判成挡 → 提前终止
      // 对齐原版：所有实体面（含斜坡）都参与 T 线检测。
      // 缓坡靠 _triangleImact 的异侧几何测试自然放行（可爬），陡坡被挡（不可爬）。
      if (tri.maxX < pathMinX || tri.minX > pathMaxX) return;
      if (tri.maxZ < pathMinZ || tri.minZ > pathMaxZ) return;
      // 进到这里 = 该面通过了 AABB 预筛，它就是"本帧参与碰撞的候选面"（每个只报一次）
      if (sink) sink.candidate(mesh, i);
      for (const l of lines) {
        const lMinY = Math.min(l.sp[1], l.ep[1]);
        const lMaxY = Math.max(l.sp[1], l.ep[1]);
        if (tri.maxY < lMinY || tri.minY > lMaxY) continue;
        if (this._triangleImact(tri, l.sp, l.ep)) {   // 原版：只测这一个方向
          if (sink) sink.blockedBy(mesh, i);
          hit = true;
          return false;
        }
      }
    });
    return hit;
  }

  /**
   * CheckNextMove — replicates smSTAGE3D::CheckNextMove (smStage3d.cpp:569)
   * Input: x/y in raw SMD units, z in world convention (+z = south), angle in radians, distance in fONE units.
   * Returns { x, y, z, collision, level } in same coordinate space.
   * `level` = 原版返回值 ccnt+1（1=走主方向、2/3=走左/右偏 ±67.5°），0=未移动；
   * 跨图/多 stage 选地面时要用它比"谁的方向更直"（见 WorldView 的 updateMovement）。
   * bodyWidth 用**游戏单位**（内部 ×fONE，对齐原版 ObjWidth=fONE 制的定点值）；
   * 默认值取玩家身体模型的实测 `Pattern->SizeWidth`（见 OBJ_WIDTH_RAW）。
   */
  checkNextMove(x: number, y: number, z: number, angle: number, dist: number, bodyWidth = OBJ_WIDTH_RAW / fONE): { x: number; y: number; z: number; collision: boolean; level: number } {
    const prevX = x, prevY = y, prevZ = z;
    const stepMaxUp = STEP_HEIGHT;
    const bodyHeight = OBJ_HEIGHT_RAW / fONE;

    let curDist = dist;
    // ccnt: 0=主方向, 1=左偏, 2=右偏（引擎角度 ±768 → 弧度 ±(768/4096*2π)）
    const ANGLE_OFFSET = (768 / 4096) * Math.PI * 2;
    for (let ccnt = 0; ccnt < 3; ccnt++) {
      const offset = ccnt === 0 ? 0 : (ccnt === 1 ? -ANGLE_OFFSET : ANGLE_OFFSET);
      const testAngle = angle + offset;
      const sinVal = Math.sin(testAngle);
      const cosVal = Math.cos(testAngle);

      const fdx = sinVal * curDist;
      const fdz = cosVal * curDist;
      if (fdx === 0 && fdz === 0) { if (ccnt === 0) curDist >>= 1; continue; }

      if (this._wallBlocked(x, y, z, fdx, fdz, bodyWidth, bodyHeight, ccnt)) {
        if (ccnt === 0) curDist >>= 1;
        continue;
      }

      const newX = x + fdx;
      const newZ = z + fdz;
      const h = this.getFloorHeight(newX, newZ, y);
      // 对齐原版 CheckNextMove：脚下必须有可站立实体面（height != CLIP_OUT）才允许移动，
      // 无面（如桥边缘/悬空）→ 该方向失败（避免从桥上掉落）
      if (!h.found) {
        if (ccnt === 0) curDist >>= 1;
        continue;
      }
      const rise = h.height - y;
      if (rise > stepMaxUp) {
        if (ccnt === 0) curDist >>= 1;
        continue;
      }

      if (collisionProbe.sink) collisionProbe.sink.decided(ccnt + 1);
      return { x: newX, y: h.height, z: newZ, collision: false, level: ccnt + 1 };
    }

    if (collisionProbe.sink) collisionProbe.sink.decided(0);
    return { x: prevX, y: prevY, z: prevZ, collision: true, level: 0 };
  }
}
