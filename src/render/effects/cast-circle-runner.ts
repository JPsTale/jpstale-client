/**
 * 起手法阵的**装配与生命周期** —— 从怪物实验室抽出，实验室与游戏共用一份。
 *
 * 三件事：两张水平光环（`effects.spawnSystem`）+ 法阵本体（静态 `.smd`，需逐帧 alpha 包络）。
 * 包络见 `cast-circle.ts` 的 `CAST_MESH_FADE`（原版 `cASSAMESH::Main`）。
 */

import * as THREE from 'three';
import {
  castCircleSystems, castCircleFamily, CAST_LIFT, CAST_MESH_FADE,
} from './cast-circle.js';
import { loadStaticSmd } from './static-fx.js';
import type { PartSystem } from '../../core/effect/part-script.js';
import type { SystemSpawner } from './multi-spark-runner.js';

export interface CastCircleCtx {
  effects: SystemSpawner | null;
  scene: THREE.Scene;
  log?: (msg: string) => void;
}

/** 需要按包络淡入淡出的法阵本体（模块级：调用方只调 `updateCastCircleMeshes`） */
const fading: { group: THREE.Group; age: number; dispose: () => void }[] = [];

/** 本体的可见系数（原版 `cASSAMESH::Main`：前 `CAST_MESH_FADE` 秒渐显，随后同速率渐隐） */
function meshAlphaAt(t: number): number {
  if (t <= 0) return 0;
  if (t < CAST_MESH_FADE) return t / CAST_MESH_FADE;
  return Math.max(0, 1 - (t - CAST_MESH_FADE) / CAST_MESH_FADE);
}

/** 每帧调一次：推进法阵本体的包络（光环由 quarks 自己管寿命，不在这里） */
export function updateCastCircleMeshes(dt: number): void {
  for (let i = fading.length - 1; i >= 0; i--) {
    const f = fading[i]!;
    f.age += dt;
    const a = meshAlphaAt(f.age);
    f.group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m && 'opacity' in m) (m as THREE.MeshPhongMaterial).opacity = a;
    });
    if (f.age >= CAST_MESH_FADE * 2) {     // 可见期走完就收（之后原版也只是全透明的僵尸）
      f.group.removeFromParent();
      f.dispose();
      fading.splice(i, 1);
    }
  }
}

/**
 * 放一次起手法阵。
 * @param charFlag 家族（1 = MAAM1 / 2 = MAAM2）；@param type 0 = 常规、1 = 大一圈（见 `castCircleFamily`）
 */
export function runCastCircle(
  ctx: CastCircleCtx,
  pos: { x: number; y: number; z: number },
  opts: { charFlag: 1 | 2; type: 0 | 1 } = { charFlag: 2, type: 0 },
): void {
  if (!ctx.effects) { ctx.log?.('  ✗ 起手法阵：没有 effects（未接渲染器）'); return; }
  const at = { x: pos.x, y: pos.y + CAST_LIFT, z: pos.z };
  const sys = castCircleSystems(opts.charFlag, opts.type);
  for (const s of sys) void ctx.effects.spawnSystem(s as PartSystem, { pos: at });
  ctx.log?.(`  ⭕ 起手法阵：两张水平光环（CharFlag=${opts.charFlag} Type=${opts.type}）`);

  const fam = castCircleFamily(opts.charFlag, opts.type);
  void loadStaticSmd(fam.mesh).then((r) => {
    if (!r) { ctx.log?.(`  ✗ 法阵模型 ${fam.mesh} 加载失败`); return; }
    r.group.position.set(at.x, at.y, at.z);
    ctx.scene.add(r.group);
    fading.push({ group: r.group, age: 0, dispose: r.dispose });
    ctx.log?.(`  ⭕ 法阵本体 ${fam.mesh.split('\\').pop()}：${r.group.children.length} 个网格`);
  });
}
