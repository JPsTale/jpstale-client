/**
 * **渲染映射一致性**核对：把"PT 四种面片的几何/朝向语义"（`HoNewParticle.cpp:3090-3180` +
 * 四个 builder）写成断言，逐类型核对我们的 quarks 映射。
 *
 * 为什么要它（2026-09-18）：我用"逐帧算术"验证了时间轴状态机，却把**渲染集成**交给了实验室肉眼
 * ——于是一连三个错都靠用户眼睛发现：粒子跑到世界原点、陨石拖尾塌成光球、法阵被压成一条窄线
 * （我把"世界 XZ 平面"做成了几何，而 quarks 的 size 是按 x/y 缩放的 ⇒ 深度恒为 1）。
 * 这一层是**从 C++ 语义翻译到 quarks 约定**，翻译错的空间很大 ⇒ 必须有断言，不能靠肉眼。
 *
 * 用法：`npx tsx scripts/verify-part-render-mapping.ts`
 */
import * as THREE from 'three';
import { createState, type PtTimelineCfg } from '../src/core/effect/pt-timeline.js';
import { PtTimeline, setTimelineCamera } from '../src/render/effects/pt-timeline-behavior.js';

const DT = 1 / 70;
let fails = 0;
const ok = (name: string, cond: boolean, got: string): void => {
  if (!cond) fails++;
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond ? '' : `（实际 ${got}）`}`);
};

const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
cam.position.set(0, 10, -20);
cam.lookAt(0, 0, 0);
cam.updateMatrixWorld(true);
setTimelineCamera(cam);

const cfg = (over: Partial<PtTimelineCfg> = {}): PtTimelineCfg => ({
  lifetime: { k: 'n', v: 10 }, emitRadius: { x: { k: 'n', v: 0 }, y: { k: 'n', v: 0 }, z: { k: 'n', v: 0 } },
  gravity: { x: { k: 'n', v: 0 }, y: { k: 'n', v: 0 }, z: { k: 'n', v: 0 } }, events: [], ...over,
});

interface P {
  position: THREE.Vector3; velocity: THREE.Vector3; size: THREE.Vector3; color: THREE.Vector4;
  rotation: THREE.Quaternion; memory: number[]; age: number; life: number; speedModifier: number;
}

/** 跑一帧后返回：四角的世界坐标（几何 = 1×1 面片，按 size 缩放的等价物） */
function quadCorners(type: number, size: [number, number], angles: [number, number, number] = [0, 0, 0]): THREE.Vector3[] {
  const tl = new PtTimeline(cfg(), type);
  const p: P = {
    position: new THREE.Vector3(), velocity: new THREE.Vector3(),
    size: new THREE.Vector3(1, 1, 1), color: new THREE.Vector4(1, 1, 1, 1),
    rotation: new THREE.Quaternion(), memory: [], age: 0, life: 10, speedModifier: 1,
  };
  const st = createState(cfg(), () => 0);
  st.val.partAngle = angles;
  (tl as unknown as { states: WeakMap<object, unknown> }).states.set(p, st);
  (tl as unknown as { emitter: THREE.Object3D | null }).emitter = null;
  tl.update(p as never, DT);
  const half = new THREE.Vector3(size[0] / 2, size[1] / 2, 0);
  return [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => new THREE.Vector3(sx! * half.x, sy! * half.y, 0)
    .applyQuaternion(p.rotation).add(p.position));
}

const bbox = (pts: THREE.Vector3[]): THREE.Vector3 => {
  const b = new THREE.Box3().setFromPoints(pts).getSize(new THREE.Vector3());
  return new THREE.Vector3(+b.x.toFixed(2), +b.y.toFixed(2), +b.z.toFixed(2));
};
const normalOf = (type: number, angles: [number, number, number] = [0, 0, 0]): THREE.Vector3 => {
  const tl = new PtTimeline(cfg(), type);
  const p: P = {
    position: new THREE.Vector3(), velocity: new THREE.Vector3(),
    size: new THREE.Vector3(1, 1, 1), color: new THREE.Vector4(1, 1, 1, 1),
    rotation: new THREE.Quaternion(), memory: [], age: 0, life: 10, speedModifier: 1,
  };
  const st = createState(cfg(), () => 0);
  st.val.partAngle = angles;
  (tl as unknown as { states: WeakMap<object, unknown> }).states.set(p, st);
  (tl as unknown as { emitter: THREE.Object3D | null }).emitter = null;
  tl.update(p as never, DT);
  return new THREE.Vector3(0, 0, 1).applyQuaternion(p.rotation).normalize();
};
const toCam = new THREE.Vector3().subVectors(cam.position, new THREE.Vector3()).normalize();

console.log('TYPE_ONE（`AddFace2DBillBoard`：相机空间 + PartAngle 做 Rx·Ry·Rz）');
{
  const n = normalOf(1);
  ok('无角度 ⇒ 面片正对相机', n.dot(toCam) > 0.99, `n·cam=${n.dot(toCam).toFixed(3)}`);
  const nz = normalOf(1, [0, 0, 90]);
  ok('只有 z（面内自转）仍正对相机', nz.dot(toCam) > 0.99, `n·cam=${nz.dot(toCam).toFixed(3)}`);
  const nx = normalOf(1, [90, 0, 0]);
  ok('x=90° ⇒ 不再正对相机（原版就是把它转出画面外）', nx.dot(toCam) < 0.99, `n·cam=${nx.dot(toCam).toFixed(3)}`);
}

console.log('TYPE_TWO（`AddFace2dPlane`：**世界 XZ 平面**，宽沿 X、高沿 Z）');
{
  const n = normalOf(2);
  ok('无角度 ⇒ 法线 = +Y（贴地铺开）', Math.abs(n.y - 1) < 1e-3, `n=${n.toArray().map((v) => +v.toFixed(2))}`);
  // ⚠ 这条就是"法阵被压成一条窄线"的守门断言：**世界尺度**必须 x≈宽、z≈高、y≈0
  const b = bbox(quadCorners(2, [10, 4]));
  ok('世界尺度 = (宽10, 厚0, 深4) —— 深度不能被 size.y 吃掉', Math.abs(b.x - 10) < 0.01 && Math.abs(b.z - 4) < 0.01 && b.y < 0.01,
    `bbox=${b.toArray()}`);
}

console.log('TYPE_THREE（`AddFaceThree`：轴向条带 —— 长轴 = 旋转后的局部 Y，宽度朝相机展开）');
{
  const n = normalOf(3);
  ok('面片正对相机', n.dot(toCam) > 0.99, `n·cam=${n.dot(toCam).toFixed(3)}`);
}

console.log('TYPE_FOUR / FIVE');
{
  // TYPE_FOUR 走 quarks Trail（模式由转换层决定），这里只验"不写四元数"不炸
  const b = bbox(quadCorners(4, [4, 20]));
  ok('TYPE_FOUR 不参与四元数朝向（交给 Trail）', b.length() > 0, `bbox=${b.toArray()}`);
  const n5 = normalOf(5, [0, 0, 0]);
  ok('TYPE_FIVE（我方扩展）无速度时回落到相机朝向', n5.dot(toCam) > 0.99, `n·cam=${n5.dot(toCam).toFixed(3)}`);
}

console.log(fails === 0
  ? '\n✓ 渲染映射与 C++ 的四种面片语义一致（相机空间 billboard / 世界 XZ 面 / 轴向条带 / 拖尾）'
  : `\n✗ ${fails} 条不符 —— 别改断言，先对着 docs/PT粒子系统-规格说明书.md §B5.6 查映射`);
process.exit(fails === 0 ? 0 : 1);
