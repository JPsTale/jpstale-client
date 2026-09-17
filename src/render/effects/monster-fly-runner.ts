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
 * ⚠ 载体节点在**到达后延时摘除**：原版到点走 `SetStop`/`SetFastStop`（不再发射、已有粒子播完
 *   自己消亡）。我们加载的 `.part` 没有停止句柄（`spawn` 只回 `Promise<boolean>`），
 *   所以既不能立刻摘（粒子会瞬间全灭，命中那一下就没有了）、也不能永不摘（节点泄漏）。
 *   延时值 `RETIRE_FRAMES` 是**我方资源管理决定**，不是原版数值。
 */
import * as THREE from 'three';
import { getMoveLocation, radToPtAngle } from '../../core/geom.js';
import type { MonsterFlySpec } from './monster-attack-fx.js';

export interface FlyDeps {
  /** 起粒子（`EffectManager.spawn`）—— 名字即 `.part`/INI 资产名 */
  spawn: (asset: string, opts: {
    pos: { x: number; y: number; z: number };
    attach?: THREE.Object3D;
    rigidFollow?: boolean;
  }) => void | Promise<boolean>;
  /** 载体节点要进场景（three 只对场景内的对象推进世界矩阵） */
  addToScene: (o: THREE.Object3D) => void;
  /** 到达时的动态光（原版 `SetDynLight`）。没传则跳过 */
  dynLight?: { set(x: number, y: number, z: number, r: number, g: number, b: number,
                   a: number, power: number, decPower: number): boolean } | null;
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

/** 到达后载体保留多少帧再摘（我方资源管理决定，见文件头） */
const RETIRE_FRAMES = 240;

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
  done: boolean;
  retire: number;
  deps: FlyDeps;
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
  node.position.set(launch.pos.x, launch.pos.y, launch.pos.z);
  deps.addToScene(node);

  const l: LiveFly = {
    node,
    vel: new THREE.Vector3(off.x, off.y, off.z),
    pos: node.position.clone(),
    lastTarget: new THREE.Vector3(),
    target: launch.target,
    fly, asset, frames: 0, done: false, retire: RETIRE_FRAMES, deps,
  };
  const t0 = launch.target();
  if (t0) l.lastTarget.set(t0.x, t0.y, t0.z);
  live.push(l);

  // 主粒子：`rigidFollow` ⇒ 整团被搬运（原版 `SetPos`）；附加系统同挂（原版 `SetAttachPos`）
  void deps.spawn(asset, { pos: launch.pos, attach: node, rigidFollow: true });
  for (const s of fly.systems ?? []) {
    void deps.spawn(s.asset, { pos: launch.pos, attach: node, rigidFollow: true });
  }
  deps.log?.(`  ✈ 飞出物 ${asset}${fly.systems?.length ? ` +${fly.systems.length}` : ''} 起飞（`
    + `${fly.homing ? '跟踪' : '直线'}`
    + `${fly.yawOffsetDeg ? `，偏航 ${((flyYawOffsetRad(fly, motionEvent) * 180) / Math.PI).toFixed(0)}°` : ''}）`
    + `　起点 (${launch.pos.x.toFixed(1)}, ${launch.pos.y.toFixed(1)}, ${launch.pos.z.toFixed(1)})`);
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
  const t = l.target();
  if (t) l.lastTarget.set(t.x, t.y, t.z);
  const dest = l.lastTarget;
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
    if (dist < 25 || l.frames > 60) { arrive(l, dist); return; }
    if (dist > 1e-6) {
      l.vel.set((dx / dist) * step, (dy / dist) * step, (dz / dist) * step);
    }
  }

  l.pos.add(l.vel);
  l.node.position.copy(l.pos);
}

function arrive(l: LiveFly, dist: number): void {
  l.done = true;
  const hit = l.fly.hit;
  l.deps.log?.(`    ✈ 飞出物 ${l.asset} 到达（距目标 ${dist.toFixed(1)} 单位）`
    + `${hit?.asset ? ` → 命中 ${hit.asset}` : ''}${hit?.dynLight ? ' + 动态光' : ''}`);
  if (hit?.asset) void l.deps.spawn(hit.asset, { pos: l.pos });
  if (hit?.dynLight) {
    const d = hit.dynLight;
    l.deps.dynLight?.set(l.pos.x, l.pos.y, l.pos.z, d.r, d.g, d.b, d.a, d.power, d.decPower);
  }
}

/** 切图/销毁世界时清干净（否则残留节点会跟着新世界） */
export function clearMonsterFlies(): void {
  for (const l of live) l.node.removeFromParent();
  live.length = 0;
  frameAcc = 0;
}
