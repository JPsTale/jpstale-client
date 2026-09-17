/**
 * 起手法阵的**装配与生命周期** —— 从怪物实验室抽出，实验室与游戏共用一份。
 *
 * 三件事：两张水平光环（`effects.spawnSystem`）+ 法阵本体（静态 `.smd`，需逐帧 alpha 包络）。
 * 包络见 `cast-circle.ts` 的 `CAST_MESH_FADE`（原版 `cASSAMESH::Main`）。
 */

import * as THREE from 'three';
import {
  castCircleSystems, castCircleFamily, CAST_LIFT, CAST_MESH_FADE, CAST_MESH_LIFE,
} from './cast-circle.js';
import { loadStaticSmd, applyStaticMeshTracks, type StaticMeshTrack } from './static-fx.js';
import type { PartSystem } from '../../core/effect/part-script.js';
import type { SystemSpawner } from './multi-spark-runner.js';
import { monsterCastOf } from './monster-attack-fx.js';

export interface CastCircleCtx {
  effects: SystemSpawner | null;
  scene: THREE.Scene;
  log?: (msg: string) => void;
}

/** 怪物技能起手的依赖 = 法阵那一套 + 能放起手音 */
export interface MonsterCastDeps extends CastCircleCtx {
  playSound?: (path: string, pos: { x: number; y: number; z: number }) => void;
}

/**
 * **怪物技能起手**（原版 `BeginSkill_Monster`，`character.cpp:14070`）：起手音 + 起手法阵。
 *
 * **唯一实现** —— 游戏（`WorldView`）与怪物实验室共用。此前只有实验室有这一环
 * （`monsterCastOf` 全仓只在实验室被调用）⇒ 游戏里怪物放技能**没有起手音、也没有法阵**；
 * 更严重的是游戏侧连"技能动作的事件帧"都没武装（`armMonster…` 只对 ATTACK 调）⇒
 * 技能特效本身也不会触发（用户 2026-09-18："能把它也接入 client 吗"）。
 *
 * 一个 `effectId` 下**所有技能共用**一套起手（取宿主条目的 `castSound` / `castMagic`）——
 * 与"这一次放的是哪一招"无关，故不需要 KeyCode。
 */
export function fireMonsterSkillCast(
  deps: MonsterCastDeps, effectId: number, pos: { x: number; y: number; z: number },
): void {
  const cast = monsterCastOf(effectId);
  if (!cast) return;
  if (cast.castSound) deps.playSound?.(cast.castSound, pos);
  if (cast.castMagic != null) {
    // `castMagic` = 原版 `sinEffect_StartMagic` 的 CharFlag：1 = MAAM1 / 2 = MAAM2（缺省按 2）
    runCastCircle(deps, pos, { charFlag: cast.castMagic === 1 ? 1 : 2, type: 0 });
  } else {
    deps.log?.('  （该怪登记了技能但没写 castMagic ⇒ 不起法阵）');
  }
}

/**
 * 法阵本体网格的**帧动画**参数 —— `AniMaxCount = 20` / `AniDelayTime = 4`（原版 `SetAssaEffect`
 * 的两个参数）现在**都查清了**（`AssaEffect.h:275,360`）：
 * ```cpp
 * if(AniDelayTime && (Time % AniDelayTime) == 0) { AniCount++; ... }   // 每 4 帧推进 1 格
 * Max_Time = AniMaxCount * AniDelayTime;                              // 总时长 20 × 4 = 80 帧
 * ```
 * ⇒ 动画是**每 4 帧推进一格**、整段 80 帧（本层按 **60fps** ⇒ 1.33s = 既有的 `CAST_MESH_LIFE`）。
 * ⚠ 可见期只有 `CAST_MESH_FADE × 2` = 0.67s（原版渐显 20 + 渐隐 20 帧）⇒ 只看得到前 **10 格**
 *   （`tmScale.z` 1 → 约 5）—— 这是原版包络决定的，不是我们截断。
 * 我第一版按"每帧推进一格 / 30fps"播（0.67s 走完 20 格）✗ ⇒ 太快、看不出变化（用户实测）。
 */
const CIRCLE_ANI_MAX_FRAME = 20 * 160;
const fading: Array<{
  group: THREE.Group; age: number; dispose: () => void; tracks?: StaticMeshTrack[];
}> = [];

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
    // **帧动画**（原版 `smOBJ3D::TmAnimation`）：按 30fps 播完 `AniMaxCount` 帧 ⇒ 法阵"张开"
    if (f.tracks?.length) {
      // 每 4 帧推进一格 ⇒ 整段 = `CAST_MESH_LIFE`（= `AniMaxCount × AniDelayTime` / 60fps）
      applyStaticMeshTracks(f.tracks, Math.min(f.age / CAST_MESH_LIFE, 1) * CIRCLE_ANI_MAX_FRAME);
    }
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
    fading.push({ group: r.group, age: 0, dispose: r.dispose, tracks: r.tracks });
    ctx.log?.(`  ⭕ 法阵本体 ${fam.mesh.split('\\').pop()}：${r.group.children.length} 个网格`);
  });
}
