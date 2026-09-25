/**
 * **升级特效**（原版 `EFFECT_LEVELUP1`，`HoEffect.cpp:7635-7735`）—— 逐行照抄的组装器。
 *
 * ## 为什么要有这个文件
 *
 * 原版这一记特效**不是一个资产**，而是**四组东西按帧序号拼起来**的（`AddObject(obj, startFrame)` 的
 * 第 2 参是**起始帧**，不是时长）。此前我方把它写成"把四枚 INI 各放一遍、都摆在身体中部"
 * ⇒ 数量（20/5/5/5）、位置（环半径 / ±y 偏移）、时间（第 25/30/…/45 帧才出现）、以及
 * **代码驱动的运动**（向心收拢、两侧内收）全都不对 —— 用户 2026-09-21："对接得不是很准确"。
 *
 * ## 原版逐字（本文件每个常量都对应下面某一行）
 *
 * ```c
 * case EFFECT_LEVELUP1:
 * {
 *   SetDynLight(x, y, z, 150, 150, 150, 255, 200, 1);          // ① 白闪光
 *   y = y - 1000;                                              //    基点下移 1000 raw
 *   for (int index = 0; index < 20; index++)                   // ② 20 颗向心粒子
 *   {
 *     int ang = ANGLE_360 / 20 * index;                        //    ⚠ **整数除法**：4096/20 = 204
 *     POINT3D destPos;    destPos.x = x; destPos.y = y; destPos.z = z;
 *     POINT3D currentPos;
 *     currentPos.x = int(x + ((float)GetCos[ang] / 65536.f)*(21000 + rand() % 10 * 1000));
 *     currentPos.y = int(y + GetCos[ang%ANGLE_90] / 65536.f * 10000);
 *     currentPos.z = int(z + ((float)GetSin[ang] / 65536.f)*(21000 + rand() % 10 * 1000));
 *     particle->StartPathTri(currentPos, destPos, "LevelUpParticle1.ini");   // 见 HoEffect.cpp:370-404
 *     AddObject(particle, 0);
 *   }
 *   for (int index = 0; index < 5; index++)                    // ③ 5 记闪光
 *     extPrimitive->StartBillRect(x + rand() % 50, y + rand() % 50, z + rand() % 50, "LevelUp.ini", ANI_ONE);
 *     AddObject(extPrimitive, index * 5 + 25);
 *   y = y + 4000;                                              //    基点净上移 3000 raw
 *   for (int index = 0; index < 5; index++)                    // ④ 左 5 + 右 5 光带
 *     primitiveMove->Start(x, y, z, 40, 10, "LevelUp1Left.ini", ANI_ONE);
 *     primitiveMove->MoveState = 1; primitiveMove->TranslateMoveX = -230;
 *     AddObject(primitiveMove, index * 5);
 *     … 右侧同构：MoveState = 3; TranslateMoveX = 230;
 * }
 * ```
 *
 * 调用点两处，**锚点规则相同**：`playsub.cpp:1310`（自己升级）与 `character.cpp:9157`（看见别人升级）
 * 都是 `StartEffect(pX, pY + 32 * fONE, pZ, EFFECT_LEVELUP1)` ⇒ **脚下 + 32 世界单位**。
 *
 * ## 三处"代码驱动"的运动（都不在 INI 里，必须自己算）
 *
 * 1. **向心粒子**（②）：`StartPathTri` 内部挂 `HoPhysicsDest`，`Start(currentPos, destPos, 0)`
 *    ⇒ `Speed = 800`（`HoPhysics.cpp:41-95`）：速度 = `(dest−cur)/|dest−cur| × 800`，**每 tick 走一步**，
 *    `|dest−cur| < Speed` 时 `Init()` 停止 ⇒ 我们按"直线匀速 800/256 单位每 tick、到 3.125 单位内停"。
 *    同处还写死 `SizeX = 7; SizeY = 23`（`HoEffect.cpp:400-404`），且 `AniType = ANI_LOOP`
 *    ⇒ **飞行期间帧动画循环**（只播一遍的话 43ms 的 `levelupparticle1` 飞一半就没了）。
 *    到点后 `HoPrimitivePolygon::Main` 把 `AniType` 改成 `ANI_ONE`（再播完一遍就销毁）。
 * 2. **两侧光带的内收**（④）：`HoEtcPrimitiveBillboardMove::Main`（`HoEffect.cpp:1687-1767`）
 *    每 4 tick 把 `TranslateMoveX` 朝 0 加一个 `Step`（初值 35，**每 4 tick 减 3，下限 4**）；
 *    `Draw`（`:1612-1672`）把 `TranslateMoveX/Y` **加在投影后的 2D 顶点上**
 *    ⇒ 这是**屏幕空间像素位移**，不是世界位移（见下面 `bandOffsetPx` 与 `applyBandOffset`）。
 * 3. **停下之后的上漂**：`TranslateMoveX == 0` 且 `PrimitiveStopCount >= 45` 时 `TranslateMoveY -= 2`
 *    （每 tick，屏幕向上）。
 *
 * ## 时间基准
 *
 * INI 的 `Delay` 与这里的"起始帧"同为 **70Hz**（`EFFECT_HZ`）⇒ 第 N 帧 = `N/70` 秒。
 * 本文件按 tick 累积（`tick += dt * 70`），**不按帧数**：原版的每-tick 步进与显示帧率无关。
 *
 * ## 我方已知偏差（都写在这里，不许静默）
 *
 * - **屏幕空间 → 相机空间**：原版把 ±230px 直接加在投影后的顶点上；我们的粒子是**世界空间**的
 *   billboard，只能把像素位移换算成相机基向量上的世界位移。做法是把基准点投影到 NDC、在 NDC 里
 *   按画布尺寸加偏移、再反投影回同一深度 ⇒ **屏幕上的位移恒等于原版的像素数**（远近都一致，
 *   与原版"固定像素"的观感相同）。前提是"光带与锚点同深度"，原版的光带就在锚点上 ⇒ 成立。
 * - **到点那一遍动画**：原版到达后还要把当前帧序播完（`ANI_ONE`，≤43ms）才销毁；我们到点即
 *   `stop()`（停发，已在飞的粒子按寿命自然消亡）⇒ 观感相同（那 43ms 的 blob 是淡出帧）。
 */

import * as THREE from 'three';
import { FONE, PT_ANGLE_FULL, ptAngleToRad } from '../../core/geom.js';
import { EFFECT_HZ } from './ini-to-quarks.js';
import { reportFallback } from '../../char/fallback-log.js';

/* ─────────── 常量（全部来自上面那段源码；raw → 世界单位一律 ÷FONE） ─────────── */

/** 调用点给的抬高：`pY + 32 * fONE`（`playsub.cpp:1310` / `character.cpp:9157`） */
export const LEVELUP_LIFT = 32;
/** ② 的组数 */
export const PATH_COUNT = 20;
/** ② 环半径 = `21000 + rand()%10*1000`（raw） */
export const PATH_RADIUS_BASE = 21000 / FONE;
export const PATH_RADIUS_STEP = 1000 / FONE;
/** ② 环上各点的 y 抬高 = `GetCos[ang % ANGLE_90]/65536 * 10000`（raw，0..39.06） */
export const PATH_Y_SPREAD = 10000 / FONE;
/** ② 落点相对基点下移 `y - 1000`（raw） */
export const PATH_DEST_DROP = 1000 / FONE;
/** ② `HoPhysicsDest` 的 `Speed = 800`（raw/tick）⇒ 每 tick 3.125 单位、每秒 218.75 */
export const PATH_SPEED_RAW = 800;
export const PATH_SPEED_PER_TICK = PATH_SPEED_RAW / FONE;
export const PATH_SPEED_PER_SEC = PATH_SPEED_PER_TICK * EFFECT_HZ;
/** ② 到达判定 = `|dest−cur| < Speed`（raw） */
export const PATH_STOP_DIST = PATH_SPEED_RAW / FONE;
/** ② 调用方写死的尺寸 `SizeX = 7; SizeY = 23`（`HoEffect.cpp:400-404`） */
export const PATH_SIZE_X = 7;
export const PATH_SIZE_Y = 23;
/** ② 资产 */
export const PATH_INI = 'levelupparticle1';

/** ③ 闪光：5 记，起始帧 `index*5 + 25`，位置带 `rand()%50`（raw）抖动 */
export const FLASH_COUNT = 5;
export const FLASH_START_FRAME = 25;
export const FLASH_FRAME_STEP = 5;
export const FLASH_JITTER_RAW = 50;
export const FLASH_INI = 'levelup';

/** ④ 光带：每侧 5 条，起始帧 `index*5`，位置 = 基点净上移 `-1000+4000`（raw） */
export const BAND_COUNT = 5;
export const BAND_FRAME_STEP = 5;
export const BAND_Y_RAW = 3000;                       // y = y - 1000 + 4000
export const BAND_SIZE_X = 40;                        // `Start(x,y,z, 40, 10, …)`
export const BAND_SIZE_Y = 10;
export const BAND_OFFSET_PX0 = 230;                   // `TranslateMoveX = ∓230`
export const BAND_STEP_PX0 = 35;                      // `Step = 35`
export const BAND_STEP_DECAY = 3;                     // `Step -= 3`
export const BAND_STEP_MIN = 4;                       // `if (Step < 5) Step = 4`
export const BAND_TICKS_PER_STEP = 4;                 // `PrimitiveMoveCount >= 4`
export const BAND_DRIFT_WAIT = 45;                    // `PrimitiveStopCount >= 45`
export const BAND_DRIFT_PX = 2;                       // `TranslateMoveY -= 2`
/** ④ 两条光带的 INI 寿命 = Delay 40+40+80 = 160 tick（`levelup1left/right.ini`） */
export const BAND_LIFE_TICKS = 160;
export const BAND_INI_LEFT = 'levelup1left';
export const BAND_INI_RIGHT = 'levelup1right';

/** ① `SetDynLight(x, y, z, 150,150,150, 255, 200, 1)` */
const DYN_LIGHT = { r: 150, g: 150, b: 150, a: 255, power: 200, decPower: 1 };

/* ─────────── 纯计算（可复算：验证脚本直接调它们，不需要渲染） ─────────── */

export interface RingSpawn { cur: { x: number; y: number; z: number }; dest: { x: number; y: number; z: number } }

/**
 * ② 的 20 个出生点与落点（世界单位）。`rand` 注入以便验证（原版是 `rand()` ⇒ 每次不同）。
 *
 * @param base 基点（= 调用点给的 `(pX, pY + 32*fONE, pZ)` 再 `y -= 1000/256` 之后的位置）
 */
export function levelUpRingSpawns(base: { x: number; y: number; z: number }, rand: () => number): RingSpawn[] {
  const out: RingSpawn[] = [];
  for (let index = 0; index < PATH_COUNT; index++) {
    // ⚠ C 的整数除法：`ANGLE_360 / 20 * index` = 204 * index（**不是** 204.8*index）
    const ang = Math.trunc(PT_ANGLE_FULL / PATH_COUNT) * index;
    const r = PATH_RADIUS_BASE + (rand() % 10) * PATH_RADIUS_STEP;
    const th = ptAngleToRad(ang);
    out.push({
      cur: {
        x: base.x + Math.cos(th) * r,
        // y 抬高：`GetCos[ang % ANGLE_90]`（0..65536）/65536 ∈ 0..1 ⇒ 0..39.06 单位
        y: base.y + Math.cos(ptAngleToRad(ang % (PT_ANGLE_FULL / 4))) * PATH_Y_SPREAD,
        z: base.z + Math.sin(th) * r,
      },
      dest: { x: base.x, y: base.y, z: base.z },
    });
  }
  return out;
}

/**
 * ④ 光带在 `tick` 时刻的**屏幕像素偏移**（x = `TranslateMoveX`，y = `TranslateMoveY`）。
 *
 * 逐行照抄 `HoEtcPrimitiveBillboardMove::Main`：每 4 tick 把 |x| 朝 0 收一个 `Step`，
 * `Step` 每 4 tick 减 3（下限 4）；`|x|` 到 0 后再等 45 tick 才开始 `y -= 2`（向上）。
 * `side` = −1（左，`TranslateMoveX = -230`）/ +1（右）。
 */
export function levelUpBandOffsetPx(tick: number, side: -1 | 1): { x: number; y: number } {
  let step = BAND_STEP_PX0;
  let off = BAND_OFFSET_PX0;
  let stopTick = -1;
  for (let t = BAND_TICKS_PER_STEP; t <= tick; t += BAND_TICKS_PER_STEP) {
    if (off <= 0) break;
    off -= step;                        // `TranslateMoveX += Step`（朝 0）
    step = Math.max(BAND_STEP_MIN, step - BAND_STEP_DECAY);   // `Step -= 3; if (Step < 5) Step = 4`
    if (off <= 0) { off = 0; stopTick = t; }
  }
  const drift = stopTick >= 0 && tick > stopTick + BAND_DRIFT_WAIT
    ? -BAND_DRIFT_PX * (tick - stopTick - BAND_DRIFT_WAIT)   // 屏幕 y 向下 ⇒ 负 = 向上
    : 0;
  return { x: side * off, y: drift };
}

/* ─────────── 装配与推进 ─────────── */

/** 起一个特效所需的最小契约（`EffectManager` 满足它；实验室可传同一份） */
export interface LevelUpFxSpawner {
  spawn(name: string, opts: {
    pos: { x: number; y: number; z: number };
    size?: number; sizeY?: number; loop?: boolean;
    attach?: THREE.Object3D; rigidFollow?: boolean; delaySec?: number;
  }): Promise<boolean>;
  spawnStoppable(name: string, opts: {
    pos: { x: number; y: number; z: number };
    size?: number; sizeY?: number; loop?: boolean;
    attach?: THREE.Object3D; rigidFollow?: boolean;
  }): Promise<{ stop(): void } | null>;
}

export interface LevelUpDeps {
  fx: LevelUpFxSpawner | null;
  scene: THREE.Scene;
  /** 动态光池（原版 `SetDynLight`）；没接就跳过并在日志里说一声 */
  dynLights?: { set(x: number, y: number, z: number, r: number, g: number, b: number,
                    a: number, power: number, decPower: number): void | boolean } | null;
  /** 相机（把 ±230px 换算成相机空间位移）；缺了 ⇒ 光带不做位移并上报一次 */
  camera?: THREE.Camera | null;
  /** 画布像素尺寸（同上）。返回 0 时同样退化为"不做位移 + 上报" */
  viewport?: () => { width: number; height: number };
  /** 诊断（实验室日志面板；`reportFallback` 实验室看不见） */
  log?: (msg: string) => void;
}

interface PathParticle {
  carrier: THREE.Group;
  handle: { stop(): void } | null;
  /** 已经请求过停发（句柄可能还没到 —— `spawnStoppable` 是异步的） */
  stopRequested: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  dest: THREE.Vector3;
  arrived: boolean;
  retireAt: number;      // tick
}

interface Band {
  carrier: THREE.Group;
  handle: { stop(): void } | null;
  /** 已经发起过 spawn（**必须同步置位**：否则异步句柄回来之前每帧都会重复起一份系统） */
  spawnRequested: boolean;
  /** 已到寿命、已请求停发 */
  retired: boolean;
  base: THREE.Vector3;
  side: -1 | 1;
  /** 该条光带的起始帧（**全局 tick**，= 本次特效起点 + index*5） */
  startTick: number;
}

const paths: PathParticle[] = [];
const bands: Band[] = [];
/** 推进所需的现场（场景/相机/视口）—— 由最近一次 `runLevelUpFx` 记下（一个页面一个场景） */
let deps: LevelUpDeps | null = null;
let tick = 0;
/** "光带缺相机 ⇒ 不做位移"只报一次（否则每次升级都刷） */
let warnedNoCamera = false;

/**
 * 放一次升级特效。
 *
 * @param feet 该玩家**脚下**的世界坐标（服务端坐标即脚下）；抬高 `+32` 由本函数照源码加。
 */
export function runLevelUpFx(d: LevelUpDeps, feet: { x: number; y: number; z: number }): void {
  deps = d;
  if (!d.fx) {
    reportFallback('fx', '升级特效：调用方没给特效管理器（fx）⇒ 只放动态光');
  }
  const base = { x: feet.x, y: feet.y + LEVELUP_LIFT, z: feet.z };
  d.log?.(`  ⬆ 升级特效：锚点 = 脚下 +${LEVELUP_LIFT}（原版 pY + 32*fONE）`
    + ` @ (${base.x.toFixed(0)}, ${base.y.toFixed(0)}, ${base.z.toFixed(0)})`);

  // ① 动态光（白闪光，power 200 / dec 1）
  if (d.dynLights) {
    d.dynLights.set(base.x, base.y, base.z, DYN_LIGHT.r, DYN_LIGHT.g, DYN_LIGHT.b,
      DYN_LIGHT.a, DYN_LIGHT.power, DYN_LIGHT.decPower);
  } else {
    reportFallback('fx', '升级特效的 SetDynLight(150,150,150,255,200,1) 没放：调用方没给动态光池');
  }

  // ② 20 颗向心粒子（起始帧 0；飞行期间帧动画循环）
  const ring = levelUpRingSpawns({ x: base.x, y: base.y - PATH_DEST_DROP, z: base.z }, Math.random);
  for (const s of ring) {
    const dest = new THREE.Vector3(s.dest.x, s.dest.y, s.dest.z);
    const pos = new THREE.Vector3(s.cur.x, s.cur.y, s.cur.z);
    const vel = dest.clone().sub(pos);
    const len = vel.length();
    if (len < 1e-6) continue;
    vel.multiplyScalar(PATH_SPEED_PER_TICK / len);        // `Velocity = (dest−cur)/len × Speed`
    const carrier = new THREE.Group();
    carrier.name = 'levelup-path';
    carrier.position.copy(pos);
    d.scene.add(carrier);
    const p: PathParticle = { carrier, handle: null, stopRequested: false, pos, vel, dest,
      arrived: false, retireAt: Infinity };
    paths.push(p);
    // ⚠ 给了 `attach` ⇒ `pos` 不参与（emitter 落在载体原点，位置由载体给；见 `SpawnOpts.attach` 的约定）
    void d.fx?.spawnStoppable(PATH_INI, {
      pos: { x: 0, y: 0, z: 0 },
      size: PATH_SIZE_X, sizeY: PATH_SIZE_Y,
      loop: true,                       // `AniType = ANI_LOOP`（飞行期间一直循环）
      attach: carrier, rigidFollow: true,   // 整团随载体搬运（原版 sprite 跟着 primitive 走）
    }).then((h) => {
      p.handle = h;
      // ⚠ 句柄是**异步**回来的：若已经到达（`stop()` 已请求过），这里必须补一刀，
      //   否则循环发射的系统会一直闪下去（`loop: true` 的粒子没有"自然结束"）
      if (p.stopRequested) h?.stop();
    });
  }

  // ③ 5 记闪光：起始帧 25/30/35/40/45，位置 = 基点 + rand()%50（raw ⇒ 0..0.19 单位）
  // ⚠ 源码这里用的 `y` 是**上面 `y = y - 1000` 之后**的值（`y += 4000` 在下一个循环之前）
  //   ⇒ 闪光的基点比"动态光/锚点"低 1000 raw（= 3.906 单位），**别写成 base.y**。
  const flashBaseY = base.y - PATH_DEST_DROP;
  for (let index = 0; index < FLASH_COUNT; index++) {
    const j = () => (Math.random() * FLASH_JITTER_RAW) / FONE;
    void d.fx?.spawn(FLASH_INI, {
      pos: { x: base.x + j(), y: flashBaseY + j(), z: base.z + j() },
      delaySec: (index * FLASH_FRAME_STEP + FLASH_START_FRAME) / EFFECT_HZ,
    });
  }

  // ④ 左 5 + 右 5 光带：起始帧 0/5/10/15/20，位置 = 基点净上移 3000 raw，尺寸 40×10
  // ⚠ `tick` 是**全局**计数器（同一会话里第二次升级时它已经几百了）⇒ 起始帧必须挂在
  //   "本次特效的起点"上（`born`），否则第二批光带会**立刻生成并立刻退役**。
  const born = tick;
  const bandPos = { x: base.x, y: base.y + BAND_Y_RAW / FONE, z: base.z };
  for (let index = 0; index < BAND_COUNT; index++) {
    for (const side of [-1, 1] as const) {
      const carrier = new THREE.Group();
      carrier.name = 'levelup-band';
      carrier.position.set(bandPos.x, bandPos.y, bandPos.z);
      d.scene.add(carrier);
      const b: Band = { carrier, handle: null, spawnRequested: false, retired: false,
        base: new THREE.Vector3(bandPos.x, bandPos.y, bandPos.z),
        side, startTick: born + index * BAND_FRAME_STEP };
      bands.push(b);
    }
  }
}

/** 每帧推进（dt 秒）—— 只有 `runLevelUpFx` 放过的那些对象在这里动 */
export function updateLevelUpFx(dt: number): void {
  if (!paths.length && !bands.length) return;
  const d = deps;
  // 本帧折合多少 tick（`EFFECT_HZ` = 70）。**凡"原版每 tick 走一步"的量都必须乘它** ——
  // 漏了就变成"按帧走一步"，位移随帧率变（60fps 慢 14%、30fps 慢一倍多，观感像"粒子飘半天不进去"）。
  const dTick = dt * EFFECT_HZ;
  tick += dTick;

  // ② 向心粒子：直线匀速飞行，到 3.125 单位内停发并退役（原版 `HoPhysicsDest` + `ANI_ONE` 收尾）
  for (let i = paths.length - 1; i >= 0; i--) {
    const p = paths[i]!;
    if (!p.arrived) {
      p.pos.addScaledVector(p.vel, dTick);   // `vel` 是**每 tick** 的步进（`Speed = 800` raw/256）
      p.carrier.position.copy(p.pos);
      if (p.pos.distanceTo(p.dest) < PATH_STOP_DIST) {
        p.arrived = true;
        p.stopRequested = true;
        p.handle?.stop();
        // 停发后给已在飞的粒子一点时间自然消亡（< 一帧动画的时长），再摘载体
        p.retireAt = tick + 4;
      }
    } else if (tick >= p.retireAt) {
      p.stopRequested = true;
      p.handle?.stop();
      p.carrier.removeFromParent();
      paths.splice(i, 1);
    }
  }

  // ④ 光带：到起始帧才生（原版 `AddObject(obj, index*5)`），此后每帧按像素位移摆位
  for (let i = bands.length - 1; i >= 0; i--) {
    const b = bands[i]!;
    if (tick >= b.startTick && !b.spawnRequested) {
      b.spawnRequested = true;
      // 同上：位置由载体（`b.carrier`，已被每帧摆到换算后的位置）给，`pos` 不参与
      void d?.fx?.spawnStoppable(b.side < 0 ? BAND_INI_LEFT : BAND_INI_RIGHT, {
        pos: { x: 0, y: 0, z: 0 },
        size: BAND_SIZE_X, sizeY: BAND_SIZE_Y,
        attach: b.carrier, rigidFollow: true,   // 载体带着系统走 ⇒ 位移由我们每帧给
      }).then((h) => {
        b.handle = h;
        if (b.retired) h?.stop();      // 停发请求早于句柄到达（异步）⇒ 补一刀
      });
      d?.log?.(`  ⬆ 光带 ${b.side < 0 ? '左' : '右'} @ 第 ${b.startTick} 帧（原版 AddObject(obj, index*5)）`);
    }
    if (b.spawnRequested) applyBandOffset(d, b);   // 句柄未到也要摆位（位移是载体的事）
    // 寿命 = INI 的 160 tick（Delay 40+40+80）：到点停发 + 摘除
    if (tick >= b.startTick + BAND_LIFE_TICKS) {
      b.retired = true;
      b.handle?.stop();
      b.carrier.removeFromParent();
      bands.splice(i, 1);
    }
  }
}

/**
 * 把光带的像素偏移换算成**相机空间**位移并摆到载体上。
 *
 * 原版是屏幕空间（`Draw` 把 `TranslateMoveX/Y` 加在**投影后**的顶点上，`HoEffect.cpp:1641-1664`）；
 * 我们只能在世界空间表达 ⇒ 把基准点投影到 NDC、在 NDC 上按画布尺寸加偏移、再反投影回同一深度：
 * 屏幕上的位移于是**恒等于原版的像素数**（远近一致）。
 */
function applyBandOffset(d: LevelUpDeps | null, b: Band): void {
  const off = levelUpBandOffsetPx(tick - b.startTick, b.side);
  const cam = d?.camera ?? null;
  const vp = d?.viewport?.() ?? null;
  if (!cam || !vp || vp.width <= 0 || vp.height <= 0) {
    if (!warnedNoCamera) {
      warnedNoCamera = true;
      reportFallback('fx', '升级特效的两侧光带：没有相机/视口 ⇒ **不做屏幕位移**（原版 ±230px 内收）'
        + '，只把它们摆在锚点旁');
    }
    b.carrier.position.copy(b.base);
    return;
  }
  // 相机矩阵要新鲜：本函数在渲染之前跑（`renderer.render` 才更新 matrixWorldInverse）
  cam.updateMatrixWorld();
  cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
  const ndc = b.base.clone().project(cam);
  ndc.x += (off.x * 2) / vp.width;
  ndc.y += (off.y * 2) / vp.height;      // 屏幕 y 向下、NDC y 向上 ⇒ 直接用 off.y 的符号
  const world = ndc.unproject(cam);
  b.carrier.position.copy(world);
}

/** 清空（换图/退出；与其它 runner 的 `clear*` 同义） */
export function clearLevelUpFx(): void {
  for (const p of paths) { p.handle?.stop(); p.carrier.removeFromParent(); }
  for (const b of bands) { b.handle?.stop(); b.carrier.removeFromParent(); }
  paths.length = 0;
  bands.length = 0;
  tick = 0;
  deps = null;
  warnedNoCamera = false;
}

/** 诊断：当前在飞/在播的个数（验证脚本与 lab 用） */
export function levelUpFxCounts(): { paths: number; bands: number; tick: number } {
  return { paths: paths.length, bands: bands.length, tick };
}
