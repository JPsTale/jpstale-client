/**
 * 地图两级剔除的一致性校验（`npm run verify-map-culling`）。
 *
 * 为什么要有它：`MapRenderer.render()` 的剔除从"**逐细格**判视锥"改成"**先判大格子**（每图一次、
 * 所有材质共用），压边界的才逐细格判、完全在视锥内的大格子直接收下"。这次改动**唯一的风险**是：
 * 万一"完全在内 ⇒ 细格必然也在内"这一步不成立，就会**少画几何**（画面上是地图缺一块）。
 * 所以本脚本不做结构检查了事，而是拿**真实地图数据**跑真算法，跟"逐细格判"的参考实现做
 * **逐字节对照**：
 *
 *   ① 参考实现（冻结在此）= 旧算法：每个细格都判一次视锥（`testFrustums` 的 AND 语义）。
 *   ② 被测 = 真 `MapRenderer.render()`。
 *   ③ 断言：同一相机位姿下，两者为每个材质打包出的**面集合完全相同**（无多画、无漏画、无重复）
 *      且 `drawRange.count` 相同、`mesh.visible` 相同。
 *
 * ⚠ **不断言"索引缓冲逐字节相同"**，因为两者**顺序不同且有理由**：细格为了跳表连续，改按
 * **大格子主序**排（见 `map-renderer.ts` 的 `KEY_SHIFT`），而旧算法是 (cx,cz) 字典序。顺序对渲染
 * 没有意义（`setDrawRange` 覆盖整个前缀，画的是同一批三角形），所以这里比的是**集合**而不是字节。
 * 之所以不干脆改成"逐字节"，是因为**只有按 cx 分带（band）才能同时满足"同大格子连续"与"键序不变"**，
 * 而带宽一整张图 Z 幅（实测 8900 单位）的剔除粒度远差于方格子 —— 为了一条更好测的断言去换更差的
 * 剔除粒度不划算。集合相同 + 数量相同已经足够钉住"不多画/不漏画"。
 *
 * 参考实现能成立的前提：细格的 key 序与面区间取自 `fineKeys/fineStarts/fineCounts` —— 那是旧
 * `cellLookup` 的等价内容（同一份 `pairs` 的去重结果，顺序与区间逐项相同）。
 *
 * 另外钉住四件容易退化的事（每件都有过静默失败的前科）：
 *   - 几何在调 `render()` **之前**就能画（索引 = 恒等置换、drawRange = 全量）。旧版是"全 0 索引、
 *     必须等 `render()` 打包"，那是条**静默**契约：漏调 = 几十万个退化三角形、一个像素都没有。
 *   - 跳表自洽：逐大格子区间求和 == 该材质细格总数；每个细格落在**它自己的**大格子区间里；key 严格升序。
 *   - 俯视正交（整图都在视锥内）时**每个面都该被画**（`visibleFaceCount == totalTriangleCount`）——
 *     这条同时兜住"非空大格子清单漏了一个"（漏了就会有细格收不到，面数对不上）。
 *   - 同一位姿第二次调用**不重打包**（相机未变 ⇒ 整图跳过，也不再置 `needsUpdate`）。
 *   - 共享 uniform 的写入者唯一：`updateDayNight` 不再逐材质写光照（逐材质写会退回 4.5 万次 copy/帧）。
 *
 * 用法：`npm run verify-map-culling`（资产目录取 `.env` 的 `VITE_ASSET_ROOT`）
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnv } from 'vite';
import * as THREE from 'three';
import type { MatConfig } from '../src/render/map-renderer.js';
import { installDomStub } from './dom-stub.js';

installDomStub();

// 真模块必须在 DOM stub 之后加载（`map-renderer` → `dyn-light` → `fallback-log` 会碰 document）
const { parseSMD } = await import('../src/core/smd-parser.js');
const { MapRenderer } = await import('../src/render/map-renderer.js');

type Smd = ReturnType<typeof parseSMD>;
type Renderer = InstanceType<typeof MapRenderer>;
/** `MapRenderer.materials` 的元素类型（该接口未导出，按结构推断即可） */
type Mrd = Renderer['materials'][number];

let fails = 0;
const ok = (name: string, pass: boolean, detail = ''): void => {
  if (!pass) fails++;
  console.log(`${pass ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

// ─────────────────────────── 资产定位 ───────────────────────────
const env = loadEnv('development', process.cwd(), '');
const assetRoot = resolve(env.VITE_ASSET_ROOT || '');
if (!assetRoot || !existsSync(assetRoot)) {
  console.error('VITE_ASSET_ROOT 不存在: ' + assetRoot);
  process.exit(2);
}
const fields = JSON.parse(readFileSync(resolve(process.cwd(), 'src/maps/fields.json'), 'utf8')) as Array<{
  id: number; shortname: string; model: string;
}>;
/** 地图 2 的 1 跳邻域 = 运行时同时加载的那 4 张（邻接双向：1 号图经 `to:2` 也被拉进来） */
const MAP_IDS = [2, 1, 4, 3];

function loadSmd(mapId: number): Smd | null {
  const f = fields.find((x) => x.id === mapId);
  if (!f) return null;
  const abs = resolve(assetRoot, 'field', f.model);
  if (!existsSync(abs)) return null;
  const buf = readFileSync(abs);
  return parseSMD(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
}

/** 与游戏 `fore1.ts:getMatConfig` 等价的最小配置：本脚本只关心几何与剔除，不加载纹理 */
const STUB_CONFIG: MatConfig = {
  hasTex: false, hasLM: false, diffuseTex: null, lightmapTex: null,
  hasSecondTex: false, secondTex: null, isTransparent: false, isRendLatter: false,
  blendType: 0, hasAnimation: false,
};

// ─────────────────────────── 参考实现（旧算法，冻结） ───────────────────────────
interface RefResult {
  /** 每个材质打包后的索引（长度同 outIndices，只有前 packed 项有效） */
  buf: Uint32Array[];
  packed: number[];
  visible: boolean[];
  /** 旧算法会检查的细格数（材质 AABB 过了一级筛的，其全部细格） */
  testedCells: number;
}

function referenceRender(mr: Renderer, camera: THREE.Camera): RefResult {
  const projScreenMatrix = new THREE.Matrix4();
  projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const frustum = new THREE.Frustum();
  frustum.setFromProjectionMatrix(projScreenMatrix);
  const testFrustums = (box: THREE.Box3): boolean => {
    if (frustum.planes && !frustum.intersectsBox(box)) return false;
    return true;
  };

  const mrds = mr.materials;
  const buf: Uint32Array[] = [];
  const packedArr: number[] = [];
  const visible: boolean[] = [];
  let testedCells = 0;

  for (const mrd of mrds) {
    const out = new Uint32Array(mrd.outIndices.length);
    let packed = 0;
    if (testFrustums(mrd.aabb)) {
      const seen = new Uint32Array(mrd.seenFaces.length);
      for (let k = 0, kn = mrd.fineKeys.length; k < kn; k++) {
        testedCells++;
        const key = mrd.fineKeys[k]!;
        const cx = Math.floor(key / 4096);
        const cz = key % 4096;
        const minX = mr.worldMin[0]! + cx * mr.cellWorldSize;
        const minZ = mr.worldMin[2]! + cz * mr.cellWorldSize;
        const cellAABB = new THREE.Box3(
          new THREE.Vector3(minX, mrd.aabb.min.y, minZ),
          new THREE.Vector3(minX + mr.cellWorldSize, mrd.aabb.max.y, minZ + mr.cellWorldSize),
        );
        if (!testFrustums(cellAABB)) continue;
        const st = mrd.fineStarts[k]!;
        const en = st + mrd.fineCounts[k]!;
        for (let j = st; j < en; j++) {
          const fi = mrd.sortedFaces[j]!;
          if (seen[fi] === 1) continue;
          seen[fi] = 1;
          const off = fi * 3;
          out[packed] = mrd.fullIndices[off]!;
          out[packed + 1] = mrd.fullIndices[off + 1]!;
          out[packed + 2] = mrd.fullIndices[off + 2]!;
          packed += 3;
        }
      }
    }
    buf.push(out);
    packedArr.push(packed);
    visible.push(packed > 0);
  }
  return { buf, packed: packedArr, visible, testedCells };
}

// ─────────────────────────── 相机取样 ───────────────────────────
function gameCamera(mr: Renderer, fx: number, fz: number, yaw: number): THREE.PerspectiveCamera {
  const w = mr.worldMax[0] - mr.worldMin[0];
  const d = mr.worldMax[2] - mr.worldMin[2];
  const x = mr.worldMin[0] + w * fx;
  const z = mr.worldMin[2] + d * fz;
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 20, 4000);
  cam.position.set(x, mr.worldMin[1] + 120, z);
  cam.lookAt(x + Math.cos(yaw) * 400, mr.worldMin[1] + 60, z + Math.sin(yaw) * 400);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
  return cam;
}

/** 离线烘图用的俯视正交相机（同 `src/tools/bake-map.ts` 的取景：整张图都在视锥内） */
function bakeCamera(mr: Renderer): THREE.OrthographicCamera {
  const minX = Math.min(mr.worldMin[0], mr.worldMax[0]);
  const maxX = Math.max(mr.worldMin[0], mr.worldMax[0]);
  const minZ = Math.min(mr.worldMin[2], mr.worldMax[2]);
  const maxZ = Math.max(mr.worldMin[2], mr.worldMax[2]);
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const margin = 200000;
  const cam = new THREE.OrthographicCamera(-(maxX - minX) / 2, (maxX - minX) / 2, (maxZ - minZ) / 2, -(maxZ - minZ) / 2, 1, 1);
  cam.position.set(cx, mr.worldMax[1] + margin, cz);
  cam.up.set(0, 0, -1);
  cam.lookAt(cx, 0, cz);
  cam.near = 1;
  cam.far = margin + (mr.worldMax[1] - mr.worldMin[1]) + 4000;
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
  return cam;
}

// ─────────────────────────── 逐图校验 ───────────────────────────
const FRAC: Array<[number, number]> = [
  [0.5, 0.5], [0.15, 0.2], [0.85, 0.8], [0.2, 0.85], [0.8, 0.15], [0.35, 0.65], [0.65, 0.35], [0.05, 0.5],
];
const YAW = [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.7, -2.1, 2.4, -0.4];

for (const mapId of MAP_IDS) {
  const name = fields.find((x) => x.id === mapId)?.shortname ?? '?';
  const smd = loadSmd(mapId);
  console.log(`\n=== 地图 ${mapId} (${name}) ===`);
  if (!smd) { ok(`地图 ${mapId} 资产存在`, false, '找不到 smd，跳过'); continue; }

  const mr = new MapRenderer(new THREE.Scene());
  mr.build(smd, new Map<string, THREE.Texture>(), () => STUB_CONFIG);
  const mrds = mr.materials;
  ok(`构建出材质（实际 ${mrds.length} 个）`, mrds.length > 0);
  if (mrds.length === 0) continue;

  // ── A. 几何"天生可画" ──
  {
    let notIdentity = 0, notFull = 0;
    for (const mrd of mrds) {
      const idx = mrd.geometry.index!.array as Uint32Array;
      const n = mrd.fullIndices.length;
      for (let i = 0; i < n; i++) if (idx[i] !== i) { notIdentity++; break; }
      if (mrd.geometry.drawRange.count !== n) notFull++;
    }
    ok('render() 之前索引 = 恒等置换（几何天生可画）', notIdentity === 0,
      notIdentity ? `${notIdentity} 个材质不是` : `${mrds.length} 个材质`);
    ok('render() 之前 drawRange = 全量', notFull === 0, notFull ? `${notFull} 个材质不是` : '');
  }

  // ── B. 跳表自洽 ──
  {
    let sumBad = 0, bucketBad = 0, orderBad = 0, rangeBad = 0, totalCells = 0;
    for (const mrd of mrds) {
      const ss = mrd.superStart;
      let sum = 0;
      for (let s = 0; s + 1 < ss.length; s++) sum += ss[s + 1]! - ss[s]!;
      if (sum !== mrd.fineKeys.length) sumBad++;
      totalCells += mrd.fineKeys.length;
      let prevBlock = 0;          // 排序键 = 大格子主序 ⇒ blockOfKey 必须非递减
      let prevKey = -1;           // 同一大格子内 key 必须递增（面区间按 key 聚簇）
      for (let k = 0; k < mrd.fineKeys.length; k++) {
        const key = mrd.fineKeys[k]!;
        // 大格子索引由渲染器**自己的实现**给出（不许脚本再推一遍公式）
        const blk = mr.blockOfKey(key);
        if (blk >= mr.superCount) rangeBad++;
        if (blk < prevBlock) orderBad++;
        if (blk === prevBlock && key <= prevKey) orderBad++;
        prevBlock = blk;
        prevKey = key;
        if (!(k >= ss[blk]! && k < ss[blk + 1]!)) bucketBad++;
      }
    }
    ok('跳表逐大格子区间求和 == 细格总数', sumBad === 0,
      sumBad ? `${sumBad} 个材质不符` : `${totalCells.toLocaleString()} 个细格条目`);
    ok('每个细格落在自己的大格子区间内', bucketBad === 0, bucketBad ? `${bucketBad} 处不符` : '');
    ok('细格按"大格子主序、格子内 key 升序"排列', orderBad === 0, orderBad ? `${orderBad} 处逆序` : '');
    ok('大格子索引全在 [0, superCount) 内（无越界格）', rangeBad === 0,
      rangeBad ? `${rangeBad} 处越界` : `superCount=${mr.superCount}`);
  }

  // ── C. 面集合对照（多相机位姿，含俯视正交） ──
  const poses: Array<[string, THREE.Camera]> = [['俯视正交（整图可见）', bakeCamera(mr)]];
  FRAC.forEach(([fx, fz], i) => poses.push([`野外 #${i} (${fx},${fz})`, gameCamera(mr, fx, fz, YAW[i % YAW.length]!) ]));

  // 面集合比对用的暂存：stamp 法，避免每个材质都分配一张表
  let maxFaces = 1;
  for (const mrd of mrds) maxFaces = Math.max(maxFaces, mrd.seenFaces.length);
  const mark = new Int32Array(maxFaces);
  let epoch = 0;

  let badTotal = 0, badVisibleCount = 0, checkedFaces = 0;
  let refCells = 0, newCells = 0, packedTotal = 0;
  for (const [label, cam] of poses) {
    const ref = referenceRender(mr, cam);
    mr.render(cam);
    let extra = 0, missing = 0, badVisible = 0, refPacked = 0, newPacked = 0;
    for (let i = 0; i < mrds.length; i++) {
      const mrd = mrds[i]!;
      const rp = ref.packed[i]!;
      // ⚠ 真值来源是 `mesh.visible`，不是 `drawRange`：被剔除的材质 `render()` 会 `continue`，
      //   不上报任何"我画了多少"。这里读 `visible` 并把不可见的记为 0 —— 早期版本直接读
      //   `drawRange.count`，于是把"被剔除的材质"当成"画了全量"，误报成几百处"多画"。
      const np = mrd.mesh.visible ? mrd.geometry.drawRange.count : 0;
      refPacked += rp;
      newPacked += np;
      if (rp !== np) { extra++; continue; }
      if (mrd.mesh.visible !== ref.visible[i]) badVisible++;
      if (rp === 0) continue;
      // 索引缓冲里存的是 `fullIndices[off]`，而 fullIndices 是恒等置换 ⇒ `idx/3` 就是面号
      epoch++;
      const buf = ref.buf[i]!;
      for (let k = 0; k < rp; k += 3) mark[buf[k]! / 3] = epoch;
      const got = mrd.outIndices;
      for (let k = 0; k < np; k += 3) {
        const fi = got[k]! / 3;
        if (mark[fi] === epoch) mark[fi] = -epoch;
        else extra++;                       // 多画的面（或同一个面被提交两次）
      }
      const nF = mrd.seenFaces.length;
      for (let fi = 0; fi < nF; fi++) if (mark[fi] === epoch) { missing++; mark[fi] = -epoch; }
      checkedFaces += np / 3;
    }
    badTotal += extra + missing;
    badVisibleCount += badVisible;
    refCells += ref.testedCells;
    newCells += mr.scannedCellCount;
    packedTotal += newPacked;
    console.log(`  ${extra === 0 && missing === 0 && badVisible === 0 ? '✓' : '✗'} ${label}`
      + `  面数 ${newPacked / 3} / 参考 ${refPacked / 3}`
      + `  逐细格检查 ${ref.testedCells.toLocaleString()} → 实际 ${mr.scannedCellCount.toLocaleString()}`
      + `  drawCall ${mr.drawCallCount}`
      + (extra || missing || badVisible ? `  ⚠ 多画 ${extra} / 漏画 ${missing} / visible ${badVisible}` : ''));
  }
  ok(`面集合与参考实现相同（${poses.length} 位姿 / 比对 ${checkedFaces.toLocaleString()} 个面）`,
    badTotal === 0, badTotal ? `${badTotal} 处不符` : '');
  ok('mesh.visible 与参考实现一致', badVisibleCount === 0, badVisibleCount ? `${badVisibleCount} 处不符` : '');
  ok('打包总长度 > 0（对照不是空跑）', packedTotal > 0, packedTotal.toLocaleString());

  // ── D. 俯视正交下"每个面都该被画"（兜住"非空大格子清单漏一个"） ──
  {
    const cam = poses[0]![1];
    mr.render(cam);
    ok('整图可见时 visibleFaceCount == totalTriangleCount（无细格被漏）',
      mr.visibleFaceCount === mr.totalTriangleCount,
      `${mr.visibleFaceCount.toLocaleString()} / ${mr.totalTriangleCount.toLocaleString()}`);
    ok('整图可见时每个材质都提交（drawCallCount == 材质数）',
      mr.drawCallCount === mrds.length, `${mr.drawCallCount} / ${mrds.length}`);
  }

  // ── E. 同一位姿第二次：不重打包 ──
  {
    const cam = poses[1]![1];
    mr.render(cam);
    const probe = mrds[0]!.outIndices;
    // 打包写进去的恒为 `fi*3`（≡0 mod 3），故取一个 ≡1 mod 3 的值当探针 ⇒ 一旦重打包必被覆盖，不会碰巧相等
    const probeVal = ((probe[0]! | 0) + 1) >>> 0;
    probe[0] = probeVal;
    mr.render(cam);                                  // 同一位姿 → 应走"相机未变"快路径
    ok('同一位姿第二次调用不重打包（索引缓冲未被改写）', probe[0] === probeVal);
    mr.render(poses[2]![1]);                         // 换位姿 → 必须重新打包
    ok('换位姿后确实重新打包（上一条不是假象）', probe[0] !== probeVal);
  }

  console.log(`  · 细格检查总量：逐细格 ${refCells.toLocaleString()} → 实际 ${newCells.toLocaleString()}`
    + `（${(refCells / Math.max(newCells, 1)).toFixed(1)}× 减少）`);

  mr.dispose();
}

// ─────────────────────────── 共享 uniform 写入者唯一 ───────────────────────────
{
  const src = readFileSync(resolve(process.cwd(), 'src/render/map-renderer.ts'), 'utf8');
  const bodyStart = src.indexOf('updateDayNight(');
  const bodyEnd = src.indexOf('\n  }', bodyStart);
  const body = src.slice(bodyStart, bodyEnd > 0 ? bodyEnd : undefined);
  ok('光照值走共享实例（uEnvLight）', /uniforms\.uEnvLight = \{ value: this\.sharedEnvLight \}/.test(src));
  ok('光照值走共享实例（uSceneLightPos/Color/Range）',
    /uniforms\.uSceneLightPos = \{ value: this\.sharedSceneLightPos \}/.test(src)
    && /uniforms\.uSceneLightColor = \{ value: this\.sharedSceneLightColor \}/.test(src)
    && /uniforms\.uSceneLightRange = \{ value: this\.sharedSceneLightRange \}/.test(src));
  ok('updateDayNight 不再逐材质写光照（那会退回 4.5 万次 copy/帧）',
    !/uSceneLightPos\.value/.test(body) && !/uEnvLight\.value/.test(body));
}

console.log(fails === 0
  ? '\n✓ verify-map-culling 通过 —— 两级剔除与"逐细格判"画出同一批面，且几何天生可画'
  : `\n✗ ${fails} 条不符 —— 先查 map-renderer.ts 的 blockOfKey/KEY_SHIFT 与 superStart 建表`);
process.exit(fails === 0 ? 0 : 1);
