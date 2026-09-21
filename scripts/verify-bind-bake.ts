/**
 * 回归 ①：**lite 包与完整包推出的"绑定姿势"必须一致**（资产不变式，方法 2 的验收）。
 * 回归 ②：**几何体缓存必须挂在"绑定姿势"上**（客户端护栏）。
 *
 * 背景（两件事是一个故事的两半，2026-09-21）：
 * `buildSkinnedMesh` 把顶点**预乘进绑定姿势的世界空间**（`bindWorldByName`），蒙皮用的是
 * 同一具骨架的 `boneInverses`（同一套姿势的逆）——两者必须同源。而"绑定姿势"是客户端用
 * **动画包的帧 0** 求出来的（`buildSkeleton` → `evalSkeleton(smb, 0)`），同一份 `.smd` 又同时被
 * 两个包装配（lite 选角预览 / 完整包进游戏），且几何缓存键只有 `.smd` ⇒ **谁先烘谁赢**，
 * 另一套骨架按自己的绑定姿势解释它 ⇒ 四肢/手被逐骨常量矩阵扭开（用户实测"进游戏回选角手部变形"）。
 *
 *  ① 资产侧（已修）：`extract-anim` 的切窗下界钉死在帧 0（`CUT_FROM`）——
 *     lite 包原先从 STAND 起点 `g0` 才开始有段，帧 0 落空 ⇒ 求值器回退 `tmRotate`，
 *     推出来的绑定姿势与完整包差最多 4.27 单位。现在两包**逐字段相等**。
 *  ② 客户端侧（已修）：`meshPartCache` 的键加上绑定姿势指纹 —— 任何包组合都不会再互借几何。
 *
 * 断言：
 *   A. 【资产】每个动画组的 lite 包与完整包：`bindKey` 相等、且逐骨 `bindWorldByName` 完全一致。
 *      资产回退（比如有人把提取器改回从 g0 切）→ 这条立刻红。
 *   B. 【缓存】同姿势 → 仍共用同一份几何（没被键改造废掉：怪物那 222 次装配仍只烘一次）。
 *   C. 【缓存】不同姿势 → **不复用**，且两份顶点确实不同（用人工扰动出的一副"另一套姿势"来断言）。
 *   D. 【缓存】命中缓存 ≡ 新解析一份 `.smd` 现场烘（缓存不改数值）。
 *
 * 用法：`npm run verify-bind-bake`
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseSmb, parseInx } from '../src/core/char-parser.js';
import { buildSkeleton, buildSkinnedMesh } from '../src/render/skinned-builder.js';
import { getBodyInxPath, resolveModelBase } from '../src/render/char-loader.js';
import type { SmbData } from '../src/char/char-format.js';
import type { SkeletonResult } from '../src/render/skinned-builder.js';

const ASSET = resolve(process.env.PT_ASSET_ROOT ?? 'E:/JPsTale/client');

let fails = 0;
const ok = (label: string, cond: boolean): void => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}`);
  if (!cond) fails++;
};

function readAb(rel: string): ArrayBuffer {
  const p = `${ASSET}/${rel}`;
  if (!existsSync(p)) throw new Error('缺资产: ' + p);
  const b = readFileSync(p);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}
const parseAt = (rel: string): SmbData => parseSmb(readAb(rel));
const posKeyOf = (built: ReturnType<typeof buildSkinnedMesh>): string =>
  built.meshes.map((m) => {
    const a = m.geometry.getAttribute('position').array as Float32Array;
    return m.userData.nodeName + '#' + a.length + '#' + a.join(',');
  }).join('|');
const maxDiff = (a: number[], c: number[]): number => {
  let d = 0;
  for (let i = 0; i < 16; i++) d = Math.max(d, Math.abs(a[i]! - c[i]!));
  return d;
};

/** 每组的代表性职业（组号 → jobId，用于取一个体模） */
const GROUPS: { group: number; jobId: number }[] = [
  { group: 1, jobId: 1 }, { group: 2, jobId: 3 }, { group: 3, jobId: 7 }, { group: 4, jobId: 4 },
  { group: 5, jobId: 8 }, { group: 6, jobId: 9 }, { group: 7, jobId: 10 }, { group: 8, jobId: 11 },
];

console.log('=== A. 资产不变式：lite / 完整包的绑定姿势必须一致 ===');
for (const { group } of GROUPS) {
  const fullSmb = parseAt(`char/tmabcd/m${group}.smb`);
  const liteSmb = parseAt(`char/tmabcd/lite/m${group}.smb`);
  const full = buildSkeleton(fullSmb, false);
  const lite = buildSkeleton(liteSmb, false);
  let worst = 0, worstBone = '';
  for (const [name, m] of full.bindWorldByName) {
    const l = lite.bindWorldByName.get(name);
    if (!l) { worst = Infinity; worstBone = name + '(缺)'; break; }
    const d = maxDiff(m, l);
    if (d > worst) { worst = d; worstBone = name; }
  }
  ok(`m${group}：bindKey ${full.bindKey === lite.bindKey ? '相等' : '❌ 不等'}，`
    + `逐骨 bindWorld 最大偏差 ${worst.toExponential(1)}（${worstBone}）`, worst <= 1e-4);
}

console.log('\n=== B/C/D. 几何缓存护栏（同一个 .smd 实例，三种装配） ===');
for (const { group, jobId } of GROUPS.slice(0, 3)) {
  const fullSmb = parseAt(`char/tmabcd/m${group}.smb`);
  const liteSmb = parseAt(`char/tmabcd/lite/m${group}.smb`);
  const full = buildSkeleton(fullSmb, false);
  const lite = buildSkeleton(liteSmb, false);

  const inxRel = getBodyInxPath(jobId, 1)!;
  const inx = parseInx(readAb(inxRel));
  const bodyBase = resolveModelBase(inx)!;
  const names = inx.highModel.modelNames.filter(Boolean);
  const smdPath = bodyBase + '.smd';
  const smd = parseAt(smdPath);
  const meshNames = names.length ? names : null;

  const a1 = buildSkinnedMesh(smd, liteSmb, meshNames, false, lite);
  const a2 = buildSkinnedMesh(smd, liteSmb, meshNames, false, lite);
  ok(`m${group} B. 同姿势复用同一份几何（${a1.meshes.length} 个网格）`,
    a1.meshes.length > 0 && a1.meshes.every((m, i) => m.geometry === a2.meshes[i]!.geometry));

  // 人工扰动出"另一套绑定姿势"（每个骨骼世界矩阵 y 平移 +2）——用来断言缓存不跨姿势复用
  const perturbed: SkeletonResult = {
    ...full,
    bindKey: 'artificial|' + full.bindKey,
    bindWorldByName: new Map([...full.bindWorldByName].map(([k, v]) => [k, v.map((x, i) => (i === 13 ? x + 2 : x))])),
  };
  const b = buildSkinnedMesh(smd, liteSmb, meshNames, false, perturbed);
  ok(`m${group} C. 不同姿势**不**复用（否则 = 用户实测的手部变形）`,
    b.meshes.every((m) => a1.meshes.every((x) => x.geometry !== m.geometry)));
  const kLite = posKeyOf(a1), kAlt = posKeyOf(b);
  ok(`m${group} C. 两套姿势烘出的顶点确实不同`, kLite !== kAlt);

  const fresh = parseAt(smdPath);
  const ref = buildSkinnedMesh(fresh, liteSmb, meshNames, false, lite);
  ok(`m${group} D. 命中缓存 ≡ 现场新烘`, posKeyOf(ref) === kLite);
}

console.log(fails === 0 ? '\nPASS' : `\nFAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);
