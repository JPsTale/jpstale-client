/**
 * **Lua Mesh 块运行器**（`Begin("Mesh")` + `InitMeshName(...)` 那一族）—— 唯一实现：
 * lab 与将来的游戏侧共用（AGENTS #15：不写第二份）。
 *
 * 依据 C++ `HoEffectMeshController`（`NewEffect/HoEffectController.cpp`）：
 *   · 帧轴：`m_fCurrentFrame += 160*30*dt`（30fps、单位 160/帧）；`InitMaxFrame(f)` ⇒ `int(f*160)`
 *     （`:185`）。到顶回 0。
 *   · 到顶时**重置事件钟**（`m_fEventTimer = 0`、`CurrentEvent = NULL` ⇒ 颜色链重放）、
 *     `m_iLoopCount++`；`loop > 0 && loopCount >= loop` ⇒ 结束（基类默认 `m_iLoop(0)` = 无限，`:4`）。
 *   · 门控：`m_fStartDelayTime <= m_fTimer` 之后才开始推进（`InitStartDelayTime`）；
 *     `m_fTimer` **全程累加**（门控外，`:242`）。
 *   · 颜色：`InitColor` = 初值，`Event*Color` 链按同构算术（非 fade 到点赋值 / fade 算步长再累加，
 *     与 `.part` 的 `[S5]` 同一套）作用于 `m_Color`；渲染侧乘在网格材质上。
 *
 * 网格本体走 `static-fx.loadStaticSmd`（法阵 `MAAM2.ASE` 的既有实现），帧动画走
 * `applyStaticMeshTracks`（`smOBJ3D::TmAnimation` 的 `GetPosFrame` 线性插值）。
 */
import type * as THREE from 'three';
import { loadStaticSmd, applyStaticMeshTracks, type StaticMeshTrack } from './static-fx.js';
import { reportFallback } from '../../char/fallback-log.js';
import type { LuaMeshIR } from '../../core/effect/lua-script.js';

/** 帧轴推进速率：160 单位/帧 × 30fps（`HoEffectController.cpp:223`） */
const FRAME_UNITS_PER_SEC = 160 * 30;

interface Rgba { r: number; g: number; b: number; a: number }

interface LiveMesh {
  group: THREE.Group;
  dispose: () => void;
  /** 逐帧位移动画轨道（`static-fx` 的 `TmAnimation` 移植；空 = 网格静止） */
  tracks: StaticMeshTrack[] | undefined;
  ir: LuaMeshIR;
  /** 已生成的事件链（含 fade 目标下标），装载期建好 */
  events: Array<{ time: number; fade: boolean; rgba: Rgba; next: number }>;
  cursor: number;
  /** 事件钟（秒；到顶回绕时归零） */
  eventTimer: number;
  /** 总时钟（秒；门控与寿命都看它） */
  timer: number;
  frame: number;              // 帧轴（单位制）
  maxFrame: number;           // 帧轴上限（单位制；0 = 不动画）
  loopCount: number;
  color: Rgba;                // 当前颜色（含 alpha 0..255）
  step: Rgba;                 // 每分量步长（每秒）
  opacity: number;            // 最近一次写进材质的 alpha（0..1）
  done: boolean;
}

const live: LiveMesh[] = [];

/** 颜色链：每条事件向后找**第一条 fade**（同构 `.part` 的 `CreateFadeLists`，此处只有颜色一槽） */
function buildColorEvents(ir: LuaMeshIR): LiveMesh['events'] {
  const evs = ir.colorEvents
    .map((e) => ({
      time: e.time,
      fade: e.fade,
      rgba: { r: e.rgba[0], g: e.rgba[1], b: e.rgba[2], a: e.rgba[3] },
      next: -1,
    }))
    .sort((a, b) => a.time - b.time);
  for (let i = 0; i < evs.length; i++) {
    for (let j = i + 1; j < evs.length; j++) {
      if (evs[j]!.fade) { evs[i]!.next = j; break; }
    }
  }
  return evs;
}

/**
 * 放一个 Lua Mesh 块。
 * @returns 句柄（null = 加载失败，原因已上报）
 */
export async function spawnLuaMesh(
  ir: LuaMeshIR,
  scene: THREE.Object3D,
  /** 世界偏移（= 父 `Begin("Parent")` 的 InitPos + 本块 InitPos，已由调用方转 three） */
  offset?: { x: number; y: number; z: number },
): Promise<{ dispose: () => void } | null> {
  if (!ir.meshAsset) {
    reportFallback('fx', `Lua Mesh 块缺 InitMeshName ⇒ 不放（${ir.unsupported.map((u) => u.name).join('、') || '无其他命令'}）`);
    return null;
  }
  const r = await loadStaticSmd(ir.meshAsset);
  if (!r) {
    reportFallback('fx', `Lua Mesh「${ir.meshRaw}」→ 资源 ${ir.meshAsset} 加载失败`);
    return null;
  }
  // 组偏移：父 + 子（原版把 Mesh 块挂在组的变换下）——不给就是本块 InitPos
  if (offset) r.group.position.set(offset.x, offset.y, offset.z);
  else r.group.position.set(ir.pos[0], ir.pos[1], ir.pos[2]);
  scene.add(r.group);
  const color: Rgba = { r: ir.baseColor[0], g: ir.baseColor[1], b: ir.baseColor[2], a: ir.baseColor[3] };
  const m: LiveMesh = {
    group: r.group, dispose: r.dispose, tracks: r.tracks, ir,
    events: buildColorEvents(ir),
    cursor: 0, eventTimer: 0, timer: 0, frame: 0,
    maxFrame: Math.trunc(ir.maxFrame * 160),
    loopCount: 0,
    color, step: { r: 0, g: 0, b: 0, a: 0 },
    opacity: color.a / 255, done: false,
  };
  live.push(m);
  return { dispose: () => { removeMesh(m); } };
}

function removeMesh(m: LiveMesh): void {
  const i = live.indexOf(m);
  if (i >= 0) live.splice(i, 1);
  m.group.removeFromParent();
  m.dispose();
}

/** 事件触发（`HoEffectEventController::RunEvent` 的同构算术；先推进后触发，与 `.part` 同序） */
function runEvents(m: LiveMesh, dt: number): void {
  const evs = m.events;
  while (m.cursor < evs.length && evs[m.cursor]!.time <= m.eventTimer) {
    const ev = evs[m.cursor]!;
    if (!ev.fade) { m.color = { ...ev.rgba }; }        // 非 fade：到点赋值
    if (ev.next >= 0) {                                // fade 链：算步长（Δt=0 → 1）
      const nx = evs[ev.next]!;
      let delta = nx.time - ev.time;
      if (delta === 0) delta = 1;
      m.step = {
        r: (nx.rgba.r - m.color.r) / delta, g: (nx.rgba.g - m.color.g) / delta,
        b: (nx.rgba.b - m.color.b) / delta, a: (nx.rgba.a - m.color.a) / delta,
      };
    }
    m.cursor++;
  }
  m.color = {
    r: m.color.r + m.step.r * dt, g: m.color.g + m.step.g * dt,
    b: m.color.b + m.step.b * dt, a: m.color.a + m.step.a * dt,
  };
}

/** 每帧推进全部 Lua 网格（lab 与游戏侧都调它） */
export function updateLuaMeshes(dt: number): void {
  for (let i = live.length - 1; i >= 0; i--) {
    const m = live[i]!;
    m.timer += dt;                                     // `m_fTimer` 全程累加（门控外，:242）
    if (m.timer < m.ir.startDelay) continue;           // 门控之前不推进
    if (m.done) continue;

    m.eventTimer += dt;                                // 事件钟（秒）
    runEvents(m, dt);

    if (m.maxFrame > 0) {                              // 帧轴（0 = 不动画，与 C++ 缺省一致）
      m.frame += FRAME_UNITS_PER_SEC * dt;
      if (m.frame >= m.maxFrame) {                     // 到顶：回 0 + **重置事件链** + 轮次计数
        m.frame = 0;
        m.eventTimer = 0;
        m.cursor = 0;
        m.color = { r: m.ir.baseColor[0], g: m.ir.baseColor[1], b: m.ir.baseColor[2], a: m.ir.baseColor[3] };
        m.step = { r: 0, g: 0, b: 0, a: 0 };
        m.loopCount++;
        if (m.ir.loop > 0 && m.loopCount >= m.ir.loop) { m.done = true; removeMesh(m); continue; }
      }
      if (m.tracks?.length) applyStaticMeshTracks(m.tracks, m.frame);
    }

    // 颜色 → 材质（原版把 m_Color 乘进网格：不透明度 + 色调）
    m.opacity = Math.max(0, Math.min(1, m.color.a / 255));
    m.group.traverse((o) => {
      const mat = (o as THREE.Mesh).material as (THREE.Material & { opacity: number; color?: THREE.Color }) | undefined;
      if (!mat || !('opacity' in mat)) return;
      mat.opacity = m.opacity;
      if (mat.color) mat.color.setRGB(m.color.r / 255, m.color.g / 255, m.color.b / 255);
    });
  }
}

/** 清场（lab 切特效时调） */
export function clearLuaMeshes(): void {
  for (const m of [...live]) removeMesh(m);
}

/** 当前存活网格数（诊断/lab 读数用） */
export function luaMeshCount(): number { return live.length; }

/** 逐网格状态快照（诊断/lab 读数用：验证颜色链与帧轴真的在走） */
export function luaMeshStates(): Array<{ mesh: string; timer: number; eventTimer: number; frame: number;
  maxFrame: number; loopCount: number; alpha: number; opacity: number; done: boolean }> {
  return live.map((m) => ({
    mesh: m.ir.meshAsset.split('/').pop() ?? m.ir.meshAsset,
    timer: m.timer, eventTimer: m.eventTimer, frame: m.frame, maxFrame: m.maxFrame,
    loopCount: m.loopCount, alpha: m.color.a, opacity: m.opacity, done: m.done,
  }));
}
