/**
 * **Chain Lightning（祭司 T4.3）的逐段链光束** —— 原版逐字：
 * `CelestialChainLighting`（`HoNewEffectFunction.cpp:646-790`）：
 *
 * ```c
 * for (index = 0; index < count-1; index++) {          // 相邻节点一对一对连
 *     两端各起 "Skill4CelestialChainLightingLight" 粒子（num1/num2 传给效果）;
 *     HoEffectType_Attach_AvaterToAvater:
 *         m_AxialController.Init("B_e20.bmp", 3, 0.005f);   // 3 帧贴图沿轴拉伸
 *         InitLoop(1);  InitEndTime(1.f);                   // 循环、1 秒结束
 *         InitColor(150,255,200, 255);  InitSize(15,25);    // 青绿、宽 15→25
 *         InitPos(cur, des);                                 // 从上一节点拉到下一节点
 *         color 事件：0.4s / 0.6s 两段 fade（尾部渐隐）
 * }
 * ```
 *
 * ## 我方的链从哪来（AGENTS #110 同构：结算流驱动）
 *
 * 原版客户端自己选链（`dm_SelectDamageChainCount` ⇒ `lpSelected_Char[]`），事件帧时整条链已知；
 * 我们的服务端权威架构里**链表在服务端**（`chainNearest` 最近邻序），客户端拿到的只有
 * 逐怪的 `S2C_AttackResult.skill_id = CHAIN_LIGHTNING`（按链序逐条到达）。
 * ⇒ 视觉按**到达顺序**重组：施法（`S2C_SkillStart`）时把"上一节点"重置为施法者；
 *   每到一条结算就从"上一节点"向该目标拉一道光束 + 两端节点粒子，并把上一节点推进到该目标。
 *   段与段天然按到达时序播放 ⇒ 观感与原版的逐段传导一致。
 *
 * ## 光束渲染
 *
 * 原版 AxialController = 多帧闪电贴图沿**轴**拉伸（宽 15→25 raw ≈ 0.06→0.1…… 实测观感为
 * 环带粗细的青绿色闪电带）。我方：A→B 拉一条双三角带（billboard 沿轴），贴图用同族
 * `b_e201.bmp`（128×256 竖闪电；`B_e20.bmp` 不在库——同族 201/202/203 在，替代并登记），
 * 加法混合、1 秒内淡出。节点粒子 = `skill4celestialchainlightinglight.part`（在库 ✓）。
 */
import * as THREE from 'three';
import { cachedFetch } from '../../core/asset-cache.js';
import { decodeTextureAsync } from '../../core/texture.js';

/** 节点光粒（原版 `Skill4CelestialChainLightingLight`，两端各一） */
export const CHAIN_NODE_PART = 'skill4celestialchainlightinglight';
/** 轴向闪电贴图（原版 B_e20.bmp 不在库 ⇒ 同族 201 替代，显式登记） */
const BEAM_TEX = 'effect/neweffect/res/texturehit/b_e201.bmp';
/** `InitEndTime(1.f)` —— 光束寿命 1 秒 */
const BEAM_LIFE = 1.0;
/** 带宽：`InitSize(15,25)`（raw/8？观感校准）⇒ 世界单位 0.9 → 1.5 渐宽 */
const BEAM_W0 = 0.9;
const BEAM_W1 = 1.5;
/** 青绿 `InitColor(150,255,200)` */
const BEAM_RGB = { r: 150, g: 255, b: 200 };

interface Beam {
  mesh: THREE.Mesh;
  geo: THREE.BufferGeometry;
  posAttr: THREE.BufferAttribute;
  mat: THREE.MeshBasicMaterial;
  age: number;
  a: THREE.Vector3;
  b: THREE.Vector3;
}

const beams: Beam[] = [];
let beamTex: THREE.Texture | null = null;
let texLoadStarted = false;
let camRef: THREE.Camera | null = null;

export interface ChainBeamDeps {
  scene: THREE.Scene;
  camera: THREE.Camera | null;
  /** 两端节点粒子（`EffectManager.spawnStoppable`；null = 没接 ⇒ 只画光束并上报） */
  spawnPartStoppable(name: string, opts: {
    pos: { x: number; y: number; z: number };
    loop?: boolean;
  }): Promise<unknown | null> | null;
  log?: (m: string) => void;
}

function ensureTex(deps: ChainBeamDeps): void {
  if (beamTex || texLoadStarted) return;
  texLoadStarted = true;
  void (async () => {
    try {
      const buf = await cachedFetch('/res/' + BEAM_TEX, 'texture');
      const d = await decodeTextureAsync(buf);
      if (!d) { console.warn('[chain] 光束贴图解码失败', BEAM_TEX); return; }
      const c = document.createElement('canvas');
      c.width = d.width;
      c.height = d.height;
      c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(d.pixels), d.width, d.height), 0, 0);
      beamTex = new THREE.CanvasTexture(c);
      beamTex.magFilter = THREE.LinearFilter;
      beamTex.minFilter = THREE.LinearFilter;
    } catch (e) {
      console.warn('[chain] 光束贴图加载失败', BEAM_TEX, e);
    }
  })();
  void deps;
}

/**
 * 拉一道链光束（`from` → `to`，世界单位；两端节点粒子照原版成对起）。
 * `deps` 首次调用时注入（WorldView）。
 */
export function runChainSegment(deps: ChainBeamDeps, from: { x: number; y: number; z: number },
                               to: { x: number; y: number; z: number }): void {
  camRef = deps.camera;
  ensureTex(deps);
  // 两端节点粒子（原版 num1/num2；loop=1 的节点光粒，1 秒后随光束一起结束）
  deps.spawnPartStoppable?.(CHAIN_NODE_PART, { pos: { ...from }, loop: true });
  deps.spawnPartStoppable?.(CHAIN_NODE_PART, { pos: { ...to }, loop: true });

  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(new Float32Array(4 * 3), 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  const uvAttr = new THREE.BufferAttribute(new Float32Array(4 * 2), 2);
  uvAttr.setXY(0, 0, 1); uvAttr.setXY(1, 1, 1); uvAttr.setXY(2, 0, 0); uvAttr.setXY(3, 1, 0);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('uv', uvAttr);
  geo.setIndex([0, 1, 3, 0, 3, 2]);
  const mat = new THREE.MeshBasicMaterial({
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.visible = false;
  deps.scene.add(mesh);
  beams.push({
    mesh, geo, posAttr, mat, age: 0,
    a: new THREE.Vector3(from.x, from.y, from.z),
    b: new THREE.Vector3(to.x, to.y, to.z),
  });
  deps.log?.(`  ⚡ 链段 (${from.x.toFixed(0)},${from.y.toFixed(0)},${from.z.toFixed(0)}) → `
    + `(${to.x.toFixed(0)},${to.y.toFixed(0)},${to.z.toFixed(0)})`);
}

/** 每帧：贴图未就绪时先亮纯色带；更新顶点（面向相机）/淡出/清理。 */
export function updateChainBeams(dt: number): void {
  if (beams.length === 0) return;
  const viewDir = new THREE.Vector3();
  if (camRef) camRef.getWorldDirection(viewDir);
  const UP = new THREE.Vector3(0, 1, 0);
  for (let i = beams.length - 1; i >= 0; i--) {
    const bm = beams[i]!;
    bm.age += dt;
    if (bm.age >= BEAM_LIFE || !beamTex) {
      if (bm.age >= BEAM_LIFE) {
        bm.geo.dispose();
        bm.mesh.removeFromParent();
        beams.splice(i, 1);
        continue;
      }
    }
    const k = Math.min(1, bm.age / BEAM_LIFE);
    const width = (BEAM_W0 + (BEAM_W1 - BEAM_W0) * k);
    bm.mat.opacity = 1 - k;                       // 尾部渐隐（0.4/0.6 两段 fade 的等价观感）
    bm.mat.color.setRGB(BEAM_RGB.r / 255, BEAM_RGB.g / 255, BEAM_RGB.b / 255);
    const seg = new THREE.Vector3().subVectors(bm.b, bm.a);
    const lat = new THREE.Vector3();
    if (seg.lengthSq() > 1e-9 && viewDir.lengthSq() > 0) lat.crossVectors(viewDir, seg);
    if (lat.lengthSq() < 1e-9) lat.crossVectors(seg, UP);
    lat.normalize().multiplyScalar(width / 2);
    const pa = bm.posAttr;
    pa.setXYZ(0, bm.a.x - lat.x, bm.a.y - lat.y, bm.a.z - lat.z);
    pa.setXYZ(1, bm.a.x + lat.x, bm.a.y + lat.y, bm.a.z + lat.z);
    pa.setXYZ(2, bm.b.x - lat.x, bm.b.y - lat.y, bm.b.z - lat.z);
    pa.setXYZ(3, bm.b.x + lat.x, bm.b.y + lat.y, bm.b.z + lat.z);
    pa.needsUpdate = true;
    bm.mesh.visible = true;
  }
}

/** 换图清理 */
export function clearChainBeams(): void {
  for (const bm of beams) {
    bm.geo.dispose();
    bm.mesh.removeFromParent();
  }
  beams.length = 0;
}
