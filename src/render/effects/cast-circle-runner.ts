/**
 * 起手法阵的**装配与生命周期** —— 从怪物实验室抽出，实验室与游戏共用一份。
 *
 * 三件事：两张水平光环（`effects.spawnSystem`）+ 法阵本体（静态 `.smd`，需逐帧 alpha 包络）。
 * 包络见 `cast-circle.ts` 的 `CAST_MESH_FADE`（原版 `cASSAMESH::Main`）。
 */

import * as THREE from 'three';
import {
  castCircleSystems, castCircleFamily, CAST_LIFT, CAST_MESH_FADE, CAST_MESH_LIFE,
  CAST_CIRCLE_MAGICIAN, CAST_CIRCLE_TYPE_NORMAL, isCastCircleFlag,
  type CastCircleFlag, type CastCircleType,
} from './cast-circle.js';
import { loadStaticSmd, applyStaticMeshTracks, type StaticMeshTrack } from './static-fx.js';
import { reportFallback } from '../../char/fallback-log.js';
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
  fx?: FxSpawner | null;
  sfx?: SfxPlayer | null;
  dynLights?: DynLightSink | null;
  cast?: Partial<MonsterAttackEventCtx>;
}

export function fireMonsterSkillCast(
  deps: MonsterCastDeps, effectId: number, pos: { x: number; y: number; z: number },
  keyCode?: number | null,
): void {
  void fireMonsterCastFx(effectId, keyCode, pos, deps.fx ?? null, {
    ...deps.cast,
    sfx: deps.sfx ?? null, dynLights: deps.dynLights ?? null, log: deps.log,
  });
  const cast = monsterCastOf(effectId);
  if (!cast) return;
  if (cast.castSound) deps.playSound?.(cast.castSound, pos);
  if (cast.castMagic != null) {
    const flag = cast.castMagic;
    if (isCastCircleFlag(flag)) {
      runCastCircle(deps, pos, { charFlag: flag, type: CAST_CIRCLE_TYPE_NORMAL });
    }
  }
}

const CIRCLE_ANI_MAX_FRAME = 20 * 160;
const fading: Array<{
  group: THREE.Group;
  age: number;
  dispose: () => void;
  tracks?: StaticMeshTrack[];
  fadeSec: number;
  lifeSec: number;
  aniMaxFrame: number;
  badParams?: boolean;
}> = [];

function meshAlphaAt(t: number, fadeSec: number = CAST_MESH_FADE): number {
  if (t <= 0) return 0;
  if (t < fadeSec) return t / fadeSec;
  return Math.max(0, 1 - (t - fadeSec) / fadeSec);
}

export function spawnAssaMesh(
  ctx: { scene: THREE.Scene; log?: (msg: string) => void },
  opts: { mesh: string; pos: { x: number; y: number; z: number };
          aniMaxCount: number; aniDelayTime: number; scale?: number; note?: string;
          /** 绕 Y 的朝向（**弧度**，three 约定）—— 原版 `StartAni(..., angleY, ...)`；
           *  Pike Wind 的环要靠它把每个网格摆成朝外（`HoEffect.cpp:6303` 的 `ANGLE_180-ang`）。 */
          rotY?: number;
          /** **延迟多少秒才出现** —— 原版 `AddObject(obj, N)` 的第 2 参是**起始帧**（不是时长），
           *  Pike Wind 的环是第 8 帧起（`HoEffect.cpp:6306`）。 */
          delaySec?: number;
          /** 该网格的**上轴约定**（默认 `'z'` = PT 同族）；`'y'` = 资产本来就是 Y-up，
           *  见 `static-fx.loadStaticSmd` 的 `upAxis`（PikeWind/bong 属这一族）。 */
          upAxis?: 'z' | 'y' },
): void {
  const lifeSec = Math.max(0.05, (opts.aniMaxCount * opts.aniDelayTime) / 60);
  const aniMaxFrame = opts.aniMaxCount * 160;      // 动画单位 = 每帧 160

  // ⚠ 这里**不再打印"开始加载"**（2026-09-21）：资产按 URL 走 `AssetManager` 的解析缓存，
  //   同一份网格放 25 次只**加载一次**（Pike Wind 的环）—— 那句话在缓存命中时是假的。
  //   真正的加载证据在 `static-fx` 的解析行（只有真解析才打印一次）；本函数只报"实例化"的结果（下面 🧊）。
  void loadStaticSmd(opts.mesh, { upAxis: opts.upAxis }).then((r) => {
    if (!r) { ctx.log?.(`  ✗ ASE 网格 ${opts.mesh} 加载失败`); return; }
    r.group.position.set(opts.pos.x, opts.pos.y, opts.pos.z);
    if (opts.rotY !== undefined) r.group.rotation.y = opts.rotY;
    if (opts.scale && opts.scale !== 1) r.group.scale.setScalar(opts.scale);
    // 入场景 + 登记淡出 = **一条路**（延迟只是把这一刻推后，别的都一样）
    const show = (): void => {
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
    };
    // 延迟期**先不入场景**（原版 `AddObject(obj, N)` 的第 2 参是**起始帧** ⇒ 到第 N 帧才 Add）
    if (opts.delaySec && opts.delaySec > 0) setTimeout(show, opts.delaySec * 1000);
    else show();
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
 *
 * @param opts.charFlag 家族 —— `CAST_CIRCLE_PRIESTESS` / `_MAGICIAN` / `_SHAMAN`（**三个具名常量**）。
 *   ⚠ **由职业决定**（`castCircleFlagForClass`），不是"随便挑个外观"。
 * @param opts.type `CAST_CIRCLE_TYPE_NORMAL` = 常规、`_LARGE` = 大一圈
 *   （`Type != NORMAL` 会**忽略** `charFlag`，见 `castCircleFamily`）
 */
export function runCastCircle(
  ctx: CastCircleCtx,
  pos: { x: number; y: number; z: number },
  opts: { charFlag: CastCircleFlag; type: CastCircleType } = {
    charFlag: CAST_CIRCLE_MAGICIAN, type: CAST_CIRCLE_TYPE_NORMAL,
  },
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
