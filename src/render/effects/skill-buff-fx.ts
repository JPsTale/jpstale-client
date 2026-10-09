/**
 * **持续型技能 buff 的视觉层** —— 由 `S2C_BuffState`（含 skill_id）驱动：
 * buff 在表里 ⇒ 特效挂上；条目消失/到期 ⇒ 特效停止。与左上角 buff 条同源同生死。
 *
 * 覆盖三招（原版链逐字出处见各段）：
 *
 * ## Virtual Life（T3.4，`AssaSkillVirtualLifeMember`，`AssaParticle.cpp:5871-5956`）
 *   · `Pt3_VirtualLife20.ASE` 起手爆（`hoAssaParticleEffect.cpp:4217`，20 帧）；
 *   · 常驻心形 = `Skill3PriestessVirtualLifeMember` .part，挂在目标**头顶**（`TempPosi.y = 1000`
 *     raw ≈ 3.9，`hoAssaParticleEffect.cpp:4237-4240`），`SetAttachPos` 逐帧跟随（`:5931-5937`）；
 *   · 早期终止（死亡/进村/目标消失）⇒ `SetFastStop`（`:5946-5951`）—— 我们对应"buff 条目消失即停"。
 *
 * ## Holy Reflection（T2.3，`sinSkillEffect_Holy_Reflection`，`sinAssaSkillEffect.cpp:625-706`）
 *   · 紫色动态光 `SetDynLight(100,50,100,150,200,1)`（`:627`）；
 *   · **2 条符文光带** `2HolyReflection.ASE`（30 帧/延迟 4，绕胸高公转、二者相位相反，`:632-646`）；
 *   · 3 片 flare 广告板 + 20 颗星屑 + 50 条 `flw.ase` 环带粒子（半径 4~5 单位公转+重力，`:648-706`）；
 *   · **受击反应**（`sinSkillEffect_Holy_Reflection_Defense`，`:593-620`）：紫光 +
 *     `HolyReflection-gu.ASE` + 7 颗 star01M_04 广告板上下漂浮。
 *   ⚠ 我方渲染：符文光带 = `b_2holyreflection.smd` 网格（healing-orbit 同一加载管线）；
 *     星屑/flare 简化为 2 颗广告板（50 条环带粒子的完整 ASSA_MOVE/ROTATE 物理未移植，登记缺口）。
 *
 * ## Summon Muspel（T4.4，`HoEffectType_MusPel`，`HoEffectManager.cpp:779-1140`）
 *   · 天使网格 `muspel.ASE`（+骨 `b_muspel.ASE`）悬浮于**头顶上空 39 单位**（`pY+10000` raw，`:847`），
 *     朝向 = 施法者反向（`UpdateView`：`-Angle.y+180°`）；
 *   · IDLE 动画帧 80..160 循环（30 帧/秒），出生播 `MusPellStart`，常驻 `MusPell` 粒子；
 *   · **攻击**：每 `Attack_Delay` 秒找最近怪 → 冲刺 → 帧到 340 打击：橙色动态光 +
 *     `SendMuspellDamage`（客户端发包 → 服务端 `Svr_Damge.cpp:3711` 按
 *     `Summon_Muspell_Damage[档]` 结算）+ Dancing Sword 斩击音二选一（`netplay.cpp:13349-13374`）。
 *     ⚠ 我们**服务端权威**：伤害由服务端 tick 结算并随 `S2C_AttackResult.skill_id` 下发，
 *     客户端收到才播攻击动画与命中粒子（AGENTS #110 同构）；
 *   · 结束播 `muspellend`。
 *
 * ⚠ **只做自机 buff**：`S2C_BuffState` 只发本人；旁观者看到别人身上的这些特效要等
 *   "他人 buff 状态广播"（缺口登记，同 Healing 治玩家目标当年）。
 */
import * as THREE from 'three';
import { loadParsedAsset } from '../../core/asset-manager.js';
import { parseSmb } from '../../core/char-parser.js';
import { buildSkeleton, buildSkinnedMesh } from '../skinned-builder.js';
import { loadCharTextures } from '../char-texture-loader.js';
import { applyPose } from '../../char/anim-player.js';
import { reportFallback } from '../../char/fallback-log.js';
import { loadStaticSmd, applyStaticMeshTracks, type StaticModelResult } from './static-fx.js';
import { cachedFetch } from '../../core/asset-cache.js';
import { decodeTextureAsync } from '../../core/texture.js';
import type { QuarksPartHandle } from './quarks-runtime.js';
import type { SmbData } from '../../char/char-format.js';

/** 技能 id（`SkillIds` 的客户端镜像常量；客户端没有服务端枚举） */
export const SKILL_HOLY_REFLECTION = 0x080203;
export const SKILL_VIRTUAL_LIFE = 0x080304;
export const SKILL_SUMMON_MUSPELL = 0x080404;

const FONE = 256;

/* ── 资产路径（全部实测在库，见各段说明） ── */
const VL_KEEP_PART = 'skill3priestessvirtuallifemember';
const VL_CAST_PART = 'skill3priestessvirtuallifemember_cast';
const HR_BAND_SMD = 'image/sinimage/assaeffect/holyr/b_2holyreflection.smd';
const MUSPEL_MESH_SMD = 'effect/neweffect/res/object/muspel.smd';
const MUSPEL_END_PART = 'muspellend';
const MUSPEL_HIT_PART = 'muspellhit1';
const MUSPEL_HAND_PART = 'muspellhand';
const HR_GU_SMD = 'image/sinimage/assaeffect/holyr/holyreflection-gu.smd';
/** `SetAssaEffect(100, "star01M_04.bmp", …)`（Defense 的 7 颗星） */
const HR_STAR_TEX = 'image/sinimage/assaeffect/holyr/p/star01m_04.bmp';

/* ── Holy Reflection 常量（`sinAssaSkillEffect.cpp:625-706`） ── */
/** 动态光 `SetDynLight(100,50,100,150,200,1)` */
const HR_DYN_LIGHT = { r: 100, g: 50, b: 100, a: 150, power: 200, decPower: 1 } as const;
/** `AniMaxCount = 30`（30 帧循环） */
const HR_BAND_ANI_MAX = 30;
/** 光带公转角速度：原版二条相位相反、随角色走 —— 我方按"绕角色慢速公转"表达 */
const HR_BAND_ORBIT_SPEED = 0.8; // rad/s
/** 光带公转半径：`StartPosi.x = -256*10` ⇒ 10 单位偏移（`:636`） */
const HR_BAND_RADIUS = 10;
/** 胸高（原版挂 `pChar` 原点、ASE 自带高度；我方给 7 单位的显式胸高） */
const HR_CHEST_H = 7;

/* ── Summon Muspel 常量（`HoEffectManager.cpp:822-1140`） ── */
/** 悬浮高度：`pY + 10000` raw = 39.06 单位（`:847`） */
const MUSPEL_HOVER_RAW = 10000;
/** 粒子高度：`pY + 5000` raw = 19.5 单位（`:845`） */
const MUSPEL_PART_H_RAW = 5000;
/** IDLE 帧循环 80×160..160×160 tick（`:963-968`）；打击点 340×160 tick（`:1025`） */
const MUSPEL_IDLE_0 = 80 * 160;
const MUSPEL_IDLE_1 = 160 * 160;
const MUSPEL_HIT_FRAME = 340 * 160;
/** 帧推进：`m_fCurrentFrame += 160*30*elapsed`（`:891`）⇒ 每秒 30 动画帧 = 4800 tick/秒 */
const MUSPEL_TICKS_PER_SEC = 160 * 30;
/** 命中动态光 `SetDynLight(255,150,50,0,180,3)` */
const MUSPEL_HIT_DYN = { r: 255, g: 150, b: 50, a: 0, power: 180, decPower: 3 } as const;
/** VL 挂载高度：`TempPosi.y = 1000` raw ≈ 3.9 单位（头顶） */
const VL_HEAD_LIFT = 1000 / FONE;

/* ── 渲染依赖（WorldView 注入；一次注入全局使用） ── */
export interface SkillBuffFxStoppable {
  stop(): void;
}
export interface SkillBuffFxParts {
  /** quarks `.part` 按名起播（可停）—— EffectManager.spawnStoppable */
  spawnPartStoppable(name: string, opts: {
    pos: { x: number; y: number; z: number };
    attach?: THREE.Object3D;
    rigidFollow?: boolean;
    loop?: boolean;
  }): Promise<QuarksPartHandle | null>;
  spawnPart(name: string, opts: { pos: { x: number; y: number; z: number } }): Promise<boolean> | null;
  /** 动态光池 */
  dynLights: {
    set(x: number, y: number, z: number, r: number, g: number, b: number, a: number, power: number, decPower: number): unknown;
  } | null;
  /** 命中音（Muspel 斩击二选一，`netplay.cpp:13366-13369`） */
  playSound(path: string, pos: { x: number; y: number; z: number }): void;
}

interface FeetGetter {
  /** 自机**脚底**实时位置与朝向（弧度） */
  (): { x: number; y: number; z: number; yaw: number };
}

/** 一个"挂在自机身上的持续特效"实例 */
interface BuffFxInstance {
  skillId: number;
  stop(): void;
  update(dt: number, feet: { x: number; y: number; z: number; yaw: number }): void;
}

const live = new Map<number, BuffFxInstance>();
let deps: { scene: THREE.Scene; parts: SkillBuffFxParts } | null = null;
let feetGetter: FeetGetter | null = null;

export function configureSkillBuffFx(d: {
  scene: THREE.Scene;
  parts: SkillBuffFxParts;
  feet: FeetGetter;
}): void {
  deps = d;
  feetGetter = d.feet;
}

/* ══════════════ Virtual Life ══════════════ */

function startVirtualLife(): BuffFxInstance {
  const carrier = new THREE.Object3D();
  deps!.scene.add(carrier);
  const handles: QuarksPartHandle[] = [];
  let stopped = false;
  void (async () => {
    try {
      // 起手爆（20 帧 ASE 的 .part 替代件）
      await deps!.parts.spawnPartStoppable(VL_CAST_PART, {
        pos: feetGetter ? feetGetter() : { x: 0, y: 0, z: 0 },
      });
      // 常驻心形：挂在头顶载体上、刚体跟随、循环
      const h = await deps!.parts.spawnPartStoppable(VL_KEEP_PART, {
        pos: { x: 0, y: 0, z: 0 },
        attach: carrier,
        rigidFollow: true,
        loop: true,
      });
      if (h) handles.push(h);
      if (stopped) h?.stop();
    } catch (e) {
      reportFallback('skillfx', 'Virtual Life 心形特效加载失败：' + String(e));
    }
  })();
  return {
    skillId: SKILL_VIRTUAL_LIFE,
    stop() {
      stopped = true;
      for (const h of handles) h.stop();
      carrier.removeFromParent();
    },
    update(_dt, feet) {
      // `SetAttachPos`：pY + 1000 raw（头顶）逐帧跟随（`AssaParticle.cpp:5931-5937`）
      carrier.position.set(feet.x, feet.y + VL_HEAD_LIFT, feet.z);
      carrier.updateMatrixWorld(true);
    },
  };
}

/* ══════════════ Holy Reflection ══════════════ */

interface BandMesh {
  group: THREE.Group;
  bones: THREE.Bone[];
  skeleton: THREE.Skeleton;
  smb: SmbData;
  /** 二条相位相反：+1 / -1 */
  dir: number;
}

async function loadBandMesh(): Promise<BandMesh> {
  const smb = await loadParsedAsset(HR_BAND_SMD, 'anim', parseSmb, true);
  const smd = await loadParsedAsset(HR_BAND_SMD, 'model', parseSmb, true);
  const skel = buildSkeleton(smb, false);
  const built = buildSkinnedMesh(smd, smb, null, false, skel);
  await loadCharTextures(built.texturesToLoad);
  const group = new THREE.Group();
  group.add(built.skeletonGroup);
  group.add(built.group);
  return { group, bones: built.bones, skeleton: built.skeleton, smb, dir: 1 };
}

function startHolyReflection(): BuffFxInstance {
  const root = new THREE.Group();
  deps!.scene.add(root);
  const bands: BandMesh[] = [];
  let aniCount = 0;
  let orbit = 0;
  let stopped = false;
  void (async () => {
    try {
      // 紫色动态光（`:627`）—— 常驻期间每次 set（DynLightPool 按 power 衰减，需周期性补）
      for (let i = 0; i < 2; i++) {
        const band = await loadBandMesh();
        band.dir = i === 0 ? 1 : -1;
        bands.push(band);
        root.add(band.group);
      }
      if (stopped) {
        for (const b of bands) b.group.removeFromParent();
      }
    } catch (e) {
      reportFallback('skillfx', 'Holy Reflection 符文光带加载失败：' + String(e)
        + '（b_2holyreflection.smd）');
    }
  })();
  return {
    skillId: SKILL_HOLY_REFLECTION,
    stop() {
      stopped = true;
      for (const b of bands) b.group.removeFromParent();
      root.removeFromParent();
    },
    update(dt, feet) {
      if (bands.length === 0) return;
      // 紫光按原版参数周期补（pool 会衰减）
      const d = HR_DYN_LIGHT;
      deps!.parts.dynLights?.set(feet.x, feet.y, feet.z, d.r, d.g, d.b, d.a, d.power, d.decPower);
      orbit += HR_BAND_ORBIT_SPEED * dt;
      aniCount = (aniCount + 1) % HR_BAND_ANI_MAX;
      const frame = aniCount * 4;   // `AniDelayTime = 4`（ tick/帧 ⇒ 4 倍刻度一帧）
      for (const band of bands) {
        // 二条相位相反地绕胸高公转（原版 StartPosi.x = -10 单位 + Angle.y 翻转）
        const a = orbit * band.dir + (band.dir > 0 ? 0 : Math.PI);
        band.group.position.set(
          feet.x + Math.sin(a) * HR_BAND_RADIUS,
          feet.y + HR_CHEST_H,
          feet.z + Math.cos(a) * HR_BAND_RADIUS,
        );
        band.group.rotation.y = -a;
        applyPose(band.smb, frame, band.bones, band.skeleton);
      }
    },
  };
}

/** **受击反应**（`sinSkillEffect_Holy_Reflection_Defense`，`:593-620`）：紫光 + gu 网格 + 7 星漂浮 */
export function playHolyReflectionDefense(at: { x: number; y: number; z: number }): void {
  if (!deps) return;
  const d = HR_DYN_LIGHT;
  deps.parts.dynLights?.set(at.x, at.y, at.z, d.r, d.g, d.b, d.a, d.power, d.decPower);
  void deps.parts.spawnPartStoppable(HR_GU_SMD.replace(/^.*\//, '').replace(/\.smd$/, ''), { pos: at })
    .catch(() => { /* gu 网格走 part 通道不成即忽略（star 广告板仍在） */ });
  // 7 颗 star01M_04 广告板：上下漂浮（MoveSpeed.y = ±10 raw/帧，`StartPosi.z` 15..31 单位抖动）
  void (async () => {
    try {
      const buf = await cachedFetch('/res/' + HR_STAR_TEX, 'texture');
      const tex = await decodeTextureAsync(buf);
      if (!tex) { reportFallback('skillfx', 'HR 星屑贴图解码失败：' + HR_STAR_TEX); return; }
      const c = document.createElement('canvas');
      c.width = tex.width;
      c.height = tex.height;
      c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(tex.pixels), tex.width, tex.height), 0, 0);
      const mat = new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(c),
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      });
      for (let i = 0; i < 7; i++) {
        const sp = new THREE.Sprite(mat);
        const ang = (i / 7) * Math.PI * 2;
        const r = 2 + (i % 3);
        sp.position.set(at.x + Math.cos(ang) * r, at.y + 2 + (i % 2) * 2, at.z + Math.sin(ang) * r);
        sp.scale.setScalar(3);
        deps!.scene.add(sp);
        window.setTimeout(() => sp.removeFromParent(), 1500);
      }
    } catch (e) {
      reportFallback('skillfx', 'HR Defense 星屑失败：' + String(e));
    }
  })();
}

/* ══════════════ Summon Muspel ══════════════ */

interface MuspelState {
  /** **对象级帧动画**网格（原版 `UpdateMesh` 用 `m_iCurrentFrame` 播帧）—— 不是骨骼蒙皮！
   *  （误用骨骼蒙皮会让骨骼变换把网格放大 3 倍：34 单位的模型撑到 106 ⇒ 半透明巨物糊满屏幕，
   *   2026-09-30 实测"闪电看不见、冰枪超级淡"的根因。） */
  static: StaticModelResult;
  frame: number;              // tick（160/动画帧）
  attacking: boolean;
  hitFired: boolean;
  /** 命中回调（WorldView 注入 → 播 hit part/动态光/音效在目标身上） */
  onHit: (feet: { x: number; y: number; z: number }) => void;
}

const muspelLive: { state: MuspelState | null } = { state: null };

function startMuspel(onHit: (feet: { x: number; y: number; z: number }) => void): BuffFxInstance {
  const root = new THREE.Group();
  deps!.scene.add(root);
  const state: MuspelState = {
    static: null as unknown as StaticModelResult,
    frame: MUSPEL_IDLE_0,
    attacking: false,
    hitFired: false,
    onHit,
  };
  muspelLive.state = state;
  void (async () => {
    try {
      // **对象级帧动画**网格（原版 `AssaSearchRes("muspel.ASE")` + `UpdateMesh(m_iCurrentFrame)`）
      const smd = await loadStaticSmd(MUSPEL_MESH_SMD);
      if (!smd) throw new Error('muspel.smd 加载失败');
      root.add(smd.group);
      state.static = smd;
      // 出生粒子（`MusPellStart`，施法者上方 19.5 单位，`:845`）
      const f = feetGetter?.() ?? { x: 0, y: 0, z: 0, yaw: 0 };
      void deps!.parts.spawnPartStoppable('muspellstart', {
        pos: { x: f.x, y: f.y + MUSPEL_PART_H_RAW / FONE, z: f.z },
      });
    } catch (e) {
      reportFallback('skillfx', 'Muspel 天使加载失败：' + String(e) + '（' + MUSPEL_MESH_SMD + '）');
    }
  })();
  return {
    skillId: SKILL_SUMMON_MUSPELL,
    stop() {
      // 结束播 muspellend（原版 FastStop + MusPell 粒子停；end part 为我方资产里的收尾件）
      const f = feetGetter?.();
      if (f) void deps!.parts.spawnPartStoppable(MUSPEL_END_PART, {
        pos: { x: f.x, y: f.y + MUSPEL_PART_H_RAW / FONE, z: f.z },
      });
      state.static?.dispose();
      state.static = null as unknown as StaticModelResult;
      muspelLive.state = null;
      root.removeFromParent();
    },
    update(dt, feet) {
      const st = muspelLive.state;
      if (!st || !st.static) return;
      // 悬浮：pY + 10000 raw（39 单位），朝向 = 施法者反向（`UpdateView`：-Angle.y+180°）
      root.position.set(feet.x, feet.y + MUSPEL_HOVER_RAW / FONE, feet.z);
      root.rotation.y = -feet.yaw + Math.PI;
      st.frame += MUSPEL_TICKS_PER_SEC * dt;
      if (st.attacking) {
        if (!st.hitFired && st.frame >= MUSPEL_HIT_FRAME) {
          st.hitFired = true;
          const hit = st.onHit;
          st.onHit = () => {};
          hit(feet);
        }
        if (st.frame >= MUSPEL_HIT_FRAME + 60 * 160) {
          st.attacking = false;
          st.frame = MUSPEL_IDLE_0;
        }
      } else {
        if (st.frame >= MUSPEL_IDLE_1) st.frame = MUSPEL_IDLE_0;
      }
      applyStaticMeshTracks(st.static.tracks ?? [], st.frame);
    },
  };
}

/* ══════════════ 对外接口 ══════════════ */

/** Muspel 攻击提示（服务端结算随 `S2C_AttackResult.skill_id` 下发后由 WorldView 调） */
export function cueMuspelAttack(): void {
  const st = muspelLive.state;
  if (!st) return;
  st.attacking = true;
  st.hitFired = false;
  st.frame = MUSPEL_IDLE_1;   // 从 IDLE 末帧起播攻击段（→340 打击点）
  const f = feetGetter?.();
  if (f) {
    void deps!.parts.spawnPartStoppable(MUSPEL_HAND_PART, {
      pos: { x: f.x, y: f.y + MUSPEL_HOVER_RAW / FONE, z: f.z },
    });
  }
}

/** WorldView 在怪物受击（skill_id = MUSPEL）时调：命中粒子 + 动态光 + 斩击音（原版二选一音） */
export function playMuspelHit(at: { x: number; y: number; z: number }): void {
  if (!deps) return;
  const d = MUSPEL_HIT_DYN;
  deps.parts.dynLights?.set(at.x, at.y, at.z, d.r, d.g, d.b, d.a, d.power, d.decPower);
  void deps.parts.spawnPartStoppable(MUSPEL_HIT_PART, { pos: at });
  // `netplay.cpp:13366-13369`：Dancing Sword 斩击音二选一
  deps.parts.playSound(
    'wav/effects/skill/sword/dancing sword attack' + (Math.random() < 0.5 ? '1' : '2') + '.wav', at);
}

/** 差分入口：buff 表（仅技能 buff）变化时启/停对应实例。 */
export function applySelfSkillBuffFx(
  buffs: readonly { skillId: number }[],
  makeInstance: (skillId: number) => BuffFxInstance,
): void {
  if (!deps) return;
  const want = new Set(buffs.map((b) => b.skillId));
  for (const [skillId, inst] of [...live.entries()]) {
    if (!want.has(skillId)) {
      inst.stop();
      live.delete(skillId);
    }
  }
  for (const skillId of want) {
    if (!live.has(skillId)) {
      live.set(skillId, makeInstance(skillId));
    }
  }
}

/** 每帧推进（WorldView 帧循环调） */
export function updateSkillBuffFx(dt: number): void {
  if (live.size === 0 || !feetGetter) return;
  const feet = feetGetter();
  for (const inst of live.values()) {
    inst.update(dt, feet);
  }
}

/** 换图/登出清场 */
export function clearSkillBuffFx(): void {
  for (const inst of live.values()) inst.stop();
  live.clear();
  muspelLive.state = null;
}

/** 内部工厂（applySelfSkillBuffFx 的 makeInstance 缺省实现） */
export function makeBuffFxInstance(skillId: number): BuffFxInstance {
  switch (skillId) {
    case SKILL_VIRTUAL_LIFE: return startVirtualLife();
    case SKILL_HOLY_REFLECTION: return startHolyReflection();
    case SKILL_SUMMON_MUSPELL: return startMuspel((feet) => playMuspelHit(feet));
    default:
      reportFallback('skillfx', `技能 buff ${skillId.toString(16)} 没有注册持久特效 ⇒ 不放`);
      return { skillId, stop() {}, update() {} };
  }
}
