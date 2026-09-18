/**
 * 怪物「飞出物」的**唯一驱动**（原版 `AssaParticle_*` 那一族）—— 游戏（WorldView）与怪物实验室共用。
 *
 * 为什么必须共用：这条能力原先**只有实验室实现**，游戏侧一行都没有
 * ⇒ `RunicGuardianShot`（0x1580，`fly`）在游戏里根本不飞，只有实验室能看到。
 * 同一个"会不会飞"的判定在仓库里出现第二份就是 bug 的种子（AGENTS #15），故收在这里。
 *
 * 两种运动模型，都取自原版源码（**逐行照抄，不按手感归纳**）：
 *   · `linear` —— `AssaParticle.cpp:7474` `Main()`：每帧整体搬运 `step = 5*fONE + 100`
 *     （≈5.39 世界单位/帧 ⇒ 323/秒）；到达判定 `:7492`：距终点 **< 25** 或**超时 60 帧**。
 *     ⚠ 关键是"**搬运的是实例、不是粒子**"：`.part` 里粒子自身初速只有 ~1/秒（几乎不动），
 *       移动的是系统位置 ⇒ 观感是"**一团**粒子被整体搬运着飞" = 一颗火球。
 *       我一度改成"给粒子 323/s 初速"—— 那是反的：粒子各自散开拉成一条，看着像冲击波
 *       （用户实测指出"原版是飞出一个法球"）。故这里一律用 `attach + rigidFollow`（整团跟随）。
 *   · `homing` —— `AssaParticle.cpp:5465` `AssaSkill3VigorBall::Main()`：每帧
 *     `Velocity += 指向目标的单位向量`（= 加速度 1 单位/帧²），
 *     `length < 100` 时 `Velocity *= 0.85`，`|Velocity| > 10` 时 `*= 0.9`（软上限），
 *     到达 `length < 15 || Time > 100` ⇒ `SetStop` + 播命中资产。
 *     目标 = **目标的** `pY + PatHeight/2`（身体中部）—— 与我们 `unitBodyAnchorY` 同一条规则。
 *
 * ⚠ 积分按**帧**推进（`dt*60` 折帧，余量留到下一帧）：原版的加速度/阻尼/上限全是"每帧"的量，
 *   按 dt 直接积分会让 120Hz 与 60Hz 飞出不同的轨迹（MultiSpark 那份同理）。
 *
 * ⚠ 到点**必须停发**（原版 `SetStop`/`SetFastStop` → `FadeStop`）：用 `EffectManager.spawnStoppable`
 *   拿句柄；少了这一刀，粒子会在命中点一直堆（用户实测"飞到目标位置后不消失"）。
 *   载体节点随后再留 `RETIRE_FRAMES` 帧才摘（停发后粒子按自己的寿命消亡，留时间给它们播完；
 *   该时长是**我方资源管理决定**，不是原版数值）。
 *
 * ⚠ 跟随语义**逐系统**取值（原版两种调用，别一刀切）：
 *   `SetAttachPos` = 整团搬运（`follow: true`）/ `SetPos` = 只移发射点 ⇒ 粒子留在原地 = **拖尾**
 *   （`follow: false`）。VigorBall 就是"主系统拖尾 + 附加系统贴体"的组合。
 */
import * as THREE from 'three';
import { getMoveLocation, radToPtAngle } from '../../core/geom.js';
import type { MonsterFlySpec } from './monster-attack-fx.js';
import { waveCamera } from '../wave-camera.js';

/** 可停止句柄的最小契约（`QuarksPartHandle`）—— 到点停发 = 原版 `SetStop`/`FadeStop` */
export interface FlyHandle { stop(): void }

export interface FlyDeps {
  /**
   * 起粒子 —— 名字即 `.part` 资产名。
   *
   * ⚠ 必须用 `EffectManager.spawnStoppable`（**不是** `spawn`）：飞出物到点要停发，
   *   否则粒子会在命中点一直堆（原版那一对 `SetStop`/`SetFastStop`）。
   */
  spawn: (asset: string, opts: {
    pos: { x: number; y: number; z: number };
    attach?: THREE.Object3D;
    rigidFollow?: boolean;
  }) => FlyHandle | null | Promise<FlyHandle | null>;
  /** 载体节点要进场景（three 只对场景内的对象推进世界矩阵） */
  addToScene: (o: THREE.Object3D) => void;
  /** 到达时的动态光（原版 `SetDynLight`）。没传则跳过。返回 `void`/`boolean` 都收（两套契约都传进来过） */
  dynLight?: { set(x: number, y: number, z: number, r: number, g: number, b: number,
                   a: number, power: number, decPower: number): void | boolean } | null;
  /** 音效（**起飞**与**命中**各一条，见 `MonsterFlySpec.sound` / `.hit.sound`）；没传则跳过 */
  sound?: (path: string, pos: { x: number; y: number; z: number }) => void;
  log?: (s: string) => void;
}

export interface FlyLaunch {
  /** 发射点（世界坐标，**已含** `fly.lift` 抬高） */
  pos: { x: number; y: number; z: number };
  /** 射手朝向（弧度）—— 偏航基准（原版 `Angle.y`） */
  yaw: number;
  /** 每帧取目标身体中部；返回 null = 这次取不到，沿用上一次（目标会走动） */
  target: () => { x: number; y: number; z: number } | null;
  /** 本条动作的第几个事件帧（1 起，= 原版 `MotionEvent`）；驱 ±偏航镜像 */
  motionEvent?: number;
}

/**
 * 到达（已 `stop()`）后载体再留多少帧才摘。
 *
 * 停发后剩下的粒子按自己的寿命消亡（VigorBall 脚本里最长 0.5~1.0 s）⇒ 留 2 秒足够它们播完；
 * 再长就是白占场景（节点泄漏）。**这是我方资源管理决定，不是原版数值**。
 */
const RETIRE_FRAMES = 120;

/**
 * 发射偏航偏移（弧度）—— **唯一实现**。
 *
 * 原版 `AssaParticle_VigorBall`（`hoAssaParticleEffect.cpp:4170/4188`）：
 * `MotionEvent == 1` 走 `Angle.y - ANGLE_45`，否则 `Angle.y + ANGLE_45`
 * ⇒ 同一招的两个事件帧各放一颗，**左右各一**。
 */
export function flyYawOffsetRad(fly: MonsterFlySpec, motionEvent: number): number {
  if (!fly.yawOffsetDeg) return 0;
  const deg = fly.mirrorByMotionEvent && motionEvent !== 1 ? fly.yawOffsetDeg : -fly.yawOffsetDeg;
  return (deg * Math.PI) / 180;
}

interface LiveFly {
  node: THREE.Object3D;
  /** 世界单位/帧（原版 `Velocity`） */
  vel: THREE.Vector3;
  pos: THREE.Vector3;
  /** 上一次取到的目标（`target()` 返回 null 时沿用） */
  lastTarget: THREE.Vector3;
  target: () => { x: number; y: number; z: number } | null;
  fly: MonsterFlySpec;
  asset: string;
  frames: number;
  /** 还没开始飞（原版 `Delay`：连粒子都不生成，`Pos` 也不动） */
  delay: number;
  done: boolean;
  /** 已停发（到点或已到达）—— 迟到的句柄要按这个补一刀 */
  stopped: boolean;
  /** 各粒子系统的句柄（到点 `stop()`） */
  handles: FlyHandle[];
  retire: number;
  deps: FlyDeps;
}

/** 起一个粒子系统并**收好句柄** —— 句柄可能比飞行还晚到（`.part` 载入是异步的），故按 `stopped` 补刀 */
function take(l: LiveFly, asset: string, follow: boolean): void {
  const h = l.deps.spawn(asset, { pos: l.pos, attach: l.node, rigidFollow: follow });
  void Promise.resolve(h).then((handle) => {
    if (!handle) return;
    if (l.stopped) handle.stop();
    else l.handles.push(handle);
  });
}

const live: LiveFly[] = [];
let frameAcc = 0;

/** 正在飞的飞出物数量（诊断用） */
export function monsterFlyCount(): number {
  return live.length;
}

/** 放出一颗飞出物（发射即建载体节点；粒子挂上去跟着走） */
export function runMonsterFly(
  deps: FlyDeps, asset: string, fly: MonsterFlySpec, launch: FlyLaunch,
): void {
  const motionEvent = launch.motionEvent ?? 1;
  // 初速方向 = 射手朝向 ± 偏航偏移（原版 `GetMoveLocation(0,0,偏移量,0,Angle.y±ANGLE_45,0)`
  // 求出的向量再 `*2` 当速度 —— `*2` 已折进表里的 `initialSpeedPerFrame`，见台账）
  const off = fly.initialSpeedPerFrame
    ? getMoveLocation(0, 0, fly.initialSpeedPerFrame, 0,
        radToPtAngle(launch.yaw + flyYawOffsetRad(fly, motionEvent)), 0)
    : { x: 0, y: 0, z: 0 };

  const node = new THREE.Object3D();
  const t0 = launch.target();
  // 起点：默认调用方给的（射手身上 + `lift`）；**`fromTargetSky`** 时改由"目标上空"算
  // （原版 `ParkAssaChaosKaraMeteo::Start`：`curPos = destPos + (0, 130000, 50000)`，world 轴）
  const sky = fly.fromTargetSky;
  if (sky && t0) {
    const d = destOf(t0, fly);
    node.position.set(d.x, d.y + sky.up, d.z + sky.back);
  } else {
    node.position.set(launch.pos.x, launch.pos.y, launch.pos.z);
  }
  deps.addToScene(node);

  const l: LiveFly = {
    node,
    vel: new THREE.Vector3(off.x, off.y, off.z),
    pos: node.position.clone(),
    lastTarget: new THREE.Vector3(),
    target: launch.target,
    fly, asset, frames: 0, delay: fly.delayFrames ?? 0,
    done: false, stopped: false, handles: [], retire: RETIRE_FRAMES, deps,
  };
  if (t0) l.lastTarget.set(t0.x, t0.y, t0.z);
  live.push(l);

  deps.log?.(`  ✈ 飞出物 ${asset}${fly.systems?.length ? ` +${fly.systems.length}` : ''} 起飞（`
    + `${fly.homing ? '跟踪' : '直线'}`
    + `${fly.fromTargetSky ? '，起点=目标上空' : ''}`
    + `${fly.delayFrames ? `，延迟 ${fly.delayFrames} 帧` : ''}`
    + `${fly.yawOffsetDeg ? `，偏航 ${((flyYawOffsetRad(fly, motionEvent) * 180) / Math.PI).toFixed(0)}°` : ''}）`
    + `　起点 (${node.position.x.toFixed(1)}, ${node.position.y.toFixed(1)}, ${node.position.z.toFixed(1)})`);

  // **延迟**：原版先 `Delay--` 到 0 才 `Start`（这期间连粒子都没有、`Pos` 也不动）
  // ⇒ 这里也等到延迟结束再挂粒子（提前 `take()` 会让它在天上挂着不动）
  if (l.delay > 0) return;
  takeAll(l);
}

/** 挂上主系统与附加系统 —— 延迟结束时才调（唯一一处；起飞音也在这里，与"真的起粒子"同一时刻） */
function takeAll(l: LiveFly): void {
  // 跟随语义**逐个系统照抄原版**（不是一刀切）：
  //   `SetAttachPos` ⇒ `follow: true`（整团被搬运 —— 如 RunicGuardian、VigorBall 的附加系统）
  //   `SetPos`      ⇒ `follow: false`（只移发射点，**粒子留在原地 = 拖尾** —— VigorBall 的主系统）
  take(l, l.asset, l.fly.follow === true);
  for (const s of l.fly.systems ?? []) take(l, s.asset, s.follow === true);
  if (l.fly.sound) l.deps.sound?.(l.fly.sound, l.node.position);   // 起飞音（原版 `esPlaySound(20)`）
}

/** 落点 = 目标 + `targetOffset`（原版 `attackPos = destPos + (0,0,±10000)`） */
function destOf(t: { x: number; y: number; z: number }, fly: MonsterFlySpec): THREE.Vector3 {
  const o = fly.targetOffset;
  return new THREE.Vector3(t.x + (o?.x ?? 0), t.y + (o?.y ?? 0), t.z + (o?.z ?? 0));
}

/** 每帧推进（由主循环调用；漏了它 = 飞出物停在起点不动，与 MultiSpark 那次同源） */
export function updateMonsterFlies(dt: number): void {
  if (live.length === 0) return;
  frameAcc += dt * 60;
  let n = Math.floor(frameAcc);
  if (n <= 0) return;
  frameAcc -= n;
  if (n > 10) n = 10;              // 掉帧时别一口气追几十帧（原版一帧一帧跑）
  for (let i = live.length - 1; i >= 0; i--) {
    const l = live[i]!;
    if (l.done) {
      if (--l.retire <= 0) { l.node.removeFromParent(); live.splice(i, 1); }
      continue;
    }
    for (let k = 0; k < n && !l.done; k++) stepFly(l);
  }
}

function stepFly(l: LiveFly): void {
  // **延迟期**：原版 `Delay--` 到 0 才 `Start`，且 `Pos` 在此期间不动（`Main` 的移动块由 `ParticleID != -1` 把守）
  if (l.delay > 0) {
    if (--l.delay === 0) takeAll(l);
    return;
  }
  const t = l.target();
  if (t) l.lastTarget.set(t.x, t.y, t.z);
  // 落点 = 目标 + `targetOffset`（每帧现算：目标会走动，原版也是拿 `destPos` 现算）
  const dest = l.fly.targetOffset ? destOf(l.lastTarget, l.fly) : l.lastTarget;
  l.frames++;

  const dx = dest.x - l.pos.x, dy = dest.y - l.pos.y, dz = dest.z - l.pos.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

  if (l.fly.homing) {
    const h = l.fly.homing;
    if (dist < h.arriveDist || l.frames > h.arriveFrames) { arrive(l, dist); return; }
    // 原版：`Velocity += 指向目标的单位向量`（长度按 fONE 归一 ⇒ 单位/帧）
    if (dist > 1e-6) {
      l.vel.x += dx / dist; l.vel.y += dy / dist; l.vel.z += dz / dist;
    }
    if (dist < h.dampDist) l.vel.multiplyScalar(h.damp);
    if (l.vel.length() > h.maxSpeedPerFrame) l.vel.multiplyScalar(h.softClamp);
  } else {
    // 直线：原版每帧整体搬运固定步长（`AssaParticle.cpp:7474`），与距离无关
    const step = (l.fly.speed ?? 0) / 60;
    if (dist < (l.fly.arriveDist ?? 25) || l.frames > (l.fly.maxFrames ?? 60)) { arrive(l, dist); return; }
    if (dist > 1e-6) {
      l.vel.set((dx / dist) * step, (dy / dist) * step, (dz / dist) * step);
    }
  }

  l.pos.add(l.vel);
  l.node.position.copy(l.pos);
}

function arrive(l: LiveFly, dist: number): void {
  l.done = true;
  l.stopped = true;
  // **停发**（原版到点那一对 `SetStop`/`SetFastStop` → `FadeStop`：不再发射，已在飞的粒子自行消亡）。
  // 少了这一刀，粒子会在命中点一直堆 —— 用户实测"飞到目标位置后不消失"就是这个。
  //
  // ⚠ **只停自己这一份**（句柄是逐次 spawn 的）。我曾在这里加过"按资产名再全局停一次"作为保险 ——
  //   那是**有害的**：CC 的 4 颗陨石同名，第 1 颗落地就把还在飞的 2/3/4 颗一起停了
  //   ⇒ 用户实测"4 道轨迹只剩第 1 道"。当时以为句柄失效，真凶其实是**spec 缓存撞名**
  //   （命中特效复用了陨石的 spec，见 `spawnSystem` 的 key），那个已修 ⇒ 这里不需要任何保险。
  const n = l.handles.length;
  for (const h of l.handles) h.stop();
  l.handles.length = 0;
  const hit = l.fly.hit;
  l.deps.log?.(`    ✈ 飞出物 ${l.asset} 到达（距目标 ${dist.toFixed(1)} 单位）→ 停发 ${n} 个句柄`
    + `${hit?.asset ? `，命中 ${hit.asset}` : ''}${hit?.dynLight ? ' + 动态光' : ''}`);
  if (hit?.asset) void l.deps.spawn(hit.asset, { pos: l.pos });
  if (hit?.dynLight) {
    const d = hit.dynLight;
    l.deps.dynLight?.set(l.pos.x, l.pos.y, l.pos.z, d.r, d.g, d.b, d.a, d.power, d.decPower);
  }
  if (hit?.sound) l.deps.sound?.(hit.sound, l.pos);
  // **屏幕震动**（原版 `EffectWaveCamera((maxDist - 距离)/div, delay)`，距离 = 命中点与本机）
  if (hit?.shake) {
    const amp = Math.trunc((hit.shake.maxDist - dist) / hit.shake.div);
    waveCamera(amp, hit.shake.delay);
    l.deps.log?.(`    ✈ 屏幕震动：幅度 ${amp}（( ${hit.shake.maxDist} - ${dist.toFixed(0)} ) / ${hit.shake.div}），延迟 ${hit.shake.delay}`);
  }
}

/** 切图/销毁世界时清干净（否则残留节点会跟着新世界） */
export function clearMonsterFlies(): void {
  for (const l of live) l.node.removeFromParent();
  live.length = 0;
  frameAcc = 0;
}
