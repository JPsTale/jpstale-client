/**
 * 祭司 T1.2 **神圣弹（Holy Bolt）**的表现层 —— `code:holybolt`。
 *
 * ## ⚠ 源码事实（本机可复算：`NewSourcePT-2023/SrcGame/src`）
 *
 * 触发链（`character.cpp:13946-13957`，`EventSkill()` 的 `case SKILL_PLAY_HOLY_BOLT` ——
 * **每个角色**的逐帧更新都跑，自机与旁观者同一份；我们由 `fireSkillEventFrame` 的
 * `event.fx = ["code:holybolt"]` 驱动，音效 `holybolt 1.wav` 在同一行的 `event.sfx`，此处不播）：
 *
 * ```c
 * if (chrAttackTarget) {
 *     GetMoveLocation(0, 24*fONE, 24*fONE, 0, Angle.y, 0);      // 起点 = 施法者 + 前方24 + 上方24
 *     StartEffectMonsterDest(pX+GeoResult_X, pY+GeoResult_Y, pZ+GeoResult_Z,
 *         chrAttackTarget->pX, chrAttackTarget->pY + 20*fONE, chrAttackTarget->pZ,
 *         MONSTER_MEPHIT_SHOT2);                                 // 终点 = 目标身上 +20
 *     SkillPlaySound(SKILL_SOUND_SKILL_HOLYBOLT, pX, pY, pZ);
 * }
 * ```
 *
 * ## 飞行的球（`StartEffectMonsterDest` → `HoEffect.cpp:8581` case MONSTER_MEPHIT_SHOT2）
 *
 * `HoEffectTracker`（:10212 起，:10000 `Main`）+ `HoParticleSystem`（`HoParticle.cpp:236-283`）：
 * · **飞行**：`V = (dest−start)/|…| × 1300`（raw/帧，:10300 附近那支 MEPHIT/IMP 共用分支）；
 *   到达判定（`Main` :10060-10100）：`length² < 800²` ⇒ 到站；`length² < 1000²` 起开始计
 *   `liveCount`，`liveCount > 3` 也到站（步长 5.08/帧 > 3.125 的到达窗，快弹会**跳过**到达窗
 *   —— 那条"3 帧武装"就是为这个存在的，照抄）；
 * · **外观**（`HoParticle.cpp`）：`MaterialNum[3]` = **`Effect\ImageData\Particle\Blue.tga`**
 *   （`HoEffect.cpp:3044` 的材质表第 3 格，我方资产根在位 ✓）；ColorStart (230,250,250) →
 *   ColorEnd (0,0,0)、Alpha 200→0、Size 6→0.5（`SHOT2 专属 SizeStart=6`，:261）、
 *   寿命 `Life = 0.005s`、`ParticlesPerSec = EngineFps×10`（70fps ⇒ **每帧 10 颗**）、
 *   `Theta=180` 但 `Direction=(0,0,0)` ⇒ **初速为零**：粒子原地生灭（≤1 帧）——
 *   观感 = 弹头处每帧换一批的亮团（"彗星头"），照抄；
 *   ⚠ 尺寸单位按 `HoParticle` 的 `MIN_SIZE 2 / MAX_SIZE 20` 钳制（`HoParticle.h:15/24`）读作
 *   **世界单位**（钳制值只有在这个量级才有意义；multispark 球 3000 raw = 11.7 同量级）。
 *   若实机偏大/偏小，调 `SHOT_SIZE_START_WU` 并把结论写回这里（Pike Wind 半径的先例）。
 *
 * ## 到站爆裂（`HoEffect.cpp:9430-9535`，case MONSTER_MEPHIT_HIT1/HIT2 —— HOLY_BOLT 走 **HIT2**）
 *
 * ① **10 条细光痕**（`HoPrimitiveBillboard::StartDestPath`，`MonsterMephit2.ini` →
 *    `LineParticle.tga`，我方资产在位 ✓）：每条从到站点飞向随机终点 ——
 *    `dest = 当前 + (sin(pitch)·cos(yaw)·120·120, cos(pitch)·90·90, sin(pitch)·sin(yaw)·120·120)`
 *    （raw ⇒ 水平最大 ±56.25、竖直 ±31.6 世界单位）；`HoPhysicsDest` 速度 **200 raw/帧**
 *    （:70-100）；起画延迟 `AddObject(bb, index*rand()%5)`（⚠ 先乘后模，0..4 帧，照抄）；
 *    画法（`HoEffect.cpp:851-876` `PRIMITIVE_PATH_RECT_LINE`）：四边形 = 头(推进点) 到
 *    `头 − V×SizeWidth(=6)`（**6 帧拖尾长度**），半宽 = `SizeHeight(70+rand%50) 个 raw`
 *    ⇒ `(70..120)/256` 世界单位 —— 细线。寿命 = 飞到终点为止。
 * ② **4 颗火花**（`StartPath`，`MonsterMephit1.ini` → `Particle1..3.tga` 三帧循环，资产在位 ✓）：
 *    `HoPhysicsParticle`（`HoPhysics.cpp:124`）：水平初速 `cos/sin(ang)×85`、竖直 `+70`，
 *    **HIT2 全部 ×2**（`hoAssaParticleEffect` 同款"×2"读法在这里是源码写的：`:9498-9506`）；
 *    重力 `Velocity.y += 2..4`/帧²；寿命 `rand()%5+10` 帧（10..14）；尺寸 `20×2 = 40`
 *    （HIT2 加倍，:9519-9526）。⚠ 尺寸沿用①的字面读数：`Face2d.width = Size << FLOATNS`
 *    经投影回世界 ⇒ 40 世界单位（一个 0.15~0.2s 的大闪光；若实机过大按实机调并写回）。
 * ③ 动态光：MEPHIT_HIT 分支**没有** `SetDynLight`（对比 multispark 命中那条有）⇒ 不放。
 *
 * ## 我方实现
 *
 * * 心跳 = **70fps**（同 divine-lightning 的 Assa 心跳；`Main.cpp:1274` 门控整条主循环）。
 * * **固定池 + 原地更新**（AGENTS #111）：球粒子 ≤ 每帧 10 颗 ⇒ 池 16 个 sprite；光痕 10 张
 *   固定四边形、火花 4 张 sprite —— **全部在起手时建齐挂好**，命中前隐藏；结束统一 dispose。
 * * 终点为**起手快照**（原版 `chrAttackTarget->pX` 在事件帧取一次，不逐帧跟）。
 * * 目标抬起量由调用方决定：本层只收"终点世界坐标"（原版 +20 抬升在 presenter 里做，
 *   与 `TARGET_BODY_LIFT` 的关系由调用方对表）。
 */
import * as THREE from 'three';
import { reportFallback } from '../../char/fallback-log.js';
import { FONE, getMoveLocation, radToPtAngle } from '../../core/geom.js';

/* ── 常量（出处见文件头） ── */
/** 心跳 = 70fps（`Main.cpp:1274`；与 divine-lightning 同一条，别按 60 算） */
export const HOLY_BOLT_FPS = 70;
/** 起点：施法者 + 前方24 + 上方24（`GetMoveLocation(0, 24*fONE, 24*fONE, 0, Angle.y, 0)`） */
export const SHOT_START_FWD_WU = 24;
export const SHOT_START_UP_WU = 24;
/** 终点抬高：目标 `pY + 20*fONE` */
export const SHOT_DEST_LIFT_WU = 20;
/** 追踪速度 1300 raw/帧（`HoEffectTracker::Start` 的 MEPHIT/IMP 分支） */
export const TRACKER_SPEED_RAW = 1300;
/** `length² < 1000²` ⇒ 开始武装计数；`< 800²` ⇒ 到站；武装计数 `> 3` 也到站 */
export const SHOT_ARM_DIST_RAW = 1000;
export const SHOT_ARRIVE_DIST_RAW = 800;
export const SHOT_ARM_FRAMES = 3;
/** 球外观（`HoParticle.cpp:236-283`，SHOT2 分支） */
export const SHOT_TEX = 'effect/imagedata/particle/blue.tga';   // `MaterialNum[3]`（材质表第 3 格）
export const SHOT_COLOR_START = { r: 230, g: 250, b: 250, a: 200 } as const;
export const SHOT_COLOR_END = { r: 0, g: 0, b: 0, a: 0 } as const;
export const SHOT_SIZE_START_WU = 6;    // `SizeStart = 6`（SHOT1 是 4；`:261`）
export const SHOT_SIZE_END_WU = 0.5;
export const SHOT_LIFE_SEC = 0.005;     // `Life = 0.005f` ⇒ ≤1 帧
export const SHOT_EMIT_PER_FRAME = 10;  // `ParticlesPerSec = EngineFps(70)×10` ⇒ 每帧 10 颗
/** `MIN_SIZE 2 / MAX_SIZE 20`（`HoParticle.h:15/24`，出生时钳制） */
export const SHOT_SIZE_MIN_WU = 2;
export const SHOT_SIZE_MAX_WU = 20;
/** 爆裂①：光痕（`HoEffect.cpp:9440-9478` + `StartDestPath`/`HoPhysicsDest`） */
export const HIT_STREAK_TEX = 'effect/imagedata/monstermephit/lineparticle1.tga'; // MonsterMephit2.ini
export const HIT_STREAK_COUNT = 10;
export const HIT_STREAK_TRAIL_FRAMES = 6;        // `size.x = 6`：尾 = 头 − V×6
export const HIT_STREAK_HALF_WIDTH_MIN_RAW = 70; // `size.y = 70 + rand%50`（raw ⇒ /256 世界单位）
export const HIT_STREAK_HALF_WIDTH_MAX_RAW = 120;
export const HIT_STREAK_SPEED_RAW = 200;         // `HoPhysicsDest::Start(…, 200)`
export const HIT_STREAK_DEST_Y_RAW = 8100;       // `cos(pitch)*(90*90)`
export const HIT_STREAK_DEST_HORIZ_RAW = 14400;  // `sin(pitch)*(120*cos/sin(yaw))*(120)`
export const HIT_STREAK_DELAY_MAX = 5;           // `index*rand()%5`（先乘后模，0..4）
/** 爆裂②：火花（`HoEffect.cpp:9480-9535` + `HoPhysics.cpp:124`） */
export const HIT_PUFF_TEXES = [
  'effect/imagedata/monstermephit/particle1.tga',
  'effect/imagedata/monstermephit/particle2.tga',
  'effect/imagedata/monstermephit/particle3.tga',
];                                                // MonsterMephit1.ini Count=3，ANI_LOOP
export const HIT_PUFF_COUNT = 4;
export const HIT_PUFF_SIZE_WU = 40;               // `20 ×2`（HIT2 加倍，:9519-9526）
export const HIT_PUFF_VY_RAW = 140;               // `70 ×2`
export const HIT_PUFF_VHORIZ_MAX_RAW = 170;       // `cos(ang)×85 ×2`（0..170，方向随机）
export const HIT_PUFF_GRAVITY_MIN = 2;            // `rand()%3+2`（raw/帧²）
export const HIT_PUFF_GRAVITY_MAX = 4;
export const HIT_PUFF_LIFE_MIN = 10;              // `rand()%5+10`（帧）
export const HIT_PUFF_LIFE_MAX = 14;

/* ── 渲染依赖（configureHolyBolt 注入；缺贴图 ⇒ 上报不放，不静默） ── */
export interface HolyBoltTextures {
  ball: THREE.Texture;
  streak: THREE.Texture;
  puffs: THREE.Texture[];   // 3 帧
}

interface StreakQuad {
  mesh: THREE.Mesh;
  posAttr: THREE.BufferAttribute;
  head: THREE.Vector3;
  dest: THREE.Vector3;
  vel: THREE.Vector3;      // 世界单位/帧
  halfWidth: number;       // 世界单位
  delay: number;           // 帧数（未到 0 时不画不推进）
  done: boolean;
}

interface PuffSprite {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  gravity: number;
  life: number;            // 帧数
  delay: number;           // 帧数（= index）
  done: boolean;
}

interface BallParticle {
  sprite: THREE.Sprite;
  age: number;             // 秒
  live: boolean;
}

interface LiveShot {
  root: THREE.Group;
  pos: THREE.Vector3;
  dest: THREE.Vector3;
  vel: THREE.Vector3;
  frame: number;
  armed: boolean;
  armFrames: number;
  arrived: boolean;
  /** 球粒子池（固定 16；每帧换 ≤10 颗新粒子，寿命 ≤1 帧） */
  ball: BallParticle[];
  streaks: StreakQuad[];
  puffs: PuffSprite[];
  /** 本发**独占**的材质（球 1 + 火花 4；结束 dispose —— 共享缓存里的不在此列） */
  ownedMats: THREE.Material[];
  /** 全部部件到站且火花/光痕播完 ⇒ true（主循环据此摘实例） */
  finished: boolean;
}

const live: LiveShot[] = [];
let frameAcc = 0;
let texRef: HolyBoltTextures | null = null;
let camRef: THREE.Camera | null = null;
let reportedNoTex = false;

/** 贴图注入（WorldView 启动时解码一次；幂等） */
export function configureHolyBolt(deps: { textures?: HolyBoltTextures | null; camera?: THREE.Camera | null }): void {
  if (deps.textures) texRef = deps.textures;
  if (deps.camera !== undefined) camRef = deps.camera;
}

/** 追踪速度/到站窗（世界单位：raw / FONE） */
const TRACKER_SPEED_WU = TRACKER_SPEED_RAW / FONE;
const ARM_DIST_WU = SHOT_ARM_DIST_RAW / FONE;
const ARRIVE_DIST_WU = SHOT_ARRIVE_DIST_RAW / FONE;

/** 加法混合共享材质（`SMMAT_BLEND_LAMP`；每张贴图一份） */
const matCache = new Map<THREE.Texture, THREE.SpriteMaterial | THREE.MeshBasicMaterial>();
function spriteMat(tex: THREE.Texture, opts?: { opacity?: number; tint?: { r: number; g: number; b: number } }): THREE.SpriteMaterial {
  const key = tex;
  if (opts) {
    // 带参数的材质**独占**（球的颜色/透明度是它专属的；别进共享缓存，否则互相污染）
    return new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: opts.opacity ?? 1,
      color: opts.tint ? new THREE.Color(opts.tint.r / 255, opts.tint.g / 255, opts.tint.b / 255) : 0xffffff,
    });
  }
  let m = matCache.get(key) as THREE.SpriteMaterial | undefined;
  if (!m) {
    m = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    matCache.set(key, m);
  }
  return m;
}
function quadMat(tex: THREE.Texture): THREE.MeshBasicMaterial {
  let m = matCache.get(tex) as THREE.MeshBasicMaterial | undefined;
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    matCache.set(tex, m);
  }
  return m;
}

function makeQuad(tex: THREE.Texture, parent: THREE.Object3D): { mesh: THREE.Mesh; posAttr: THREE.BufferAttribute } {
  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(new Float32Array(4 * 3), 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  const uvAttr = new THREE.BufferAttribute(new Float32Array(4 * 2), 2);
  uvAttr.setXY(0, 0, 1); uvAttr.setXY(1, 1, 1); uvAttr.setXY(2, 0, 0); uvAttr.setXY(3, 1, 0);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('uv', uvAttr);
  geo.setIndex([0, 1, 3, 0, 3, 2]);
  const mesh = new THREE.Mesh(geo, quadMat(tex));
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.visible = false;          // 命中后才亮
  parent.add(mesh);              // ⚠ 建了就要挂载（AGENTS #111）
  return { mesh, posAttr };
}

/**
 * 起一发神圣弹（自机与旁观者共用，AGENTS #15）。
 *
 * @param deps.scene  载体节点挂这里
 * @param from        施法者**脚底**世界坐标（起点 = 它 + 前方24/上方24，按 `casterYaw`）
 * @param casterYaw   施法者朝向（弧度；原版 `Angle.y`）
 * @param targetBody  目标点（**含抬升**：原版 = 目标 `pY + 20*fONE`；调用方给"身上"坐标时
 *                    不必再加 `SHOT_DEST_LIFT_WU` —— 抬升已含在它给的值里）
 */
export function runHolyBolt(
  deps: { scene: THREE.Scene; log?: (m: string) => void },
  from: { x: number; y: number; z: number },
  casterYaw: number,
  targetBody: { x: number; y: number; z: number },
): void {
  if (!texRef) {
    if (!reportedNoTex) {
      reportedNoTex = true;
      reportFallback('skillfx', 'Holy Bolt：贴图没注入（blue/LineParticle/Particle1..3）⇒ 本次不放（不静默）');
    }
    return;
  }
  const root = new THREE.Group();
  root.matrixAutoUpdate = false;
  deps.scene.add(root);

  // 起点 = GetMoveLocation(0, 24*fONE, 24*fONE, 0, Angle.y, 0)（前方沿朝向、向上 24）
  const mv = getMoveLocation(0, SHOT_START_UP_WU, SHOT_START_FWD_WU, 0, radToPtAngle(casterYaw), 0);
  const pos = new THREE.Vector3(from.x + mv.x, from.y + mv.y, from.z + mv.z);
  const dest = new THREE.Vector3(targetBody.x, targetBody.y, targetBody.z);
  const dir = dest.clone().sub(pos);
  const len = dir.length() || 1;
  const speed = TRACKER_SPEED_WU;
  const vel = dir.divideScalar(len).multiplyScalar(speed);

  // 球粒子池：寿命 ≤1 帧 ⇒ 同帧存活 ≤ 每帧产量(10)，池 16 留余量。
  // 材质**独占**（ColorStart (230,250,250)、Alpha 200 —— 出生即所见，寿命 ≤1 帧看不到衰减）
  const ballMat = spriteMat(texRef.ball, {
    opacity: SHOT_COLOR_START.a / 255,
    tint: { r: SHOT_COLOR_START.r, g: SHOT_COLOR_START.g, b: SHOT_COLOR_START.b },
  });
  const ownedMats: THREE.Material[] = [ballMat];
  const ball: BallParticle[] = [];
  for (let i = 0; i < 16; i++) {
    const sp = new THREE.Sprite(ballMat);
    sp.visible = false;
    root.add(sp);
    ball.push({ sprite: sp, age: 0, live: false });
  }  // 光痕 10 + 火花 4：命中时才赋参数、才可见（先建齐 —— AGENTS #111：帧内不 new）
  const streaks: StreakQuad[] = [];
  for (let i = 0; i < HIT_STREAK_COUNT; i++) {
    const { mesh, posAttr } = makeQuad(texRef.streak, root);
    streaks.push({
      mesh, posAttr,
      head: new THREE.Vector3(), dest: new THREE.Vector3(), vel: new THREE.Vector3(),
      halfWidth: 0, delay: 0, done: false,
    });
  }
  const puffs: PuffSprite[] = [];
  for (let i = 0; i < HIT_PUFF_COUNT; i++) {
    // 材质**每颗独立** —— 三帧循环要逐颗换 map（共享材质会互相污染）
    const tex = texRef.puffs[i % texRef.puffs.length]!;
    const mat = spriteMat(tex);
    ownedMats.push(mat);
    const sp = new THREE.Sprite(mat);
    sp.visible = false;
    root.add(sp);
    puffs.push({
      sprite: sp,
      vel: new THREE.Vector3(), gravity: 0, life: 0, delay: i, done: false,
    });
  }

  live.push({
    root, pos, dest, vel, frame: 0, armed: false, armFrames: 0, arrived: false,
    ball, streaks, puffs, ownedMats, finished: false,
  });
  deps.log?.(`  ✧ Holy Bolt：球 (${pos.x.toFixed(1)},${pos.y.toFixed(1)},${pos.z.toFixed(1)}) → `
    + `(${dest.x.toFixed(1)},${dest.y.toFixed(1)},${dest.z.toFixed(1)})，${speed.toFixed(2)}/帧`);
}

/** 到站爆裂（`HoEffect.cpp:9430-9535` 的 HIT2 半支；随机量就地掷 —— 单机视觉，不跨端同步） */
function onArrive(s: LiveShot): void {
  // ① 光痕 ×10
  for (let i = 0; i < HIT_STREAK_COUNT; i++) {
    const q = s.streaks[i]!;
    const yaw = Math.random() * Math.PI * 2;
    const pitch = Math.random() * Math.PI;                       // `RANDOM_NUM*180°` ⇒ 0..π
    q.dest.set(
      s.pos.x + Math.sin(pitch) * Math.cos(yaw) * HIT_STREAK_DEST_HORIZ_RAW / FONE,
      s.pos.y + Math.cos(pitch) * HIT_STREAK_DEST_Y_RAW / FONE,
      s.pos.z + Math.sin(pitch) * Math.sin(yaw) * HIT_STREAK_DEST_HORIZ_RAW / FONE,
    );
    q.head.copy(s.pos);
    const d = q.dest.clone().sub(q.head);
    const dl = d.length() || 1;
    q.vel.copy(d.divideScalar(dl).multiplyScalar(HIT_STREAK_SPEED_RAW / FONE));
    q.halfWidth = (HIT_STREAK_HALF_WIDTH_MIN_RAW
      + Math.random() * (HIT_STREAK_HALF_WIDTH_MAX_RAW - HIT_STREAK_HALF_WIDTH_MIN_RAW)) / FONE;
    // ⚠ 原文 `index*rand() % 5`：先乘后模（C 优先级）⇒ 0..4；照抄不自作聪明改 `(index*rand())%…` 之外的形式
    q.delay = (i * Math.floor(Math.random() * 32768)) % HIT_STREAK_DELAY_MAX;
    q.done = false;
  }
  // ② 火花 ×4（延迟 = index 帧）
  for (let i = 0; i < HIT_PUFF_COUNT; i++) {
    const p = s.puffs[i]!;
    const ang = Math.random() * Math.PI * 2;
    p.vel.set(
      Math.cos(ang) * HIT_PUFF_VHORIZ_MAX_RAW / FONE * Math.random(),
      HIT_PUFF_VY_RAW / FONE,
      Math.sin(ang) * HIT_PUFF_VHORIZ_MAX_RAW / FONE * Math.random(),
    );
    p.gravity = HIT_PUFF_GRAVITY_MIN + Math.random() * (HIT_PUFF_GRAVITY_MAX - HIT_PUFF_GRAVITY_MIN);
    p.life = HIT_PUFF_LIFE_MIN + Math.floor(Math.random() * (HIT_PUFF_LIFE_MAX - HIT_PUFF_LIFE_MIN + 1));
    p.delay = i;
    p.done = false;
  }
}

/** 追踪球一帧（`HoEffectTracker::Main` :10000-10100 的 MEPHIT_SHOT2 支 + `HoParticle` 出生/老化） */
function stepShot(s: LiveShot): void {
  if (s.arrived) return;
  s.frame++;
  // 球粒子：本帧出生 ≤10 颗（寿命 ≤1 帧：本帧亮、下帧灭）
  let born = 0;
  for (const b of s.ball) {
    if (b.live) {
      b.age += 1 / HOLY_BOLT_FPS;
      if (b.age >= SHOT_LIFE_SEC) { b.live = false; b.sprite.visible = false; }
    }
  }
  for (const b of s.ball) {
    if (born >= SHOT_EMIT_PER_FRAME) break;
    if (b.live) continue;
    b.live = true;
    b.age = 0;
    b.sprite.visible = true;
    b.sprite.position.copy(s.pos);
    // 出生尺寸钳制（`Size = SizeStart; Clamp(Size, MIN_SIZE, MAX_SIZE)`）——本实现寿命 ≤1 帧，
    // 尺寸只会显示出生值 ⇒ 收缩到 SizeEnd 的过程不可见（原版同理：0.005s < 1 帧）
    b.sprite.scale.setScalar(Math.min(Math.max(SHOT_SIZE_START_WU, SHOT_SIZE_MIN_WU), SHOT_SIZE_MAX_WU));
    born++;
  }
  // 追踪 + 到站判定（`Main` 逐字：先武装计数、后到达窗 —— 快弹跳窗靠 3 帧武装兜住）
  const term = s.dest.clone().sub(s.pos);
  const length = term.length();
  if (length < ARM_DIST_WU) {
    if (s.armed) s.armFrames++;
    s.armed = true;
  }
  if (length < ARRIVE_DIST_WU || s.armFrames > SHOT_ARM_FRAMES) {
    s.pos.copy(s.dest);
    s.arrived = true;
    for (const b of s.ball) { b.live = false; b.sprite.visible = false; }
    onArrive(s);
    return;
  }
  s.pos.add(s.vel);
}

/** 光痕/火花一帧（`HoPhysicsDest::Main` / `HoPhysicsParticle::Main`） */
function stepHit(s: LiveShot): void {
  const viewDir = new THREE.Vector3();
  if (camRef) camRef.getWorldDirection(viewDir);
  const UP = new THREE.Vector3(0, 1, 0);
  for (const q of s.streaks) {
    if (q.done) continue;
    if (q.delay > 0) { q.delay--; continue; }
    const remain = q.dest.clone().sub(q.head);
    if (remain.length() <= q.vel.length()) { q.done = true; q.mesh.visible = false; continue; }
    q.head.add(q.vel);
    // 四边形 = 头 → 头 − V×6（`PRIMITIVE_PATH_RECT_LINE` 的 currentPos = dest − DirectionVelocity×SizeWidth）
    const tail = q.head.clone().sub(q.vel.clone().multiplyScalar(HIT_STREAK_TRAIL_FRAMES));
    const seg = q.head.clone().sub(tail);
    const lat = new THREE.Vector3();
    if (seg.lengthSq() > 1e-9 && viewDir.lengthSq() > 0) lat.crossVectors(viewDir, seg);
    if (lat.lengthSq() < 1e-9) lat.crossVectors(seg, UP);
    lat.normalize().multiplyScalar(q.halfWidth);
    q.posAttr.setXYZ(0, q.head.x - lat.x, q.head.y - lat.y, q.head.z - lat.z);
    q.posAttr.setXYZ(1, q.head.x + lat.x, q.head.y + lat.y, q.head.z + lat.z);
    q.posAttr.setXYZ(2, tail.x - lat.x, tail.y - lat.y, tail.z - lat.z);
    q.posAttr.setXYZ(3, tail.x + lat.x, tail.y + lat.y, tail.z + lat.z);
    q.posAttr.needsUpdate = true;
    q.mesh.visible = true;
  }
  for (const p of s.puffs) {
    if (p.done) continue;
    if (p.delay > 0) { p.delay--; continue; }
    p.vel.y += p.gravity;
    p.life--;
    p.sprite.position.add(p.vel);
    p.sprite.scale.setScalar(HIT_PUFF_SIZE_WU);
    // 三帧循环（MonsterMephit1.ini Count=3，ANI_LOOP）
    if (texRef && p.life > 0) {
      const f = texRef.puffs[(p.life + p.delay) % texRef.puffs.length];
      if (f) (p.sprite.material as THREE.SpriteMaterial).map = f;
    }
    p.sprite.visible = p.life > 0;
    if (p.life <= 0) p.done = true;
  }
}

/** 每帧调（70fps 帧轴；与 multi-spark 的 60fps 轴不同，别抄错） */
export function updateHolyBoltRunners(dt: number): void {
  if (live.length === 0) return;
  frameAcc += dt * HOLY_BOLT_FPS;
  const n = Math.floor(frameAcc);
  if (n <= 0) return;
  frameAcc -= n;
  for (let i = live.length - 1; i >= 0; i--) {
    const s = live[i]!;
    for (let k = 0; k < n && !s.arrived; k++) stepShot(s);
    if (s.arrived) {
      for (let k = 0; k < n; k++) stepHit(s);
      s.finished = s.streaks.every((q) => q.done) && s.puffs.every((p) => p.done);
    }
    if (s.finished) {
      s.root.removeFromParent();
      disposeShot(s);
      live.splice(i, 1);
    }
  }
}

function disposeShot(s: LiveShot): void {
  for (const q of s.streaks) {
    q.mesh.geometry.dispose();
    q.mesh.removeFromParent();
  }
  for (const m of s.ownedMats) m.dispose();
  s.root.removeFromParent();
}

/** 场景销毁时清干净（换图/退出；调用方负责） */
export function clearHolyBolt(): void {
  for (const s of live) {
    disposeShot(s);
  }
  live.length = 0;
}

/** 自检/回归用（`npm run verify-holy-bolt`）：在飞实例数 + 最近一发是否已到站 */
export function holyBoltStats(): { live: number; arrived: boolean } {
  const s = live[live.length - 1];
  return { live: live.length, arrived: s ? s.arrived : false };
}
