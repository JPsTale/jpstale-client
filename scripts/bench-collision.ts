import { readFileSync } from 'node:fs';
import { parseSMD } from '../src/core/smd-parser.js';
import { CollisionMesh } from '../src/maps/collision.js';

const buf = readFileSync('E:/JPsTale/client/field/ricarten/village-2.smd').buffer.slice(0);
const smd = parseSMD(buf);
const mesh = new CollisionMesh();
mesh.buildFromSMD(smd);

const nTri = mesh.triangles.length;
const nCells = mesh.cellMap.size;
console.log(`碰撞面: ${nTri}  非空 cell: ${nCells}`);
console.log(`平均每 cell 面数: ${(nTri / Math.max(1, nCells)).toFixed(1)}`);

// cell 面数分布
let maxCell = 0, sum = 0, over50 = 0, over100 = 0;
for (const arr of mesh.cellMap.values()) {
  sum += arr.length;
  if (arr.length > maxCell) maxCell = arr.length;
  if (arr.length > 50) over50++;
  if (arr.length > 100) over100++;
}
console.log(`最大 cell 面数: ${maxCell}  面数>50 的 cell: ${over50}  >100 的 cell: ${over100}`);

// 模拟一次查询成本：角色在某点，查附近 cell（±64 单位 = 9 cell），测平均/最大附近三角形数
const CELL_SIZE = 64 * 256;
const AREA_RADIUS = 64 * 256;
const samples = [ [387178, -4516101], [176000, -4550000], [500000, -5000000], [0, 0] ];
for (const [sx, sz] of samples) {
  const idxs = mesh._nearbyTriangleIdx(sx, sz);
  // 去重（cell 可能重复引用同一三角形）
  const uniq = new Set(idxs);
  console.log(`查询点 raw(${sx},${sz}): 附近三角形(去重) = ${uniq.size}`);
}

// 测一次 checkNextMove 耗时（50 次取均值）
const t0 = performance.now();
for (let i = 0; i < 50; i++) {
  mesh.checkNextMove(387178, 55341, -4516101, 0, 800);
}
const t1 = performance.now();
console.log(`checkNextMove 平均: ${((t1 - t0) / 50 * 1000).toFixed(0)} μs`);
