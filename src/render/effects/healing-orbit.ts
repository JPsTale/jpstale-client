/**
 * Healing 的**旋转小天使** —— `sinEffect_Healing2`（`sinSkillEffect.cpp:1632-1668`）第二份实例的
 * 完整移植（2026-09-26 三次返工：用户两轮指正——第一版丢了旋转/上升/淡出，第二版用广告牌
 * 是臆测；**原版形态 = 一只 30 帧扇翅动画的小天使网格**，绕角色公转、边转边升、末段淡出）。
 *
 * ── 原版参数（逐条出处）──
 *   · `sinEffectDefaultSet(Index2, SIN_EFFECT_MESH, pChar, 0, 7000)`（`:1646`）——
 *     **Y = 7000 是高度偏移**（`sinEffect2.cpp:1201-1220`：`Posi.y = pChar->pY + Y`）
 *     ⇒ 锚点 = 角色位置上方 **7000/256 ≈ 27.34 世界单位**（上身/头颈高度）。
 *     （第一份 `BoneFlag = 1` 贴骨实例 Y = 13000 ≈ 50.8，**未移植**——需要骨骼挂载，presenter 上报。）
 *   · `Max_Time = 250`（`:1654`）—— 生命周期 250 逻辑帧（@70fps ≈ 3.57s）。
 *   · `AniCount = 1; AniMax = 30; AniTime = 1`（`:1655-1657`，末值生效）—— 网格自带 **30 帧**
 *     旋转/扇翅轨道（实测 `hialtest.smd`：`tmRot` 32 键），由 `applyStaticMeshTracks` 播放。
 *   · `Color_A = 150`（`:1659`）—— 初始不透明度 150/255。
 *   · `RotateAngle = 256`（`:1661`）—— 每帧公转 256（PT 角度制 4096/圈 = 1/16 圈/帧）。
 *   · `RotateDistance.z = 256 * 16`（`:1662`）—— 公转半径 **16 世界单位**。
 *   · `Angle.y`（`:1663`）—— 朝向随公转同步。
 *   · `MoveSpeed.y = 200`（`:1664`）—— 每帧上升 200/256 ≈ 0.78 单位（一边转一边升）。
 *   · `AlphaTime = Max_Time - 20`、`AlphaAmount = 10`（`:1665-1667`）—— 最后 20 帧每帧 -10/255 淡出。
 *
 * 渲染走 `static-fx`（**动画网格**加载器，与法阵同一条路——这不是粒子脚本，quarks 不适用）。
 * 驱动模式与 `multi-spark-runner` 同款：调用方每帧调 {@link updateHealingOrbits}（70fps 逻辑帧）。
 */
import * as THREE from 'three';
import { loadStaticSmd, applyStaticMeshTracks, type StaticMeshTrack } from './static-fx.js';
import { reportFallback } from '../../char/fallback-log.js';

const MESH = 'image/sinimage/effect/skilleffect/healing/hialtest.smd';
const ANCHOR_LIFT = 7000 / 256;        // sinEffectDefaultSet 的 Y=7000 ⇒ 头颈高度
const MAX_TIME = 250;                  // Max_Time
const TURN_PER_FRAME = 256 / 4096;     // RotateAngle（4096 = 整圈）
const RADIUS = 16;                     // RotateDistance.z = 256*16（raw）÷256
const RISE_PER_FRAME = 200 / 256;      // MoveSpeed.y
const BASE_ALPHA = 150 / 255;          // Color_A
const FADE_AT = 230;                   // AlphaTime = Max_Time - 20
const ANI_FRAMES = 30;                 // AniMax
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

/** 起一份旋转小天使（`at` = 被治疗者**脚底**位置；原版 `pChar` = 目标 ?: 自己） */
export function runHealingOrbit(
  deps: { scene: THREE.Scene; log?: (msg: string) => void },
  at: { x: number; y: number; z: number },
  fxScale = 1,
): void {
  void loadStaticSmd(MESH, { upAxis: 'z' }).then((r) => {
    if (!r) {
      reportFallback('skillfx', 'Healing 小天使网格加载失败（' + MESH + '）⇒ 不放');
      return;
    }
    // 克隆实例 + **克隆材质**（末段淡出要逐实例改透明度，不能动缓存里的共享材质）
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
        mats.push(c);
        return c;
      });
    });
    if (fxScale !== 1) root.scale.multiplyScalar(fxScale);
    deps.scene.add(root);
    deps.log?.(`  ✦ Healing 小天使：锚点上方 ${ANCHOR_LIFT.toFixed(1)}、绕头 r=${RADIUS} 公转上升`
      + `（${MAX_TIME} 帧，网格 ${r.tracks?.length ?? 0} 条动画轨道）`);
    live.push({ root, mats, tracks: r.tracks, at: { ...at }, frame: 0 });
  }).catch((e) => {
    reportFallback('skillfx', 'Healing 小天使起放抛错：' + String(e));
  });
}

/** 每帧调一次（WorldView 帧循环）：自身扇翅动画 + 公转 + 上升 + 末段淡出 */
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
    o.root.position.set(
      o.at.x + Math.cos(ang) * RADIUS,
      o.at.y + ANCHOR_LIFT + o.frame * RISE_PER_FRAME,
      o.at.z + Math.sin(ang) * RADIUS,
    );
    o.root.rotation.y = -ang;   // Angle.y 与公转同步（原版 :1663）
    // 网格自身的 30 帧扇翅轨道（AniTime=1 ⇒ 每逻辑帧 1 帧）
    if (o.tracks?.length) applyStaticMeshTracks(o.tracks, Math.min(o.frame, ANI_FRAMES) * 160);
    // 末 20 帧：Color_A 150 每帧 -10/255 → 0
    const alpha = o.frame >= FADE_AT
      ? Math.max(0, (150 - (o.frame - FADE_AT) * 10) / 255)
      : BASE_ALPHA;
    for (const m of o.mats) m.opacity = alpha;
  }
}
