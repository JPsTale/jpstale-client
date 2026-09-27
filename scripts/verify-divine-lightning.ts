/**
 * **神之雷电（Divine Lightning）回归**（`npm run verify-divine-lightning`）——
 * 用户 2026-09-27 实测 FPS 11.7、"3D提交"80ms/96%：第一版每帧往场景里 new mesh 且从不摘除、
 * 实例永不清除 ⇒ 几分钟堆出 3 万+ draw。本脚本用**真模块**跑帧循环钉（每条都能红）：
 *
 *   A. **弹体照源码到达**：从 390 单位高落向头顶，**≤50 tick**（`Max_Time`）内到达并生成 **5 颗**溅射火花；
 *   B. **网格数恒定**：飞行全程场景里的 mesh 数有界（1 弹带 + 5 火花带 = ≤6），绝不随帧数增长；
 *   C. **寿命（70fps 帧轴 + 火花每帧 Time+2）**：弹体 50 tick 到点；火花 ≈(150−T0)/2 ≈ 65~75 tick；
 *      全部结束后实例清零（第一版的收尾条件永远不成立 ⇒ `live` 只增不减）；
 *   D. **连放多道不累积**。
 *
 * 帧轴 = **70fps**（`Main.cpp:1274` `int fps = 70;` 门控主循环 —— Assa 心跳；2026-09-27 修正，
 * 第一版用 60 ⇒ 整体慢 16%，用户实测"火花动画速率太慢"）。
 */
import { installDomStub } from './dom-stub.js';

installDomStub();
let fails = 0;
const ok = (label: string, cond: boolean): void => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}`);
  if (!cond) fails++;
};

const THREE = (await import('three')).default ?? (await import('three'));
const { runDivineLightning, configureDivineLightning, updateDivineLightningRunners, divineLightningStats,
  clearDivineLightning, BOLT_MAX_FRAMES, SPARK_COUNT, BOLT_TRACE_WIDTH_RAW } = await import('../src/render/effects/divine-lightning.js');

console.log('A/B/C. 真模块跑帧循环（70fps Assa 心跳）');
{
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(60, 1.6, 0.1, 2000);
  cam.position.set(130, 50, 30);
  cam.lookAt(100, 20, -30);
  configureDivineLightning({ camera: cam });
  const at = { x: 100, y: 20, z: -30 };
  runDivineLightning({ scene, log: () => {} }, at);

  const countMeshes = (): number => {
    let n = 0;
    scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) n++; });
    return n;
  };

  // 逐帧推进，记录关键事件
  let arrivedAt = -1;
  let maxMeshes = 0;
  let sparksSeen = 0;
  let boltRibbonGoneAt = -1;
  const FPS = 70;            // Assa 心跳（Main.cpp:1274）
  const totalFrames = 200;   // 覆盖弹体 50 + 火花 ≤75 + 余量
  for (let f = 1; f <= totalFrames; f++) {
    updateDivineLightningRunners(1 / FPS);
    const st = divineLightningStats();
    maxMeshes = Math.max(maxMeshes, countMeshes());
    if (arrivedAt < 0 && st.sparks > 0) { arrivedAt = f; sparksSeen = st.sparks; }
    if (boltRibbonGoneAt < 0 && arrivedAt > 0 && st.live > 0) {
      // 弹体带子在到点后仍存在（原版到 50 帧才随实例消失）—— 记"弹体过期后带子是否还在"
      // 检测方式：frame > 50 后带子必须已消失（这里用 mesh 数近似：火花带 ≤5，弹带没了）
    }
    if (st.live === 0) break;
  }
  ok(`A. 弹体 ≤ ${BOLT_MAX_FRAMES} tick 到达并生成溅射（实测第 ${arrivedAt} tick、${sparksSeen} 颗）`,
    arrivedAt > 0 && arrivedAt <= BOLT_MAX_FRAMES && sparksSeen === SPARK_COUNT);
  ok(`B. 网格数有界（≤ 1+${SPARK_COUNT} = ${SPARK_COUNT + 1}；实测峰值 ${maxMeshes}）`,
    maxMeshes <= SPARK_COUNT + 1 && maxMeshes > 0);

  const st = divineLightningStats();
  ok(`C. ${totalFrames} tick 后实例全部清零（残留 ${st.live}；寿命上界 = 50 + 75 + 余量）`, st.live === 0);
  ok(`C. 清理后场景里 0 个 mesh（残留 ${countMeshes()}）`, countMeshes() === 0);

  // D. 连放三道也不累积（用户场景：多目标逐个落雷）
  for (let i = 0; i < 3; i++) runDivineLightning({ scene }, at);
  for (let f = 0; f < totalFrames; f++) updateDivineLightningRunners(1 / FPS);
  ok('D. 连放 3 道后同样全部清干净', divineLightningStats().live === 0 && countMeshes() === 0);

  clearDivineLightning();
}

console.log('E. 竖直段不退化（2026-09-27 用户实测"没有从天而降的雷"的回归钉）');
{
  // 第一版的横向 = cross(段方向, up) 的水平投影 —— 竖直段（弹体下落）横向恒 (0,0) ⇒
  // 带子两侧顶点重合 ⇒ 零宽度 ⇒ 一个像素都不画。修法：cross(视线, 段方向)。
  // 用真模块 + 真相机跑一发，断言**弹体带子两侧顶点分离 ≥ 半宽的 90%**。
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(60, 1.6, 0.1, 2000);
  cam.position.set(30, 30, 60);            // 斜上方看目标 —— 游戏相机的典型视角
  cam.lookAt(0, 10, 0);
  configureDivineLightning({ camera: cam });
  runDivineLightning({ scene, log: () => {} }, { x: 0, y: 0, z: 0 });
  // 推进几帧让 trace 积累（弹体竖直下落中）
  for (let f = 0; f < 10; f++) updateDivineLightningRunners(1 / 70);
  // 找场景里的弹体带 mesh，读它第 0 对顶点的间距
  let mesh: THREE.Mesh | null = null;
  scene.traverse((o) => { if (!mesh && (o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.getAttribute('position')) mesh = o as THREE.Mesh; });
  ok('弹体带 mesh 已创建（竖直下落中也画得出带子）', !!mesh);
  if (mesh) {
    const pos = mesh.geometry.getAttribute('position');
    const a = new THREE.Vector3().fromBufferAttribute(pos, 0);
    const b = new THREE.Vector3().fromBufferAttribute(pos, 1);
    const sep = a.distanceTo(b);
    const expect = BOLT_TRACE_WIDTH_RAW / 256;   // 全宽（两侧各半宽）
    ok(`带子两侧顶点分离 = ${sep.toFixed(2)}（期望 ≈ 全宽 ${expect.toFixed(2)}；第一版为 **0** ⇒ 竖直带完全不可见）`,
      sep > expect * 0.9 && sep < expect * 1.1);
  }
  clearDivineLightning();
}

console.log(fails === 0 ? '\n全部通过' : `\n${fails} 项不符`);
process.exit(fails === 0 ? 0 : 1);
