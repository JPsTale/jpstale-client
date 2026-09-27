/**
 * Healing 的**头顶旋转上升光环** —— `sinEffect_Healing2`（`sinSkillEffect.cpp:1632-1668`）第二份
 * 网格的完整语义（2026-09-26 用户实测指正："它应该是在目标或自己头上有旋转的粒子表示恢复的"——
 * 上一版只放了静态网格，把旋转/上升/淡出全丢了）。
 *
 * ── 原版事实（逐条出处）──
 *   · `RotateAngle = 256`（`:1661`）—— 每游戏帧自转 256（PT 角度制，4096 = 整圈）⇒ 1/16 圈/帧。
 *   · `RotateDistance.z = 256 * 16`（`:1662`）—— 旋转半径 4096（raw）= **16 世界单位**。
 *   · `MoveSpeed.y = 200`（`:1664`）—— 每帧上升 200（raw）= **0.78 世界单位**（一边转一边升）。
 *   · `Max_Time = 250`（`:1654`）—— 生命周期 250 帧（@70fps ≈ 3.6s）。
 *   · `Color_A = 150`（`:1659`）—— 初始不透明度 150/255 ≈ 0.59（半透明）。
 *   · `AlphaTime = Max_Time - 20`、`AlphaAmount = 10`（`:1665-1667`）—— 最后 20 帧每帧 -10/255 淡出。
 *   · `AniMax = 30`（`:1656`）—— 网格自身序列帧 30 帧（`applyStaticMeshTracks` 推进）。
 *   · 同函数还有一份 `BoneFlag = 1` 的**贴骨跟随**份（`:1637-1643`）—— 仍**未移植**
 *     （需要骨骼挂载能力），`skill-fx-runner` 的 presenter 会显式上报。
 *
 * 驱动模式与 `multi-spark-runner` 同款：调用方每帧调 {@link updateHealingOrbits}（70fps 逻辑帧）。
 */
import * as THREE from 'three';
import { loadStaticSmd, applyStaticMeshTracks, type StaticMeshTrack } from './static-fx.js';
import { reportFallback } from '../../char/fallback-log.js';

const MESH = 'image/sinimage/effect/skilleffect/healing/hialtest.smd';
const MAX_TIME = 250;
const TURN_PER_FRAME = 256 / 4096;
const RADIUS = 16;
const RISE_PER_FRAME = 200 / 256;
const BASE_ALPHA = 150 / 255;
const FADE_AT = 230;
const FPS = 70;

interface HealingOrbit {
  root: THREE.Group;
  mats: THREE.Material[];
  tracks: StaticMeshTrack[] | undefined;
  at: { x: number; y: number; z: number };
  frame: number;
}
const live: HealingOrbit[] = [];
let frameAcc = 0;

/** 起一份旋转光环（`at` = 被治疗者位置；原版 `pChar` = 目标 ?: 自己） */
export function runHealingOrbit(
  deps: { scene: THREE.Scene; log?: (msg: string) => void },
  at: { x: number; y: number; z: number },
  fxScale = 1,
): void {
  void loadStaticSmd(MESH, { upAxis: 'z' }).then((r) => {
    if (!r) {
      reportFallback('skillfx', 'Healing 光环网格加载失败（' + MESH + '）⇒ 不放');
      return;
    }
    // 克隆实例 + **克隆材质**（透明度逐实例渐变，不能与缓存共享材质）
    const root = r.group.clone(true);
    const mats: THREE.Material[] = [];
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mesh.material = list.map((m0) => {
        const c = m0.clone();
        c.transparent = true;
        c.opacity = BASE_ALPHA;
        c.depthWrite = false;
        mats.push(c);
        return c;
      });
    });
    root.position.set(at.x, at.y, at.z);
    if (fxScale !== 1) root.scale.multiplyScalar(fxScale);
    deps.scene.add(root);
    deps.log?.(`  ✦ Healing 光环：绕头 r=${RADIUS} 旋转上升（${MAX_TIME} 帧），材质 ${mats.length} 份`);
    live.push({ root, mats, tracks: r.tracks, at: { ...at }, frame: 0 });
  }).catch((e) => {
    reportFallback('skillfx', 'Healing 光环起放抛错：' + String(e));
  });
}

/** 每帧调一次（与 `updateMultiSparkRunners` 同一调用点）：自转 + 上升 + 序列帧 + 末段淡出 */
export function updateHealingOrbits(dt: number): void {
  if (live.length === 0) return;
  frameAcc += dt * FPS;
  const n = Math.floor(frameAcc);
  if (n <= 0) return;
  frameAcc -= n;
  for (let i = live.length - 1; i >= 0; i--) {
    const o = live[i]!;
    o.frame += n;
    if (o.frame >= MAX_TIME) {
      o.root.removeFromParent();
      for (const m of o.mats) m.dispose();   // 只清克隆材质；几何/贴图归缓存管
      live.splice(i, 1);
      continue;
    }
    const ang = o.frame * TURN_PER_FRAME * Math.PI * 2;
    const rise = o.frame * RISE_PER_FRAME;
    o.root.position.set(o.at.x + Math.cos(ang) * RADIUS, o.at.y + rise, o.at.z + Math.sin(ang) * RADIUS);
    o.root.rotation.y = -ang;   // 面片随旋转同步转向（原版 Angle.y 与 RotateAngle 联动）
    if (o.tracks?.length) applyStaticMeshTracks(o.tracks, Math.min(o.frame, 30) * 160);   // AniMax=30（动画单位 160/帧）
    const alpha = o.frame >= FADE_AT
      ? Math.max(0, (150 - (o.frame - FADE_AT) * 10) / 255)
      : BASE_ALPHA;
    for (const m of o.mats) m.opacity = alpha;
  }
}
