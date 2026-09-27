/**
 * Healing 的**头顶旋转上升光环** —— quarks 粒子实现（2026-09-26 二次返工：用户指出
 * 上一版"没有按照我们的技术方案走 quarks"——用了静态 SMD 网格 + 手动变换，偏离方案；
 * 且网格只有 7×4×10 单位再乘 0.59 透明度 ⇒ 实机根本看不见）。
 *
 * ── 原版语义（`sinEffect_Healing2`，`sinSkillEffect.cpp:1632-1668`）──
 *   · `RotateAngle = 256` —— 每逻辑帧自转 256（PT 角度制 4096/圈）⇒ 绕锚点公转；
 *   · `RotateDistance.z = 256 * 16` —— 公转半径 **16 世界单位**；
 *   · `MoveSpeed.y = 200` —— 每帧上升 200/256 ≈ **0.78 单位**（一边转一边升）；
 *   · `Max_Time = 250` —— 生命周期 250 逻辑帧（@70fps ≈ 3.57s）；
 *   · `Color_A = 150` —— 初始 alpha 150/255；`AlphaTime = Max_Time - 20`、`AlphaAmount = 10`
 *     ⇒ **最后 20 帧每帧 -10 线性淡出**（keyframes：hold 到 230 帧，再 fade 到 0）。
 *   · 贴图 = `HIAL.bmp`（smd 材质表里的那张，与网格同目录；"小天使"精灵图）。
 *
 * ⚠ **与源文件的形态差异（显式声明）**：原版是 ASE **网格**（AniMax 30 = 30 个顶点姿势的
 *   扇翅动画）；quarks 走 **HIAL.bmp 广告牌**（单帧精灵，无扇翅）—— 按"技术方案：粒子走 quarks"
 *   的用户口径实现；扇翅要等 ASE 逐帧姿势进渲染层，缺口在 presenter 的上报里可见。
 *
 * 驱动模式与 `multi-spark-runner` 同款：载体节点每帧摆到轨道点，粒子 `rigidFollow` 跟随。
 */
import * as THREE from 'three';
import type { PartSystem } from '../../core/effect/part-script.js';
import { reportFallback } from '../../char/fallback-log.js';

/** 贴图：`sinSkillEffect.cpp` 的 HIALTEST.ASE 材质引用（smd 材质表 texturePaths 实测同张） */
export const HEALING_TEX = 'image\\Sinimage\\Effect\\SkillEffect\\Healing\\HIAL.bmp';

const MAX_TIME = 250;
const FPS = 70;
const LIFE_SEC = MAX_TIME / FPS;                 // ≈3.57s
const FADE_FROM_FRAME = 230;                     // AlphaTime = Max_Time - 20
const TURN_PER_FRAME = 256 / 4096;               // RotateAngle（4096 = 整圈）
const RADIUS = 256 * 16 / 256;                   // RotateDistance.z = 16 世界单位
const RISE_PER_FRAME = 200 / 256;                // MoveSpeed.y
const SIZE = 8;                                  // 广告牌边长（世界单位）——原网格包围盒 ~7 单位量级；
                                                 // 原版网格渲染的"尺寸"由 ASE 几何给出，广告牌无对应字段
                                                 // ⇒ 我方定（fxScale 可整体调）。
/** keyframes 的 color 事件按**秒**给（渲染层 `k.time / lifetimeSec` 归一） */
const HOLD_SEC = FADE_FROM_FRAME / FPS;

/** 单颗光环粒子：LAMP 广告牌，末 20/250 帧线性淡出 */
export function healingOrbitSystem(): PartSystem {
  const num = (v: number) => ({ k: 'n' as const, v });
  const vec = (x: number, y: number, z: number) => ({ x: num(x), y: num(y), z: num(z) });
  const a0 = 150 / 255;
  return {
    name: 'HealingOrbit',
    version: 1,
    position: null,
    emitters: [{
      name: 'Angel',
      blend: 'lamp',
      particleType: 1,
      numParticles: 1,
      emitRate: 60,
      loops: 1,
      delay: 0,
      lifetime: num(LIFE_SEC),
      emitRadius: vec(0, 0, 0),
      initialVelocity: vec(0, 0, 0),
      gravity: vec(0, 0, 0),
      texture: HEALING_TEX,
      initialSize: num(SIZE),
      initialSizeExt: num(SIZE),
      initialColor: { r: num(255), g: num(255), b: num(255), a: num(a0 * 255) },
      initialPartAngle: null,
      initialLocalAngle: null,
      finalColor: { r: num(255), g: num(255), b: num(255), a: num(0) },
      finalSize: num(SIZE),
      finalSizeExt: num(SIZE),
      finalPartAngle: null,
      finalLocalAngle: null,
      finalVelocity: null,
      // 末段淡出：hold 到 AlphaTime（230 帧）原值，之后线性降到 0（Max_Time 归零）
      keyframes: {
        color: [
          { time: HOLD_SEC, value: { k: 'color', v: { r: num(255), g: num(255), b: num(255), a: num(a0 * 255) } }, fade: false },
          { time: LIFE_SEC, value: { k: 'color', v: { r: num(255), g: num(255), b: num(255), a: num(0) } }, fade: true },
        ],
      },
    }],
  };
}

interface HealingOrbit {
  node: THREE.Object3D;
  at: { x: number; y: number; z: number };
  frame: number;
}
const live: HealingOrbit[] = [];
let frameAcc = 0;

/** 起一份旋转光环（`at` = 被治疗者位置；原版 `pChar` = 目标 ?: 自己） */
export function runHealingOrbit(
  deps: { effects: { spawnSystem: (s: PartSystem, o: { pos: { x: number; y: number; z: number }; attach?: THREE.Object3D; rigidFollow?: boolean }) => Promise<unknown> | null } | null;
         scene: THREE.Scene; log?: (msg: string) => void },
  at: { x: number; y: number; z: number },
  fxScale = 1,
): void {
  if (!deps.effects) {
    reportFallback('skillfx', 'Healing 光环没起：没有 effects（未接渲染器）');
    return;
  }
  const node = new THREE.Object3D();
  node.position.set(at.x, at.y, at.z);
  if (fxScale !== 1) node.scale.multiplyScalar(fxScale);
  deps.scene.add(node);
  void deps.effects.spawnSystem(healingOrbitSystem(), { pos: { ...at }, attach: node, rigidFollow: true });
  deps.log?.(`  ✦ Healing 光环：绕锚点 r=${RADIUS} 旋转上升 ${LIFE_SEC.toFixed(2)}s（quarks/HIAL.bmp）`);
  live.push({ node, at: { ...at }, frame: 0 });
}

/** 每帧调一次（WorldView 帧循环）：公转 + 上升（末段淡出由 quarks keyframes 自己走） */
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
      // 粒子寿命与轨道同步（Max_Time 到 ⇒ quarks 系统已自然结束；摘载体）
      o.node.removeFromParent();
      live.splice(i, 1);
      continue;
    }
    const ang = o.frame * TURN_PER_FRAME * Math.PI * 2;
    o.node.position.set(
      o.at.x + Math.cos(ang) * RADIUS,
      o.at.y + o.frame * RISE_PER_FRAME,
      o.at.z + Math.sin(ang) * RADIUS,
    );
  }
}
