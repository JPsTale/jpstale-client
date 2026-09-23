/**
 * 呼吸发光**渲染层**（`render/blink-fx.ts`）的回归 —— `npm run verify-blink-fx`。
 *
 * 为什么单独一条：纯逻辑（表/波形/滚动）已由 `verify-aging-blink` 钉死，但**把它写进材质**这一步
 * 全是"静默失败"高发区 —— 材质类型换了、emissiveMap 忘了接、叠加层忘了挂、镜像克隆没共享材质、
 * 卸下后不熄灯…… 画面上的表现都只是"不亮"或"一直亮着"，**不会报错**。
 *
 * 这里用一个**合成武器**（Group + Mesh + MeshPhongMaterial，与 `loadSmdFromUrl` 造出来的同构）
 * 走真实代码路径，断言四件事：
 *   ① 波形 → `material.emissive` 的换算（峰 = 表色×511/512、谷 = 0）；
 *   ② 第二通道叠加网格的建立与材质设置（加色/透明/不写深度）+ 材质级可见性开关；
 *   ③ **镜像克隆共享材质**：刺客匕首的镜像份靠它一起发光（three 的 clone 共享材质，别改成深拷贝）；
 *   ④ `setRow(null)` / `dispose()` 后**必须熄灯**（不能把卸下的武器留在亮着的状态）。
 */
import * as THREE from 'three';
import { BlinkFx } from '../src/render/blink-fx.js';
import { WeaponRig } from '../src/render/weapon-rig.js';
import { agingRowOf, craftRowOf, BLINK_HALF_MS } from '../src/game/agingBlink.js';

let failed = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { console.log(`  ok   ${name}`); return; }
  console.log(`  FAIL ${name}${detail ? ' —— ' + detail : ''}`);
  failed++;
}

/** 合成一件"武器"：与 `loadSmdFromUrl` 的输出同构（Group > Mesh(MeshPhongMaterial)） */
function fakeWeapon(): { group: THREE.Group; mat: THREE.MeshPhongMaterial; meshes: THREE.Mesh[] } {
  const group = new THREE.Group();
  const mat = new THREE.MeshPhongMaterial({ color: 0xffffff });
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
  mesh.name = 'weapon_part';
  group.add(mesh);
  return { group, mat, meshes: [mesh] };
}

const row12 = agingRowOf(12)!;     // RGB(10,220,30)、第二通道 mixs_05 / SCROLL8
const row20 = agingRowOf(20)!;     // RGB(240,240,240)、第二通道 mixm_01 / SCROLL10
const row7 = agingRowOf(7)!;       // RGB(0,50,140)、第二通道 mixs_01 / SCROLL5

// ───────────────── ① 波形 → emissive ─────────────────
{
  const { group, mat } = fakeWeapon();
  const fx = BlinkFx.create(group, row12)!;
  check('create 返回效果对象（有组就有）', !!fx);

  fx.update(0);                    // 峰值：511/512
  const k = 511 / 512;
  const okPeak = Math.abs(mat.emissive.r - (row12.r / 255) * k) < 1e-9
    && Math.abs(mat.emissive.g - (row12.g / 255) * k) < 1e-9
    && Math.abs(mat.emissive.b - (row12.b / 255) * k) < 1e-9;
  check('t=0（峰）emissive = 表色×511/512', okPeak, `${mat.emissive.r},${mat.emissive.g},${mat.emissive.b}`);

  fx.update(BLINK_HALF_MS);        // 谷：0
  check('t=512（谷）emissive = 0', mat.emissive.r === 0 && mat.emissive.g === 0 && mat.emissive.b === 0,
    `${mat.emissive.r},${mat.emissive.g},${mat.emissive.b}`);

  fx.update(0);
  const clone = group.clone();     // 镜像份（刺客匕首）：three 的 clone 共享材质
  const cloneMat = (clone.children[0] as THREE.Mesh).material as THREE.MeshPhongMaterial;
  check('镜像克隆共享同一份材质（⇒ 一起发光，别改成深拷贝）', cloneMat === mat);
  fx.update(BLINK_HALF_MS);
  check('镜像份跟着一起熄（同一材质）', cloneMat.emissive.g === 0);

  fx.update(0);
  fx.setRow(row20);                // 换行（锻造升级）：色跟着换
  fx.update(0);
  check('setRow 换行后 emissive 换成新行的色', Math.abs(mat.emissive.r - (row20.r / 255) * k) < 1e-9
    && Math.abs(mat.emissive.g - (row20.g / 255) * k) < 1e-9, `${mat.emissive.r},${mat.emissive.g}`);

  fx.setRow(null);
  check('setRow(null) ⇒ 熄灯', mat.emissive.r === 0 && mat.emissive.g === 0 && mat.emissive.b === 0);
  fx.update(0);
  check('熄灯后 update 不会重新点亮（row=null 时不动材质）', mat.emissive.g === 0);
  fx.dispose();
}

// ───────────────── ② 第二通道叠加网格 ─────────────────
{
  const { group, meshes } = fakeWeapon();
  const fx = BlinkFx.create(group, row12)!;
  const overlay = meshes[0]!.children[0] as THREE.Mesh | undefined;
  check('叠加网格挂在原网格下面（变换/镜像克隆自动跟随）', !!overlay && overlay.parent === meshes[0]);
  const ovMat = overlay!.material as THREE.MeshBasicMaterial;
  check('叠加材质：加色混合 + 透明 + 不写深度',
    ovMat.blending === THREE.AdditiveBlending && ovMat.transparent === true && ovMat.depthWrite === false,
    `${ovMat.blending}/${ovMat.transparent}/${ovMat.depthWrite}`);
  check('叠加网格与武器共几何（零额外几何体）', overlay!.geometry === meshes[0]!.geometry);
  check('贴图没到位前不参与渲染（材质级可见性，镜像份共享同一份材质也一起开关）', ovMat.visible === false);
  // 注：贴图走 `/res/...` 的异步加载，Node 下取不到 ⇒ 会 reportFallback 并保持"只有呼吸光"。
  // 那条上报本身在浏览器里是可用的（缺图时用户能在降级清单里看到），这里只断言不抛异常。
  fx.update(0);
  check('缺贴图时不抛异常（保持只有呼吸光）', true);
  fx.dispose();
  check('dispose 摘掉叠加网格', meshes[0]!.children.length === 0, String(meshes[0]!.children.length));
}

// ───────────────── ③ 无发光 / 无组 的边界 ─────────────────
{
  const { group, mat } = fakeWeapon();
  const fx = BlinkFx.create(group, null)!;
  fx.update(0);
  check('row=null（未锻造）建立后不亮', mat.emissive.r === 0 && mat.emissive.g === 0 && mat.emissive.b === 0);
  check('row=null 时叠加层建好但不参与渲染（材质 visible=false，等 setRow 点亮）',
    (group.children[0] as THREE.Mesh).children.length === 1
    && ((group.children[0] as THREE.Mesh).children[0] as THREE.Mesh).material instanceof THREE.MeshBasicMaterial
    && (((group.children[0] as THREE.Mesh).children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).visible === false);
  const none = BlinkFx.create(null, row7);
  check('没有武器组 ⇒ 返回 null（调用方不用判空）', none === null);
  fx.dispose();
}

// ───────────────── ④ 合成行也走同一条路 ─────────────────
{
  const { group, mat } = fakeWeapon();
  const fx = BlinkFx.create(group, craftRowOf(0))!;
  fx.update(0);
  const row0 = craftRowOf(0)!;
  check('合成行（RGB 13,0,5）同样进 emissive', Math.abs(mat.emissive.r - (row0.r / 255) * (511 / 512)) < 1e-9,
    String(mat.emissive.r));
  fx.dispose();
}

// ───────────────── ⑤ WeaponRig 的色表行（曳光染色读它；2026-09-23 那个 bug 就出在这条链上）──
{
  const rig = new WeaponRig();
  rig.setAppearance(undefined);
  check('未给外观 ⇒ mainRow/offRow 都是 null（不染色）', rig.mainRow === null && rig.offRow === null);
  // 主手锻造 +8（色表行 4 = RGB(100,0,90)）、副手合成（行 0）
  rig.setAppearance({ weaponKindCode: 2, weaponAgingLevel: 8, offHandKindCode: 1, offHandAgingLevel: 0 });
  check('锻造 +8 ⇒ mainRow = 行 4（RGB 100,0,90）',
    rig.mainRow?.r === 100 && rig.mainRow?.g === 0 && rig.mainRow?.b === 90, JSON.stringify(rig.mainRow));
  check('副手合成 ⇒ offRow = 行 0（texMixCode 9）', rig.offRow?.texMixCode === 9, JSON.stringify(rig.offRow));
  // 再改一次（+12）：行跟着换 —— 这正是"装备着的武器锻造升级、模型没变"那条路
  rig.setAppearance({ weaponKindCode: 2, weaponAgingLevel: 12 });
  check('再 setAppearance（+12）后 mainRow 换成行 8（RGB 10,220,30）',
    rig.mainRow?.r === 10 && rig.mainRow?.g === 220 && rig.mainRow?.b === 30, JSON.stringify(rig.mainRow));
  check('这次没给副手 ⇒ offRow 回到 null（不残留上一件）', rig.offRow === null);
}

console.log(failed === 0 ? '\n呼吸发光渲染层：全部通过' : `\n呼吸发光渲染层：${failed} 条失败`);
process.exit(failed === 0 ? 0 : 1);
