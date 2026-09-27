/**
 * 祭司 T2.2 **神之雷电（Divine Lightning）**的表现层 —— `code:divinelightning`。
 *
 * ## ⚠ 源码事实（本机可复算，两棵树一致：`NewSourcePT-2023/SrcGame/src` 与 `ex-machina`）
 *
 * 触发链（`character.cpp:16272-16300`，`EventSkill()` 的 `case SKILL_PLAY_DIVINE_LIGHTNING`）：
 *   ① 自机分支：`dm_SelectDamageCount(...)` 选敌 + `dm_SendRangeDamage(...)` 结算（**选敌与结算在客户端**）；
 *   ② **两种身份都走** `SkillPlay_DivineLightning_Effect(this, point)`（`netplay.cpp:12463`）——
 *      · 施法者是本机：对 `dm_SelectDamageCount` 记下的 **`dwSkill_DivineLightning_Target[]` 表**逐个放；
 *      · 施法者是**别人**（旁观者）：**本地重选** —— 以施法者为中心 160 单位内
 *        扫 `Divine_Lightning_Num[point-1]` 个敌人（从 `DivineLightning_FindCount` 轮转位继续），
 *        扫满或扫完为止；不足时把**自己（lpCurPlayer）**补作最后一个目标。
 *      ③ 打中了几个（>0）就 `rand()%3` 三选一播 `DIVINELIGHTNING1/2/3` 音。
 *
 * ## 每个目标身上放什么（`AssaParticle_DivineLighting`，`hoAssaParticleEffect.cpp:654-671` 逐字）
 *
 * ```
 * curPos = (pX, pY + 100000, pZ)      // 天上：100000/256 ≈ 390 单位高
 * desPos = (pX, pY + 5000,  pZ)       // 头顶：5000/256  ≈ 19.5 单位
 * partShot->Start(&curPos, &desPos, ASSA_SHOT_SPARK);
 * ```
 *
 * **ASSA_SHOT_SPARK 的行为**（`AssaParticle.cpp`，`(cur,dest,type)` 版 `Start` :786-820 + `Main` :503-556）：
 *   · **追踪弹**：每帧朝 `DesPosi` 方向**加速**（`Velocity += 单位方向`，位移 `Velocity * fONE`）；
 *     距离 <80 时速度 ×0.8（软着陆）；`Max_Time = 50` 帧强制过期；
 *   · **贴图** `spark01_01.bmp`（`SMMAT_BLEND_LAMP` 加法）、`Face.width = 8000`、白色 α255；
 *   · **拖尾**：每帧 `cAssaTrace->AddData(&Posi)`（`cASSATrace` 长度 50 的位置历史），
 *     绘制用 `AssaAddFaceTrace`（`AssaUtil.cpp:895`）沿历史拉出一条**带宽 8000/2=4000 定点**
 *     （= 15.6 世界单位宽）的加法光带，UV 沿历史均分；
 *   · **到达**（距离 <10、State 0→1）：`AssaParticle_Sprak(&DesPosi)`（`:695-712`）——
 *     **5 颗** `cASSAPARTSPARK`（各自朝随机方向溅射的火花，寿命 150 帧、初相位 `rand 0..20` 帧）
 *     + **白动态光** `SetDynLight(255,255,255, 255, 100, 2)`
 *     + **`g_NewParticleMgr.Start("DivineLightning", pos)`** —— 即资产根
 *     `effect/particle/script/divinelightning.part`（清单已在 `effect-names.generated.json`，
 *     5 个 emitter：白→蓝火花 40 颗 / 两层 BackLight 大光斑 / Spaceship Debris 5 颗 / FireJet 6 颗）。
 *
 * `cASSAPARTSPARK`（`AssaParticle.h:47` + `:949-1035`）：从落点朝 `DesPosi`（自身 −5000 高度 +
 * ±1000 水平抖动，即**向下外溅**）加速飞行；`Time % 2` 往 trace 里塞点（同样拖尾，宽 4000）。
 *
 * ## 我方实现
 *
 * * **弹体 + 拖尾**：同一个驱动器（`updateDivineLightningRunners`，WorldView 每帧调）按上面的
 *   加速/软化/到达公式推进；拖尾用 **trace 环形历史 + 带宽三角带**重建（原版 `AssaAddFaceTrace`
 *   就是"沿历史点各横向展开 ±width/2 再连三角带"，见 `weapon-trail` 的同构实现）。
 *   贴图 `effect/assaeffect/deadlay/spark01_01.bmp`（144×768，`AssaSearchRes` 从
 *   `Effect\AssaEffect\**` 收集的正是它；`image/Sinimage/AssaEffect` 下没有同名文件）。
 * * **落地三件套**：5 颗溅射火花（同一驱动器，带 `Time % 2` 的拖尾间隔）+ 白动态光（`dyn-light`
 *   池，参数逐字）+ `part:divinelightning`（走 `ctx.spawnPart`，与数据侧 `part:` 同名）。
 * * **目标表**：**服务端结算返回的目标列表随 `S2C_AttackResult` 逐个到达**（每目标一条、带
 *   `attacker_id/skill_id`），旁观者据此对**同一个怪物 id** 放落雷 —— 与自机共用一份实现
 *   （AGENTS #15），**不重跑本地选敌**（原版旁观者本地重选是为了在没有服务端的单机里表现；
 *   我们的服务端权威选敌结果就是"哪几个目标"的事实，AGENTS #14 同步结果）。
 * * **音效**：三选一 —— `skill-fx.json` 的 `event.sfx` 已含 `divinelightning 1.wav`；
 *   ⚠ 源码是 `rand()%3` 三条（`divinelightning 1/2/3.wav`），数据侧只登记了 1 条
 *   ⇒ 现按数据播 1 条（不编另外两条的文件名）；变体缺口已在 AGENTS #105 登记。
 */
import * as THREE from 'three';
import { reportFallback } from '../../char/fallback-log.js';

/* ── 原版常量（出处见文件头；raw = 定点，256/单位） ── */
/** `pChar->pY + 100000`（`:560`）—— 起点：天上 */
export const BOLT_START_LIFT_RAW = 100000;
/** `desPos.y = pChar->pY + 5000`（`:564`）—— 终点：目标头顶 */
export const BOLT_END_LIFT_RAW = 5000;
/** `Max_Time = 50`（`AssaParticle.cpp:818`）—— 弹体寿命上限（60fps 帧） */
export const BOLT_MAX_FRAMES = 50;
/** `Face.width = 8000`（`:800`）—— 弹体光带宽（定点/2 = 4000 ⇒ 15.6 单位） */
export const BOLT_TRACE_WIDTH_RAW = 8000;
/** `cASSATrace` 的历史长度（`AssaUtil.h:20` `Length = 50`） */
export const TRACE_LENGTH = 50;
/** 到达判定 `length < 10`（定点距离，`AssaParticle.cpp:524`） */
const ARRIVE_DIST_F = 10;
/** 软化 `length < 80 ⇒ Velocity *= 0.8`（`:536-539`） */
const SOFT_DIST_F = 80;
/** 溅射火花：`Max_Time = 150`、`DesPosi.y -= 5000`、水平 ±1000、初速各轴 `rand 10..18`（`AssaParticle.cpp:949-971`） */
export const SPARK_COUNT = 5;
const SPARK_MAX_FRAMES = 150;
const SPARK_DROP_RAW = 5000;
const SPARK_JITTER_RAW = 1000;
const SPARK_SPEED_MIN = 10, SPARK_SPEED_MAX = 18;
const SPARK_TRACE_WIDTH_RAW = 4000;   // `Face.width = 4000`（`:986`）
/** `AssaParticle_Sprak`：白动态光 `SetDynLight(255,255,255, 255,100,2)`（`hoAssaParticleEffect.cpp:710`） */
export const SPARK_DYN_LIGHT = { r: 255, g: 255, b: 255, a: 255, power: 100, decPower: 2 } as const;
/** 弹体/火花贴图（`AssaSearchRes("spark01_01.bmp", SMMAT_BLEND_LAMP)`，:807）—— 资产根路径 */
export const SPARK_TEXTURE = 'effect/assaeffect/deadlay/spark01_01.bmp';
/** 落地 `.part`（`g_NewParticleMgr.Start("DivineLightning", …)`，:711） */
export const DIVINE_LIGHTNING_PART = 'divinelightning';

const FONE = 256;

/* ── 渲染依赖（`runDivineLightning` 注入） ── */
export interface DivineFxSink {
  scene: THREE.Scene;
  /** 动态光池（原版 `SetDynLight`） */
  dynLights?: { set: (x: number, y: number, z: number, r: number, g: number, b: number, a: number, power: number, decPower: number) => unknown } | null;
  /** 按名起 `.part`（`EffectManager.spawn`；`divinelightning` 在清单里） */
  spawnPart?: ((name: string, opts: { pos: { x: number; y: number; z: number } }) => Promise<boolean> | null) | null;
  log?: (msg: string) => void;
}

interface BoltSpec {
  /** 落点 = 目标（脚底；终点在其上方 `BOLT_END_LIFT_RAW/FONE`） */
  at: { x: number; y: number; z: number };
}

/** 一条活着的落雷（弹体 + 到达后的溅射火花共用同一份 trace 渲染物） */
interface LiveBolt {
  root: THREE.Group;
  mats: THREE.Material[];
  geos: THREE.BufferGeometry[];
  /** 弹体状态（原版 `Posi/Velocity/State/Time`）—— 定点坐标用世界单位浮点表达 */
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  arrived: boolean;
  frame: number;
  /** 弹体拖尾历史（最新在头部；原版 `cAssaTrace.AddData` push_front + 超长丢尾） */
  trace: THREE.Vector3[];
  /** 溅射火花（到达后生成；`null` = 弹体还没到） */
  sparks: Array<{
    pos: THREE.Vector3;
    vel: THREE.Vector3;
    trace: THREE.Vector3[];
    frame: number;
    delay: number;
  }> | null;
  /** 已通知过落地三件套 */
  grounded: boolean;
  spec: BoltSpec;
}

const live: LiveBolt[] = [];
let frameAcc = 0;
let texCache: THREE.Texture | null = null;

/** trace 历史 → 三角带几何（原版 `AssaAddFaceTrace` 的带状重建：沿历史各点横向展开 ±width/2） */
function buildTraceGeometry(trace: THREE.Vector3[], width: number): THREE.BufferGeometry | null {
  // 原版 `AssaAddFaceTrace`：点数 <2 没有带子；相机空间展开在这里退化成"屏幕朝向的横向"——
  // 我们没有相机空间，改用**相邻段的水平垂直向量**（世界空间），加法混合下观感一致；
  // 视角差异属已知近似（原版每帧按当前相机重建，我们也是每帧重建，只是横向取世界向量）。
  if (trace.length < 2) return null;
  const pos = new Float32Array(trace.length * 2 * 3);
  const uv = new Float32Array(trace.length * 2 * 2);
  const half = width / 2 / FONE;   // 定点宽 → 每侧世界单位
  for (let i = 0; i < trace.length; i++) {
    const p = trace[i]!;
    const prev = trace[Math.max(0, i - 1)]!;
    const next = trace[Math.min(trace.length - 1, i + 1)]!;
    // 段方向（取邻点平均，首尾用单侧），横向 = 方向 × up 的水平垂直
    const dx = next.x - prev.x, dy = next.y - prev.y, dz = next.z - prev.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    // 横向 = dir × (0,1,0) 的水平分量归一（闪电带不需要精确 billboard，加法混合 + 羽化即可）
    let px = dz / len, pz = -dx / len;
    const pl = Math.hypot(px, pz) || 1;
    px /= pl; pz /= pl;
    pos[(i * 2) * 3 + 0] = p.x - px * half;
    pos[(i * 2) * 3 + 1] = p.y;
    pos[(i * 2) * 3 + 2] = p.z - pz * half;
    pos[(i * 2 + 1) * 3 + 0] = p.x + px * half;
    pos[(i * 2 + 1) * 3 + 1] = p.y;
    pos[(i * 2 + 1) * 3 + 2] = p.z + pz * half;
    const v = i / (trace.length - 1);
    uv[(i * 2) * 2 + 0] = 0; uv[(i * 2) * 2 + 1] = v;
    uv[(i * 2 + 1) * 2 + 0] = 1; uv[(i * 2 + 1) * 2 + 1] = v;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const idx: number[] = [];
  for (let c = 0; c + 1 < trace.length; c++) {
    const a = c * 2, b = c * 2 + 1, d = c * 2 + 2, e = c * 2 + 3;
    idx.push(a, b, e, a, e, d);
  }
  geo.setIndex(idx);
  return geo;
}

/** 弹体的一帧推进（原版 `cASSAPARTSHOT::Main` 的 SPARK 分支 :503-556 逐字） */
function stepBolt(b: LiveBolt): 'flying' | 'arrived' | 'expired' {
  const des = new THREE.Vector3(b.spec.at.x, b.spec.at.y + BOLT_END_LIFT_RAW / FONE, b.spec.at.z);
  if (b.frame >= BOLT_MAX_FRAMES) return 'expired';
  const term = des.clone().sub(b.pos).divideScalar(FONE);
  const length = term.length() || 1;
  b.trace.unshift(b.pos.clone());
  if (b.trace.length > TRACE_LENGTH) b.trace.length = TRACE_LENGTH;
  if (length * FONE < ARRIVE_DIST_F && !b.arrived) {
    b.arrived = true;
    return 'arrived';
  }
  const unit = term.divideScalar(length);
  b.vel.add(unit);
  if (length * FONE < SOFT_DIST_F) b.vel.multiplyScalar(0.8);
  b.pos.addScaledVector(b.vel, 1);   // `Posi += Velocity * fONE`（世界单位制）
  b.frame++;
  return 'flying';
}

/** 溅射火花的一帧推进（原版 `cASSAPARTSPARK::Start/:Main` :949-1035） */
function stepSpark(s: LiveBolt['sparks'] extends (infer S)[] | null ? S : never): 'flying' | 'expired' {
  if (s.frame >= SPARK_MAX_FRAMES) return 'expired';
  const des = s.pos.clone().add(
    new THREE.Vector3(0, -SPARK_DROP_RAW / FONE, 0)); // DesPosi = 自身下方 5000（含起手抖动）
  if (s.frame % 2 === 1) {   // `Time % 2` 才记拖尾（:1010）
    s.trace.unshift(s.pos.clone());
    if (s.trace.length > TRACE_LENGTH) s.trace.length = TRACE_LENGTH;
  }
  const term = des.clone().sub(s.pos).divideScalar(FONE);
  const length = term.length() || 1;
  s.vel.add(term.divideScalar(length));
  if (length * FONE < 60) s.vel.multiplyScalar(0.8);
  s.pos.addScaledVector(s.vel, 1);
  s.frame++;
  return 'flying';
}

/** 起一记落雷（`at` = 目标**脚底**世界坐标）—— 自机与旁观者共用（AGENTS #15） */
export function runDivineLightning(deps: DivineFxSink, at: { x: number; y: number; z: number }): void {
  if (!deps.scene) {
    reportFallback('skillfx', 'Divine Lightning：调用方没给 scene ⇒ 不放');
    return;
  }
  const root = new THREE.Group();
  root.frustumCulled = false;
  deps.scene.add(root);
  const b: LiveBolt = {
    root, mats: [], geos: [],
    pos: new THREE.Vector3(at.x, at.y + BOLT_START_LIFT_RAW / FONE, at.z),
    vel: new THREE.Vector3(),
    arrived: false, frame: 0,
    trace: [], sparks: null, grounded: false,
    spec: { at: { ...at } },
  };
  live.push(b);
  deps.log?.(`  ⚡ Divine Lightning 落雷：起点高 ${(BOLT_START_LIFT_RAW / FONE).toFixed(0)}，目标 (${at.x.toFixed(1)},${at.y.toFixed(1)},${at.z.toFixed(1)})`);
}

/** 每帧调（WorldView 帧循环，60fps 帧轴 —— 与 multi-spark 同一模式） */
export function updateDivineLightningRunners(dt: number): void {
  if (live.length === 0) return;
  frameAcc += dt * 60;
  const n = Math.floor(frameAcc);
  if (n <= 0) return;
  frameAcc -= n;
  for (let i = live.length - 1; i >= 0; i--) {
    const b = live[i]!;
    for (let k = 0; k < n; k++) {
      const st = stepBolt(b);
      if (st === 'arrived' && !b.grounded) {
        b.grounded = true;
        onGround(b);
      }
      if (st === 'expired' && !b.grounded) {
        // 50 帧没追上（理论上不会：直线下落）—— 原版直接 memset；我们同样静默收掉带子
        b.grounded = true;
      }
      if (b.sparks) {
        for (const s of b.sparks) stepSpark(s);
      }
    }
    // 重建带子几何（弹体 + 溅射火花各自一条）
    for (const g of b.geos) g.dispose();
    b.geos.length = 0;
    const rebuild = (trace: THREE.Vector3[], width: number): void => {
      const geo = buildTraceGeometry(trace, width);
      if (!geo) return;
      const mat = new THREE.MeshBasicMaterial({
        map: texCache ?? undefined,
        transparent: true,
        blending: THREE.AdditiveBlending,   // `SMMAT_BLEND_LAMP`
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      b.mats.push(mat);
      b.geos.push(geo);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      b.root.add(mesh);
    };
    if (!b.grounded || b.trace.length >= 2) rebuild(b.trace, BOLT_TRACE_WIDTH_RAW);
    if (b.sparks) for (const s of b.sparks) rebuild(s.trace, SPARK_TRACE_WIDTH_RAW);
    // 收尾：弹体已过 + 全部火花过期 ⇒ 撤
    const sparksDone = !b.sparks || b.sparks.every((s) => s.frame >= SPARK_MAX_FRAMES);
    if (b.grounded && sparksDone && b.trace.length < 2) {
      b.root.removeFromParent();
      for (const g of b.geos) g.dispose();
      for (const m of b.mats) m.dispose();
      live.splice(i, 1);
    }
  }
}

/** 到地三件套（原版 `AssaParticle_Sprak`，`hoAssaParticleEffect.cpp:695-712` 逐字） */
function onGround(b: LiveBolt): void {
  const at = {
    x: b.spec.at.x,
    y: b.spec.at.y + BOLT_END_LIFT_RAW / FONE,   // `&DesPosi` = 目标头顶
    z: b.spec.at.z,
  };
  // ① 5 颗溅射火花（初相位 `GetRandomPos(0,20)` 帧 —— 随机量，注入点在此）
  b.sparks = [];
  for (let i = 0; i < SPARK_COUNT; i++) {
    const dirX = Math.random() < 0.5 ? -1 : 1;
    const dirZ = Math.random() < 0.5 ? -1 : 1;
    const pos = new THREE.Vector3(
      at.x + (Math.random() * 2 - 1) * (SPARK_JITTER_RAW / FONE),
      at.y,
      at.z + (Math.random() * 2 - 1) * (SPARK_JITTER_RAW / FONE),
    );
    b.sparks.push({
      pos,
      vel: new THREE.Vector3(
        dirX * (SPARK_SPEED_MIN + Math.random() * (SPARK_SPEED_MAX - SPARK_SPEED_MIN)),
        SPARK_SPEED_MIN + Math.random() * (SPARK_SPEED_MAX - SPARK_SPEED_MIN),
        dirZ * (SPARK_SPEED_MIN + Math.random() * (SPARK_SPEED_MAX - SPARK_SPEED_MIN)),
      ),
      trace: [],
      frame: Math.floor(Math.random() * 21),   // `partSpark->Time = GetRandomPos(0, 20)`
      delay: 0,
    });
  }
  // ② 白动态光
  const d = SPARK_DYN_LIGHT;
  dynSink?.set(at.x, at.y, at.z, d.r, d.g, d.b, d.a, d.power, d.decPower);
  // ③ `.part`（白→蓝火花 + BackLight + FireJet —— 数据在 divinelightning.part）
  void partSink?.(DIVINE_LIGHTNING_PART, { pos: at });
}

/** 动态光 / spawnPart 的注入点（`runDivineLightning` 之后由调用方设置；避免每次调用带一堆闭包） */
let dynSink: DivineFxSink['dynLights'] = null;
let partSink: DivineFxSink['spawnPart'] = null;

/** `runDivineLightning` 时把渲染依赖一并交给驱动器（与 multi-spark-runner 同款） */
export function configureDivineLightning(deps: Pick<DivineFxSink, 'dynLights' | 'spawnPart'>): void {
  dynSink = deps.dynLights ?? null;
  partSink = deps.spawnPart ?? null;
}

/** 场景销毁时清干净（换图/退出；调用方负责） */
export function clearDivineLightning(): void {
  for (const b of live) {
    b.root.removeFromParent();
    for (const g of b.geos) g.dispose();
    for (const m of b.mats) m.dispose();
  }
  live.length = 0;
}

/** 贴图（延迟加载；`SPARK_TEXTURE` 加法混合） */
export function setDivineLightningTexture(tex: THREE.Texture): void {
  texCache = tex;
}
