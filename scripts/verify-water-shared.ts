/**
 * 水岸共享顶点（B'）回归 —— 水面网格与岸边网格**共用同一批顶点索引**（资产事实，
 * 见 de-2.smd：86 条水岸共边，水面试 mat47 与岸面试 mat48 引用完全相同的 triIdx）。
 *
 * 原版靠全局顶点池共享让岸边顶点跟着水波一起动；我们按材质拆 mesh、顶点按面平铺，
 * 共享关系丢失 → 给非水材质的**共享顶点副本**打 `aWaterEdge` mask，用**同一坐标公式**位移。
 *
 * 钉住的性质：
 *   ① 水面材质**不**带 aWaterEdge（它走原有"全顶点位移"路径，两套不能混）
 *   ② 岸边材质带 aWaterEdge，且长度 == 顶点数
 *   ③ **核心**：被标记为 1 的岸边顶点，其坐标必须与某个水面顶点**重合**
 *      —— 坐标相同才保证位移逐位一致（否则 mask 标错顶点 → 反而制造裂缝）
 *   ④ 与水无关的材质**不带** aWaterEdge（零开销，不是给全图都加）
 *
 * 用法：npx tsx scripts/verify-water-shared.ts
 */
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseSMD, type SMDData, type SMDMaterial } from '../src/core/smd-parser.js';
import { MapRenderer, type MatConfig } from '../src/render/map-renderer.js';

const ASSET = resolve(process.env.PT_ASSET_ROOT ?? 'E:/JPsTale/client');
const MAP = join(ASSET, 'field/desert/de-2.smd');

let fail = 0;
function check(label: string, pass: boolean, extra = ''): void {
  if (!pass) fail++;
  console.log(`${pass ? '  ✓' : '  ✗'} ${label}${extra ? '：' + extra : ''}`);
}

function isWaterMat(m: SMDMaterial): boolean {
  return !!(m.windMeshBottom && !(m.useState & 0x4000) && (m.windMeshBottom & 0x7FF) === 0x200);
}

const stubConfig = (): MatConfig => ({
  hasTex: false, hasLM: false, diffuseTex: null, lightmapTex: null,
  hasSecondTex: false, secondTex: null, isTransparent: false,
  isRendLatter: false, blendType: 0, hasAnimation: false,
});

const d: SMDData = parseSMD(new Uint8Array(readFileSync(MAP)).buffer as ArrayBuffer);
const renderer = new MapRenderer(new THREE.Scene());
renderer.build(d, new Map(), stubConfig);

const round = (v: number) => Math.round(v * 1000) / 1000;
const posKey = (arr: ArrayLike<number>, i: number) => `${round(arr[i * 3])},${round(arr[i * 3 + 1])},${round(arr[i * 3 + 2])}`;

// 水面材质的全部顶点坐标（位移公式只依赖坐标，坐标集合即"位移坐标系"）
const waterPos = new Set<string>();
let waterMatCount = 0;
for (const mrd of renderer.materials) {
  if (!isWaterMat(d.materials[mrd.matIdx])) continue;
  waterMatCount++;
  const pos = mrd.geometry.getAttribute('position').array as Float32Array;
  for (let i = 0; i < pos.length / 3; i++) waterPos.add(posKey(pos, i));
}
check('本图存在水面材质', waterMatCount > 0, `waterMat=${waterMatCount}`);
check('本图水面顶点坐标集非空', waterPos.size > 0, `waterPos=${waterPos.size}`);

// 水面材质不得带 aWaterEdge（它走全顶点位移）
let waterWithAttr = 0;
for (const mrd of renderer.materials) {
  if (isWaterMat(d.materials[mrd.matIdx]) && mrd.geometry.getAttribute('aWaterEdge')) waterWithAttr++;
}
check('水面材质不带 aWaterEdge', waterWithAttr === 0, `带=${waterWithAttr}`);

// 岸边/其他非水材质：带 mask 的，逐个核对"标记顶点坐标必须落在水面坐标集里"
let shoreMats = 0, shoreFlagged = 0, mismatched = 0;
for (const mrd of renderer.materials) {
  if (isWaterMat(d.materials[mrd.matIdx])) continue;
  const attr = mrd.geometry.getAttribute('aWaterEdge');
  if (!attr) continue;
  shoreMats++;
  const pos = mrd.geometry.getAttribute('position').array as Float32Array;
  const edge = attr.array as Float32Array;
  check(`材质 ${mrd.matIdx} aWaterEdge 长度 == 顶点数`, attr.count === mrd.geometry.getAttribute('position').count,
    `edge=${attr.count} pos=${mrd.geometry.getAttribute('position').count}`);
  for (let i = 0; i < edge.length; i++) {
    if (edge[i] < 0.5) continue;
    shoreFlagged++;
    if (!waterPos.has(posKey(pos, i))) mismatched++;
  }
}
check('至少一个非水材质带 aWaterEdge', shoreMats > 0, `材质数=${shoreMats}`);
check('标记顶点数 > 0', shoreFlagged > 0, `标记=${shoreFlagged}`);
check('★ 所有标记顶点坐标都落在水面坐标集里（位移必一致）', mismatched === 0, `不符=${mismatched}`);

// 与水无关的材质不带 mask（选择性，不是全图加）
let plainMats = 0;
for (const mrd of renderer.materials) {
  if (isWaterMat(d.materials[mrd.matIdx])) continue;
  if (!mrd.geometry.getAttribute('aWaterEdge')) plainMats++;
}
check('存在不带 aWaterEdge 的非水材质（mask 是选择性的）', plainMats > 0, `无mask=${plainMats}`);

console.log(fail === 0 ? '\n全部通过' : `\n${fail} 项不符`);
process.exit(fail === 0 ? 0 : 1);
