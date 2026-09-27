/**
 * 祭司 T2.2 **神之雷电（Divine Lightning）**的表现层 —— `code:divinelightning`。
 *
 * ## ⚠ 源码事实（本机可复算，两棵树一致：`NewSourcePT-2023/SrcGame/src` 与 `ex-machina`）
 *
 * 触发链（`character.cpp:16272-16300`，`EventSkill()` 的 `case SKILL_PLAY_DIVINE_LIGHTNING`）：
 *   ① 自机分支：`dm_SelectDamageCount(...)` 选敌 + `dm_SendRangeDamage(...)` 结算（**选敌与结算在客户端**）；
 *   ② **两种身份都走** `SkillPlay_DivineLightning_Effect(this, point)`（`netplay.cpp:12463`）——
 *      施法者是本机：对选敌表逐个放；是**别人**（旁观者）：本地重选（160 单位内
 *      `Divine_Lightning_Num[p]` 个、轮转位继续）。③ 打中 >0 个就 `rand()%3` 播音。
 *      （我方：目标列表 = 服务端权威结算随 `S2C_AttackResult.skill_id` 逐条到达 —— AGENTS #110，
 *      **不重跑本地选敌**。）
 *
 * ## 每个目标身上放什么（`AssaParticle_DivineLighting`，`hoAssaParticleEffect.cpp:654-671` 逐字）
 *
 *   弹体 = `cASSAPARTSHOT`（`AssaParticle.cpp` `(cur,dest,type)` 版 `Start` :786-820 + `Main` :503-556）：
 *   · 起点 `(pX, pY+100000, pZ)`（天上 ≈390 单位高）、终点 `(pX, pY+5000, pZ)`（头顶 ≈19.5）；
 *   · **追踪**：每帧 `Velocity += 单位方向`，`Posi += Velocity * fONE`（速度单位 = 世界单位/帧）；
 *     **距离单位是"除过 fONE 的浮点"** —— 到达判定 `length < 10`、软化 `length < 80 ⇒ Velocity ×0.8`
 *     （:524/:536-539，**世界单位**，不是定点 raw —— 第一版我把这两个阈值按 raw 比较了，永不到达）；
 *   · `Max_Time = 50` 帧强制过期（到期整个实例 memset —— **拖尾带随实例一起消失**）；
 *   · 每帧 `cAssaTrace->AddData(&Posi)`（历史 50 点）⇒ `AssaAddFaceTrace`（`AssaUtil.cpp:895`）
 *     沿历史拉出加法混合光带：`Face.width = 8000`，**half = 8000>>1 = 4000 raw = 15.6 世界单位/侧**；
 *   · 到达（`length < 10`，State 0→1）⇒ `AssaParticle_Sprak(&DesPosi)`（`:695-712`）三件套。
 *
 *   ⚠ **心跳 = 70fps**：`Main.cpp:1274` `int fps = 70;` 门控主循环 ⇒ `MainAssaEffect`
 *   （`sinbaram/AssaEffect.cpp:92`）每秒 tick 70 次 —— 我第一版按 60fps 推进，整体慢 16%
 *   （用户实测"雷火花动画速率太慢"的来源之一）。
 *   溅射火花 = `cASSAPARTSPARK::Start(pCurPosi)`（`AssaParticle.cpp:949-988`，**5 颗**）：
 *   · `Posi` = 到达点（头顶）、`DesPosi = Posi − 5000y ± 1000xz`（**终点**向下 + 水平抖动；
 *     第一版我把抖动放在了起点 —— 反了）；初速 `x/z = ±rand(10..18)`、**`y = +rand(6..8)`（向上！）**，
 *     之后每帧同样"朝终点加速"；`Face.width = 4000`（half 7.8 单位/侧）；
 *   · ⚠ **每帧 Time +2**：`MainAssaEffect` 外层 `Time++`（AssaEffect.cpp:99）+ `Main` 尾部
 *     又一个 `Time++`（AssaParticle.cpp:1090）⇒ 实际寿命 = (150 − T0)/2 ≈ **65~75 帧 @70fps
 *     ≈ 0.93~1.07 秒**（第一版按"150 帧"算成 2.1~2.5 秒 —— "火花太慢"的主体）；
 *   · 拖尾条件 `Time % 2` 看到的是**外层 ++ 之后**的值（T0+1, T0+3, …，奇偶恒定）
 *     ⇒ **T0 为偶数的火花有拖尾、奇数的永远没有**（引擎怪癖，照抄：~52% 有带子）。
 *
 *   三件套：白动态光 `SetDynLight(255,255,255, 255,100,2)` + `g_NewParticleMgr.Start("DivineLightning")`
 *   = 资产 `effect/particle/script/divinelightning.part`（清单在库 ✓，走 quarks）。
 *
 * ## 我方实现
 *
 * * **拖尾带**：每条 trace 一个**固定容量的 BufferGeometry**（TRACE_LENGTH×2 顶点、DynamicDrawUsage、
 *   drawRange 控制段数），每帧**原地更新**顶点 —— ⚠ 第一版每帧 new 一个 mesh 挂进场景、旧网格
 *   从不摘除 ⇒ 场景每帧多 6 个 mesh、几分钟堆出 3 万+ draw（用户 2026-09-27 实测 FPS 11.7、
 *   "3D提交"80ms/96%）—— 教训：**每帧重建的特效必须"固定对象 + 原地更新"，new/dispose 只许发生在
 *   生命周期边界**。横向 = 段方向 × up 的水平垂直（原版在相机空间展开；加法混合下观感一致，
 *   视角差异属已知近似）。UV：u=0/1 两列、v 沿历史均分（原版 `AssaAddFaceTrace` 同构）；
 *   贴图整条映射 —— 原版 `SetMaterialAnimFrame(mat, 2)` 的 2 帧材质动画未移植（144×768 的帧条切片），
 *   属外观近似，显式登记。
 * * **寿命**：弹体 50 帧到点 ⇒ 它的带子**当场消失**（照原版 memset）；火花 130~150 帧各自到点
 *   ⇒ 各自的带子消失；全部结束 ⇒ 实例从 `live` 摘除、几何释放。（第一版的收尾条件写错，
 *   实例永不清除 —— 同样是那次泄漏的一半。）
 * * **自检**：`npm run verify-divine-lightning`（到达帧数 / 溅射颗数 / 网格数恒定 / 全部清干净）。
 */
import * as THREE from 'three';
import { reportFallback } from '../../char/fallback-log.js';

/* ── 原版常量（出处见文件头） ── */
export const BOLT_START_LIFT_RAW = 100000;
export const BOLT_END_LIFT_RAW = 5000;
/** `Max_Time = 50`（弹体寿命，60fps 帧） */
export const BOLT_MAX_FRAMES = 50;
/** `Face.width = 8000`（带子总宽，定点）⇒ half = 4000 raw = 15.625 世界单位/侧 */
export const BOLT_TRACE_WIDTH_RAW = 8000;
/** `cASSATrace` 历史长度（`AssaUtil.h` 构造器 `Length = 50`） */
export const TRACE_LENGTH = 50;
/** 到达/软化判定 —— **世界单位**（源码在 `(Des−Posi)/fONE` 之后比较，:524/:536） */
const ARRIVE_DIST_WU = 10;
const SOFT_DIST_WU = 80;
/** 火花：5 颗、寿命 150、终点 −5000y ± 1000xz、初速 x/z ±(10..18)、y +(6..8)（:949-971） */
export const SPARK_COUNT = 5;
const SPARK_MAX_FRAMES = 150;
const SPARK_TIME_SEED_MAX = 20;
const SPARK_DROP_RAW = 5000;
const SPARK_JITTER_RAW = 1000;
const SPARK_SPEED_MIN = 10, SPARK_SPEED_MAX = 18;
const SPARK_VY_MIN = 6, SPARK_VY_MAX = 8;
const SPARK_TRACE_WIDTH_RAW = 4000;
const SPARK_SOFT_DIST_WU = 60;       // `length < 60 ⇒ ×0.8`（:1024）
/** `AssaParticle_Sprak` 白动态光（`hoAssaParticleEffect.cpp:710`） */
export const SPARK_DYN_LIGHT = { r: 255, g: 255, b: 255, a: 255, power: 100, decPower: 2 } as const;
/** 弹体/火花贴图（`AssaSearchRes("spark01_01.bmp", SMMAT_BLEND_LAMP)`） */
export const SPARK_TEXTURE = 'effect/assaeffect/deadlay/spark01_01.bmp';
/** 落地 `.part`（`g_NewParticleMgr.Start("DivineLightning", …)`） */
export const DIVINE_LIGHTNING_PART = 'divinelightning';

const FONE = 256;
/** Assa 特效心跳 = **70fps**（`Main.cpp:1274` `int fps = 70;` 门控主循环） */
const ASSA_FPS = 70;

/* ── 渲染依赖 ── */
export interface DivineFxSink {
  scene: THREE.Scene;
  dynLights?: { set: (x: number, y: number, z: number, r: number, g: number, b: number, a: number, power: number, decPower: number) => unknown } | null;
  spawnPart?: ((name: string, opts: { pos: { x: number; y: number; z: number } }) => Promise<boolean> | null) | null;
  log?: (msg: string) => void;
}

/** 一条拖尾带的**固定容量**渲染物（顶点原地更新，永不在帧内 new） */
interface Ribbon {
  mesh: THREE.Mesh;
  geo: THREE.BufferGeometry;
  posAttr: THREE.BufferAttribute;
  uvAttr: THREE.BufferAttribute;
}

/** 弹体（原版 `cASSAPARTSHOT` 的 SPARK 分支） */
interface BoltState {
  pos: THREE.Vector3;     // 世界单位
  vel: THREE.Vector3;     // 世界单位/帧
  trace: THREE.Vector3[]; // 最新在头部
  frame: number;
  arrived: boolean;
  expired: boolean;
}

/** 溅射火花（原版 `cASSAPARTSPARK`） */
interface SparkState {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  dest: THREE.Vector3;
  trace: THREE.Vector3[];
  frame: number;
  expired: boolean;
}

interface LiveBolt {
  root: THREE.Group;
  bolt: BoltState;
  boltRibbon: Ribbon | null;
  sparks: SparkState[] | null;   // null = 还没到达
  sparkRibbons: (Ribbon | null)[];
  at: { x: number; y: number; z: number };
}

const live: LiveBolt[] = [];
let frameAcc = 0;
let texCache: THREE.Texture | null = null;
/** 共享材质（加法混合；贴图由 `setDivineLightningTexture` 注入，晚到也自动补上） */
let sharedMat: THREE.MeshBasicMaterial | null = null;
let dynSink: DivineFxSink['dynLights'] = null;
let partSink: DivineFxSink['spawnPart'] = null;
let camRef: THREE.Camera | null = null;
let reportedNoCam = false;

function materialOf(): THREE.MeshBasicMaterial {
  if (!sharedMat) {
    sharedMat = new THREE.MeshBasicMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,   // `SMMAT_BLEND_LAMP`
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }
  if (texCache && sharedMat.map !== texCache) {
    sharedMat.map = texCache;
    sharedMat.needsUpdate = true;
  }
  return sharedMat;
}

/**
 * 建（惰性）或更新一条拖尾带 —— **顶点原地写**，段数用 drawRange；点数 <2 时隐藏。
 *
 * ⚠ 横向 = `normalize(cross(viewDir, segDir))`（**相机朝向带**，2026-09-27 修）：
 *   第一版用 `cross(segDir, up)` 的水平投影 ⇒ **竖直段（弹体下落正是竖直的）横向恒 (0,0)**，
 *   带子两侧顶点重合成零宽度 ⇒ 一个像素都不画 —— 用户实测"没有从天而降的雷"的真根因。
 *   原版 `AssaAddFaceTrace`（`AssaUtil.cpp:895`）在**相机空间**取垂直（`persp = (-dy, +dx)`，
 *   dx/dy 是 `AssaGetCameraCoord` 之后的 2D 分量）⇒ 竖直线投影后两分量都在、不退化；
 *   本实现用世界空间的 `cross(viewDir, segDir)` 表达同一语义。段方向 ∥ 视线时回退 `cross(segDir, up)`。
 */
function updateRibbon(root: THREE.Group, existing: Ribbon | null, trace: THREE.Vector3[], halfWidthWU: number,
                      viewDir: THREE.Vector3): Ribbon | null {
  if (trace.length < 2) {
    if (existing) existing.mesh.visible = false;
    return existing;
  }
  let r = existing;
  if (!r) {
    const geo = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(new Float32Array(TRACE_LENGTH * 2 * 3), 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    const uvAttr = new THREE.BufferAttribute(new Float32Array(TRACE_LENGTH * 2 * 2), 2);
    geo.setAttribute('position', posAttr);
    geo.setAttribute('uv', uvAttr);
    const idx: number[] = [];
    for (let c = 0; c + 1 < TRACE_LENGTH; c++) {
      const a = c * 2, b = c * 2 + 1, d = c * 2 + 2, e = c * 2 + 3;
      idx.push(a, b, e, a, e, d);
    }
    geo.setIndex(idx);
    geo.setDrawRange(0, 0);
    const mesh = new THREE.Mesh(geo, materialOf());
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;   // 顶点直接写世界坐标，mesh 自身零变换
    root.add(mesh);                  // ⚠ 建了就要挂载（第一版重写时漏了这行 ⇒ 一条带都画不出来）
    r = { mesh, geo, posAttr, uvAttr };
  }
  const n = Math.min(trace.length, TRACE_LENGTH);
  const UP = new THREE.Vector3(0, 1, 0);
  const seg = new THREE.Vector3();
  const lat = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const p = trace[i]!;
    const prev = trace[Math.max(0, i - 1)]!;
    const next = trace[Math.min(n - 1, i + 1)]!;
    seg.set(next.x - prev.x, next.y - prev.y, next.z - prev.z);
    if (seg.lengthSq() === 0) seg.set(0, -1, 0);   // 重复点（静止段）：按"向下"处理，与弹体主方向一致
    lat.crossVectors(viewDir, seg.normalize());
    if (lat.lengthSq() < 1e-6) lat.crossVectors(seg, UP);   // 段 ∥ 视线：回退水平垂直
    lat.normalize().multiplyScalar(halfWidthWU);
    r.posAttr.setXYZ(i * 2, p.x - lat.x, p.y - lat.y, p.z - lat.z);
    r.posAttr.setXYZ(i * 2 + 1, p.x + lat.x, p.y + lat.y, p.z + lat.z);
    const v = i / (n - 1);
    r.uvAttr.setXY(i * 2, 0, v);
    r.uvAttr.setXY(i * 2 + 1, 1, v);
  }
  r.posAttr.needsUpdate = true;
  r.uvAttr.needsUpdate = true;
  r.geo.setDrawRange(0, (n - 1) * 6);
  r.geo.computeBoundingSphere();
  r.mesh.visible = true;
  return r;
}

/** 释放一条带（从 root 摘 mesh + 释放几何；材质共享不释放） */
function disposeRibbon(r: Ribbon | null): null {
  if (r) {
    r.mesh.removeFromParent();
    r.geo.dispose();
  }
  return null;
}

/** 弹体一帧（`cASSAPARTSHOT::Main` SPARK 分支 :503-556 逐字；长度单位 = 世界单位） */
function stepBolt(b: LiveBolt): void {
  const s = b.bolt;
  if (s.expired) return;
  if (s.frame >= BOLT_MAX_FRAMES) {
    s.expired = true;              // 到点整个实例删掉（带子随实例消失）
    return;
  }
  const des = new THREE.Vector3(b.at.x, b.at.y + BOLT_END_LIFT_RAW / FONE, b.at.z);
  // ⚠ 坐标已是**世界单位**，不再除 FONE（原版那次除法是"定点 raw → 浮点"，我们没有定点层；
  //   第一版重写多除了一次 ⇒ 距离缩水 256 倍，第 1 帧就"到达"）
  const term = des.clone().sub(s.pos);
  const length = term.length();
  s.trace.unshift(s.pos.clone());
  if (s.trace.length > TRACE_LENGTH) s.trace.length = TRACE_LENGTH;
  if (length < ARRIVE_DIST_WU && !s.arrived) {
    s.arrived = true;
    onGround(b, des);
  }
  const unit = term.divideScalar(length || 1);
  s.vel.add(unit);
  if (length < SOFT_DIST_WU) s.vel.multiplyScalar(0.8);
  s.pos.add(s.vel);
  s.frame++;
}

/** 火花一帧（`cASSAPARTSPARK::Start/:Main` :949-1035 逐字） */
function stepSpark(s: SparkState): void {
  if (s.expired) return;
  if (s.frame >= SPARK_MAX_FRAMES) {
    s.expired = true;
    return;
  }
  // `MainAssaEffect` 外层 `Time++` 之后才进 Main ⇒ 拖尾条件看到的是 +1 后的奇偶；
  // 本实现用 `frame % 2 === 0` 表达同一件事（frame = 帧首的 Time）。之后 Main 尾部再 +1，
  // 与外层合成**每帧 +2** ⇒ 寿命 = (150 − T0)/2 帧。
  if (s.frame % 2 === 0) {
    s.trace.unshift(s.pos.clone());
    if (s.trace.length > TRACE_LENGTH) s.trace.length = TRACE_LENGTH;
  }
  const term = s.dest.clone().sub(s.pos);   // 世界单位，同上
  const length = term.length() || 1;
  s.vel.add(term.divideScalar(length));
  if (length < SPARK_SOFT_DIST_WU) s.vel.multiplyScalar(0.8);
  s.pos.add(s.vel);
  s.frame += 2;
}

/** 到地三件套（原版 `AssaParticle_Sprak`，`hoAssaParticleEffect.cpp:695-712` 逐字） */
function onGround(b: LiveBolt, arrival: THREE.Vector3): void {
  const list: SparkState[] = [];
  for (let i = 0; i < SPARK_COUNT; i++) {
    // `Posi = *pCurPosi`（到达点，不抖）；`DesPosi = Posi − 5000y ± 1000xz`（抖动在**终点**）
    const pos = arrival.clone();
    const dest = new THREE.Vector3(
      pos.x + (Math.random() * 2 - 1) * (SPARK_JITTER_RAW / FONE),
      pos.y - SPARK_DROP_RAW / FONE,
      pos.z + (Math.random() * 2 - 1) * (SPARK_JITTER_RAW / FONE),
    );
    const dirX = Math.random() < 0.5 ? -1 : 1;
    const dirZ = Math.random() < 0.5 ? -1 : 1;
    const vel = new THREE.Vector3(
      dirX * (SPARK_SPEED_MIN + Math.random() * (SPARK_SPEED_MAX - SPARK_SPEED_MIN)),
      SPARK_VY_MIN + Math.random() * (SPARK_VY_MAX - SPARK_VY_MIN),   // ⚠ 初速**向上**（源码如此）
      dirZ * (SPARK_SPEED_MIN + Math.random() * (SPARK_SPEED_MAX - SPARK_SPEED_MIN)),
    );
    // `partSpark->Time = GetRandomPos(0, 20)` 起跳；每帧 +2（外层 ++ + Main 尾部 ++）
    // ⇒ 寿命 (150−T0)/2 帧；拖尾看 `Time%2`（外层 ++ 后）＝ T0 偶才有（奇偶恒定，引擎怪癖照抄）
    list.push({ pos, vel, dest, trace: [], frame: Math.floor(Math.random() * (SPARK_TIME_SEED_MAX + 1)), expired: false });
  }
  b.sparks = list;
  b.sparkRibbons = list.map(() => null);
  // 白动态光
  const d = SPARK_DYN_LIGHT;
  dynSink?.set(arrival.x, arrival.y, arrival.z, d.r, d.g, d.b, d.a, d.power, d.decPower);
  // `.part`（白→蓝火花 + BackLight + FireJet）
  void partSink?.(DIVINE_LIGHTNING_PART, { pos: { x: arrival.x, y: arrival.y, z: arrival.z } });
}

/** 起一记落雷（`at` = 目标**脚底**世界坐标）—— 自机与旁观者共用（AGENTS #15） */
export function runDivineLightning(deps: DivineFxSink, at: { x: number; y: number; z: number }): void {
  if (!deps.scene) {
    reportFallback('skillfx', 'Divine Lightning：调用方没给 scene ⇒ 不放');
    return;
  }
  const root = new THREE.Group();
  root.matrixAutoUpdate = false;
  deps.scene.add(root);
  const b: LiveBolt = {
    root,
    bolt: {
      pos: new THREE.Vector3(at.x, at.y + BOLT_START_LIFT_RAW / FONE, at.z),
      vel: new THREE.Vector3(),
      trace: [], frame: 0, arrived: false, expired: false,
    },
    boltRibbon: null,
    sparks: null,
    sparkRibbons: [],
    at: { ...at },
  };
  live.push(b);
  deps.log?.(`  ⚡ Divine Lightning 落雷：起点高 ${(BOLT_START_LIFT_RAW / FONE).toFixed(0)}，目标 (${at.x.toFixed(1)},${at.y.toFixed(1)},${at.z.toFixed(1)})`);
}

/** 渲染依赖注入（`dynLights`/`spawnPart`/`camera`；幂等） */
export function configureDivineLightning(deps: Pick<DivineFxSink, 'dynLights' | 'spawnPart'> & {
  /** 相机（拖尾带的横向 = `cross(视线, 段方向)` —— 对**竖直**段也非零；缺它 ⇒ 带**不画**并上报） */
  camera?: THREE.Camera | null;
}): void {
  dynSink = deps.dynLights ?? null;
  partSink = deps.spawnPart ?? null;
  camRef = deps.camera ?? null;
}

/** 每帧调（**70fps** 帧轴 —— Assa 心跳，见文件头；与 multi-spark 的 60fps 轴**不同**，别抄错） */
export function updateDivineLightningRunners(dt: number): void {
  if (live.length === 0) return;
  frameAcc += dt * ASSA_FPS;
  const n = Math.floor(frameAcc);
  if (n <= 0) return;
  frameAcc -= n;
  // 视线方向（原版在相机空间展开 ⇒ 这里同样按相机取）；缺相机 ⇒ 上报一次并不画（不静默）
  const viewDir = new THREE.Vector3();
  let haveView = false;
  if (camRef) { camRef.getWorldDirection(viewDir); haveView = true; }
  else if (!reportedNoCam) {
    reportedNoCam = true;
    reportFallback('skillfx', 'Divine Lightning：没注入相机 ⇒ 拖尾带无法定向（cross(视线,段方向)），本次不画');
  }
  for (let i = live.length - 1; i >= 0; i--) {
    const b = live[i]!;
    for (let k = 0; k < n; k++) {
      stepBolt(b);
      if (b.sparks) for (const s of b.sparks) stepSpark(s);
    }
    // 带子原地更新（弹体到点 ⇒ 当场消失；火花各自到点 ⇒ 各自消失）
    if (haveView) {
      b.boltRibbon = b.bolt.expired ? disposeRibbon(b.boltRibbon)
        : updateRibbon(b.root, b.boltRibbon, b.bolt.trace, BOLT_TRACE_WIDTH_RAW / 2 / FONE, viewDir);
      if (b.sparks) {
        for (let si = 0; si < b.sparks.length; si++) {
          const s = b.sparks[si]!;
          b.sparkRibbons[si] = s.expired ? disposeRibbon(b.sparkRibbons[si] ?? null)
            : updateRibbon(b.root, b.sparkRibbons[si] ?? null, s.trace, SPARK_TRACE_WIDTH_RAW / 2 / FONE, viewDir);
        }
      }
    }
    // 全部结束（弹体到点 + 火花都到点）⇒ 摘实例
    if (b.bolt.expired && (!b.sparks || b.sparks.every((s) => s.expired))) {
      disposeRibbon(b.boltRibbon);
      if (b.sparkRibbons) for (const sr of b.sparkRibbons) disposeRibbon(sr);
      b.root.removeFromParent();
      live.splice(i, 1);
    }
  }
}

/** 场景销毁时清干净（换图/退出；调用方负责） */
export function clearDivineLightning(): void {
  for (const b of live) {
    disposeRibbon(b.boltRibbon);
    if (b.sparkRibbons) for (const sr of b.sparkRibbons) disposeRibbon(sr);
    b.root.removeFromParent();
  }
  live.length = 0;
}

/** 贴图注入（PT 加密 BMP 解码成 DataTexture 后交给这里；晚到也自动补上） */
export function setDivineLightningTexture(tex: THREE.Texture): void {
  texCache = tex;
}

/** 自检用：当前存活实例数与溅射火花总数 */
export function divineLightningStats(): { live: number; sparks: number } {
  let sparks = 0;
  for (const b of live) if (b.sparks) sparks += b.sparks.length;
  return { live: live.length, sparks };
}
