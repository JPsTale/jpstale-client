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
import type { DynLightSink } from './dyn-light.js';
import {
  monsterCastOf, fireMonsterCastFx, type FxSpawner, type SfxPlayer, type MonsterAttackEventCtx,
} from './monster-attack-fx.js';

export interface CastCircleCtx {
  effects: SystemSpawner | null;
  scene: THREE.Scene;
  log?: (msg: string) => void;
}

/** 怪物技能起手的依赖 = 法阵那一套 + 起手特效（按资产名起 `.part`）+ 起手音 / 动态光 */
export interface MonsterCastDeps extends CastCircleCtx {
  playSound?: (path: string, pos: { x: number; y: number; z: number }) => void;
  /** 起手**特效**用的装配器（`EffectManager.spawn`）—— 游戏/实验室传同一个 effects 管理器 */
  fx?: FxSpawner | null;
  sfx?: SfxPlayer | null;
  dynLights?: DynLightSink | null;
  /**
   * 起手特效的**其余上下文**（目标/范围/飞出物等回调）—— 类型就是事件帧那一份
   * （`MonsterAttackEventCtx`），因为"起手那一招"什么都能用得上（CC 的陨石是飞出物）。
   *
   * 由调用方传 `{ ...monsterTargeting(pos), ...monsterFxCallbacks(actor, 1) }` —— 与事件帧**同一份**。
   */
  cast?: Partial<MonsterAttackEventCtx>;
}

/**
 * **怪物技能起手**（原版 `BeginSkill_Monster`，`character.cpp:14070`）：起手特效 + 起手音 + 起手法阵。
 *
 * **唯一实现** —— 游戏（`WorldView`）与怪物实验室共用。此前只有实验室有这一环
 * （`monsterCastOf` 全仓只在实验室被调用）⇒ 游戏里怪物放技能**没有起手音、也没有法阵**；
 * 更严重的是游戏侧连"技能动作的事件帧"都没武装（`armMonster…` 只对 ATTACK 调）⇒
 * 技能特效本身也不会触发（用户 2026-09-18："能把它也接入 client 吗"）。
 *
 * 起手音/法阵是**所有技能共用**一套（取宿主条目的 `castSound` / `castMagic`）；
 * 但**起手特效不共用** —— CC 就按 `KeyCode` 分（`'J'` 一颗陨石、`else` 一记近身），
 * 故 `keyCode` 必须传进来，由 `resolveMonsterFx(..., 'cast')` 那**唯一一处**判。
 */
export function fireMonsterSkillCast(
  deps: MonsterCastDeps, effectId: number, pos: { x: number; y: number; z: number },
  keyCode?: number | null,
): void {
  // ① 起手特效（原版各 case 里那句 `ParkAssaParticle_*`；只有 `timing: 'cast'` 的条目会放）
  void fireMonsterCastFx(effectId, keyCode, pos, deps.fx ?? null, {
    ...deps.cast,
    sfx: deps.sfx ?? null, dynLights: deps.dynLights ?? null, log: deps.log,
  });
  // ② 起手音 + 起手法阵（原版同一支里的 `SkillPlaySound` + `sinEffect_StartMagic`）
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
  /** 本份网格的包络参数（法阵与怪物 ASE 网格各用各的，见 `spawnAssaMesh`） */
  fadeSec: number; lifeSec: number; aniMaxFrame: number;
  /** 参数缺失已报过（每份只报一次） */
  badParams?: boolean;
}> = [];

/** 本体的可见系数（原版 `cASSAMESH::Main`：前 `CAST_MESH_FADE` 秒渐显，随后同速率渐隐） */
function meshAlphaAt(t: number, fadeSec: number = CAST_MESH_FADE): number {
  if (t <= 0) return 0;
  if (t < fadeSec) return t / fadeSec;
  return Math.max(0, 1 - (t - fadeSec) / fadeSec);
}

/**
 * **放一个 ASE/静态网格特效**（原版 `SetAssaEffect(...)` 那一族）—— **唯一实现**：
 * 起手法阵（`runCastCircle`）与怪物特效表里的 `mesh` 字段都走它。
 *
 * 原版两个参数（`AniMaxCount` / `AniDelayTime`）决定帧动画：**每 `AniDelayTime` 帧推进一格**、
 * 整段 `AniMaxCount × AniDelayTime` 帧（`AssaEffect.h:275,360`）；可见期由 `cASSAMESH::Main`
 * 的渐显/渐隐包络决定（= `CAST_MESH_FADE` 两侧，与法阵同一套，故共用常量）。
 *
 * @param mesh 资产路径（`.smd`，相对 `VITE_ASSET_ROOT`）—— 原版写的是 `.ASE`（同族资产，见各方 notes）
 */
export function spawnAssaMesh(
  ctx: { scene: THREE.Scene; log?: (msg: string) => void },
  opts: { mesh: string; pos: { x: number; y: number; z: number };
          aniMaxCount: number; aniDelayTime: number; scale?: number; note?: string },
): void {
  const lifeSec = Math.max(0.05, (opts.aniMaxCount * opts.aniDelayTime) / 60);
  const aniMaxFrame = opts.aniMaxCount * 160;      // 动画单位 = 每帧 160
  // ⏳ **加载前打点**：卡住时日志会停在这行之后 ⇒ 一眼看出是"加载/解析"这一步（此前只有成功/失败行，
  // 卡住时什么也看不到 ✗ —— 用户实测 CC 普攻卡死，我就卡在这一步上无从判断）
  ctx.log?.(`  ⏳ 开始加载 ASE 网格 ${opts.mesh}（AniMaxCount=${opts.aniMaxCount} / AniDelayTime=${opts.aniDelayTime}）`);
  void loadStaticSmd(opts.mesh).then((r) => {
    if (!r) { ctx.log?.(`  ✗ ASE 网格 ${opts.mesh} 加载失败`); return; }
    r.group.position.set(opts.pos.x, opts.pos.y, opts.pos.z);
    if (opts.scale && opts.scale !== 1) r.group.scale.setScalar(opts.scale);
    ctx.scene.add(r.group);
    fading.push({
      group: r.group, age: 0, dispose: r.dispose, tracks: r.tracks,
      fadeSec: CAST_MESH_FADE, lifeSec, aniMaxFrame,
    });
    const nTracks = r.tracks?.length ?? 0;
    ctx.log?.(`  🧊 ASE 网格 ${opts.mesh.split('/').pop()}：${r.group.children.length} 个网格，`
      + `帧动画 ${nTracks} 条轨道 / ${opts.aniMaxCount} 帧（AniDelayTime=${opts.aniDelayTime}）`
      + `${nTracks === 0 ? '（⚠ 没有轨道 ⇒ 只会淡入淡出）' : `，${lifeSec.toFixed(2)}s 播完`}`
      + `${opts.note ? `　[${opts.note}]` : ''}`);
  });
}

/** 每帧调一次：推进法阵本体的包络（光环由 quarks 自己管寿命，不在这里） */
export function updateCastCircleMeshes(dt: number): void {
  for (let i = fading.length - 1; i >= 0; i--) {
    const f = fading[i]!;
    f.age += dt;
    // **帧动画**（原版 `smOBJ3D::TmAnimation`）：按 30fps 播完 `AniMaxCount` 帧 ⇒ 法阵"张开"
    if (f.tracks?.length) {
      // ⚠ **守卫**：`lifeSec`/`aniMaxFrame` 一旦缺失 ⇒ `age/undefined` = NaN ⇒ `applyStaticMeshTracks(NaN)`
      //   会把 NaN 写进 position/scale（污染 three 的矩阵与包围球）。这里先判、**每份只报一次**，然后跳过
      //   帧动画（网格照常显示，只是不动）—— 不静默，也不把 NaN 喂下去。
      if (!f.badParams && (!Number.isFinite(f.lifeSec) || !Number.isFinite(f.aniMaxFrame))) {
        f.badParams = true;
        reportFallback('fx', `静态网格的帧动画参数缺失（lifeSec=${String(f.lifeSec)} aniMaxFrame=${String(f.aniMaxFrame)}）`
          + '⇒ 本次跳过帧动画（不把 NaN 喂给 applyStaticMeshTracks），只做淡入淡出');
      }
      if (!f.badParams) {
        // 每 `AniDelayTime` 帧推进一格 ⇒ 整段 = `AniMaxCount × AniDelayTime` / 60fps = `lifeSec`
        applyStaticMeshTracks(f.tracks, Math.min(f.age / f.lifeSec, 1) * f.aniMaxFrame);
      }
    }
    const a = meshAlphaAt(f.age, f.fadeSec);
    f.group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m && 'opacity' in m) (m as THREE.MeshPhongMaterial).opacity = a;
    });
    if (f.age >= f.fadeSec * 2) {          // 可见期走完就收（之后原版也只是全透明的僵尸）
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
    fading.push({
      group: r.group, age: 0, dispose: r.dispose, tracks: r.tracks,
      fadeSec: CAST_MESH_FADE, lifeSec: CAST_MESH_LIFE, aniMaxFrame: CIRCLE_ANI_MAX_FRAME,
    });
    // 帧动画的状态**必须回显**：这是"页面是不是旧副本 / 轨道有没有读到"的唯一自证点
    //（用户实测过"实验室好了、游戏里没有"——那次是页面加载早于提交）
    const nTracks = r.tracks?.length ?? 0;
    ctx.log?.(`  ⭕ 法阵本体 ${fam.mesh.split('\\').pop()}：${r.group.children.length} 个网格，`
      + `帧动画 ${nTracks} 条轨道 / ${CIRCLE_ANI_MAX_FRAME / 160} 帧`
      + `${nTracks === 0 ? '（⚠ 没有轨道 ⇒ 只会淡入淡出）' : `，${(CAST_MESH_LIFE).toFixed(2)}s 播完`}`);
  });
}
