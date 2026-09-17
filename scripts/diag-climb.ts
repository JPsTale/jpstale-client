/**
 * 爬坡 / 台阶手感差异诊断。
 *
 * 把**原版 C++ 的 CheckNextMove 逐行照抄**成参考实现，与我们的
 * `CollisionMesh.checkNextMove` 并排跑同一份几何，量出：
 *   A. 同一段斜坡上「上去要几帧 / 其中被挡几帧」随每帧步长 dist 与身高参数 H 的变化
 *   B. 台阶（桥口那种小台阶）能不能跨过去
 *   C. 真实地图（理查登 village-2）上，同一 dist 下两者各自"被挡"的比例
 *
 * 参考实现依据（原版客户端源码，与 ex-machina `smStage3d.cpp` 同逻辑）：
 *   - smLib3d/smStage3d.cpp：CheckNextMove / smMakeTLine / GetPolyHeight / GetTriangleImact /
 *     MakeAreaFaceList / smGetPlaneProduct / Stage_StepHeight = 10*fONE
 *   - character.cpp:2013 传 `Pattern->SizeWidth/SizeHeight`（由 smObj3d.cpp AddVertex 从模型顶点算出）
 *   - character.cpp:4183/4185/4199 本地玩家每帧调用：野外走 (MoveSpeed*180)>>8=175、
 *     村庄走 MoveSpeed=250、跑 (MoveSpeed*460)>>8=449（MoveSpeed=250+10*cnt，cnt 夹 0..8）
 *
 * 用法：
 *   npx tsx scripts/diag-climb.ts            # A + B（合成几何，秒级）
 *   npx tsx scripts/diag-climb.ts --map      # 追加 C（真实地图扫描，较慢）
 *   npx tsx scripts/diag-climb.ts --debug    # 打印判定细节
 */
import { readFileSync } from 'node:fs';
import { parseSMD } from '../src/core/smd-parser.js';
import { CollisionMesh } from '../src/maps/collision.js';

const fONE = 256;
const CLIP_OUT = -32767;
const StepHeight = 10 * fONE;
const DEBUG = process.argv.includes('--debug');
let dbgLeft = 12;

/**
 * 角色碰撞尺寸 = 原版 `Pattern->SizeWidth / SizeHeight`，由
 * `Server服务端/char/tmABCD/tmbB01.ASE` 逐顶点算得（AddVertex 的 maxX/maxZ/maxY）。
 * 与 `char/tmabcd/tmbb01.smd` 头部字段逐字节一致（maxX=1291 maxZ=1163 maxY=10428）。
 * 注：`smOBJ3D::AddVertex` 里 maxX←|x|、maxZ←|y|、maxY←|z|，故
 *     SizeWidth = max(maxX, maxZ) = max(2338, 2799) = 2799，SizeHeight = maxY = 11662。
 */
export const CHAR_SIZE = { width: 2799, height: 11662 };

/** 我们客户端现在用的尺寸（与 collision.ts 的 OBJ_WIDTH_RAW / OBJ_HEIGHT_RAW 同源） */
export const OURS_NOW = { width: 2799, height: 11662 };

type P = [number, number, number];
interface RTri {
  p: [P, P, P];
  /** 面法线的定长分量（±32767，short 截断）—— C++ Face.VectNormal（SetNormal 归一化） */
  vn?: [number, number, number];
}
type Provider = (x: number, z: number) => number[];

// ============================== 参考实现（逐行照抄）==============================

/** 全局 smGetPlaneProduct（smStage3d.cpp:16），含 >>6 / >>2 截断 */
function refPlaneProduct(p1: P, p2: P, p3: P, p: P): number {
  const ux = (p2[0] - p1[0]) >> 6, uy = (p2[1] - p1[1]) >> 6, uz = (p2[2] - p1[2]) >> 6;
  const vx = (p3[0] - p1[0]) >> 6, vy = (p3[1] - p1[1]) >> 6, vz = (p3[2] - p1[2]) >> 6;
  const nx = (uy * vz - uz * vy) >> 2;
  const ny = (uz * vx - ux * vz) >> 2;
  const nz = (ux * vy - uy * vx) >> 2;
  return nx * ((p[0] - p1[0]) >> 6) + ny * ((p[1] - p1[1]) >> 6) + nz * ((p[2] - p1[2]) >> 6);
}

/** 按 SetNormal 的规则算面的定长法线（±32767，(short) 截断） */
function refVectNormal(t: RTri): [number, number, number] {
  if (t.vn) return t.vn;
  const [p1, p2, p3] = t.p;
  const ux = p2[0] - p1[0], uy = p2[1] - p1[1], uz = p2[2] - p1[2];
  const vx = p3[0] - p1[0], vy = p3[1] - p1[1], vz = p3[2] - p1[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  t.vn = [Math.trunc((nx / len) * 32767), Math.trunc((ny / len) * 32767), Math.trunc((nz / len) * 32767)];
  return t.vn;
}

/**
 * smSTAGE3D::GetPlaneProduct（smStage3d.cpp:166）—— 用面预存法线、位移 >>4。
 * C++ 的 GetTriangleImact 里 c1/c2 用这个、三条边测试用全局 smGetPlaneProduct。
 */
function refFaceProduct(t: RTri, p: P): number {
  const vn = refVectNormal(t);
  const [p1] = t.p;
  return (vn[0] >> 4) * ((p[0] - p1[0]) >> 4)
       + (vn[1] >> 4) * ((p[1] - p1[1]) >> 4)
       + (vn[2] >> 4) * ((p[2] - p1[2]) >> 4);
}

/**
 * smSTAGE3D::GetPolyHeight（smStage3d.cpp:1589）—— 按 z 扫描线插值，**不是**重心坐标。
 * 先按 z 排出 ptop/pmid/pbot，算该 z 处的 x 跨度 [x1,x2] 与两端 y，再沿 x 线性插值。
 */
function refPolyHeight(t: RTri, x: number, z: number): number {
  const p = t.p;
  let top = p[0]!, bot = p[1]!, mid = p[2]!;
  for (let i = 0; i < 3; i++) if (p[i]![2] < top[2]) top = p[i]!;
  if (top === bot) bot = mid;
  for (let i = 0; i < 3; i++) if (p[i]![2] > bot[2] && top !== p[i]) bot = p[i]!;
  for (let i = 0; i < 3; i++) if (top !== p[i] && bot !== p[i]) { mid = p[i]!; break; }

  if (z < top[2] || z > bot[2]) return CLIP_OUT;

  const lz = bot[2] - top[2], tz = mid[2] - top[2], bz = bot[2] - mid[2];
  const lx = lz !== 0 ? ((bot[0] - top[0]) << 8) / lz : 0;
  const tx = tz !== 0 ? ((mid[0] - top[0]) << 8) / tz : 0;
  const bx = bz !== 0 ? ((bot[0] - mid[0]) << 8) / bz : 0;
  let x1 = ((lx * (z - top[2])) >> 8) + top[0];
  let x2 = z < mid[2] ? ((tx * (z - top[2])) >> 8) + top[0] : ((bx * (z - mid[2])) >> 8) + mid[0];

  const ly = lz !== 0 ? ((bot[1] - top[1]) << 8) / lz : 0;
  const ty = tz !== 0 ? ((mid[1] - top[1]) << 8) / tz : 0;
  const by = bz !== 0 ? ((bot[1] - mid[1]) << 8) / bz : 0;
  let y1 = ((ly * (z - top[2])) >> 8) + top[1];
  let y2 = z < mid[2] ? ((ty * (z - top[2])) >> 8) + top[1] : ((by * (z - mid[2])) >> 8) + mid[1];

  if (x1 > x2) { const c = x1; x1 = x2; x2 = c; const d = y1; y1 = y2; y2 = d; }
  if (x < x1 || x > x2) return CLIP_OUT;

  const xe = x2 - x1, ye = y2 - y1;
  const yl = xe !== 0 ? (ye << 8) / xe : y1;
  return ((yl * (x - x1)) >> 8) + y1;
}

/** smSTAGE3D::GetTriangleImact（smStage3d.cpp:214）—— 含 c1>0 分支 vy=vz=0 的原版手误
 *  opt.twoWay：额外测反向（ep→sp）。**原版不这么做** —— 我们的 `_wallBlocked` 加了这一条。
 */
function refTriangleImact(t: RTri, sp: P, ep: P, opt?: RefOpt): boolean {
  if (imp(t, sp, ep, opt)) return true;
  if (opt?.twoWay && imp(t, ep, sp, opt)) return true;
  return false;
}

interface RefOpt { twoWay?: boolean; worldXCrossbar?: boolean; flipSign?: boolean }

function imp(t: RTri, sp: P, ep: P, opt?: RefOpt): boolean {
  const pp = (a: P, b: P, c: P, q: P) => { const v = refPlaneProduct(a, b, c, q); return opt?.flipSign ? -v : v; };
  const [p1, p2, p3] = t.p;
  const below = (q: P) => q[1] < p1[1] && q[1] < p2[1] && q[1] < p3[1];
  const above = (q: P) => q[1] > p1[1] && q[1] > p2[1] && q[1] > p3[1];
  if ((below(sp) || above(sp)) && (below(ep) || above(ep))) return false;

  const sgn = opt?.flipSign ? -1 : 1;
  const c1 = sgn * refFaceProduct(t, sp);      // 类方法版（面法线）
  const c2 = sgn * refFaceProduct(t, ep);
  if ((c1 <= 0 && c2 <= 0) || (c1 > 0 && c2 > 0)) return false;

  let vx: number, vy: number, vz: number;
  if (c1 <= 0) {
    vx = (ep[0] - sp[0]) << 8; vy = (ep[1] - sp[1]) << 8; vz = (ep[2] - sp[2]) << 8;
  } else {
    vx = (sp[0] - ep[0]) << 8;
    vy = 0;   // 原版手误：ep->y - ep->y
    vz = 0;   // 原版手误：ep->z - ep->z
  }
  const edge = (a: P, b: P) => pp(a, b, [a[0] + vx, a[1] + vy, a[2] + vz] as P, sp) > 0;
  if (edge(p1, p2)) return false;
  if (edge(p2, p3)) return false;
  if (edge(p3, p1)) return false;
  return true;
}

/**
 * smSTAGE3D::CheckNextMove（smStage3d.cpp:569）。
 * 前进方向 = (sin, cos)，右方 = (cos, -sin)（GetMoveLocation 的 Z/X/Y 旋转，AngX=AngZ=0）。
 */
function refCheckNextMove(
  t: RTri[], near: Provider, x: number, y: number, z: number, heading: number,
  distIn: number, o: { width: number; height: number } & RefOpt,
): { ok: boolean; x: number; y: number; z: number; why: string } {
  const H = o.height;
  const idx = near(x, z);
  if (!idx.length) return { ok: false, x, y, z, why: '无候选面' };

  let dist = distIn;
  for (let ccnt = 0; ccnt < 3; ccnt++) {
    const a = heading + (ccnt === 0 ? 0 : (ccnt === 1 ? -1 : 1) * (768 / 4096) * Math.PI * 2);
    const sx = Math.sin(a), sz = Math.cos(a);
    const rx = Math.cos(a), rz = -Math.sin(a);
    const PosiMinY = fONE * 12;
    const PosiMaxY = H - (H >> 2);
    const width = o.width >> 2;

    const ep: P = [x + sx * dist, y, z + sz * dist];
    const L: [P, P][] = [
      [[x, y + PosiMinY, z], [ep[0] + sx * fONE * 12, y + PosiMinY, ep[2] + sz * fONE * 12]],
      [[x, y + PosiMaxY, z], [ep[0] + sx * fONE * 12, y + PosiMaxY, ep[2] + sz * fONE * 12]],
      [[ep[0] + sx * fONE * 12 - (o.worldXCrossbar ? width : width * rx), y + PosiMinY,
        ep[2] + sz * fONE * 12 - (o.worldXCrossbar ? 0 : width * rz)],
       [ep[0] + sx * fONE * 12 + (o.worldXCrossbar ? width : width * rx), y + PosiMinY,
        ep[2] + sz * fONE * 12 + (o.worldXCrossbar ? 0 : width * rz)]],
      [[ep[0] + sx * fONE * 12 - (o.worldXCrossbar ? width : width * rx), y + PosiMaxY,
        ep[2] + sz * fONE * 12 - (o.worldXCrossbar ? 0 : width * rz)],
       [ep[0] + sx * fONE * 12 + (o.worldXCrossbar ? width : width * rx), y + PosiMaxY,
        ep[2] + sz * fONE * 12 + (o.worldXCrossbar ? 0 : width * rz)]],
    ];

    let height = CLIP_OUT;
    for (const i of idx) {
      const he = refPolyHeight(t[i]!, ep[0], ep[2]);
      if (he !== CLIP_OUT && he - ep[1] < StepHeight && height < he) height = he;
    }

    if (height !== CLIP_OUT) {
      let blocked = false, who = '';
      for (const i of idx) {
        for (let li = 0; li < 4; li++) {
          const [s, e] = L[li]!;
          if (refTriangleImact(t[i]!, s, e, o)) { blocked = true; who = `tri${i} line${li}`; break; }
        }
        if (blocked) break;
      }
      if (!blocked) return { ok: true, x: ep[0], y: height, z: ep[2], why: '' };
      if (DEBUG && dbgLeft-- > 0) {
        console.log(`    [dbg] ref 被挡 ccnt=${ccnt} dist=${dist} pos=(${x | 0},${y | 0},${z | 0}) ${who}`);
      }
    } else if (DEBUG && dbgLeft-- > 0) {
      console.log(`    [dbg] ref 无地面 ccnt=${ccnt} dist=${dist} pos=(${x | 0},${y | 0},${z | 0}) ep=(${ep[0] | 0},${ep[2] | 0})`);
    }
    if (ccnt === 0) dist >>= 1;
  }
  return { ok: false, x, y, z, why: '全方向失败' };
}

// ============================== 几何工具 ==============================

const toRTris = (mesh: CollisionMesh): RTri[] =>
  mesh.triangles.map(t => ({
    p: [[t.x1, t.y1, t.z1], [t.x2, t.y2, t.z2], [t.x3, t.y3, t.z3]] as [P, P, P],
    vn: [t.vnx, t.vny, t.vnz] as [number, number, number],
  }));

// z 取负是镜像：法线是伪矢量 → n' = (-nx, -ny, nz)（与 collision.ts 的取反约定一致）
const mirrorTris = (tris: RTri[]): RTri[] =>
  tris.map(t => ({
    p: t.p.map(p => [p[0], p[1], -p[2]] as P) as [P, P, P],
    vn: t.vn ? ([-t.vn[0], -t.vn[1], t.vn[2]] as [number, number, number]) : undefined,
  }));

/** 用 RTri 造一个 CollisionMesh（buildFromSMD 会把 z 取负，故传入 -z 抵消） */
function meshFromTris(tris: RTri[]): CollisionMesh {
  const verts: number[] = [], triIdx: number[] = [], faceMat: number[] = [];
  for (const t of tris) {
    const base = verts.length / 3;
    for (const p of t.p) verts.push(p[0], p[1], -p[2]);
    triIdx.push(base, base + 1, base + 2);
    faceMat.push(0);
  }
  const mesh = new CollisionMesh();
  mesh.buildFromSMD({
    nVertex: verts.length / 3, nFace: tris.length, nTexLink: 0, nLight: 0,
    verts: new Float32Array(verts), triIdx: new Uint16Array(triIdx),
    faceMat: new Uint16Array(faceMat),
    materials: [{ meshState: 1 } as never],
  } as never);
  return mesh;
}

function loadMapMesh(path: string): CollisionMesh {
  const b = readFileSync(path);
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  const mesh = new CollisionMesh();
  mesh.buildFromSMD(parseSMD(ab));
  return mesh;
}

// ============================== 合成几何 ==============================

/** 平路(z:-40..0) + 斜坡(z:0..60u，角度 deg) + 台地(z:60..140u)，坡向 +z */
function makeRampTris(deg: number): RTri[] {
  const u = fONE;
  const halfW = 40 * u;
  const topY = 60 * u * Math.tan((deg * Math.PI) / 180);
  const tris: RTri[] = [];
  const quad = (z0: number, y0: number, z1: number, y1: number) => {
    const a: P = [-halfW, y0, z0], b: P = [halfW, y0, z0], c: P = [halfW, y1, z1], d: P = [-halfW, y1, z1];
    tris.push({ p: [a, b, c] }, { p: [a, c, d] });
  };
  quad(-40 * u, 0, 0, 0);
  quad(0, 0, 60 * u, topY);
  quad(60 * u, topY, 140 * u, topY);
  return tris;
}

/** 平路 + 高 h 的竖直台阶 + 台面 */
function makeStepTris(h: number): RTri[] {
  const u = fONE;
  const halfW = 40 * u;
  const tris: RTri[] = [];
  const quad = (z0: number, y0: number, z1: number, y1: number) => {
    const a: P = [-halfW, y0, z0], b: P = [halfW, y0, z0], c: P = [halfW, y1, z1], d: P = [-halfW, y1, z1];
    tris.push({ p: [a, b, c] }, { p: [a, c, d] });
  };
  quad(-40 * u, 0, 0, 0);
  quad(0, h, 140 * u, h);
  const a: P = [-halfW, 0, 0], b: P = [halfW, 0, 0], c: P = [halfW, h, 0], d: P = [-halfW, h, 0];
  tris.push({ p: [a, b, c] }, { p: [a, c, d] });
  return tris;
}

interface RunWay { impl: 'ref' | 'ours'; dist: number; width: number; height: number; mirror: boolean }

/** 从 |z|=20u 走到 |z|≥100u（台地）；返回帧数 / 被挡帧数 / 最终高度 */
function climbRun(w: RunWay, geom: RTri[], maxFrames = 400): { frames: number; blocked: number; ok: boolean; y: number } {
  const u = fONE;
  const tris = w.mirror ? mirrorTris(geom) : geom;
  const mesh = meshFromTris(tris);
  const rt = toRTris(mesh);
  const near: Provider = (x, z) => mesh._nearbyTriangleIdx(x, z);
  const heading = w.mirror ? Math.PI : 0;
  let x = 0, y = 0, z = (w.mirror ? 20 : -20) * u;
  let blocked = 0, frames = 0;
  for (; frames < maxFrames; frames++) {
    if (Math.abs(z) >= 100 * u) break;
    if (w.impl === 'ref') {
      const r = refCheckNextMove(rt, near, x, y, z, heading, w.dist, w);
      if (r.ok) { x = r.x; y = r.y; z = r.z; } else blocked++;
    } else {
      const r = mesh.checkNextMove(x, y, z, heading, w.dist, w.width / fONE);
      if (!r.collision) { x = r.x; y = r.y; z = r.z; } else blocked++;
    }
  }
  return { frames, blocked, ok: Math.abs(z) >= 100 * u, y: y / u };
}

// ============================== 主流程 ==============================

const WAYS: { label: string; w: RunWay }[] = [
  { label: '原版 野外走 d=175', w: { impl: 'ref', dist: 175, width: CHAR_SIZE.width, height: CHAR_SIZE.height, mirror: false } },
  { label: '原版 跑     d=449', w: { impl: 'ref', dist: 449, width: CHAR_SIZE.width, height: CHAR_SIZE.height, mirror: false } },
  { label: '原版 跑     d=898', w: { impl: 'ref', dist: 898, width: CHAR_SIZE.width, height: CHAR_SIZE.height, mirror: false } },
  { label: '原版参数+镜像(z 取负) d=449', w: { impl: 'ref', dist: 449, width: CHAR_SIZE.width, height: CHAR_SIZE.height, mirror: true } },
  { label: '原版参数+镜像(z 取负) d=898', w: { impl: 'ref', dist: 898, width: CHAR_SIZE.width, height: CHAR_SIZE.height, mirror: true } },
  { label: '我方 d=175(档位1 野外走≈182)', w: { impl: 'ours', dist: 175, width: OURS_NOW.width, height: OURS_NOW.height, mirror: true } },
  { label: '我方 d=449(档位≈8@60fps)', w: { impl: 'ours', dist: 449, width: OURS_NOW.width, height: OURS_NOW.height, mirror: true } },
  { label: '我方实现 d=898(60fps跑)', w: { impl: 'ours', dist: 898, width: OURS_NOW.width, height: OURS_NOW.height, mirror: true } },
  { label: '我方 H=45.55u(旧尺寸对照) d=898', w: { impl: 'ours', dist: 898, width: CHAR_SIZE.width, height: CHAR_SIZE.height, mirror: true } },
  { label: '我方 H=45.55u(旧尺寸对照) d=175', w: { impl: 'ours', dist: 175, width: CHAR_SIZE.width, height: CHAR_SIZE.height, mirror: true } },
];

console.log('角色碰撞尺寸（原版 Pattern->SizeWidth/SizeHeight ← tmbB01.ASE）：');
console.log(`  ObjWidth =${CHAR_SIZE.width} (${(CHAR_SIZE.width / fONE).toFixed(2)}u)  横杆半宽 = ObjWidth>>2 = ${CHAR_SIZE.width >> 2} raw`);
console.log(`  ObjHeight=${CHAR_SIZE.height} (${(CHAR_SIZE.height / fONE).toFixed(2)}u)  上沿 = H-(H>>2) = ${CHAR_SIZE.height - (CHAR_SIZE.height >> 2)} raw = ${((CHAR_SIZE.height - (CHAR_SIZE.height >> 2)) / fONE).toFixed(2)}u`);
console.log(`我方实现：bodyWidth=10.93u → 半宽 ${(2799 >> 2)} raw   上沿 = ${((11662 - (11662 >> 2)) / fONE).toFixed(2)}u（已与源码对齐）`);
console.log('步高：两者都是 Stage_StepHeight = 10u —— 没变\n');
console.log('每帧步长：原版每 tick 一次 MoveAngle2（70Hz；跑 = (MoveSpeed*460)>>8，MoveSpeed = 250+10*cnt，cnt 夹 0..8 → 449~592 raw）');
console.log('          我方每帧一次：dist = 服务端速度 × dt，而服务端速度 = ((250+10*档位)*460>>8)/256*60（档位 1~51）');
console.log('          → 60fps 时每帧步长 = (250+10*档位)*460>>8：档位1=467  档位9=610  档位25=898  档位51=1365 raw');
console.log('          （客户端 selfRunWps 的初值取档位 25 = EU 最高档，仅用于 S2C_PlayerState 到达前兜底）');
console.log('          同一速度下 70→60 的纯帧率影响 = ×70/60：449 → 524 raw');

const SLOPES = [20, 30, 40, 45, 50, 55, 60];
console.log('=== A. 斜坡：从坡前 20u 走到坡顶台地（|z|≥100u）要几帧 / 其中被挡几帧 ===');
for (const { label, w } of WAYS) {
  const cells = SLOPES.map(deg => {
    const r = climbRun(w, makeRampTris(deg));
    return `${deg}°:${r.ok ? String(r.frames).padStart(3) + '帧/' + String(r.blocked).padStart(3) + '挡' : '  卡@' + r.y.toFixed(0) + 'u'}`;
  });
  console.log(`  ${label.padEnd(26)} ${cells.join(' ')}`);
}

const STEPS = [2, 4, 6, 8, 9, 10, 12, 16];
console.log('\n=== B. 台阶：能否跨过（原版判定 hy < 10*fONE，严格小于 → 10u 应判"卡"）===');
for (const { label, w } of WAYS) {
  const cells = STEPS.map(h => `${h}u:${climbRun(w, makeStepTris(h * fONE)).ok ? '过' : '卡'}`);
  console.log(`  ${label.padEnd(26)} ${cells.join(' ')}`);
}

// ============================== C. 真实地图 ==============================
if (process.argv.includes('--map') && !process.argv.includes('--d-only')) {
  const MAP = 'E:/JPsTale/client/field/ricarten/village-2.smd';
  console.log(`
=== C. 真实地图扫描：${MAP} ===`);
  const mesh = loadMapMesh(MAP);
  const rt = toRTris(mesh);
  const near: Provider = (x, z) => mesh._nearbyTriangleIdx(x, z);

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const t of rt) for (const p of t.p) {
    if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
    if (p[2] < minZ) minZ = p[2]; if (p[2] > maxZ) maxZ = p[2];
  }

  const CLASSES = ['平地 <10°', '缓坡 10-30°', '陡坡 30-50°', '极陡 >50°'];
  const classOf = (deg: number) => (deg < 10 ? 0 : deg < 30 ? 1 : deg < 50 ? 2 : 3);

  /** 地面三角的法线与水平面的夹角 */
  const faceSlope = (i: number): number => {
    const t = rt[i]!;
    const ux = t.p[1][0] - t.p[0][0], uy = t.p[1][1] - t.p[0][1], uz = t.p[1][2] - t.p[0][2];
    const vx = t.p[2][0] - t.p[0][0], vy = t.p[2][1] - t.p[0][1], vz = t.p[2][2] - t.p[0][2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    return (Math.acos(Math.min(1, Math.abs(ny) / len)) * 180) / Math.PI;
  };

  // ── 第一遍：采样 + 按坡度分类（只留陡坡样本，减少第二遍的工作量）
  interface Sample { x: number; z: number; g: number; cls: number; gi: number }
  const byClass: Sample[][] = CLASSES.map(() => []);
  const stride = 96 * fONE;
  const HEADINGS = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
  let samples = 0;
  for (let x = minX; x <= maxX; x += stride) {
    for (let z = minZ; z <= maxZ; z += stride) {
      let g = CLIP_OUT, gi = -1;
      for (const i of near(x, z)) {
        const he = refPolyHeight(rt[i]!, x, z);
        if (he !== CLIP_OUT && he > g) { g = he; gi = i; }
      }
      if (g === CLIP_OUT) continue;
      samples++;
      byClass[classOf(faceSlope(gi))]!.push({ x, z, g, cls: classOf(faceSlope(gi)), gi });
    }
  }

  // ── 第二遍：各变体的被挡率（含「只改一处」的因子隔离）
  interface Var { label: string; opt: RefOpt; h: number }
  const VARIANTS: Var[] = [
    { label: '原版（H=45.55u）', opt: {}, h: CHAR_SIZE.height },
    { label: '原版 + 双向判定', opt: { twoWay: true }, h: CHAR_SIZE.height },
    { label: '原版 + 横杆沿世界X', opt: { worldXCrossbar: true }, h: CHAR_SIZE.height },
    { label: '原版 + 两者都加', opt: { twoWay: true, worldXCrossbar: true }, h: CHAR_SIZE.height },
    { label: '原版 + 两者 + H=21u', opt: { twoWay: true, worldXCrossbar: true }, h: 21 * fONE },
    { label: '原版（H=21u）', opt: {}, h: 21 * fONE },
    { label: '原版 + flip符号(=原版帧)', opt: { flipSign: true }, h: CHAR_SIZE.height },
    { label: '原版 + flip符号 + 双向', opt: { flipSign: true, twoWay: true }, h: CHAR_SIZE.height },
  ];

  const pct = (a: number, b: number) => `${((100 * a) / Math.max(1, b)).toFixed(2)}%`;
  const onlySteep = process.argv.includes('--steep-only');
  const from = onlySteep ? 2 : 0;

  const rates = VARIANTS.map(v => ({ label: v.label, blocked: CLASSES.map(() => 0) }));
  const totals = CLASSES.map(() => 0);
  const oursBlocked = CLASSES.map(() => 0);
  for (let c = from; c < CLASSES.length; c++) {
    for (const smp of byClass[c]!) {
      for (const hd of HEADINGS) {
        totals[c]++;
        for (let vi = 0; vi < VARIANTS.length; vi++) {
          const v = VARIANTS[vi]!;
          const r = refCheckNextMove(rt, near, smp.x, smp.g, smp.z, hd, 898, { width: CHAR_SIZE.width, height: v.h, ...v.opt });
          if (!r.ok) rates[vi]!.blocked[c]++;
        }
        const o = mesh.checkNextMove(smp.x, smp.g, smp.z, hd, 898, OURS_NOW.width / fONE);
        if (o.collision) oursBlocked[c]++;
      }
    }
  }
  console.log('  【因子隔离】dist=898（≈我们 60fps 跑），各变体的被挡率：');
  console.log('  ' + '变体'.padEnd(22) + CLASSES.slice(from).map(c => c.padStart(12)).join('') + '      合计');
  for (let vi = 0; vi < VARIANTS.length; vi++) {
    const b = rates[vi]!.blocked;
    const tot = b.reduce((a, v) => a + v, 0);
    const tsum = totals.reduce((a, v) => a + v, 0);
    console.log('  ' + VARIANTS[vi]!.label.padEnd(20) +
      b.slice(from).map((v, i) => pct(v, totals[i + from]!).padStart(12)).join('') + pct(tot, tsum).padStart(10));
  }
  console.log('  ' + '我方实现（已改）'.padEnd(20) +
    oursBlocked.slice(from).map((v, i) => pct(v, totals[i + from]!).padStart(12)).join('') +
    pct(oursBlocked.reduce((a, v) => a + v, 0), totals.reduce((a, v) => a + v, 0)).padStart(10));

  // ── 步长敏感性：我们的每帧步长 = 速度×dt（随帧率变），原版是固定值。
  //    如果被挡率随 dist 明显变化，那么"同一处坡在掉帧时更难爬"。
  /** 步长敏感性表用的 dist 列表。`--dist=N` 可只测一个（例如按自己角色的档位算出的每帧步长）。 */
  const di = process.argv.indexOf('--dist');
  const DISTS = di >= 0 && Number(process.argv[di + 1]) > 0 ? [Number(process.argv[di + 1])] : [175, 449, 898, 1796, 3584];
  console.log('  【步长敏感性】同一批陡坡样本、同一实现，只改每帧步长 dist：');
  console.log('  ' + 'dist(raw) ≈ 帧率'.padEnd(22) + CLASSES.slice(from).map(c => c.padStart(12)).join(''));
  for (const d of DISTS) {
    const oR = CLASSES.map(() => 0), rR = CLASSES.map(() => 0);
    for (let c = from; c < CLASSES.length; c++) {
      for (const smp of byClass[c]!) {
        for (const hd of HEADINGS) {
          if (mesh.checkNextMove(smp.x, smp.g, smp.z, hd, d, OURS_NOW.width / fONE).collision) oR[c]++;
          if (!refCheckNextMove(rt, near, smp.x, smp.g, smp.z, hd, d, CHAR_SIZE).ok) rR[c]++;
        }
      }
    }
    const note = d === 898 ? '（我们 60fps 跑）' : d === 1796 ? '（我们 30fps 跑）' : d === 3584 ? '（我们 15fps 跑）' : d === 449 ? '（原版跑）' : '（原版野外走）';
    console.log('  ' + `${d} ${note}`.padEnd(20) +
      CLASSES.slice(from).map((c, i) => `我方 ${pct(oR[i + from]!, totals[i + from])}/原版 ${pct(rR[i + from]!, totals[i + from])}`.padStart(0).padEnd(12)).join(''));
  }
  console.log('  样本数（每类 × 4 朝向）：' + CLASSES.slice(from).map((c, i) => `${c}=${totals[i + from]}`).join('  '));

}

// ============================== D. 真实地图：真·上坡跑 ==============================
if (process.argv.includes('--map')) {
  const MAP = 'E:/JPsTale/client/field/ricarten/village-2.smd';
  console.log(`
=== D. 真·上坡跑（真实地图上坡面 20°~55°，沿坡度方向直走 20 帧）===`);
  const mesh = loadMapMesh(MAP);
  const rt = toRTris(mesh);
  const near: Provider = (x, z) => mesh._nearbyTriangleIdx(x, z);

  const u = fONE;
  const norm = (i: number) => {
    const t = rt[i]!;
    const ux = t.p[1][0] - t.p[0][0], uy = t.p[1][1] - t.p[0][1], uz = t.p[1][2] - t.p[0][2];
    const vx = t.p[2][0] - t.p[0][0], vy = t.p[2][1] - t.p[0][1], vz = t.p[2][2] - t.p[0][2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    return { nx, ny, nz, len: Math.hypot(nx, ny, nz) || 1 };
  };

  // 采样（步长 64u，比 C 更密，因为只挑选坡面样本）
  const stride = 64 * u;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const t of rt) for (const p of t.p) {
    if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
    if (p[2] < minZ) minZ = p[2]; if (p[2] > maxZ) maxZ = p[2];
  }
  interface Case { x: number; z: number; y: number; heading: number; deg: number }
  const cases: Case[] = [];
  for (let x = minX; x <= maxX; x += stride) {
    for (let z = minZ; z <= maxZ; z += stride) {
      let g = CLIP_OUT, gi = -1;
      for (const i of near(x, z)) {
        const he = refPolyHeight(rt[i]!, x, z);
        if (he !== CLIP_OUT && he > g) { g = he; gi = i; }
      }
      if (g === CLIP_OUT) continue;
      const n = norm(gi);
      const deg = (Math.acos(Math.min(1, Math.abs(n.ny) / n.len)) * 180) / Math.PI;
      if (deg < 20 || deg > 55) continue;
      // 上坡方向 = 高度场梯度方向 = -(nx,nz)（法线水平分量取反）
      const hx = -n.nx, hz = -n.nz;
      const hl = Math.hypot(hx, hz) || 1;
      // 朝向：yaw 使 (sin,cos) ∝ (hx,hz) → a = atan2(hx, hz)
      cases.push({ x, z, y: g, heading: Math.atan2(hx / hl, hz / hl), deg });
    }
  }

  interface Runner { label: string; impl: 'ref' | 'ours'; dist: number; w: number; h: number; opt?: RefOpt; sub?: number }
  const RUNNERS: Runner[] = [
    { label: '原版 野外走 d=175', impl: 'ref', dist: 175, w: CHAR_SIZE.width, h: CHAR_SIZE.height },
    { label: '原版 跑     d=449', impl: 'ref', dist: 449, w: CHAR_SIZE.width, h: CHAR_SIZE.height },
    { label: '原版 跑     d=898', impl: 'ref', dist: 898, w: CHAR_SIZE.width, h: CHAR_SIZE.height },
    { label: '我方 d=175(档位1 野外走≈182)', impl: 'ours', dist: 175, w: OURS_NOW.width, h: OURS_NOW.height },
    { label: '我方 d=449(档位≈8@60fps)', impl: 'ours', dist: 449, w: OURS_NOW.width, h: OURS_NOW.height },
    { label: '我方 d=898(档位25@60fps)', impl: 'ours', dist: 898, w: OURS_NOW.width, h: OURS_NOW.height },
    { label: '我方 d=1796(档位25@30fps)', impl: 'ours', dist: 1796, w: OURS_NOW.width, h: OURS_NOW.height },
    { label: '我方 H=45.55u(旧尺寸对照) d=898', impl: 'ours', dist: 898, w: CHAR_SIZE.width, h: CHAR_SIZE.height },
    { label: '原版+flip符号 d=449(原版帧)', impl: 'ref', dist: 449, w: CHAR_SIZE.width, h: CHAR_SIZE.height, opt: { flipSign: true } },
    { label: '我方 档位25@60fps 分子步(≤449)', impl: 'ours', dist: 898, w: OURS_NOW.width, h: OURS_NOW.height, sub: 449 },
    { label: '我方 档位51@60fps 分子步(≤449)', impl: 'ours', dist: 1365, w: OURS_NOW.width, h: OURS_NOW.height, sub: 449 },
    { label: '我方 档位51@60fps 单次(对照)', impl: 'ours', dist: 1365, w: OURS_NOW.width, h: OURS_NOW.height },
    { label: '我方 档位25 子步≤224', impl: 'ours', dist: 898, w: OURS_NOW.width, h: OURS_NOW.height, sub: 224 },
    { label: '我方 档位25 子步≤112', impl: 'ours', dist: 898, w: OURS_NOW.width, h: OURS_NOW.height, sub: 112 },
    { label: '我方 档位25 子步≤175(原版走)', impl: 'ours', dist: 898, w: OURS_NOW.width, h: OURS_NOW.height, sub: 175 },
    { label: '原版+flip符号 d=898', impl: 'ref', dist: 898, w: CHAR_SIZE.width, h: CHAR_SIZE.height, opt: { flipSign: true } },
  ];
  const FRAMES = 20;
  console.log(`  坡面样本 ${cases.length} 个（20°~55°）× 每样本沿坡度方向直走 ${FRAMES} 帧`);
  console.log('  实现                          被挡帧率    完全卡死(20 帧全挡)的样本   平均前进(沿坡面)');
  for (const r of RUNNERS) {
    let blocks = 0, stuck = 0, advance = 0;
    for (const c of cases) {
      let x = c.x, y = c.y, z = c.z, b = 0;
      const sx = x, sz = z;
      for (let f = 0; f < FRAMES; f++) {
        if (r.impl === 'ref') {
          const res = refCheckNextMove(rt, near, x, y, z, c.heading, r.dist, { width: r.w, height: r.h, ...r.opt });
          if (res.ok) { x = res.x; y = res.y; z = res.z; } else b++;
        } else {
          // 与 WorldView.updateMovement 一致：一帧位移按 r.sub 切成几次调用（r.sub 未给则一次走完）
          let remaining = r.dist, adv = false;
          while (remaining > 0) {
            const sr = Math.min(remaining, r.sub ?? r.dist);
            const res = mesh.checkNextMove(x, y, z, c.heading, sr, r.w / fONE);
            if (res.collision) break;
            // 与 WorldView 一致：单步下沉 > 8u 时不采纳 y
            if (res.y >= y - 8 * fONE) { x = res.x; y = res.y; z = res.z; }
            else { x = res.x; z = res.z; }
            adv = true; remaining -= sr;
          }
          if (!adv) b++;
        }
      }
      blocks += b;
      if (b === FRAMES) stuck++;
      advance += Math.hypot(x - sx, z - sz);
    }
    console.log('  ' + r.label.padEnd(28) +
      `${((100 * blocks) / (cases.length * FRAMES)).toFixed(1)}%`.padStart(9) +
      `${`${stuck} / ${cases.length} (${((100 * stuck) / cases.length).toFixed(1)}%)`}`.padStart(24) +
      `${(advance / cases.length / fONE).toFixed(2)}u`.padStart(16));
  }
}

// ============================== E. 单面栏杆：单向判定到底挡不挡 ==============================
if (process.argv.includes('--rail')) {
  const MAP = 'E:/JPsTale/client/field/ricarten/village-2.smd';
  console.log(`
=== E. 单面栏杆 / 竖直面：从两侧靠近，看判定挡哪一侧 ===`);
  const mesh = loadMapMesh(MAP);
  const rt = toRTris(mesh);
  const near: Provider = (x, z) => mesh._nearbyTriangleIdx(x, z);
  const u = fONE;

  const faceN = (i: number) => {
    const t = rt[i]!;
    const ux = t.p[1][0] - t.p[0][0], uy = t.p[1][1] - t.p[0][1], uz = t.p[1][2] - t.p[0][2];
    const vx = t.p[2][0] - t.p[0][0], vy = t.p[2][1] - t.p[0][1], vz = t.p[2][2] - t.p[0][2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    return { nx: nx / len, ny: ny / len, nz: nz / len, len };
  };
  /** 该点附近"可站立"面的高度（取不超过 ceilY 的最高面） */
  const groundAt = (x: number, z: number, ceilY: number) => {
    let best = CLIP_OUT;
    for (const i of near(x, z)) {
      const he = refPolyHeight(rt[i]!, x, z);
      if (he !== CLIP_OUT && he <= ceilY && he > best) best = he;
    }
    return best;
  };

  // 挑「竖直 + 像栏杆」的面：|ny| 小、高度 12u~48u、水平方向够长（按 xz 投影边长）
  interface Rail { i: number; x: number; z: number; y: number; hx: number; hz: number; top: number; hgt: number; side: 2 }
  const rails: Rail[] = [];
  for (let i = 0; i < rt.length; i++) {
    const n = faceN(i);
    if (Math.abs(n.ny) > 0.35) continue;                      // 近竖直
    const ys = rt[i]!.p.map(p => p[1]);
    const top = Math.max(...ys), bot = Math.min(...ys);
    const hgt = top - bot;
    if (hgt < 8 * u || hgt > 48 * u) continue;                // 像栏杆的高度带
    // xz 投影长度（栏杆需要有一定长度，排除小柱脚）
    const p = rt[i]!.p;
    const e1 = Math.hypot(p[1][0] - p[0][0], p[1][2] - p[0][2]);
    const e2 = Math.hypot(p[2][0] - p[0][0], p[2][2] - p[0][2]);
    const e3 = Math.hypot(p[2][0] - p[1][0], p[2][2] - p[1][2]);
    if (Math.max(e1, e2, e3) < 8 * u) continue;
    const cx = (p[0][0] + p[1][0] + p[2][0]) / 3, cz = (p[0][2] + p[1][2] + p[2][2]) / 3;
    // 水平法线方向（只取 xz 分量）
    const hl = Math.hypot(n.nx, n.nz) || 1;
    const hx = n.nx / hl, hz = n.nz / hl;
    const d = 2.5 * u;                                        // 站到面外 2.5u
    const gA = groundAt(cx + hx * d, cz + hz * d, top - 2 * u);
    const gB = groundAt(cx - hx * d, cz - hz * d, top - 2 * u);
    // 两侧都要有地面，且该面确实高出站立面（否则不是"栏杆挡路"）
    if (gA === CLIP_OUT || gB === CLIP_OUT) continue;
    if (top - gA < 8 * u || top - gB < 8 * u) continue;
    rails.push({
      i, x: cx + hx * d, z: cz + hz * d, y: gA, hx, hz, top, hgt, side: 2,
      // 记 A/B 两侧
      ...( { } as object),
    } as Rail);
    rails.push({ i, x: cx - hx * d, z: cz - hz * d, y: gB, hx, hz, top, hgt, side: 2 } as Rail);
  }
  console.log(`  候选"栏杆面"样本 ${rails.length} 个（近竖直、高度 8~48u、两侧 2.5u 内都有地面）`);

  interface Cfg { label: string; use: 'ours' | 'ref'; opt?: RefOpt; h?: number }
  const CFGS: Cfg[] = [
    { label: '① 我方实现（已改：单向+原版符号）', use: 'ours' },
    { label: '② 原版算法(单向, 我方旧符号)', use: 'ref', opt: {} },
    { label: '③ 原版算法(单向, 原版符号=flip)', use: 'ref', opt: { flipSign: true } },
    { label: '④ 原版算法(双向, 原版符号)', use: 'ref', opt: { flipSign: true, twoWay: true } },
    { label: '⑤ ③+横杆沿世界X', use: 'ref', opt: { flipSign: true, worldXCrossbar: true } },
    { label: '⑥ ③+H=21u', use: 'ref', opt: { flipSign: true }, h: 21 * fONE },
    { label: '⑦ ③+横杆世界X+H=21u', use: 'ref', opt: { flipSign: true, worldXCrossbar: true }, h: 21 * fONE },
  ];
  console.log('  配置                              挡(迎面)   不挡(可穿过)   其中非竖直面遮挡的占比');
  for (const c of CFGS) {
    let block = 0, pass = 0;
    for (const r of rails) {
      // 迎面方向 = 指向该面（站点的外法线取反）
      const sgn = (r.x > 0) ? 1 : 1;
      void sgn;
      // 站点在面外，面的水平法线方向 (hx,hz) 指向站点；朝向该面 = -(hx,hz)
      const heading = Math.atan2(-r.hx, -r.hz);
      let blocked: boolean;
      if (c.use === 'ours') {
        blocked = mesh.checkNextMove(r.x, r.y, r.z, heading, 898, OURS_NOW.width / fONE).collision;
      } else {
        blocked = !refCheckNextMove(rt, near, r.x, r.y, r.z, heading, 898, { width: CHAR_SIZE.width, height: c.h ?? CHAR_SIZE.height, ...c.opt }).ok;
      }
      if (blocked) block++; else pass++;
    }
    console.log('  ' + c.label.padEnd(32) + `${((100 * block) / rails.length).toFixed(1)}%`.padStart(9) +
      `${((100 * pass) / rails.length).toFixed(1)}%`.padStart(13));
  }
}

// ============================== F. 单面栏杆（合成）：单向判定挡哪一侧 ==============================
if (process.argv.includes('--rail2')) {
  console.log('=== F. 合成单面栏杆：一块"只有单面纹理"的竖直四边形（两侧都是地面）===');
  const u = fONE;

  /** 栏杆在 z=0，x∈[-40u,40u]，y∈[0,h]；两侧 z<0 / z>0 都是 y=0 的地面 */
  function makeRail(h: number, flipWinding: boolean): RTri[] {
    const halfW = 40 * u, far = 60 * u;
    const tris: RTri[] = [];
    const quad = (z0: number, y0: number, z1: number, y1: number) => {
      const a: P = [-halfW, y0, z0], b: P = [halfW, y0, z0], c: P = [halfW, y1, z1], d: P = [-halfW, y1, z1];
      tris.push({ p: [a, b, c] }, { p: [a, c, d] });
    };
    quad(-far, 0, 0, 0);          // 地面（-z 侧）
    quad(0, 0, far, 0);           // 地面（+z 侧）
    const a: P = [-halfW, 0, 0], b: P = [halfW, 0, 0], c: P = [halfW, h, 0], d: P = [-halfW, h, 0];
    if (flipWinding) tris.push({ p: [a, c, b] }, { p: [a, d, c] });   // 反向绕序
    else tris.push({ p: [a, b, c] }, { p: [a, c, d] });
    return tris;
  }

  const faceNy = (t: RTri) => {
    const [p1, p2, p3] = t.p;
    const ux = p2[0] - p1[0], uy = p2[1] - p1[1], uz = p2[2] - p1[2];
    const vx = p3[0] - p1[0], vy = p3[1] - p1[1], vz = p3[2] - p1[2];
    return { nz: ux * vy - uy * vx, ny: uz * vx - ux * vz };
  };

  const RAIL_H = [20 * u, 30 * u, 40 * u];
  const DIST = 898;
  for (const flipWinding of [false, true]) {
    for (const h of RAIL_H) {
      const geom = makeRail(h, flipWinding);
      const mesh = meshFromTris(geom);
      const rt = toRTris(mesh);
      const near: Provider = (x, z) => mesh._nearbyTriangleIdx(x, z);
      const railFace = rt[4]!;                        // 第 5 个面 = 栏杆
      const n = faceNy(railFace);
      const sign = Math.sign(n.nz) >= 0 ? '+z' : '-z';
      const out: string[] = [];
      for (const [sideLabel, z, heading] of [['-z 侧走过来', -2.5 * u, 0], ['+z 侧走过来', 2.5 * u, Math.PI]] as [string, number, number][]) {
        for (const cfg of [
          { l: '原版(单向,原版符号)  ', opt: { flipSign: true } as RefOpt, ours: false },
          { l: '单向(旧符号)          ', opt: {} as RefOpt, ours: false },
          { l: '双向(旧实现)          ', opt: { twoWay: true, flipSign: true } as RefOpt, ours: false },
          { l: '★我方实现(改后)       ', opt: {} as RefOpt, ours: true },
        ]) {
          const blocked = cfg.ours
            ? mesh.checkNextMove(0, 0, z, heading, DIST, OURS_NOW.width / fONE).collision
            : !refCheckNextMove(rt, near, 0, 0, z, heading, DIST, { width: CHAR_SIZE.width, height: CHAR_SIZE.height, ...cfg.opt }).ok;
          out.push(`${sideLabel} ${cfg.l}: ${blocked ? '挡住' : '穿过'}`);
        }
      }
      console.log(`  栏杆高 ${(h / u).toFixed(0)}u, 绕序${flipWinding ? '反向' : '正向'}(法线朝 ${sign})`);
      for (const o of out) console.log('    ' + o);
    }
  }
  console.log('  注：H 用真实值 45.55u（上沿 T 线 34.17u）、dist=898。');
}
