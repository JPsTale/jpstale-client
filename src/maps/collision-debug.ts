/**
 * 碰撞调试可视化（`?coll=1` / F9 开关）。
 *
 * 三项（用户 2026-09-13 指定）：
 *   ① **CollisionMesh**：把每张已加载图的**碰撞三角形**画成线框（灰）——注意是碰撞面
 *      （`meshState & 1` 的那些），不是渲染网格，所以"看上去有栏杆但走过去了"一眼能对。
 *   ② **当前参与碰撞的面**：本帧 `checkNextMove` 里 cell 取到的**候选面**（蓝）与
 *      真正判成"挡"的面（红）；另外每张已加载图在玩家脚下的**地面高度**画一条横线 + 读数
 *      （对齐 `pt-visualizer/DummyPlayer.tryStep` 里那句"各图地面: m0=… m3=…"日志）。
 *   ③ **角色碰撞器**：碰撞盒（绿，尺寸取自算法同源常量）+ 真正的探针 **4 条 T 形线**（黄，
 *      下沿 +12u / 上沿 0.75×ObjHeight / 末端左右横杆）—— 挡不挡就是这 4 条线说了算。
 *
 * 数据怎么来：`collision.ts` 里的 `collisionProbe` 钩子（**只在调试开启时挂上**，
 * 关闭时为 null，判定路径零开销）。候选/阻挡面按 mesh 引用回传，本模块再用
 * `meshes: Map<mapId, CollisionMesh>` 反查是哪张图。
 *
 * 性能：网格线框每张图只建一次（缓存）；候选/阻挡/地面线按 `THROTTLE_MS` 重建；
 * 只有 T 形线与碰撞盒每帧更新（都是 5 个点的几何）。
 */
import * as THREE from 'three';
import type { CollisionMesh } from './collision.js';
import { collisionProbe } from './collision.js';
import { reportFallback } from '../char/fallback-log.js';

const THROTTLE_MS = 100;

/** 配色（读数的图例同色） */
const C_MESH = 0x4a5a6a;
const C_CAND = 0x2f8fff;
const C_BLOCK = 0xff3b30;
const C_BOX = 0x33ff66;
const C_FACE = 0x33ffe0;      // 角色面向（前箭头）
const C_TLINE = 0xffd83d;     // 本帧**走通**的那次尝试的 T 形线
const C_TLINE_ALT = 0xff8a3d; // 同帧其它尝试（主方向/±67.5° 重试）的 T 形线
const C_FLOOR = [0xff66cc, 0x66ffcc, 0xffaa33, 0xaa66ff, 0x66aaff, 0xff8888, 0x88ff88, 0xdddddd];

export interface CollisionDebugParams {
  /** 已加载图的碰撞网格（引用即用，随加载/卸载变化） */
  meshes: Map<number, CollisionMesh>;
  /** 自机（world 单位） */
  x: number; y: number; z: number;
  angle: number;
  /** 本帧位移（world） */
  step: number;
  /** 角色碰撞尺寸（与算法同源：width=ObjWidth, height=ObjHeight，world 单位） */
  bodyWidth: number;
  bodyHeight: number;
  /** 该帧实际调用的每次移动的探针长度（raw→world 由调用方换算好）——每帧可能多子步 */
  substep: number;
}

export class CollisionDebug {
  readonly root = new THREE.Group();
  private scene: THREE.Scene | null = null;
  private enabled = false;

  /** mapId → 网格线框（缓存） */
  private wireByMap = new Map<number, THREE.LineSegments>();
  /** CollisionMesh 引用 → mapId（sink 回传的是引用） */
  private mapOfMesh = new WeakMap<CollisionMesh, number>();

  private candGeo = new THREE.BufferGeometry();
  private blockGeo = new THREE.BufferGeometry();
  private floorGeo = new THREE.BufferGeometry();
  private tlineGeo = new THREE.BufferGeometry();
  private tlineAltGeo = new THREE.BufferGeometry();
  private faceGeo = new THREE.BufferGeometry();
  private boxGeo = new THREE.BufferGeometry();
  private candLine: THREE.LineSegments;
  private blockLine: THREE.LineSegments;
  private floorLine: THREE.LineSegments;
  private tline: THREE.LineSegments;
  private tlineAlt: THREE.LineSegments;
  private face: THREE.LineSegments;
  private box: THREE.LineSegments;

  /** 本帧 sink 收集（按 mesh 引用分组，暂时存索引） */
  private candOf = new Map<CollisionMesh, Set<number>>();
  private blockOf = new Map<CollisionMesh, Set<number>>();
  /**
   * 本帧的 T 形线（**只保留当前帧**：一帧的移动可能跨多子步、每次子步最多试 3 个方向，
   * 所以这里是"这次帧真正探过的全部"，`level` 标明是主方向还是 ±67.5° 重试）。
   * 旧实现只存"最后一次调用"，于是 ① 停下后线还留在屏幕上、② 常显示的是重试方向 ——
   * 两者都会让"线不跟朝向"看起来像 bug。
   */
  private probeSets: { level: number; pts: number[] }[] = [];
  /** 本帧最后一次裁定：哪次尝试走通了（level=0 表示全被挡）。合并视图下没有"哪张图"。 */
  private decided: number | null = null;
  private lastBuild = 0;

  private readout: HTMLDivElement;

  constructor() {
    const mk = (geo: THREE.BufferGeometry, color: number, width = 1) => {
      const m = new THREE.LineBasicMaterial({ color, linewidth: width, depthTest: false, transparent: true, opacity: 0.95 });
      const ls = new THREE.LineSegments(geo, m);
      ls.frustumCulled = false;
      ls.renderOrder = 999;   // 调试线画在最上层（depthTest:false）
      return ls;
    };
    this.candLine = mk(this.candGeo, C_CAND);
    this.blockLine = mk(this.blockGeo, C_BLOCK, 2);
    this.floorLine = mk(this.floorGeo, C_FLOOR[0]!);
    this.tline = mk(this.tlineGeo, C_TLINE, 2);
    this.tlineAlt = mk(this.tlineAltGeo, C_TLINE_ALT);
    this.face = mk(this.faceGeo, C_FACE, 2);
    this.box = mk(this.boxGeo, C_BOX, 2);
    this.root.add(this.candLine, this.blockLine, this.floorLine, this.tline, this.tlineAlt, this.face, this.box);
    // 给几何起名：three 的 "Computed radius is NaN" 只打印几何对象本身，
    // 有名字才能在控制台里一眼认出是不是调试层画的（而不是游戏里的某个模型）。
    this.candGeo.name = 'coll:cand';
    this.blockGeo.name = 'coll:block';
    this.floorGeo.name = 'coll:floor';
    this.tlineGeo.name = 'coll:tline';
    this.tlineAltGeo.name = 'coll:tline-alt';
    this.faceGeo.name = 'coll:facing';
    this.boxGeo.name = 'coll:box';

    this.readout = document.createElement('div');
    this.readout.style.cssText = [
      'position:fixed', 'left:8px', 'top:64px', 'z-index:9999', 'pointer-events:none',
      'font:12px/1.45 ui-monospace,Consolas,monospace', 'color:#dce6f2',
      'background:rgba(8,12,18,.72)', 'padding:6px 8px', 'border-radius:4px', 'white-space:pre',
    ].join(';');
  }

  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    if (on) {
      collisionProbe.sink = {
        candidate: (mesh, i) => {
          let s = this.candOf.get(mesh);
          if (!s) { s = new Set(); this.candOf.set(mesh, s); }
          s.add(i);
        },
        blockedBy: (mesh, i) => {
          let s = this.blockOf.get(mesh);
          if (!s) { s = new Set(); this.blockOf.set(mesh, s); }
          s.add(i);
        },
        tlines: (level, pts) => { this.probeSets.push({ level, pts }); },
        decided: (level) => { this.decided = level; },
      };
      if (this.scene) this.scene.add(this.root);
      document.body.appendChild(this.readout);
    } else {
      collisionProbe.sink = null;
      this.root.removeFromParent();
      this.readout.remove();
    }
  }

  isEnabled(): boolean { return this.enabled; }

  attach(scene: THREE.Scene): void {
    this.scene = scene;
    if (this.enabled) scene.add(this.root);
  }

  /** 卸载某张图时清掉它的线框（避免残留） */
  forgetMap(mapId: number): void {
    const w = this.wireByMap.get(mapId);
    if (w) { w.removeFromParent(); w.geometry.dispose(); this.wireByMap.delete(mapId); }
  }

  /**
   * 每帧调用（关闭时立即返回）。重活（线框/候选/阻挡/地面）按 THROTTLE_MS 节流，
   * T 形线 + 面向 + 碰撞盒每帧更新。
   *
   * ⚠ 探针数据**画完即清**：它只代表"这一帧真正探过的方向"。留着上一帧的线，
   * 停下后屏幕上就会出现一条与角色朝向无关的线（曾据此误判为 bug）。
   */
  update(p: CollisionDebugParams): void {
    if (!this.enabled) return;
    const now = performance.now();
    if (now - this.lastBuild > THROTTLE_MS) {
      this.lastBuild = now;
      this.rebuildMeshWires(p.meshes);
      this.rebuildFaces(p);
    }
    this.updateTlines();
    this.updateFacing(p);
    this.updateBox(p);
    if (now - this.lastReadout > 200) { this.lastReadout = now; this.refreshReadout(p); }
    this.probeSets.length = 0;
    this.decided = null;
  }

  private lastReadout = 0;

  // ---------------- ① 碰撞网格线框 ----------------

  private rebuildMeshWires(meshes: Map<number, CollisionMesh>): void {
    for (const [mapId, cm] of meshes) {
      if (this.wireByMap.has(mapId)) { this.mapOfMesh.set(cm, mapId); continue; }
      const n = cm.triangles.length;
      const pos = new Float32Array(n * 6 * 3);
      let o = 0;
      let bad = 0;
      for (const t of cm.triangles) {
        const v = [[t.x1, t.y1, t.z1], [t.x2, t.y2, t.z2], [t.x3, t.y3, t.z3]];
        // 数据体检：碰撞三角形来自 SMD 解析，正常全为有限值（当时的一次性体检脚本扫过
        // 全仓 625 张图 / 372 万面 → 0 个非有限）。真出现就跳过该面并上报，不静默画坏。
        if (v.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || !Number.isFinite(p[2]))) { bad++; continue; }
        for (const [a, b] of [[0, 1], [1, 2], [2, 0]] as const) {
          pos[o++] = v[a]![0] / 256; pos[o++] = v[a]![1] / 256; pos[o++] = v[a]![2] / 256;
          pos[o++] = v[b]![0] / 256; pos[o++] = v[b]![1] / 256; pos[o++] = v[b]![2] / 256;
        }
      }
      if (bad) reportFallback('collDebug:nonFiniteTriangle', `map${mapId} 有 ${bad} 个碰撞三角形含非有限坐标（已跳过不画）`);
      const geo = new THREE.BufferGeometry();
      geo.name = `coll:wire:m${mapId}`;
      geo.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, o), 3));
      const ls = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
        color: C_MESH, transparent: true, opacity: 0.5,
      }));
      ls.frustumCulled = false;
      this.wireByMap.set(mapId, ls);
      this.mapOfMesh.set(cm, mapId);
      this.root.add(ls);
    }
  }

  // ---------------- ② 候选面 / 阻挡面 / 各图脚下地面 ----------------

  private rebuildFaces(p: CollisionDebugParams): void {
    const seg: number[] = [];
    const pushTri = (cm: CollisionMesh, i: number, out: number[]) => {
      const t = cm.triangles[i];
      if (!t) return;
      const v = [[t.x1, t.y1, t.z1], [t.x2, t.y2, t.z2], [t.x3, t.y3, t.z3]];
      for (const [a, b] of [[0, 1], [1, 2], [2, 0]] as const) {
        out.push(v[a]![0] / 256, v[a]![1] / 256, v[a]![2] / 256,
                 v[b]![0] / 256, v[b]![1] / 256, v[b]![2] / 256);
      }
    };
    let nCand = 0, nBlock = 0;
    const blockSet = new Set<number>();
    for (const [cm, set] of this.blockOf) {
      for (const i of set) { blockSet.add(i); nBlock++; pushTri(cm, i, seg); }
    }
    this.setSegments(this.blockGeo, seg, '阻挡面');
    this.blockLine.visible = seg.length > 0;

    const candSeg: number[] = [];
    for (const [cm, set] of this.candOf) {
      for (const i of set) { nCand++; if (!blockSet.has(i)) pushTri(cm, i, candSeg); }
    }
    this.setSegments(this.candGeo, candSeg, '候选面');
    this.candLine.visible = candSeg.length > 0;
    this.candCount = nCand;
    this.blockCount = nBlock;
    this.candOf.clear();
    this.blockOf.clear();

    // 各图脚下地面：每图在玩家 (x,z) 的"可站立地面高度"→ 画一小段横线 + 读数
    const floorSeg: number[] = [];
    const floorText: string[] = [];
    let k = 0;
    for (const [mapId, cm] of p.meshes) {
      const fh = cm.getFloorHeight(p.x * 256, p.z * 256, p.y * 256);
      floorText.push(`m${mapId}=${fh.found ? (fh.height / 256).toFixed(1) : '无'}`);
      if (fh.found) {
        const y = fh.height / 256, r = 3;
        floorSeg.push(p.x - r, y, p.z, p.x + r, y, p.z);
        floorSeg.push(p.x, y, p.z - r, p.x, y, p.z + r);
      }
      k++;
    }
    this.setSegments(this.floorGeo, floorSeg, '各图地面');
    this.floorLine.visible = floorSeg.length > 0;
    (this.floorLine.material as THREE.LineBasicMaterial).color.setHex(C_FLOOR[0]!);
    this.floorText = floorText.join('  ');
  }

  /**
   * 写入线段顶点。**复用已有 BufferAttribute**（只在容量不够时重建）：
   * 每帧 `new BufferAttribute` 会让旧的 GL buffer 悬着（three 只在 geometry.dispose 时释放）
   * → 长时间开着调试会稳定泄漏。这里按"需要多少才扩多少"处理。
   *
   * ⚠ 两点必须注意：
   *   1. **不调用 `computeBoundingSphere()`**：这些线都设了 `frustumCulled = false`，渲染根本不用
   *      包围球；而它扫的是**整个数组**（不看 drawRange），既浪费又正是 three 那句
   *      "Computed radius is NaN" 的触发点 —— 调试代码不该制造误导性的报错。
   *   2. **写入前查非有限值**：一旦把 NaN 写进复用的缓冲区，它会被后续更短的帧**留在尾部**、
   *      反复触发包围球告警。这里发现就整帧不写（保留上一帧的好数据）并上报（不静默）。
   */
  private setSegments(geo: THREE.BufferGeometry, seg: number[], layer: string): void {
    const need = seg.length;
    for (let i = 0; i < need; i++) {
      if (!Number.isFinite(seg[i]!)) {
        reportFallback('collDebug:nonFiniteVertex', `${layer} 第 ${i} 个分量=${seg[i]}（本帧不写入，保留上一帧）`);
        return;
      }
    }
    let attr = geo.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!attr || attr.array.length < need) {
      // ⚠ 容量必须按**顶点数**分配（= itemSize 的整数倍）。
      // `BufferAttribute.count = array.length / itemSize` **不做取整**：容量写成 1024（非 3 的倍数）
      // → count = 341.33 → three 遍历到第 341 号顶点时读到越界元素 `undefined` → 当 NaN 处理
      // → 报 `computeBoundingSphere(): Computed radius is NaN`。**这就是那条告警的真正来源**
      // （实测：Float32Array(1024)+itemSize3 → radius=NaN；1026 → radius=0 正常）。
      const capVerts = Math.max(Math.ceil(need / 3), Math.ceil((attr?.array.length ?? 0) * 2 / 3), 512);
      attr = new THREE.BufferAttribute(new Float32Array(capVerts * 3), 3);
      geo.setAttribute('position', attr);
    }
    (attr.array as Float32Array).set(seg, 0);
    attr.needsUpdate = true;
    geo.setDrawRange(0, need / 3);
  }

  // ---------------- ③ 碰撞器：T 形线 + 面向 + 碰撞盒 ----------------

  /**
   * 本帧真正探过的 T 形线。**亮黄 = 走通的那次尝试**，暗橙 = 同帧试过但被否的
   * （主方向被挡后 `checkNextMove` 会左右各重试一次 ±67.5°）。
   * 两者用不同颜色分开画，才能回答"为什么线不是正的"。
   */
  private updateTlines(): void {
    const chosenSeg: number[] = [];
    const altSeg: number[] = [];
    const d = this.decided;
    for (const set of this.probeSets) {
      const isChosen = d !== null && d > 0 && set.level === d - 1;
      const out = isChosen ? chosenSeg : altSeg;
      const t = set.pts;
      for (let i = 0; i + 5 < t.length; i += 6) {
        out.push(t[i]! / 256, t[i + 1]! / 256, t[i + 2]! / 256,
                 t[i + 3]! / 256, t[i + 4]! / 256, t[i + 5]! / 256);
      }
    }
    this.setSegments(this.tlineGeo, chosenSeg, 'T形线(走通)');
    this.setSegments(this.tlineAltGeo, altSeg, 'T形线(重试)');
    this.tline.visible = chosenSeg.length > 0;
    this.tlineAlt.visible = altSeg.length > 0;
    this.probeInfo = this.probeSets.length
      ? `${this.probeSets.length} 组（${chosenSeg.length ? `亮黄=走通(第${d ?? 0}次尝试)` : '全部被挡'}）`
      : '无（本帧未移动 → 不产生探针）';
  }

  /**
   * 角色**面向**（青箭，从脚下沿 `selfAngle`）。
   * 移动方向 = (sin a, cos a)，与渲染用的 `charGroup.rotation.y = selfAngle` 同一约定 ——
   * 所以正常前进时，亮黄 T 形线应当与这支箭头**重合**。
   */
  private updateFacing(p: CollisionDebugParams): void {
    const len = Math.max(4, p.bodyWidth * 1.2);
    const fx = Math.sin(p.angle), fz = Math.cos(p.angle);
    const y = p.y + 0.15;                       // 略抬离地，避免被地形遮住
    const ex = p.x + fx * len, ez = p.z + fz * len;
    const seg = [p.x, y, p.z, ex, y, ez];
    // 箭头两撇（±150°）
    for (const s of [-1, 1]) {
      const a = p.angle + s * (Math.PI * 5) / 6;
      seg.push(ex, y, ez, ex + Math.sin(a) * len * 0.35, y, ez + Math.cos(a) * len * 0.35);
    }
    this.setSegments(this.faceGeo, seg, '面向箭头');
    this.face.visible = Number.isFinite(p.x) && Number.isFinite(p.z) && Number.isFinite(p.angle);
  }

  private updateBox(p: CollisionDebugParams): void {
    const hw = p.bodyWidth / 2, h = p.bodyHeight;
    const { x, y, z } = p;
    const c: [number, number, number][] = [
      [-hw, 0, -hw], [hw, 0, -hw], [hw, 0, hw], [-hw, 0, hw],
      [-hw, h, -hw], [hw, h, -hw], [hw, h, hw], [-hw, h, hw],
    ];
    const E = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]] as const;
    const seg: number[] = [];
    for (const [a, b] of E) {
      seg.push(x + c[a]![0], y + c[a]![1], z + c[a]![2], x + c[b]![0], y + c[b]![1], z + c[b]![2]);
    }
    this.setSegments(this.boxGeo, seg, '碰撞盒');
    this.box.visible = true;
  }

  /** 读数（图示）：节流 200ms 更新一次，避免每帧写 DOM */
  private refreshReadout(p: CollisionDebugParams): void {
    this.readout.textContent =
      `碰撞调试  map=${p.meshes.size}张图  step=${p.step.toFixed(2)}u  子步=${p.substep.toFixed(2)}u\n` +
      `碰撞盒 ${p.bodyWidth.toFixed(2)}×${p.bodyHeight.toFixed(2)}u（绿）  面向（青）  T线（黄/橙）\n` +
      `本帧探针: ${this.probeInfo}\n` +
      `候选面(蓝)=${this.candCount}  阻挡面(红)=${this.blockCount}\n` +
      `各图脚下地面: ${this.floorText}`;
  }

  private floorText = '';
  private probeInfo = '';
  private candCount = 0;
  private blockCount = 0;
}
