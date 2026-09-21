/**
 * WORLD 屏：复刻 /pt/maps/ 的地图渲染 + 真实角色模型 + 卫星相机跟随。
 * 唯一差异：地图从服务端 enterGame 的 mapId/出生点读取，而非下拉选择。
 * 权威依据：pt-web-server/static/maps/index.html + docs/fields/pt-map-renderer-design.md §3.10.2。
 * 坐标：出生点 world = (-z, y, -x)；地图顶点 world = raw/256 + 轴交换（map-renderer 内部处理）。
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { loadMap, updateFrameAnimations } from '../maps/fore1.js';
import { loadUiImage } from '../render/ui-texture.js';
import { mapSmdPath, MAP_CATALOG } from '../maps/map-catalog.js';
import { minimapBase } from '../maps/map-data.js';
import { mapDecorList } from '../maps/map-decor.js';
import { loadMapDecor, unloadDecor } from '../maps/decor-loader.js';
import { neighborMaps } from '../maps/map-gates.js';
import { CollisionMesh, OBJ_WIDTH_RAW, OBJ_HEIGHT_RAW, NEARBY_RADIUS_UNITS } from '../maps/collision.js';
import { CollisionDebug } from '../maps/collision-debug.js';
import { installNaNGeometryWatch, scanNaNGeometry, reportNaNGeometry } from '../render/nan-scan.js';
import type { NaNGeometryHit } from '../render/nan-scan.js';
import { canEnterMap, mapLevelRequirement } from '../game/safeZones.js';
import { monsterStopRing } from '../game/combatRange.js';
import { isInputBlocked } from '../app/inputGate.js';
import { appendSystemMessage } from '../app/chatStore.js';
import { mapLightProfile } from '../maps/map-light.js';
import { setMaxAnisotropy } from '../render/texture-loader.js';
import { t } from '../i18n/index.js';
import { loadCharacterModel, getHead } from '../render/char-loader.js';
import { faceAngleOf, faceAngleFromDir } from '../core/geom.js';
import { loadMonsterModel } from '../render/monster-loader.js';
import {
  fireMonsterAttackEvent, findAttackBone, MONSTER_RANGED, MONSTER_BOW_IDCODE, type MonsterFlySpec,
} from '../render/effects/monster-attack-fx.js';
import { dmgFxGet, bounceScale, popArc, dirFromTo, easeOutCubic } from '../render/dmg-fx.js';
import {
  fireSkillCast, fireSkillEvent, skillFxRowByIcon, skillFxRowByAnimIndex,
  type SkillFxRow, type SkillFxFireCtx,
} from '../render/effects/skill-fx-runner.js';
import { updateMultiSparkRunners } from '../render/effects/multi-spark-runner.js';
import { runMonsterFly, updateMonsterFlies, clearMonsterFlies } from '../render/effects/monster-fly-runner.js';
import { updateCastCircleMeshes, fireMonsterSkillCast, spawnAssaMesh } from '../render/effects/cast-circle-runner.js';
import { updateGlacialSpikes } from '../render/effects/glacial-spike.js';
import { CODE_SKILL_FX } from '../render/effects/skill-fx-runner.js';
import { createDynLightPool, type DynLightPool } from '../render/effects/dyn-light.js';
import type { MonsterModelResult } from '../render/monster-loader.js';
import { mapAudio } from '../maps/map-audio.js';
import type { SceneLightWorld } from '../render/map-renderer.js';
import { createAnimStateMachine } from '../char/anim-state-machine.js';
import { semanticEntryOfMotion } from '../char/anim-match.js';
import { reportFallback } from '../char/fallback-log.js';
import { semanticEntriesForJob } from '../char/semantic-anim.js';
import { isSafeMap } from '../game/safeZones.js';
import { getWeaponTypeFromIdCode, getHandType, getHandTypeFromIdCode } from '../char/weapon-type.js';
import { sfx, weaponSoundCode, eventFrameSoundState, type HandType, type VoiceHandle } from '../audio/sfx.js';
import { playItemSound } from '../audio/item-sounds.js';
import { USE_EFFECT_INI, useEffectKindOf, type UseEffectKind } from '../game/useEffect.js';
import { predictSwitchAppearance } from '../game/weapon-set.js';
// 药水的那几张 INI 与 `POTION_BURST` 参数已移交给 `render/effects/quarks-runtime.ts`（改走 three.quarks）
import { createEffectManager } from '../render/effects/effect-manager.js';
import { createQuarksRuntime } from '../render/effects/quarks-runtime.js';
import { ITEM_DEFS } from '../game/data/itemDefs.js';
import type { MotionInfo } from '../char/char-format.js';
import { CHRMOTION_STATE_DEAD, CHRMOTION_STATE_SKILL } from '../char/char-format.js';
import { advanceAnimFrame, crossEventFrames, motionEventIndexOf, evalBoneFrame } from '../char/animation.js';
import { createAnimPlayer, applyPose, evalWorkspaceFor, buildMotionList as buildMotionListShared, type AnimPlayer } from '../char/anim-player.js';
import { createProjectileManager, projectileChoiceOf, isRangedWeapon, unitBodyAnchorY, RELEASE_LEAD_FRAMES, releaseFlightTime, MAGIC_JOBS, type ProjectileManager } from '../render/projectile.js';
import { loadCharTextures, type TextureTarget } from '../render/char-texture-loader.js';
import { setCursorMode, getCursorMode, initCursor } from './cursor.js';
import { loadCameraPrefs, saveCameraPrefs, CAM_DIST_MIN, CAM_DIST_MAX, CAM_ANX_MIN, CAM_ANX_MAX } from './camera-prefs.js';
import { loadUiPrefs, saveUiPrefs } from './ui-prefs.js';
import type { CharacterAppearance } from './CharSelect.js';
import { armorNumFromIdCode, appearanceModelKey } from './CharSelect.js';
import { resolveCostumeBody } from '../render/costume-body-map.js';
import { loadWeaponModel, loadDropItemModel, findBone, WEAPON_BONES, offMountBoneOf, weaponSizeMax, combatBoneOf, WeaponMount } from '../render/weapon-loader.js';
import { createWeaponTrail, MonsterTrails, trailTintOfSkill, type WeaponTrail } from '../render/effects/weapon-trail.js';
import { isShootingMode } from '../char/weapon-type.js';
import { SKILL_DEBUG } from '../game/skillDbg.js';
import { skillLevelByIcon } from '../game/skillLevel.js';
import { skillIndexByIcon } from '../game/data/skillIndexByIcon.js';
import { CLASS_DIR } from '../game/skillData.js';
import { getGameSnapshot } from '../app/gameStore.js';
import { frameStart as perfFrameStart, mark as perfMark, frameEnd as perfFrameEnd, setCounter as perfSetCounter, report as perfReport } from '../app/profiler.js';
import { pickVisibleMonsters, VIS_TIERS, type VisibilityCandidate, type VisibilityResult } from '../render/monster-visibility.js';
import { loadDisplayPrefs, type DisplayPrefs } from './display-prefs.js';
import { updateWaveCamera, setWaveCameraEnabled } from '../render/wave-camera.js';
import { setBillboardCamera } from '../render/effects/part-to-quarks.js';
import { setOrientCamera } from '../render/effects/orient-shared.js';

/** idcode → classItem（4=单手 / 6=双手），武器音效选码用（原版 WeaponPlaySound 的 HandType） */
const ITEM_CLASS_BY_CODE = new Map<number, number>(ITEM_DEFS.map((d) => [d.code, d.class]));

/* ─────────── 武器语义查询（自机与远端**唯一实现**，不要各写一份） ───────────
 * 远端 actor 的动画曾因"只有自机接了武器语义"而永远播通用动画（用户实测）。 */

/** idcode → 武器语义类型（AXE/SWORD/BOW…）；无武器/徒手 → null */
export function weaponTypeOfIdCode(idcode: number | null | undefined): string | null {
  if (!idcode || idcode <= 0) return null;
  return getWeaponTypeFromIdCode(idcode);
}

/** idcode → 单双手。语义表（含人工覆盖）优先，DB classItem 兜底；无武器 → UNDEFINED */
export function handTypeOfIdCode(idcode: number | null | undefined): HandType {
  if (!idcode) return 'UNDEFINED';
  const fromSem = getHandTypeFromIdCode(idcode);
  if (fromSem === '1H' || fromSem === '2H') return fromSem as HandType;
  const cls = ITEM_CLASS_BY_CODE.get(idcode);
  return cls === undefined ? 'UNDEFINED' : (getHandType(cls) as HandType);
}

/**
 * 变体种子派生（服务端未下发 seed 时的确定性回退）。
 * 只用 **(实体 id, 状态)** 两个所有客户端都相同的输入 → 同一实体在所有客户端播同一条变体。
 * 旧行为是各客户端各自 `Math.random()`，同一角色在不同客户端上动作不一致（用户实测）。
 */
export function deriveAnimSeed(id: number, state: number): number {
  return (Math.imul(id >>> 0, 0x9E3779B1) ^ Math.imul(state >>> 0, 0x85EBCA6B)) >>> 0;
}

/**
 * 副手件姿态搬运：盾留左臂不动，匕首在左手 ↔ 左腰之间搬移。
 * （**主手**不在这里 —— 它连同"双手武器的镜像份"由 `WeaponMount` 统一管，见 weapon-loader。）
 * 找不到目标骨时**不静默丢弃**：返回骨名由调用方上报（纠错 #12：降级必须可见）。
 */
export function moveOffHandForStance(opts: {
  root: THREE.Object3D;
  off: THREE.Object3D | null;
  idcode: number;
  offKind: number;
  stance: 'combat' | 'sheathed';
}): { moved: boolean; missingBone: string | null } {
  const { root, off, idcode, offKind, stance } = opts;
  if (!off || offKind !== 2) return { moved: false, missingBone: null }; // 只有匕首参与搬运
  const target = stance === 'combat'
    ? offMountBoneOf(idcode, offKind, 'combat')
    : offMountBoneOf(idcode, offKind, 'sheathed');
  const bone = findBone(root, target);
  if (!bone) return { moved: false, missingBone: target };
  off.parent?.remove(off);
  bone.add(off);
  return { moved: true, missingBone: null };
}

export interface EnterGameInfo {
  playerId: number;
  mapId: number;
  position: { x: number; y: number; z: number };
  rotation?: { x: number; y: number; z: number }; // 出生朝向（ay=引擎角度 0-4095）
  appearance?: CharacterAppearance;
  /** 全量地图包围盒（服务端 EnterGame 下发，SMD 派生；world float 域）——判图/预加载查找表 */
  maps?: Array<{ mapId: number; bounds?: [number, number, number, number] }>;
}

/** 进图加载出口：main.ts 喂给 LoadingScreen（阶段进度 + 首帧渲染完成） */
export interface WorldLoadHooks {
  onProgress?: (current: number, max: number) => void;
  onReady?: () => void;
}

export interface WorldView {
  /**
   * 开始一次新的进场（发 `C2S_SelectCharacter` 时调，**必须在发之前**）。
   *
   * 丢掉上一局残留的 Appear 暂存。服务端先发视野内 Appear、**再**发 `S2C_EnterGame`，
   * 所以本局的 Appear 会在世界建好前到达并暂存 —— 清点落在"进场发起"而非"世界建好"
   * （详见实现处注释：清早了会连本局的 Appear 一起清掉）。
   */
  beginWorldEnter(): void;
  show(enterGame: EnterGameInfo, hooks?: WorldLoadHooks): void;
  hide(): void;
  destroy(): void;
  /** 游戏时间（0-23时/0-59分）：昼夜驱动源（忠实 /pt/maps darkLevel/BackColor 渐变） */
  setGameTime(hour: number, min: number): void;
  /** 切换场内小地图显示（原版 TAB）；返回切换后是否显示 */
  toggleMinimap(): boolean;
  /** 小地图当前是否显示（HUD 的 TAB 按钮图标同步用） */
  isMinimapOn(): boolean;
  /**
   * 相机模式（原版小按钮 Z）：0=手动（方向键/滚轮俯仰/鼠标贴左右边缘旋转）、
   * 1=自动（松手后慢慢回到角色背后）、2=固定（视角始终跟在角色背后）。返回切换后的值。
   */
  toggleCameraMode(): number;
  /** 当前相机模式 */
  cameraMode(): number;
  /** 切换"显示附近所有掉落物名牌"（A 键） */
  toggleGroundItemLabels(): void;
  /** 取消当前 Chase/攻击目标（ESC）—— 与"点空地取消"同一出口，但不产生移动意图 */
  cancelTarget(): void;
  /** 应用显示偏好（系统设置里改完立即生效，见 ui/display-prefs.ts）：下一帧重算可见集 */
  setDisplayPrefs(p: DisplayPrefs): void;
  /** 当前显示预算的实况（可见/隐藏只数、档位）—— 系统设置面板与 profiler 都用它显示"发生了什么" */
  displayBudgetStatus(): { visible: number; hidden: number; range: number; cap: number };
  /** 走/跑模式（真源）；返回切换后的值 */
  toggleRun(): boolean;
  /** 当前是否跑 */
  isRunning(): boolean;
  /** 设置客户端帧率上限（0=跟随显示器刷新率）；持久化到 localStorage 'pt.fps' */
  setTargetFps(fps: number): void;
  /** 当前帧率上限（0=不限制） */
  getTargetFps(): number;
  /** 记录自机 playerId（enterGame.playerId），供 S2C_PlayerMove 路由收敛 */
  setSelfId(playerId: number): void;
  /** 自机移动速度（世界单位/秒，服务端权威属性）；默认 EU 最高档，S2C_PlayerState 到达后覆盖 */
  setSpeed(walkWps: number, runWps: number, walkAnimRate?: number, runAnimRate?: number): void;
  /** playerId 是否为自机（供 S2C_PlayerAppear 丢弃自己的外观快照） */
  isSelf(playerId: number): boolean;
  /** 自机 hp/maxHp（S2C_PlayerState 喂入；名牌血条用） */
  setSelfHp(hp: number, maxHp: number): void;
  /**
   * 服务端权威复活（`game.playerRespawn`）：送回出生地图、半血。
   * **自机位置权威在客户端** —— 必须由客户端把自己搬过去，否则服务端认为你在出生地、
   * 你还在原地继续挨打（两边状态错乱）。`y<=0` 时用本地地形补。
   */
  applyRespawn(info: { mapId: number; x: number; z: number; y: number; hp: number; maxHp: number }): Promise<void>;
  /**
   * 不连续位移（`S2C_PlayerTeleport`，本人）：断本地移动/追击/下落 → 落位 → 必要时换图 →
   * 按新图重选姿态。复活（`applyRespawn`）与脱困共用这一条 —— 复活的额外步骤只有
   * "解除死亡态 + 半血"，不另写一份搬人的实现。
   */
  applyTeleport(info: { mapId: number; x: number; y: number; z: number; angle?: number }): Promise<void>;
  /** 不连续位移（旁观者）：目标图不是当前图 → 摘掉显示；否则把 actor 直接搬过去（并清插值快照，避免"滑过去"） */
  teleportRemote(playerId: number, info: { mapId: number; x: number; y: number; z: number; angle?: number }): void;
  /**
   * 玩家死亡（`S2C_PlayerDeath`）：躺下停在 DEAD 动画末帧，直到 applyRespawn。
   * 自机期间定身（不能移动/攻击）；旁观者的尸体同样可见。
   */
  applyPlayerDeath(playerId: number): void;
  /** 复活目标图是否与当前图不同（main.ts 据此决定要不要盖加载遮罩） */
  respawnNeedsMapLoad(mapId: number): boolean;
  /** 大地图用：当前地图 + 自机世界坐标（含朝向） */
  worldMapPlayer(): { mapId: number; x: number; z: number; angle: number };
  /** 大地图用：地图上的其他实体（NPC / 怪物 / 队友） */
  worldMapEntities(): { kind: 'npc' | 'monster' | 'party'; x: number; z: number; angle?: number }[];
  /** 服务端权威换图校准（game.mapSwitched）：对齐 currentMapId 并同步区域 */
  applyMapSwitched(mapId: number): void;
  /** 自机角色名（S2C_PlayerState.playerName；名牌显示） */
  setSelfName(name: string): void;
  /** 自机等级（跨图边界的等级门槛判定用） */
  setSelfLevel(level: number): void;
  /** 碰撞调试可视化的开关（F9 / `?coll=1` / 控制台都走它） */
  /** 使用道具：播 EAT 动画 + 事件帧的粒子/音效（与 requestPlayEat 同一实现）。false = 没吃成（别发请求） */
  playEat(kind?: UseEffectKind): boolean;
  /**
   * 请求切换武器套（W 键）。空闲时立刻兑现；一次性动画（攻击/技能/受击/吃药）未播完时
   * 缓存到动作结束（对齐原版 `sinChangeSetFlag`，`character.cpp:3817`）。
   */
  requestSwitchWeapon(): void;
  setCollisionDebug(on: boolean): void;
  isCollisionDebug(): boolean;
  /** 扫描场景，列出几何里含非有限值的对象（定位 three 的"包围球 NaN"告警） */
  scanNaNGeometry(): NaNGeometryHit[];
  /** 自机发起攻击 → 进入 3 秒战斗窗口（玩家血条显示） */
  markSelfCombat(): void;
  /**
   * S2C_AttackStart 旁观同步：attackerId 为视野内远端玩家 → 触发其挥拳动画（按 attackSpeed 变速）+ 朝 targetId 怪转向。
   * 自机（attackerId=self）忽略：自机挥拳由本地攻击循环驱动。
   */
  signalAttackStart(attackerId: number, targetId: number, attackSpeed: number, animIndex?: number, animClip?: string): void;
  /**
   * S2C_Damage 受击硬直：targetId 为自机 → 站立/走/跑时播受击动画（攻击/技能中不打断）；
   * 为远端玩家 → 同规则作用到该 actor。damage<=0（抵抗/吸收）不播。
   */
  onTakeDamage(targetId: number, damage: number): void;
  /** S2C_Damage/Heal：targetId 命中怪物/远端玩家/自机 → 更新其 currentHp；isDamage 才触发自机战斗窗口 */
  applyUnitHp(targetId: number, hp: number, isDamage: boolean): void;
  /** S2C_AttackResult：怪物受击 → 自减血量（服务端暂只广播 damage）；attackerId=self 触发自机战斗窗口 */
  applyMonsterHit(monsterId: number, damage: number): void;
  /**
   * S2C_AttackResult 音反馈（自机为攻击者）：MISS → 挥空音；暴击 → 追加暴击音。
   * 对应原版 WeaponPlaySound 末尾的 AttackCritcal / 暴击追加码 16。
   */
  playSelfAttackResult(missed: boolean, critical: boolean, hitIndex?: number, attackEffect?: boolean): void;
  /** 应用服务端下发的攻击计划（B 方案）：起手即知各段结果 → 事件帧可直接播正确的音 */
  applyAttackPlan(plan: {
    clientSeq?: number | null;
    segments?: ArrayLike<{ index?: number | null; missed?: boolean | null; isCritical?: boolean | null; attackEffect?: boolean | null }> | null;
  }): void;
  /**
   * 在单位身上放一个 INI 广告牌特效（命中/暴击/升级等）。
   * targetId 可为怪物/远端玩家/自机；无法定位目标时静默忽略。
   * 特效名对应 `effect/animationdata/<名>.ini`（如 NormalHit1 / CriticalHit1 / Light1）。
   */
  spawnEffectOnUnit(targetId: number, name: string): void;
  /** 升级闪光：`EFFECT_LEVELUP1` 的四枚 INI（levelupparticle1/levelup/levelup1left/levelup1right）摆在目标锚点 */
  spawnLevelUpEffect(targetId: number): void;
  /** 伤害/躲闪飘字：kind 可省略（按 id 自动归属 自机/怪物/远端玩家）；crit 放大字号 */
  /** attackerId：攻击者玩家 id（可选 —— 给到的话飘字沿 "被攻击者 → 攻击者" 方向漂移） */
  showFloater(kind: 'self' | 'monster' | 'remote' | null, id: number, text: string, color: string, crit: boolean, attackerId?: number): void;
  /** 服务端权威移动（S2C_PlayerMove）：自机→阈值收敛插值；他人→远端演员跟踪 */
  applyPlayerMove(playerId: number, x: number, y: number, z: number, angle: number, animState: number, animIndex?: number, animClip?: string, useSeq?: number, useItemIdcode?: number): void;
  /** 玩家进入视野（S2C_PlayerAppear）→ 异步加载独立克隆演员；angle=出现时朝向(弧度) */
  playerAppear(playerId: number, name: string, classId: number, level: number, hp: number, maxHp: number, clanName: string, clanMark: string, x: number, y: number, z: number, angle?: number, appearance?: CharacterAppearance, walkAnimRate?: number, runAnimRate?: number): void;
  /** 玩家离开视野（S2C_PlayerDisappear）→ 移除演员 */
  playerDisappear(playerId: number): void;
  /** 外观更新（S2C_AppearanceUpdate）：自机或指定远端换装 → 重建模型 */
  updateSelfAppearance(appearance?: CharacterAppearance): void;
  updateRemoteAppearance(playerId: number, appearance?: CharacterAppearance): void;
  /** 换头（转职换头饰/道具换发型）：只替换头部网格，骨架/身体/动画不动 */
  changeSelfHead(jobId: number, faceNum: number, tier: number): void;
  /**
   * 怪物出现（`S2C_MonsterAppear`）：modelFile 资产路径 + 位置/朝向 → 渲染怪物演员。
   * `dead=true` = **尸体**（中途进场/重连时看见的已死怪，服务端在 Appear 上带标记）——
   * 直接摆成死亡姿势，不播 idle。
   */
  monsterAppear(monsterId: number, templateId: number, name: string, modelFile: string, level: number, hp: number, maxHp: number, x: number, y: number, z: number, angle: number, dead?: boolean, monsterEffectId?: number, animRate?: number): void;
  /** 怪物移动/状态（S2C_MonsterMove：位置+angle+anim_state） */
  monsterMove(monsterId: number, x: number, y: number, z: number, angle: number, animState: number, animIndex?: number): void;
  /** 怪物消失（S2C_MonsterDisappear）→ 移除（尸体的**下界**：停留时长由服务端 decay 决定，客户端不自己计时） */
  monsterDisappear(monsterId: number): void;
  /**
   * 怪物死亡（S2C_MonsterDeath）→ **留下尸体**：播死亡动作、停在末帧，等 Disappear 才移除。
   *
   * 与 `monsterDisappear` 是两条事件（原版同样：死＝动作态 0x120，删＝`FrameCounter > 400` 的
   * `Close()`）。**不要**在这里移除 actor，也**不要**给尸体加本地计时器 —— 停留时长只有一个来源。
   */
  monsterDeath(monsterId: number): void;
  /** NPC 出现（S2C_NpcAppear）：静态站桩，播 idle 动画 + 头顶名字标签。entityId = 运行时实体 id */
  npcAppear(entityId: number, nameKey: string, modelFile: string, x: number, y: number, z: number, angle: number): void;
  /** NPC 消失（S2C_NpcDisappear）→ 移除 */
  npcDisappear(entityId: number): void;
  /**
   * 地面物品出现（S2C_GroundItemAppear）：加载 DropItem 模型渲染（dorpItem 可空→旗帜兜底）。
   *
   * `itemId` = 原版 32 位 idcode（服务端 `GroundItemProto.item_id`），**只用来判物品大类**：
   * 原版 `scITEM::Draw` 里只有 `ITEMBASE_Weapon`（首字节 0x01）才躺平。
   * `quantity` / `money` 只用于名牌显示数量（金币用 `money`，其余可堆叠物用 `quantity`）。
   */
  groundItemAppear(groundItemId: number, name: string, x: number, y: number, z: number, dorpItem: string, itemId: number, quantity: number, money: number): void;
  /** 地面物品消失（S2C_GroundItemDisappear，拾取/过期/被清） → 移除 */
  groundItemDisappear(groundItemId: number): void;
  /** [调试/装备] 播放指定技能图标动画（iconFile 含 .bmp；'skill_normal'=普攻） */
  playSkillByIcon(iconFile: string, aim?: THREE.Object3D | null): boolean;
  /** [调试/装备] 播放当前装备在指定拳的技能动画 */
  playEquippedSkill(slot: 'left' | 'right', aim?: THREE.Object3D | null): boolean;
}

/**
 * 服务端出生点/位置坐标 → 场景世界。
 * 服务端 world 与 three 场景渲染同域（+z = south），直接使用。
 */
export function rawToWorld(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, y, z);
}

export interface WorldViewOpts {
  /** 移动上报（客户端位置上权威，方向二）：angle=弧度(0=+Z北)、mode=0 IDLE/1 WALK/2 RUN、
   *  x/y/z=当前世界位置。WorldView 控制上报节奏（移动中 ~25Hz + 启动/停止/转向即时）。
   *  anim=动画覆盖：0=按 mode 推导；下落 FALLDOWN=0x70、落地 FALLSTAND=0x71/FALLDAMAGE=0x72。
   *  animIndex/animClip=**自机此刻播的那一条动画**（.inx 条目索引 + 语义 ID）。
   *  服务端原样透传，旁观者据此直接播同一条 —— 不再各自匹配/随机（否则同一角色在不同
   *  客户端上动作不一致）。clip 仅供两端校验数据是否同代（人可读，日志用）。 */
  onMoveInt?: (angle: number, mode: 0 | 1 | 2, x: number, y: number, z: number, anim?: number,
               animIndex?: number, animClip?: string) => void;
  /** 点击地面物品（拾取意图）→ main.ts 发 C2S_PickupItem。拾取距离由服务端权威裁决。 */
  onPickupGroundItem?: (groundItemId: number) => void;
  /** 走到 NPC 身边（Chase 到位）→ 交互（开店/对话）。参数是 NPC 的**运行时实体 id**。 */
  onNpcInteract?: (entityId: number) => void;
  /** 攻击起手（挥拳开始）→ main.ts 发 C2S_AttackStart(targetId, clientSeq, segments)。
   *  animIndex/animClip = 本次挥击动画（旁观者据此播同一条，见 onMoveInt 说明）。 */
  onAttackStart?: (monsterId: number, clientSeq: number, segments: number,
                   animIndex?: number, animClip?: string) => void;
  /** 命中帧（每段一次）→ main.ts 发 C2S_AttackHit(targetId, hitIndex)。 */
  onAttackHit?: (monsterId: number, hitIndex: number) => void;
  /**
   * 施放技能（当前**只有调试施法**会带换目标：Alt/Shift+点击瞄准怪）→ main.ts 发 C2S_UseSkill。
   * skillId = 技能列表下标（`skillIndexByIcon` 的返回值，服务端 `predicate.useSkill`）。 */
  onCastSkill?: (skillId: number, monsterId: number) => void;
  /**
   * 兑现一次「切换武器套」（W 键）→ main.ts 发 C2S_SwitchWeapon。
   *
   * 不直接在按键处发：动画没播完时切武器会让"模型换了、动画还是旧武器那套"
   * （用户 2026-09-16 实测）。由 WorldView 在合适的时机（`STATE < 0x100`，即站/走/跑）
   * 才回调 —— 对齐原版 `sinChangeSetFlag` 的兑现条件（`character.cpp:3817`）。
   */
  onSwitchWeapon?: () => void;
}

// 动画状态 wire token（与 S2C_PlayerMove.anim_state / C2S anim_state 同义）
const ANIM_WALK = 0x0050;
const ANIM_RUN = 0x0060;
const ANIM_FALLDOWN = 0x0070;
const ANIM_FALLSTAND = 0x0071;
const ANIM_FALLDAMAGE = 0x0072;
/** 使用道具（= 原版 CHRMOTION_STATE_EAT，character.h:750；服务端 `broadcastEatIfPotion` 用它广播） */
const ANIM_EAT = 0x0140;
/** 死亡（= 原版 CHRMOTION_STATE_DEAD，见 char-format 的唯一定义；这里只用于"复活了没有"的比较） */
const ANIM_DEAD = CHRMOTION_STATE_DEAD;

// ===== 玩家普通攻击（design-player-combat.md）=====
// 挥拳动画时长 = 服务端攻击间隔 + 此冗余，保证客户端节奏不慢于服务端冷却（结构性防丢刀）
const SWING_SLACK_MS = 40;
// 起手闸门余量：动画播完到触发下次起手之间的帧级抖动（2 动画帧 ≈ 67ms，见 selfAttackGateMs）
const ATTACK_START_MARGIN_MS = 67;

// ===== 动画播放（delta-time，与帧率解耦）=====
// animFrame 单位：1 动画帧 = 160 单位。原「每渲染帧 += 80」在 60fps 下等价于 4800 单位/秒。
// 现按真实 dt 推进 → 帧率任意（30/60/120/144…）动画速度一致，客户端帧率可调。
// ANIM_UNITS_PER_SEC 已移至 char/animation.ts（游戏与工具共用同一常量，避免两处各定义一份）
const ANIM_FPS_BASE = 30;        // 动画数据基准帧率（1 动画帧 = 1/30 秒）

/**
 * 攻击间隔公式（与服务端 CombatService.attackIntervalMs 逐字一致）：
 * frames = 60 − 3·clamp(as−6, 0, 6) @60fps → as=0..6:1000ms，12+:700ms
 */
function attackIntervalMs(attackSpeed: number): number {
  const clamped = Math.max(0, Math.min(attackSpeed - 6, 6));
  return Math.round((60 - 3 * clamped) * 1000 / 60);
}

/** 攻击动画播放速率倍率（1=基准速度）：使该动画播完时长 = 攻击间隔 + slack */
function attackRate(motion: MotionInfo, attackSpeed: number): number {
  const swingMs = attackIntervalMs(attackSpeed) + SWING_SLACK_MS;
  const span = motion.endFrame - motion.startFrame;
  const naturalMs = (span / ANIM_FPS_BASE) * 1000;
  return Math.max(0.01, naturalMs / swingMs);
}

/**
 * 起手闸门：两次起手之间至少要隔这么久（毫秒）。
 * 服务端 AttackStart 有一道 `checkAttackCooldown` 硬闸（间隔 = attackIntervalMs，与上面同式），
 * 落在冷却内会被**整条拒绝**：这次挥拳没有计划可裁定，命中帧就会退回重掷甚至被当作上一计划的
 * 重复段吞掉。动画播完到下次起手之间有几帧/几毫秒的抖动，正好能压进冷却边界，
 * 所以客户端自己也要留出这段余量（2 个动画帧 ≈ 67ms），让上报的节奏始终落在服务端允许的速率内。
 */
function selfAttackGateMs(): number {
  return attackIntervalMs(getGameSnapshot().character?.attackSpeed ?? 0) + ATTACK_START_MARGIN_MS;
}

/**
 * 交互类目标（掉落物 / NPC / 其他玩家）的停步环半径。
 *
 * 这几类要**停在判定范围之内**才能触发交互，所以比怪物那个环更近：
 *   - 掉落物：客户端即时拾取判定 `PICK_ACT_RANGE = 32`；停在 32 正好压线，一抖就拾不到；
 *   - NPC 对话：服务端 `NPC_INTERACT_RANGE = 96`（宽），但贴太近在视觉上像"撞上去"，取 24 自然；
 *   - 其他玩家：无服务端距离校验，跟 NPC 取齐。
 *
 * ⚠ 怪物的停步环**不在这里**——它是"攻击距离的函数"，见 `game/combatRange.ts`。
 * 曾经两者共用一个硬编码 32，服务端把近战单手调成 30 后它就成了"停在攻击距离之外"的死区。
 */
const INTERACT_RANGE = 24;

/**
 * 自机攻击距离 = 服务端下发的 `shootingRange`，**不做本地二次加工**。
 *
 * 那个字段就是"攻击距离"本身（服务端 `PlayerStatCalculator.shootingRangeOf` 已分档：
 * 远程=装备射程 / 近战双手 60 / 近战单手与徒手 30），服务端 `CombatService.attackRange`
 * 读的是同一个值 ⇒ 面板显示、客户端停步距离、服务端距离裁决三者一致。
 * ⚠ 曾经这里写 `max(shootingRange, 48)`，那个 48 会把"单手 40"顶成 48 —— 已删。
 * ⚠ 停在哪儿由它算出（`monsterStopRing`）——**别在别处再写一个停步距离**：
 * 两个数字一旦漂开（环 ≥ 射程）追击就会卡死在"够不着"的位置，见 `game/combatRange.ts`。
 */
function selfAttackRange(): number {
  return getGameSnapshot().character?.shootingRange ?? 0;
}

// 怪物名牌/血条显隐距离阈值（< 服务端露面 VIEW_RANGE=1000；见 design-nameplate-hpbar.md）
const NAME_TAG_RANGE = 600; // 怪物名牌常显范围（防漏怪）；范围外选中/悬停才显示
const NPC_TAG_RANGE = 768;  // NPC 名牌 12 格（对齐 exm：NPC RendPoint.z < 12*64*fONE）
// "进入战斗"窗口：最近 N 毫秒自机受击/发起攻击 → 玩家血条显示
const COMBAT_WINDOW_MS = 3000;

/** 使用道具的粒子高度：脚下 + 48（原版 `pY + 48 * fONE`；世界单位 = 原版 float 单位，见 collision 的 OBJ_*_RAW） */
const EAT_EFFECT_LIFT = 48;

/**
 * 吃药冷却（毫秒）= 原版 `sinUsePotionDelayFlag` 的 **50 帧**（`sinInvenTory.cpp:794`：
 * `dwUsePotionDelayTime > 50` 才清零），按原版 70Hz 主循环换算 ⇒ 50/70 ≈ 714ms。
 * 期间再按吃药键**无效**（不吃、不播、不发请求）。
 */
const EAT_COOLDOWN_MS = Math.round((50 / 70) * 1000);

/**
 * 「使用道具」的表现入口（EAT 动画 + 粒子 + 音效）——**唯一实现**，右键/数字键/点药水槽三处都调它。
 * 原版：`sinActionPotion()`（playsub.cpp:1076）切 `CHRMOTION_STATE_EAT`；
 * `.in` 里每职业的 EAT 条目是 `물약먹기동작1/2`（weapon=all，野外/村庄都能用）。
 *
 * **粒子与音效的时机分两条**（逐分支照抄，别合并）：
 *   · 药水 —— 在 EAT 的**事件帧**才播（`character.cpp:6324` `if (MotionInfo->EventFrame[0])`）：
 *     粒子 `EFFECT_POTION{1,2,3}` + 音 `SIN_SOUND_EAT_POTION`(=20)。
 *   · 以太核心 —— `ActionEtherCore`（`playsub.cpp:1111`）在**点击瞬间**就
 *     `StartEffect(EFFECT_RETURN1)` + `SkillPlaySound(SKILL_SOUND_LEARN)`。
 *
 * ⚠ 此处曾写"原版喝药水没有粒子特效"——**是错的**：`StartEffect(EFFECT_POTION*)` 就在上面两处。
 */
let playEatRequest: ((kind: UseEffectKind) => boolean) | null = null;

/**
 * 请求播放"使用道具"表现。
 *
 * @returns **是否真的开始吃了** —— 调用方据此决定要不要发 `C2S_UseItem`。
 *   返回 false 的两种情况（都要**不吃也不发**，对齐原版）：
 *   · 家族未登记（kind=null）；
 *   · 正在吃 / 刚吃过（见 `EAT_COOLDOWN_MS`）—— 原版 `sinActionPotion()` 在 EAT 中直接
 *     `return FALSE`，调用方连 `pUsePotion` 都不设（`playsub.cpp:1078`）⇒ 这一下按键无效。
 *   未进图时也返回 false（静默忽略）。
 */
export function requestPlayEat(kind: UseEffectKind = null): boolean {
  return playEatRequest ? playEatRequest(kind) : false;
}

/** 攻击段的"暴击外观"判定（T2 唯一实现）：原版 `AttackEffect`（character.cpp:13354 置位）
 *  与真暴击 `is_critical` 谁为真都按暴击外观处理 —— 只影响命中特效/武器音，**不改伤害**。
 *  ⚠ 飘字（showFloater 的 crit 参数）仍只跟 `isCritical`，别用本函数（见任务书 :173）。 */
export interface CritLookSeg {
  missed: boolean;
  critical: boolean;
  attackEffect?: boolean | null;
}
export function lookCritOf(seg: CritLookSeg | null | undefined): boolean {
  return !!seg && !seg.missed && (seg.critical || !!seg.attackEffect);
}

export function createWorldView(container: HTMLElement, opts?: WorldViewOpts): WorldView {
  const root = document.createElement('div');
  root.id = 'world-root';
  root.style.cssText = 'display:none;position:fixed;inset:0;z-index:50;background:#0d0d0d;';
  container.appendChild(root);

  let renderer: THREE.WebGLRenderer | null = null;
  let scene: THREE.Scene | null = null;
  let camera: THREE.PerspectiveCamera | null = null; // 游戏相机（/pt/maps/ 的 debugCamera）
  let currentMapId = 0; // 当前所在地图
  let lastMapSwitch = 0; // 上次换图时间（防抖）
  /** 上次"按坐标范围检查区域是否已加载"的时间（节流；见移动分支里的 mapsInRange 检查） */
  let lastRegionCheck = 0;
  /** 最近一次区域同步"想要的图"集合：进行中的分帧构建据此判断自己是否已被抛弃 */
  let wantedMaps = new Set<number>();
  /** 待卸载地图 → 到期时刻。**延迟卸载**：边界来回时避免"卸了又装"（每次装约 0.3s） */
  const pendingUnload = new Map<number, number>();
  const MAP_UNLOAD_DECAY_MS = 8000;
  // 名牌/血条 2D overlay（叠在 3D 层上方，pointer-events:none；design-nameplate-hpbar.md）
  let npOverlay: HTMLCanvasElement | null = null;
  let npCtx: CanvasRenderingContext2D | null = null;

  // 动画区域位（对齐原版 StageVillage）：1=村庄 2=野外；查服务端 enterGame 下发的安全区表，未知图按野外
  function currentFieldState(): number {
    return isSafeMap(currentMapId) ? 1 : 2;
  }

  // ---- 走/跑模式（真源；移动中切换经 onMoveInt 出口上报 C2S）---
  // 初值取持久化偏好（用户 2026-09-13：原先每次重进都被重置回"跑"）
  const uiPrefs0 = loadUiPrefs();
  let running = uiPrefs0.running;
  let dirLight: THREE.DirectionalLight | null = null; // 平行光（供角色等受光材质，强度随昼夜压暗）
  let effects: ReturnType<typeof createEffectManager> | null = null; // INI 广告牌特效
  /**
   * 动态光池（原版 `SetDynLight`）—— **80 槽数据面 + 8 盏常驻 PointLight**，实验室与游戏同一份实现
   * （真实灯为什么不建 80 盏，见 `effects/dyn-light.ts` 头注释）。
   *
   * ⚠ 此前游戏侧**没有建它**，所以所有 `SetDynLight` 都无处落地（用户实测："动态光对怪物没起作用"，
   * 不是错觉）。也注意：**地图用的是 `MeshBasicMaterial`（不受光）**，所以地图不会吃到动态光 ——
   * 那是另一件事（要让地图受光得改地图渲染器）。
   */
  let dynLights: DynLightPool | null = null;
  /** three.quarks 粒子运行时（现阶段接管：药水爆发、法术弹）见 `render/effects/quarks-runtime.ts` */
  let quarksFx: ReturnType<typeof createQuarksRuntime> | null = null;

  // ── 昼夜状态（移植 /pt/maps index.html:512-615，忠实原版 Winmain.cpp:5394 + playmain.cpp:2981）──
  let dayNightHour = 12;          // 当前游戏小时（由 main.ts 喂入）
  let dayNightMin = 0;            // 当前游戏分钟
  let dayNightState = 0;          // 0=白天 1=夜晚（hour<4 || hour>=23 或地牢）
  let dayDark = 0;                // DarkLevel 0~220（每帧 ±1 趋向 slot.dark）
  let dayBackR = 0, dayBackG = 0, dayBackB = 0; // BackColor 天空色调（每帧 ±1 趋向 slot.back）
  let dnSceneLightWarned = false; // 无灯提示只打一次
  // 户外时段目标（对齐 /pt/maps：Sky01 day/evening/night 的 LightColor + LightDark）
  // 索引4 day: (0,0,-10)/1；5 evening: (28,0,-30)/24；6 night: (-50,0,10)/145
  const DAYNIGHT_SLOTS = [
    { hLo: 4,  hHi: 22, dark: 1,   back: [0, 0, -10] },  // 白天 4-21
    { hLo: 22, hHi: 23, dark: 24,  back: [28, 0, -30] }, // 傍晚 22
    { hLo: 23, hHi: 24, dark: 145, back: [-50, 0, 10] }, // 夜 23
    { hLo: 0,  hHi: 4,  dark: 145, back: [-50, 0, 10] }, // 夜 0-3
  ];
  // loadMap 现在可能返回 null（分帧构建期间被取消）—— 能进这张表的**一定是建好的**，
  // 所以显式取 NonNullable（否则每个遍历点都要判空，取消语义反而被稀释）。
  const mapHandles = new Map<number, NonNullable<Awaited<ReturnType<typeof loadMap>>>>();
  const collisionMeshes = new Map<number, CollisionMesh>();
  /**
   * **碰撞判定的唯一入口**：玩家坐标 AABB 命中的那些图（+ 兜底）的三角形合并成一份候选，
   * 一次判定。碰撞只看"世界空间里附近有哪些面"，**不看"当前是哪张地图"** ——
   * 地图是人为切分的（一条路/一个门可能一部分在这张图、一部分在另一张图），
   * 只用一张图判定等于用残缺几何判定：该挡的没挡（用户实测穿空气墙），该走的走不了。
   * `currentMapId` / `findCurrentMap` 只负责**地图身份**（换图、区域加载、音频、姿态、等级门槛）。
   */
  const moveCollision = new CollisionMesh();      // 含墙体判定：来源 = 坐标命中的图
  const groundCollision = new CollisionMesh();    // 只取地面高度：来源 = 全部已加载图（取最高，范围大无副作用）
  moveCollision.setSourceMap(collisionMeshes);
  groundCollision.setSourceMap(collisionMeshes);
  /** moveCollision 当前参与判定的图集合（按坐标重建，避免每子步分配新 Set） */
  const moveSources = new Set<number>();
  const decorGroups = new Map<number, THREE.Group[]>(); // mapId → 装饰 group 列表
  // 全部 44 图 world AABB（预取，用于 findCurrentMap 判归属，不依赖是否已加载）
  const allBounds = new Map<number, [number, number, number, number]>();
  let charGroup: THREE.Group | null = null;
  let selfAngle = 0; // 角色朝向（弧度）
  let selfJobId = 1;
  // 自机主手武器挂载器（含双手武器镜像份、姿态搬运）—— 与远端/检查器同一实现
  const selfWeaponMount = new WeaponMount();
  let selfOffHandGroup: THREE.Group | null = null; // 当前挂载的自机副手（盾/匕首）
  // 自机武器姿态：'combat'=挂手部（攻击姿态）；'sheathed'=收到腰间/背后（安全区村庄态）。对齐 CharSelect。
  let selfWeaponStance: 'combat' | 'sheathed' = 'combat';
  /** 自机是否处于死亡态（躺下等复活）—— 期间定身、不接受移动/攻击 */
  let selfDead = false;
  /** 自机当前动画的**语义 ID**（`SemanticEntry.clip`，如 `stand_unarmed.m4.10`）。
   *  随移动/起手上报给服务端 → 旁观者据此直接播同一条，并校验两端动画数据是否同代。 */
  let selfAnimClip = '';
  let selfAppearance: CharacterAppearance | undefined; // 当前自机外观（进图/换装更新；动画武器类型+武器挂载源）
  let animSmb: Awaited<ReturnType<typeof loadCharacterModel>>['animSmb'] | null = null;
  let bipInxInfo: Awaited<ReturnType<typeof loadCharacterModel>>['bipInxInfo'] | null = null;
  let bones: THREE.Bone[] = [];
  let skeleton: THREE.Skeleton | null = null;
  let animState: ReturnType<typeof createAnimStateMachine> | null = null;
  let motionList: MotionInfo[] = [];
  let animFrameId = 0;
  /**
   * 自机动画播放器（帧推进 + 求值 + 施加到骨骼）—— **与选角预览/远端/怪物/NPC 同一份实现**
   * （`char/anim-player.ts`）。自机建模时创建；未建模时为 null。
   */
  let selfPlayer: AnimPlayer | null = null;
  /**
   * 自机的**近战武器曳光** —— **每只手一条**：原版 `smCHAR::DrawMotionBlur:10137-10141` 是
   * `if (HvLeftHand.PatTool) DrawMotionBlurTool(&HvLeftHand); if (HvRightHand.PatTool) …`
   * 左右手**各调一次**。刺客匕首双持时左手挂 `Bip weapon05`（AGENTS 纠错 #9）。
   * 索引 0 = 主手（`combatBoneOf`），1 = 镜像份（刺客匕首的左手，`WeaponMount.mirror`）。
   */
  const selfTrails: Array<WeaponTrail | null> = [null, null];
  const selfTrailWeaponIds = [-1, -1];
  /** 曳光探针：这一会话里**见过哪些 `motion.state`**（去重后各打一行，用来对判据） */
  const selfTrailStates = new Set<number>();
  /** T1：当前这一下挥击由哪条**技能下标**驱动（决定残影染色，见 weapon-trail.ts 的 `SKILL_TRAIL_TINTS`）。
   *   null/未登记 ⇒ 不染色；普攻 onset 与 `skill_normal` 路径置回 null。设值只两处，见 playSkillByIcon 与普攻循环。 */
  let selfTrailSkillIndex: number | null = null;
  /** 远程攻击的投射物（弓/弩 → 箭；标枪 → 标枪本身）。纯表现，见 render/projectile.ts */
  let projectileMgr: ProjectileManager | null = null;
  // 自机动画播放速率倍率（1=基准）；攻击时按攻速对应的挥拳时长改写，离开 ATTACK 复原
  let selfAnimRate = 1;
  /** 自机走/跑动画速率（服务端下发，1 档 = 1.0）—— 客户端不再自己换算 */
  let selfWalkAnimRate = 1;
  let selfRunAnimRate = 1;
  // 本次挥拳的命中帧跟踪：motion + 目标 + 事件帧（相对 startFrame×160，非零）+ 已触发段数
  let selfAttackMotion: MotionInfo | null = null;
  let selfAttackTargetId = 0;
  /**
   * 自机**当前正在放的技能**在 `skill-fx.json` 里的那一行（起手/事件帧的音与特效都从它取）。
   * 原版是一条 `switch (skillIndex)`（`sinSkillEffect.cpp`），我们改由数据表驱动。
   */
  let selfSkillRow: SkillFxRow | null = null;
  /** 本次技能已触发过几个事件帧（与怪物侧同一判据：`crossEventFrames`） */
  let selfSkillEventFired = 0;
  /**
   * 本次技能的**瞄准点**（世界坐标）。
   *
   * 为什么不直接用 `selfAttackTargetId`：那个值是**自动攻击循环**在"跑到射程内起手"时赋的
   * （见下面的普攻分支），它不是"可保持的选中状态" —— 点一只怪只会**跑过去**，所以
   * "先选目标再施法"这条路在我们客户端并不存在（用户 2026-09-17 实测卡在这里）。
   * 故调试入口改用**已有的 hover 目标**（`hoverTarget`，也就是你看到高亮的那只怪 ——
   * "所见即所瞄"，不再自己挑一次；先前我用 `nameplateTargetAt ?? pickTargetAt` 又挑了一遍，
   * 那是同一判定的第二份实现）。存**节点引用**而不是坐标：原版传的是 `desChar` 引用，
   * 第 30 帧改瞄取的是它**当下**的位置（目标会动）。
   * 真正的技能目标将来由服务端/技能系统给，那时换掉这一处即可。
   */
  let selfSkillAim: THREE.Object3D | null = null;
  /**
   * 瞄准**怪的身中**而不是脚底：`root.position` 在地面，而原版给特效定高度惯用 `pY + N*fONE`
   * （如蘑菇 `pY + 24*fONE`；我方 `MONSTER_ATTACK_FX` 的 `height` 也是这一套）。
   * ⚠ `sinEffect_MultiSpark` 自己用 `DesChar->pY` **原值**（无抬高）⇒ 抬高属**调用侧**的事，
   *   所以放在这里而不是粒子层。数值不对就改这一个常量。
   */
  const TARGET_BODY_LIFT = 24;
  let selfAttackEventFrames: number[] = [];
  /** 待触发的「使用道具」粒子/音效（药水在 EAT 事件帧才放，见 playEatInternal） */
  let selfEatEffect: { kind: UseEffectKind; motion: MotionInfo; fired: boolean } | null = null;
  /** 上次吃药的时刻（`performance.now()`）—— 冷却见 `EAT_COOLDOWN_MS`（原版 sinUsePotionDelayFlag） */
  let lastEatAt = -1e9;
  /**
   * 已应用到自机的**外观指纹**（`CharSelect.appearanceModelKey`）—— "模型是否真的变了"的判据。
   *
   * 只在它变了时才重建模型 + 重选动画；否则整件事跳过（用户 2026-09-16：
   * 整理背包 / 换戒指不该让角色动画从头播一遍）。判据覆盖武器 / 副手 / 躯干甲 / 头 / 转职，
   * 不是"只判武器"。
   */
  let selfAppearanceKey = '';
  /**
   * 待兑现的「切换武器套」请求（W 键）—— 原版 `sinChangeSetFlag`（`character.cpp:3818/4553`）。
   *
   * 攻击/技能/受击/吃药等**一次性动画未播完时不能切**：武器模型会先换掉，而手上还在播
   * 旧武器那一套挥击动画 ⇒ "动画和武器不匹配"（用户 2026-09-16 实测）。
   * 原版把请求存进 flag，只在 `MotionInfo->State < 0x100`（站/走/跑这类移动态）时才兑现。
   */
  let pendingSwitchWeapon = false;

  /** 本次挥拳**各段**的挥击音句柄（key = hit_index）。miss 结果到达时按段替换那一声（见 playSelfAttackResult） */
  const selfAttackVoices = new Map<number, VoiceHandle | null>();
  /** 本机攻击序号（每次起手自增），用于把 S2C_AttackPlan 与本次攻击对齐 */
  let selfAttackSeq = 0;
  /** 上次起手的时刻（rafMs）：起手闸门用，见下方 selfAttackGateMs() */
  let lastSelfAttackStartMs = -1e9;
  /** 服务端下发的攻击计划（B 方案）：key = hit_index。**有计划的段在事件帧直接播正确结果音**，
   *  不再走"乐观命中 → 结果到达再替换"；没有计划的段才退回乐观路径（计划未到/起手被拒）。 */
  let selfAttackPlan: Map<number, CritLookSeg> | null = null;
  /** 已按计划播过音的段 → **当时播的是哪套判定**（missed/critical）。结果到达时用它判断要不要修正 */
  const selfPlanSounded = new Map<number, CritLookSeg>();
  let selfAttackHitFired = 0;
  /** 本次攻击的投射物是否已放（见 spawnProjectile 与 RELEASE_LEAD_FRAMES 的说明） */
  let selfProjectileFired = false;
  let selfPos = new THREE.Vector3();
  let rafMs = 0;
  // 进图加载 hooks（show() 每次重置；首帧渲染后触发 onReady，供 main.ts 收起加载页）
  let loadHooks: WorldLoadHooks | null = null;
  let firstFramePending = false;

  // ── [临时调试] [ ] 键前后调小时，便于看各时段光照。TODO: 验证后删除本块 ──
  const DN_DEBUG_KEYS = true; // 关闭即整体失效
  let dnDebugHour: number | null = null; // 覆盖游戏时钟的小时（null=跟随 GameClock）

  // ── 移动状态（复刻 /pt/maps/ dummy 移动；速度对齐服务端 EU 权威档位）──
  // 服务端 MovementService 固定 EU cnt=25：跑系数 460 / 走系数 180（EU_COEFF_RUN/WALK 同款公式）。
  //   客户端 60fps 帧步长 step_f = ((cnt*10+250)*coeff>>8)/256 world
  //   服务端 20fps tick 步长 step = step_f×3（world/s 一致 ⇒ 预测≈权威，免频繁纠偏）
  // ── 自机（方向二：客户端位置上权威）：本地即时移动（即时跟手）+ 按节奏上报位置 ──
  // 无对账/回拉：上报的就是本地正在渲染的位置，服务端限速校验后转发，远端看到即此处。
  let selfPlayerId = -1;
  // 自机名牌/血条数据（playerState 喂 hp；damage/heal targetId=self 喂战斗窗口与 hp）
  let selfName = '';
  let selfHp = 100, selfMaxHp = 100;
  /** 自机等级：跨图边界门槛判定用（来源 S2C_PlayerState.level，见 main.ts） */
  let selfLevel = 1;
  let selfCombatUntil = 0; // performance.now() 截止：在此刻前视为"战斗中"
  let selfTopY = 1.7; // 自机模型顶高（loadPlayer 后由 modelTopY 计算）
  let mouseDown = false;
  let mouseX = 0, mouseY = 0;
  // tap（轻点，非拖拽按住）判定：按下时刻/位置，抬起时位移与时长在阈值内视为点击
  let tapDownX = 0, tapDownY = 0, tapDownT = 0;
  // 本次按压是否按在可交互目标上（掉落物/怪/玩家）：目标按压抬起时直接执行点击目标逻辑
  let targetPressActive = false;

  // ---- 原版鼠标光标 overlay：指向可拾取→GetItem(手)、怪物→Attack(红)、NPC→Talk、默认箭头 ----
  let cursorProbeAt = 0;
  let mouseSeen = false;

  // ---- hover 发光外轮廓（design-hover-outline.md）----
  // 颜色常量：掉落物金黄 / 怪物淡红 / NPC 绿 / 玩家白；自机不描边。
  const HOVER_COLOR_ITEM = 0xffd24a;
  const HOVER_COLOR_MONSTER = 0xff6b6b;
  const HOVER_COLOR_NPC = 0x54ff9f;
  /**
   * 玩家用**白**色（用户 2026-09-16：必须与 NPC 的绿色区分开）。
   *
   * 曾经与 NPC 同为 `0x54ff9f` —— 人多时根本分不清点中的是人还是 NPC，
   * 而"点人"与"点 NPC"发起的交互完全不同。
   * 颜色是 `outlinePass.visibleEdgeColor.set(...)`（直接赋值、不是相乘），所以白色是有效高亮。
   */
  const HOVER_COLOR_PLAYER = 0xffffff;
  let outlinePass: OutlinePass | null = null;
  let composer: EffectComposer | null = null;
  let hoverTarget: { root: THREE.Object3D; color: number } | null = null;
  let lastHoverScanAt = 0;
  /** 剖析器的场景遍历统计节拍（遍历本身有成本，不能每帧做） */
  let lastSceneScanAt = 0;

  /** 诊断（临时）：步长采样主 framebuffer，统计三类目标色像素，判定光圈是否落在屏幕上。 */
  function hoverOutlineScanDiag(): void {
    try {
      const r = renderer;
      if (!r) return;
      const gl = r.getContext() as WebGL2RenderingContext;
      const w = Math.floor(r.domElement.width * r.getPixelRatio());
      const h = Math.floor(r.domElement.height * r.getPixelRatio());
      const full = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, full);
      const step = 6;
      let green = 0, red = 0, gold = 0;
      const key = hoverTarget ? hoverTarget.color : 0;
      for (let y = 0; y < h; y += step) {
        for (let x = 0; x < w; x += step) {
          const i = (y * w + x) * 4;
          const R = full[i], G = full[i + 1], B = full[i + 2];
          if (G > 110 && R < 130 && B < 95 && G > R + 30) green++;
          else if (R > 150 && G < 95 && B < 95) red++;
          else if (R > 170 && G > 110 && B < 90 && R > B + 60) gold++;
        }
      }
      const targetColorName = key === HOVER_COLOR_ITEM ? '金黄(item)' : key === HOVER_COLOR_MONSTER ? '红(monster)' : key === HOVER_COLOR_NPC ? '绿(npc)' : '白(player)';
      console.log(`[hover-diag] 屏幕扫描(步长${step}): green=${green} red=${red} gold=${gold} | hover目标色=${targetColorName}`);
      // 红/金/绿任何一类有像素 → 光圈已画出（但需先排除背景本身含亮色）
    } catch (e) {
      console.error('[hover-diag] 屏幕扫描失败:', e);
    }
  }


  /** 按屏幕坐标探测指向目标 → 光标模式 + hover 外轮廓目标（节流）。
   *
   *  **与点击共用同一个判定**（`pickTargetAt` = 原版屏幕矩形 + 深度最近）：
   *  原版也是同一个 `lpSelChar`/`lpSelItem` 同时驱动光标与点击，
   *  两边各判一套会出现"光标显示可拾取、点下去却选了怪"。
   *  名牌矩形（overlay 是 DOM 最上层）优先于 3D 判定。 */
  function probeCursorAt(cx: number, cy: number): void {
    const now = performance.now();
    if (now - cursorProbeAt < 66) return; // ~15Hz 足够（配合世界滚动静态光标）
    cursorProbeAt = now;
    if (!renderer || !camera || !scene) return;

    // **名牌也是拾取目标**（用户 2026-09-13：地上的道具太难捡）：
    // 鼠标落在某块名牌的矩形内 → 直接把它对应的目标当作 hover 目标。
    const tagHit = nameplateHits.find((b) =>
      cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h);
    if (tagHit) {
      hoverTarget = { root: tagHit.root, color: tagHit.color };
      setCursorMode(tagHit.cursor, mouseDown);
      return;
    }

    const tag = pickTargetAt(cx, cy);
    if (!tag) {
      hoverTarget = null;
      setCursorMode('default', mouseDown);
      return;
    }
    switch (tag.kind) {
      case 'item':
        hoverTarget = { root: tag.root, color: HOVER_COLOR_ITEM };
        setCursorMode('pickup', mouseDown);
        break;
      case 'monster':
        hoverTarget = { root: tag.root, color: HOVER_COLOR_MONSTER };
        setCursorMode('attack', mouseDown);
        break;
      case 'npc':
        hoverTarget = { root: tag.root, color: HOVER_COLOR_NPC };
        setCursorMode('talk', mouseDown);
        break;
      default:
        hoverTarget = { root: tag.root, color: HOVER_COLOR_PLAYER };
        setCursorMode('default', mouseDown);
        break;
    }
  }

  // 点击目标（对齐原版 lpCharMsTrace/lpMsTraceItem 引用式追踪）：
  //   item/monster/player/npc = 引用目标，每帧用其实时坐标（GetMouseSelAngle）；
  //   ground = 固定坐标的"点地移动"意图。新点击总会替换旧意图 → Chase 可被中断。
  let moveTarget:
    | { kind: 'item' | 'monster' | 'player' | 'npc'; id: number }
    | { kind: 'ground'; x: number; z: number }
    | null = null;
  let moveStuckStart = 0;
  /** 最近一次算出的"到追逐目标的距离"（世界单位）；-1 = 还没算过。见到位拾取日志 */
  let lastChaseDist = -1;

  /** Chase/移动目标实时位置：找不到（消失/离视野）返回 null → 取消追踪 */
  function chaseTargetPos(): { x: number; z: number } | null {
    if (!moveTarget) return null;
    if (moveTarget.kind === 'ground') {
      return { x: moveTarget.x, z: moveTarget.z };
    }
    if (moveTarget.kind === 'item') {
      const g = groundItems.get(moveTarget.id);
      return g ? { x: g.root.position.x, z: g.root.position.z } : null;
    }
    if (moveTarget.kind === 'monster') {
      const m = monsters.get(moveTarget.id);
      return m ? { x: m.root.position.x, z: m.root.position.z } : null;
    }
    if (moveTarget.kind === 'player') {
      const p = remotes.get(moveTarget.id);
      return p ? { x: p.root.position.x, z: p.root.position.z } : null;
    }
    if (moveTarget.kind === 'npc') {
      const n = npcs.get(moveTarget.id);
      return n ? { x: n.root.position.x, z: n.root.position.z } : null;
    }
    return null;
  }
  /** 点击掉落物即时拾取半径（世界单位，对齐原版 ≈32）：该范围内点击即发 C2S；更远走 Chase */
  const PICK_ACT_RANGE = 32;
  /**
   * 屏幕矩形判定的尺寸（**世界单位**），等价原版 `GetRect2D(..., 32 * fONE, 32 * fONE, ...)`
   * —— 原版传的是世界尺寸而非像素，故矩形随距离自动缩放（近大远小），这里同理。
   */
  const ITEM_PICK_ANCHOR_UP = 16;   // 原版锚点：物品位置抬高 16 单位（`pY + 16 * fONE`）
  const WORLD_PICK_SIZE = {
    item: 32,      // 原版掉落物矩形 32×32
    monster: 64,   // 角色：原版按模型尺寸传，这里统一给一个够用的世界尺寸
    player: 64,
    npc: 64,
  } as const;

  // 本地移动步速 world/s（默认 EU 最高档；S2C_PlayerState.walk_speed/run_speed 到达后 setSpeed 覆盖为玩家属性速度）
  let selfRunWps = (((25 * 10 + 250) * 460) >> 8) / 256 * 60;   // ≈210.5
  let selfWalkWps = (((25 * 10 + 250) * 180) >> 8) / 256 * 60;  // ≈82.3
  /**
   * 「1 档」移动速度 —— 基准，用来把走/跑动画的播放速度按**实际移速**缩放（用户 2026-09-16 要求）。
   *
   * 为什么需要：动画本身是按基准速度做的，玩家穿上加速装备（或吃了加速药）后
   * 位移变快、脚步却还是原来那套 ⇒ 看起来在"滑行"。按 `实际 ÷ 1档` 缩放播放速度，
   * 步频才跟得上位移。
   *
   * ⚠ **此前这里直接取了上面那两句默认值，而它们是「档位 25（EU 最高档）」**（同 797 行注释）；
   * 档位体系见 `docs/movement-speed-analysis.md`：`MoveSpeed = 档位*10 + 250`，范围 **1~25**。
   * 于是基准 = 82.3/210.5 而真正的一档 = 42.7/109.5 ⇒ 基准偏大 **1.93 倍**，
   * 一档时 `rate = 42.7/82.3 ≈ 0.52`，**动画速度只有一半**（用户实测："1 档移动速度明显降低"）。
   * 修法：基准改按**档位 1** 的公式算 ⇒ 一档 `rate = 1`，加速后 `rate > 1`（正是原设计意图）。
   */
  // 「1 档基准」不再由客户端持有 —— 走/跑动画速率改由**服务端查表下发**
  //（`GameConstants.WALK_ANIM_RATE`，随 `S2C_PlayerState` / `S2C_PlayerAppear` 到达）。
  // 此前客户端用"本地的默认值"当 1 档基准，而那份默认值其实是档位 25 ⇒ 一档动画被拖慢一半（用户实测）。
  // 上报状态机
  let wasMoving = false;        // 上一帧是否在移动（本地动画/停止上报去重）
  let lastMoveReportAt = 0;
  const MOVE_REPORT_MS = 40;    // 移动中上报节奏 ≈25Hz（服务端 20Hz tick 消费）
  /** "按坐标检查区域是否已加载"的节流（跑图时最多每 500ms 查一次 AABB，开销可忽略） */
  const REGION_CHECK_MS = 500;
  /**
   * 单次碰撞探测的位移上限（raw）。一帧的位移按它切成几次 `checkNextMove`。
   * 取 449 = 原版本地玩家**跑步基准**每 tick 的位移（`(MoveSpeed*460)>>8`，MoveSpeed=250，
   * 70Hz 每 tick 一次；原版全程 449~592 raw）。我们的速度上限比原版高，若一次走完整帧位移，
   * 碰撞采样点密度就比原版稀（高速时掠过薄墙/窄缝、跨过小台阶；掉帧 dt 夹到 0.1s 时单次可达 8000+ raw）。
   * 这是**碰撞粒度**（CCD 采样密度），不是速度上限 —— 速度仍由服务端下发的 walk/run 决定。
   */
  const MAX_SUBSTEP_RAW = 449;
  /**
   * 参与碰撞的图，按"以玩家为中心的这个半径"与图的 AABB **相交**来选（世界单位）。
   *
   * ⚠ 不能用"玩家坐标点落在哪个 AABB 内"：地图边界处常有**平行于边界**的墙，
   * 玩家坐标一越界，整张相邻图就会被排除 → 那堵墙直接失效（用户 2026-09-13 指出）。
   *
   * ⚠ 该半径**必须等于取附近三角形的半径**（`NEARBY_RADIUS_UNITS`，= 原版 MakeAreaFaceList 的 ±64u）：
   * 两个距离若不同，就会出现"面取得到、但那张图没被选进来"的漏洞（用户 2026-09-13 定）。
   * 于是"任何可能被取到的面，其所属图必在集合里"成为结构性保证，而不是靠估算。
   * 半径大只会**多挡不少挡**（判定是"任一面命中即挡"）。
   */
  const COLLIDE_MAP_RADIUS = NEARBY_RADIUS_UNITS;

  /**
   * 碰撞调试可视化（用户 2026-09-13 指定三项：碰撞网格 / 当前参与碰撞的面 / 角色碰撞器）。
   * 开关：URL `?coll=1`、按 **F9**、或控制台 `worldView.setCollisionDebug(true)`。
   * 关闭时 `collisionProbe.sink = null` → 判定路径零开销。
   */
  const collisionDebug = new CollisionDebug();
  /** 边界门槛提示的节流（别每帧都刷屏） */
  let lastGateMsgAt = 0;
  // 掉落状态（对齐原版：下落有 FALLDOWN 动画，下落中不能水平移动/转向）
  /**
   * 是否进入下落且要播 FALLDOWN（`diff > 32`）。
   *
   * ⚠ 别拿它当"是否在下落"用：8~32 之间同样在逐帧下落（原版 `character.cpp:1766-1771` 的
   * `pY -= 8 * fONE`），而那时**不进 FALLDOWN**；原版在那段里也不禁止水平移动
   * ⇒ "小坎上能走过去"是原版行为。曾为此加过一个"只要在掉就定身"的 `descending`，
   * 那是**偏离原版**的，已回滚。
   */
  let falling = false;
  let fallHeight = 0;           // 下落起始高度差（触发 FALLDAMAGE 判定）
  let lastY = 0;                // 上一帧自机 y（检测下落位移，同步角色高度）

  function wrapAngle(a: number): number {
    const tau = Math.PI * 2;
    return ((a + Math.PI) % tau + tau) % tau - Math.PI;
  }

  const keys: Record<string, boolean> = {};
  /** 是否正在文本输入（聊天/改名等输入框聚焦）→ 游戏按键必须让路 */
  function typingActive(): boolean {
    const a = document.activeElement;
    return a instanceof HTMLInputElement
      || a instanceof HTMLTextAreaElement
      || (a instanceof HTMLElement && a.isContentEditable === true);
  }
  window.addEventListener('keydown', (e) => { if (!typingActive()) keys[e.code] = true; });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });
  // 失焦清键：按住方向键时切窗口/点别的应用 → keyup 落在别处，按键状态会**永久卡住**
  // （实测：keys['ArrowUp'] 卡住后相机距离每帧 -8 一直缩到下限）。失焦即全部松开。
  window.addEventListener('blur', () => { for (const k of Object.keys(keys)) keys[k] = false; });
  // C 键已由全局 KeyBinding 接管（角色状态面板），这里不再注册 debugDump。
  // 调试输出改为挂到 KeyJ（不会与游戏键位冲突）。
  window.addEventListener('keydown', (e) => {
    if (typingActive()) return;
    if (e.code === 'KeyJ') debugDump();
  });
  // U 键：[临时调试] 角色垂直上抛 40 单位（穿桥掉到桥下后脱困用；TODO: 验证后删除）
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyU') {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      selfPos.y += 40;
      console.log('[u] teleport 角色上抛 40 → y=' + selfPos.y.toFixed(1));
    }
  });

  // ── [临时调试] [ ] 键 ±1 小时（TODO: 验证后删除本块）──
  window.addEventListener('keydown', (e) => {
    if (!DN_DEBUG_KEYS) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const base = dnDebugHour ?? dayNightHour;
    if (e.code === 'BracketLeft') { dnDebugHour = (base + 23) % 24; console.log(`[daynight] hour=${dnDebugHour}`); }
    if (e.code === 'BracketRight') { dnDebugHour = (base + 1) % 24; console.log(`[daynight] hour=${dnDebugHour}`); }
  });

  // 相机状态（对应 /pt/maps/ debug 相机，Winmain.cpp 自由模式初始值）
  // 俯仰角 anx 默认 33.75°（引擎角度 384 → 弧度），any=0；fov=40.9, near=20, far=4000（JS 世界单位）
  // **初值与改动都持久化**（localStorage，见 camera-prefs.ts）：重进游戏不必重设观察距离/角度。
  const camInit = loadCameraPrefs();
  const cam = {
    dist: camInit.dist,
    viewDist: camInit.dist,
    anx: camInit.anx,
    viewAnx: camInit.anx,
    any: camInit.any,
    fov: 40.9,
  };
  /** 已落盘的相机读数：与当前值比对，避免每帧写 localStorage */
  let camSaved = { dist: camInit.dist, anx: camInit.anx, any: camInit.any, mode: camInit.mode, autoRecenter: camInit.autoRecenter };
  let camDirty = false;
  let camSavedAt = 0;
  const CAM_ROT_STEP = (16 / 4096) * Math.PI * 2; // 引擎角度 ±16 → 弧度
  const statsEl = document.createElement('div');
  statsEl.style.cssText = 'position:absolute;left:8px;bottom:8px;padding:6px 10px;background:rgba(0,0,0,0.72);color:#cfc;font:12px/1.5 monospace;border:1px solid #486;z-index:60;user-select:none;pointer-events:none;white-space:pre;';
  root.appendChild(statsEl);

  // ── 场内小地图（忠实原版 playsub.cpp DrawFieldMap：北向滚动视口整场缩略图 + 中心箭头 + MapBox + 标题）
  // 全浮点移植：剥掉原版 8 位定点(fONE=256/FLOATNS=8)与 4096 角度查表，比例语义不变。
  // 画布布局：y0..16 = 标题条；y16..144 = 128×128 地图框（原版 (px,py)，py=426+(WinSizeY-600)）。
  const MM_BOX_Y = 16;               // 框顶部（标题条高度）
  const MM_HALF = 64;                // 框中心 = px+64
  const mmEl = document.createElement('canvas');
  mmEl.width = 128; mmEl.height = 144;
  mmEl.style.cssText = 'position:absolute;z-index:60;pointer-events:none;';
  root.appendChild(mmEl);
  const mmCtx = mmEl.getContext('2d')!;
  let mmVisible = uiPrefs0.minimapOpen;   // 持久化：小地图开关
  mmEl.style.display = mmVisible ? 'block' : 'none';   // 元素入场即按偏好显隐（否则会先闪一下）
  const mmImg = new Map<string, HTMLImageElement>(); // url → image
  const mmLoading = new Set<string>();
  let mmAssetsInit = false;          // arrow/mapbox 一次性

  /**
   * 小地图用的界面纹理（arrow / mapbox）—— 解码流程已抽到 `src/render/ui-texture.ts`，
   * 大地图组件用**同一份**（不然就是两份实现，见 AGENTS #15）。
   */
  async function ensureMMImg(url: string): Promise<void> {
    if (mmImg.has(url) || mmLoading.has(url)) return;
    mmLoading.add(url);
    try {
      const img = await loadUiImage(url);
      if (img) mmImg.set(url, img);
    } finally {
      mmLoading.delete(url);
    }
  }

  function drawImgSub(img: HTMLImageElement, dx: number, dy: number, dw: number, dh: number, fx: number, fy: number, fw: number, fh: number): void {
    mmCtx.drawImage(img, fx * img.width, fy * img.height, Math.max(fw, 1e-4) * img.width, Math.max(fh, 1e-4) * img.height, dx, dy, Math.max(dw, 0), Math.max(dh, 0));
  }

  // 场地缩略图名：唯一数据源 fields.json 的 minimap 字段（= EU SetFileName(ase, 名) 第二参）。
  // 名字与 smd basename 无规律（如 lostisland→lost、dun-6a→dun-6），故由数据文件决定、不做推断。
  function mmBaseName(mapId: number): string | null {
    return minimapBase(mapId);
  }

  // 原版不显示小地图的场（SOD/quest-arena/ACTION/boss36）
  function mmFieldHidden(): boolean {
    return [30, 32, 36, 39].includes(currentMapId);
  }

  function drawMinimap(): void {
    // 屏幕定位：px=656+(W-800)=W-144，py=426+(H-600)=H-174；标题在 py-16 之上
    const px = window.innerWidth - 144;
    const py = window.innerHeight - 174;
    mmEl.style.left = `${px}px`;
    mmEl.style.top = `${py - MM_BOX_Y}px`;
    mmCtx.clearRect(0, 0, 128, 144);
    if (!mmVisible || mmFieldHidden()) return;
    if (!mmAssetsInit) {
      mmAssetsInit = true;
      ensureMMImg('/res/image/arrow.tga');
      ensureMMImg('/res/image/mapbox.tga');
      ensureMMImg('/res/image/npc.tga');
    }
    if (mapHandles.size === 0) return;

    // 半透明黑底（原版 dsDrawColorBox(0,0,0,128)）
    mmCtx.fillStyle = 'rgba(0,0,0,0.5)';
    mmCtx.fillRect(0, MM_BOX_Y, 128, 128);

    // 统一世界窗口（以玩家为中心，固定比例，北=−Z 在上 / 东=+X 在右）
    // 与单图不同：世界坐标连续，遍历所有已加载图（当前+邻图），每图把自己
    // 落在窗口内的那部分缩略图裁剪画入同一 126 盒 → 交界处两张图同时可见且无缝
    const half = (mapLightProfile(currentMapId).mode === 'fixed' ? 16 : 24) * 64;
    const winX0 = selfPos.x - half, winX1 = selfPos.x + half;
    const winZ0 = selfPos.z - half, winZ1 = selfPos.z + half;
    const pxScale = 126 / Math.max(winX1 - winX0, 1e-9);

    for (const [mapId, mh] of mapHandles) {
      const base = mmBaseName(mapId);
      if (!base) continue;
      const url = `/res/field/map/${base}.tga`;
      const [gx0, , gz0] = mh.mapRenderer.worldMin;
      const [gx1, , gz1] = mh.mapRenderer.worldMax;
      const spanX = gx1 - gx0, spanZ = gz1 - gz0;
      if (spanX <= 0 || spanZ <= 0) continue;
      const xA = Math.max(gx0, winX0), xB = Math.min(gx1, winX1);
      const zA = Math.max(gz0, winZ0), zB = Math.min(gz1, winZ1);
      if (xB - xA <= 0 || zB - zA <= 0) continue; // 该图不在视窗内

      ensureMMImg(url);
      const tile = mmImg.get(url);
      if (!tile) continue; // 缩略图未就绪再下一帧补

      const dx = 1 + (xA - winX0) * pxScale;
      const dw = (xB - xA) * pxScale;
      const dy = MM_BOX_Y + 1 + (zA - winZ0) * pxScale;
      const dh = (zB - zA) * pxScale;
      if (dw < 2 || dh < 2) continue;
      drawImgSub(tile, dx, dy, dw, dh,
        (xA - gx0) / spanX, (zA - gz0) / spanZ,
        (xB - xA) / spanX, (zB - zA) / spanZ);
    }

    // NPC 绿点（原版 DrawMapNPC：遍历 NPC，仅 |Δ| < 视窗才画，8×8 npc.tga 中心对齐）
    const npcMark = mmImg.get('/res/image/npc.tga');
    if (npcMark) {
      for (const [, actor] of npcs) {
        const nx = actor.root.position.x, nz = actor.root.position.z;
        if (nx < winX0 || nx > winX1 || nz < winZ0 || nz > winZ1) continue;
        const sx = 1 + (nx - winX0) * pxScale;
        const sy = MM_BOX_Y + 1 + (nz - winZ0) * pxScale;
        mmCtx.drawImage(npcMark, sx - 3, sy - 3, 8, 8);
      }
    }

    // 玩家箭头：窗口以玩家为中心 ⇒ 恒在框中心旋转（原版 DrawMapArrow）
    const arrow = mmImg.get('/res/image/arrow.tga');
    if (arrow) {
      mmCtx.save();
      mmCtx.translate(MM_HALF, MM_BOX_Y + MM_HALF);
      mmCtx.scale(-1, 1);        // 若箭头仅 E/W 反向请保留，否则删此行
      mmCtx.rotate(selfAngle);
      mmCtx.drawImage(arrow, -8, -8, 16, 16);
      mmCtx.restore();
    }

    // 边框（原版 MapBox 最后覆盖，中心镂空）
    const box = mmImg.get('/res/image/mapbox.tga');
    if (box) mmCtx.drawImage(box, 0, MM_BOX_Y, 128, 128);

    // 标题（原版 psDrawTexImage_Point 于 (px,py-16)；为 i18n 改文本，不走 <name>t.tga 贴图）
    const name = t(`map.${currentMapId}`);
    if (!name.startsWith('map.')) {
      mmCtx.font = 'bold 11px "Microsoft YaHei", "Segoe UI", sans-serif';
      mmCtx.textAlign = 'center';
      mmCtx.textBaseline = 'middle';
      mmCtx.shadowColor = 'rgba(0,0,0,0.9)';
      mmCtx.shadowBlur = 2;
      mmCtx.fillStyle = '#f8f0d8';
      mmCtx.fillText(name, MM_HALF, MM_BOX_Y / 2);
      mmCtx.shadowBlur = 0;
    }
  }

  function toggleMinimap(): boolean {
    mmVisible = !mmVisible;
    mmEl.style.display = mmVisible ? 'block' : 'none';
    saveUiPrefs({ running, minimapOpen: mmVisible });   // 落盘（用户 2026-09-13）
    return mmVisible;
  }

  /** 当前小地图是否显示（HUD 的 TAB 按钮图标同步用） */
  function isMinimapOn(): boolean {
    return mmVisible;
  }

  // ===== 相机模式（原版小按钮 Z）：0=手动 1=自动 2=固定 =====
  // 原版证据（ex-machina `src/game/Main.cpp`）：
  //   · `int PlayCameraMode = 1;`            → **默认是自动**
  //   · 切模式：`if (CameraAutoFlag == 2) any = ANGLE_45;`  → 进固定时朝向重置 45°
  //   · `PlayD3D`：`if (PlayCameraMode == 2) { dist = 400; anx = ANGLE_45 - 128;
  //                  ViewAnx = anx; ViewDist = dist; }`   → **固定 = 每帧把距离与俯仰按死**
  //     （用户 2026-09-12 指出："固定摄像机是有固定角度、固定距离的" —— 我原先只锁了朝向，漏了这两个）
  //   · 自动：`PlayCameraMode == 1 && ... && lpCurPlayer->MoveFlag` → 只在角色移动时追朝向
  const TAU2 = Math.PI * 2;
  /** 固定相机（原版模式 2）的硬编码读数 */
  const CAM_FIXED_DIST = 400;                     // dist = 400
  const CAM_FIXED_ANX = (384 / 4096) * Math.PI * 2;  // anx = ANGLE_45 - 128 = 384 引擎角
  const CAM_FIXED_ANY = (512 / 4096) * Math.PI * 2;  // 进入固定时 any = ANGLE_45 = 512 引擎角（45°）
  let camMode = camInit.mode;   // 持久化（原版 PlayCameraMode：0 手动/1 自动/2 固定）
  /** 鼠标贴左右边缘 N px 内持续旋转视角（**仅手动模式**） */
  const CAM_EDGE_PX = 24;
  const CAM_EDGE_RATE = 1.7;     // 边缘旋转角速度（弧度/秒）
  /** 视角平滑时间常数（秒）：滚轮/按键微调时按指数趋近，不要"阶梯跳" */
  const CAM_SMOOTH_TAU = 0.12;

  // 自动相机（原版 Main.cpp:1590-1635）——目的不是"转圈"，而是**稳住观察方向**：
  //   · 只在角色**移动中**（`lpCurPlayer->MoveFlag`）才追；
  //   · 外守卫：朝向偏差 < ANGLE_90+180（=1204 引擎角 ≈ 105.8°）才追 —— 角色朝镜头走时**不甩镜头**；
  //   · 死区：偏差 ≤ AC_MOVE_MIN（256 ≈ 22.5°）**一点不动**，避免小抖动带着镜头摇；
  //   · 步长按偏差比例：`max(|Δ|>>6, AC_MOVE_STEP=4)` 引擎角/**帧**（原版 70Hz），远差转得快、近差收得慢。
  //   · 还要 `AutoCameraFlag`（= 本文件的 autoRecenter）：**任何手动相机操作都关掉它**，操作完成再打开 ——
  //     所以"手动调过之后跑着跑着镜头就不动了"是原版设计（不回正、不跟手斗），不是 bug（用户 2026-09-12 问）。
  const CAM_AUTO_DEAD_ZONE = (256 / 4096) * TAU2;          // 22.5°
  const CAM_AUTO_MAX_DEV = ((1024 + 180) / 4096) * TAU2;   // 105.8°
  const CAM_AUTO_STEP_MIN = (4 / 4096) * TAU2 * 70;        // 4 单位/帧 @70Hz → 弧度/秒
  const CAM_AUTO_GAIN = 70 / 64;                           // (|Δ|>>6) 每帧 → 每秒
  /** 自动回正开关（原版 AutoCameraFlag）：贴边旋转/滚轮/相机键都会置 false，操作结束（平滑到位/松开/离开边缘）再置 true */
  let autoRecenter = camInit.autoRecenter;   // 持久化（原版 AutoCameraFlag）

  /**
   * 改自动回正开关。**所有改动都走这里** —— 它顺带把相机偏好标脏，交给 500ms 的节流块
   * 统一落盘（用户 2026-09-13：这个开关原先只在内存里，重进游戏就回到默认）。
   */
  function setAutoRecenter(v: boolean): void {
    if (autoRecenter === v) return;
    autoRecenter = v;
    camDirty = true;
  }

  /** 角度差归一化到 (-π, π] */
  function wrapPi(d: number): number {
    return Math.atan2(Math.sin(d), Math.cos(d));
  }

  /** 切换相机模式：固定 → 手动 → 自动 → 固定（返回切换后的值）；进固定时朝向重置为原版的 45° */
  function toggleCameraMode(): number {
    camMode = camMode === 2 ? 0 : camMode === 0 ? 1 : 2;
    if (camMode === 2) cam.any = CAM_FIXED_ANY;
    return camMode;
  }

  /** 滚轮调俯仰（原版 WM_MOUSEWHEEL：`whAnx = anx + zDelta`，然后 anx 每帧 ±8 引擎角趋近）。
   *  模式 ≠ 固定时可用；**任何手动相机操作都关掉自动回正**（原版 `AutoCameraFlag = FALSE`）。 */
  function onWheel(e: WheelEvent): void {
    if (isInputBlocked()) return;   // 加载页/遮罩期间不接收滚轮（见 inputGate）
    if (camMode === 2) return;
    e.preventDefault();
    cam.anx = Math.max(CAM_ANX_MIN, Math.min(CAM_ANX_MAX, cam.anx - e.deltaY * 0.0006));
    setAutoRecenter(false);   // 交回给"平滑到位"那一刻再打开（见 updateCamera）
  }

  // 施加姿势用的临时量已收进 `char/anim-player.ts`（与姿势尾巴同一处，唯一一份）
  const clock = new THREE.Clock();

  function ensure3D(): void {
    if (renderer) return;
    // 深度精度经 /maps/ 对照诊断：不再使用 logarithmicDepthBuffer（原先 z-fighting 并非深度精度问题，
    // 而是贴地物共面；而 logdepth 会阻断官方 OutlinePass 的深度纹理）。近远平面 near=20/far=4000 已足够健康。
    renderer = new THREE.WebGLRenderer({ antialias: true });
    // 剖析器要"整帧累计"的渲染统计：three 默认每次 render() 结束就把 info 清零，
    // 而 EffectComposer 一帧要 render 多次（每个 pass 一次）→ 自动重置后只剩最后一个
    // 全屏 quad 的数字。改为手动：帧末读一次再 reset（见 renderLoop 统计段）。
    renderer.info.autoReset = false;
    setMaxAnisotropy(renderer.capabilities.getMaxAnisotropy());
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(root.clientWidth, root.clientHeight, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    root.appendChild(renderer.domElement);
    // 名牌/血条 overlay canvas（叠在 3D 之上，pointer-events:none）
    npOverlay = document.createElement('canvas');
    npOverlay.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;';
    const dpr = renderer.getPixelRatio();
    npOverlay.width = Math.max(1, Math.floor(root.clientWidth * dpr));
    npOverlay.height = Math.max(1, Math.floor(root.clientHeight * dpr));
    npCtx = npOverlay.getContext('2d');
    if (npCtx) npCtx.setTransform(dpr, 0, 0, dpr, 0, 0); // 绘制用 CSS px
    root.appendChild(npOverlay);
    scene = new THREE.Scene();
    collisionDebug.attach(scene);
    try {
      const q = new URLSearchParams(location.search);
      // 调试开关（URL 显式意图才生效，正常游戏不带）：
      //   ?coll=1 碰撞可视化；?nan=1 只在 three 报"包围球 NaN"时自动定位是哪个对象
      if (q.get('coll') === '1') collisionDebug.setEnabled(true);
      if (q.get('coll') === '1' || q.get('nan') === '1') {
        installNaNGeometryWatch(scene);
        console.log('[nan-scan] 已挂上包围球 NaN 定位钩子（three 报错时自动打印对象链）；也可随时 worldView.scanNaNGeometry()');
      }
    } catch { /* 非浏览器环境忽略 */ }
    scene.background = new THREE.Color(0x111122);
    camera = new THREE.PerspectiveCamera(cam.fov, 1, 20, 4000);
      // 粒子“面向相机”的基底要用它（PtCameraFacingSpin = localangleY 的忠实形态）
      setBillboardCamera(camera);
      // **orient 层（TYPE_ONE/THREE/FIVE）的相机** —— 与上一行是**两个**注册表（`orient-shared` 的
      // 注释写着"WorldView/实验室各一次"）。两个实验台都注册了，而这里过去**只注册了 billboard 那个**
      // ⇒ 游戏里 orient 行为拿不到相机、更新函数第一句 `if (!cam) return` 直接跳过 ⇒ `PartAngle`
      // 永远不写进面片 ⇒ 长条光芒只剩默认轴向（用户 2026-09-20 在 Chain Lancer 上看到"只有 y 轴"，
      // 而**实验室里正常** —— 因为实验室两个都注册了）。祭司那批技能踩过同一个坑。
      // 传的是**活引用**（相机会被 OrbitControls/跟随逻辑持续旋转，拷贝快照会立刻过期）。
      setOrientCamera(camera.quaternion, camera.position);
    // 官方后处理管线：RenderPass(主场景) → OutlinePass(hover 发光描边) → OutputPass(色彩空间输出)
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const op = new OutlinePass(
      new THREE.Vector2(renderer.domElement.width, renderer.domElement.height),
      scene,
      camera,
    );
    op.edgeStrength = 3.0;
    op.edgeGlow = 0.5;
    op.edgeThickness = 1.0;
    op.visibleEdgeColor.set(0x54ff9f);
    op.hiddenEdgeColor.set(0x003321);
    op.enabled = false; // 无 hover 目标时不产生任何后处理开销
    outlinePass = op;
    composer.addPass(op);
    composer.addPass(new OutputPass());
    camera.position.set(0, 200, 400);
    const amb = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(amb);
    const dir = new THREE.DirectionalLight(0xffffff, 0.85);
    dir.position.set(200, 400, 200);
    scene.add(dir);
    dirLight = dir;

    // three.quarks 运行时 —— **全场景唯一**：代码内 spec、`.part` 文件、药水、法术弹都归它
    quarksFx = createQuarksRuntime(scene);
    // 特效实例管理（INI 广告牌特效；depthWrite=false + 按 BlendType 混合）
    // ⚠ **必须把 quarksFx 注进去**：`spawnSystem`/`spawn` 的渲染都委托给它（"全用 quark"）。
    // ⚠ 且它由 `effects.update` 统一推进 ⇒ **这里不要再 update 一次**（会 2 倍速）。
    effects = createEffectManager(quarksFx);
    dynLights = createDynLightPool(scene);
    // ⚠ 顺序有讲究：投射物管理器**必须**在特效管理器之后建 —— 法术弹的粒子是挂到飞行节点上的
    // （`projectile.ts` 里 `fx.spawnSystem`），早建一步拿到的就是 `null` ⇒ 箭/标枪照常、法术弹静默没有特效
    // （2026-09-16 用户实测"看不到粒子特效"的根因）。
    projectileMgr = createProjectileManager(scene, effects, quarksFx);
  }

  // 有效小时：调试键覆盖优先，否则跟随 GameClock
  function dnEffectiveHour(): number {
    return dnDebugHour ?? dayNightHour;
  }

  function dnCurrentSlot(): { dark: number; back: number[] } {
    const h = dnEffectiveHour();
    for (const s of DAYNIGHT_SLOTS) {
      if (h >= s.hLo && h < s.hHi) return s;
    }
    return DAYNIGHT_SLOTS[0];
  }

  // 每帧昼夜驱动（移植 /pt/maps index.html dnUpdate + 按地图档案）：
  // 地牢/室内(fixed)：DarkLevel/BackColor 直接用档案固定值（恒夜）；户外/村庄：每帧 ±1 渐变趋向时段目标。
  // 环境光偏移 = (-DarkLevel+BackColor)/255（村庄夜间地形再减半，原版 playmain Color>>=1），
  // 加入玩家火把 + 附近≤8 场景灯后写入每张地图材质 shader uniform。
  function dnUpdate(): void {
    const prof = mapLightProfile(currentMapId);
    const fixed = prof.mode === 'fixed';
    if (fixed) {
      // 恒夜：直落固定值（原版 MainSky 进图即设，非渐变）
      dayNightState = 1;
      dayDark = prof.dark;
      dayBackR = prof.back[0];
      dayBackG = prof.back[1];
      dayBackB = prof.back[2];
    } else {
      const slot = dnCurrentSlot();
      dayNightState = (dnEffectiveHour() < 4 || dnEffectiveHour() >= 23) ? 1 : 0;
      if (dayDark < slot.dark) dayDark = Math.min(dayDark + 1, slot.dark);
      if (dayDark > slot.dark) dayDark = Math.max(dayDark - 1, slot.dark);
      if (dayBackR < slot.back[0]) dayBackR = Math.min(dayBackR + 1, slot.back[0]);
      if (dayBackR > slot.back[0]) dayBackR = Math.max(dayBackR - 1, slot.back[0]);
      if (dayBackG < slot.back[1]) dayBackG = Math.min(dayBackG + 1, slot.back[1]);
      if (dayBackG > slot.back[1]) dayBackG = Math.max(dayBackG - 1, slot.back[1]);
      if (dayBackB < slot.back[2]) dayBackB = Math.min(dayBackB + 1, slot.back[2]);
      if (dayBackB > slot.back[2]) dayBackB = Math.max(dayBackB - 1, slot.back[2]);
    }

    // 环境光偏移 = -DarkLevel + BackColor（有符号，/255 后进 shader）；村庄夜间减半（>>1）
    let eR = -dayDark + dayBackR;
    let eG = -dayDark + dayBackG;
    let eB = -dayDark + dayBackB;
    if (prof.village && dayDark > 0) {
      eR >>= 1; eG >>= 1; eB >>= 1;
    }
    const envLight = new THREE.Vector3(eR / 255, eG / 255, eB / 255);

    // 玩家火把（Winmain.cpp:5517-5535）：DarkLevel>0 时 ap=DarkLevel×1.25，非地牢范围 260 world
    const torchPos = new THREE.Vector3();
    const torchColor = new THREE.Vector3();
    let torchRange = 0;
    if (dayDark > 0) {
      const ap = Math.min(Math.round(dayDark * 1.25), 255);
      torchPos.set(selfPos.x, selfPos.y + 32, selfPos.z);
      torchColor.set(ap / 255, ap / 255, ap / 255);
      torchRange = 260;
    }

    // 场景灯（playmain.cpp:847-885）：夜(DarkLevel>0)启用；NIGHT型(type&1)&&夜 全亮，其余 rgb×DarkLevel>>8
    const sceneLights: { pos: THREE.Vector3; color: THREE.Vector3; range: number }[] = [];
    if (dayDark > 0) {
      const cand: { d2: number; l: SceneLightWorld }[] = [];
      for (const mh of mapHandles.values()) {
        for (const l of mh.mapRenderer.lights) {
          const dx = l.wx - selfPos.x, dy = l.wy - selfPos.y, dz = l.wz - selfPos.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < 0x300000) cand.push({ d2, l });
        }
      }
      if (cand.length === 0) {
        if (!dnSceneLightWarned) {
          dnSceneLightWarned = true;
          console.warn('[daynight] 无场景灯（当前图未烘焙灯或远离光源）');
        }
      }
      cand.sort((a, b) => a.d2 - b.d2);
      const DL = dayDark;
      const dim = (v: number) => (v * DL) >> 8;
      for (let i = 0; i < Math.min(cand.length, 8); i++) {
        const l = cand[i].l;
        const nightFull = ((l.type & 0x1) !== 0) && dayNightState === 1;
        const r = nightFull ? l.r : dim(l.r);
        const g = nightFull ? l.g : dim(l.g);
        const b = nightFull ? l.b : dim(l.b);
        sceneLights.push({
          pos: new THREE.Vector3(l.wx, l.wy, l.wz),
          color: new THREE.Vector3(r / 255, g / 255, b / 255),
          range: l.range / 256, // raw → world
        });
      }
    }

    for (const mh of mapHandles.values()) {
      mh.mapRenderer.updateDayNight(envLight, sceneLights, torchPos, torchColor, torchRange,
        dynLights?.data());
    }
    // 角色等受光材质（Phong）同步压暗：dir/amb 强度随 DarkLevel 线性降
    const k = 1 - dayDark / 255;
    if (dirLight) dirLight.intensity = 0.85 * k;
    const amb = scene?.children.find(c => c instanceof THREE.AmbientLight) as THREE.AmbientLight | undefined;
    if (amb) amb.intensity = 0.6 * k;
  }

  function setGameTime(hour: number, min: number): void {
    dayNightHour = hour;
    dayNightMin = min;
    mapAudio.setGameTime(hour);
  }

  // 角色/怪物/武器纹理加载：实现已抽到 render/char-texture-loader.ts（与 CharSelect / 检查器共用一份）。
  // 这里只包一层，把本场景的各向异性级别注入进去。
  async function loadTextures(textures: TextureTarget[]): Promise<void> {
    await loadCharTextures(textures, renderer ? renderer.capabilities.getMaxAnisotropy() : 1);
  }

  let selfBodyGroup: THREE.Group | null = null;   // 自机身体（可替换：换甲/换衣）
  let selfHeadGroup: THREE.Group | null = null;   // 自机头部（可替换：转职换头饰/道具换发型）
  let selfBodyArmor: string | null = null;        // 当前身体 key（job:armor:override）
  let selfHead = 0;                               // 头型 faceNum
  let selfHeadTier = 0;                           // 转职阶级 tier（rank，0~3，决定头模后缀 a/b/c）

  // 自机初始化：建私有骨架壳 + 头 + 初始身体，动画由全局 bones/skeleton 驱动（帧循环复用）。
  // 与远端同构（cloneBoneHierarchy + cloneSkinnedMesh），规避 char-loader 共享 group 导致的
  // "多次 add/remove 同一 group → 透明/串扰"问题。之后换装只调 swapSelfBody，不重建模型。
  async function loadPlayer(appearance: CharacterAppearance | undefined, jobId: number): Promise<void> {
    if (!scene) return;
    selfJobId = jobId;
    let armorNum = 1;
    let bodyInxOverride: string | null = null;
    if (appearance?.bodyModelIdcode && appearance.bodyModelIdcode > 0) {
      armorNum = armorNumFromIdCode(appearance.bodyModelIdcode);
    } else if (appearance?.bodyModel) {
      bodyInxOverride = resolveCostumeBody(appearance.bodyModel, jobId);
    }
    const head = appearance?.head || 0;
    const tier = appearance?.rank || 0;
    const result = await loadCharacterModel(jobId, head, tier, armorNum, bodyInxOverride);
    console.log('[WorldView] 自机建模: job=' + jobId + ' bodyMesh=' + result.bodyMeshes.length + ' headMesh=' + result.headMeshes.length + ' armor=' + armorNum);

    // 私有骨架克隆（避免共享 skeletonGroup 被跨 reload 复用）
    const priv = cloneBoneHierarchy(result.bones, result.skeleton);
    bones = priv.bones;
    skeleton = priv.skeleton;
    animSmb = result.animSmb;
    bipInxInfo = result.bipInxInfo;
    // 自机动画播放器：**与选角预览/怪物/NPC 同一份实现**（char/anim-player.ts）
    selfPlayer = createAnimPlayer(result.animSmb, bones, skeleton);

    // charGroup 装配：骨架根 + 身体组 + 头组（身体组可整体换内容，头/骨架不动）
    charGroup = new THREE.Group();
    const boneRoot = new THREE.Group();
    if (priv.bones[0]) boneRoot.add(priv.bones[0]);
    charGroup.add(boneRoot);

    selfBodyGroup = new THREE.Group();
    selfBodyGroup.name = 'selfBody';
    for (const m of result.bodyMeshes) {
      const cm = cloneSkinnedMesh(m, skeleton);
      cm.visible = true;
      selfBodyGroup.add(cm);
    }
    selfBodyGroup.visible = false; // 纹理加载完再显示，避免透明/灰闪
    charGroup.add(selfBodyGroup);

    selfHeadGroup = new THREE.Group();
    selfHeadGroup.name = 'selfHead';
    for (const m of result.headMeshes) {
      const cm = cloneSkinnedMesh(m, skeleton);
      cm.visible = true;
      selfHeadGroup.add(cm);
    }
    charGroup.add(selfHeadGroup);
    selfHead = head;
    selfHeadTier = tier;

    scene.add(charGroup);
    charGroup.position.copy(selfPos);
    charGroup.rotation.y = selfAngle;
    selfTopY = modelTopY(charGroup) + 0.5; // 自机名牌锚点顶高

    buildMotionList();
    animState = createAnimStateMachine({
      getMotions: () => motionList,
      getClassId: () => jobId,
      getWeaponIdCode: () => selfAppearance?.weaponIdcode || 0,
      getWeaponType: () => selfWeaponType(),
      getHandType: () => { const h = selfHandType(); return h === '1H' || h === '2H' ? h : null; },
      // 语义匹配优先（唯一实现）；怪物/NPC 无 sidecar → 空数组 → 回退旧链
      getSemanticEntries: () => semanticEntriesForJob(jobId),
      getFieldState: () => currentFieldState(),
      onStanceChange: (stance) => { setSelfWeaponStance(stance); },
      onMotionChange: (motion: MotionInfo) => {
        selfPlayer?.setFrame(motion.startFrame * 160);
        // 记下这条动画的语义 ID：移动/起手上报时要把它同步出去（旁观者据此播同一条）
        selfAnimClip = semanticEntryOfMotion(motionList, semanticEntriesForJob(jobId), motion)?.clip ?? '';
      },
    });
    animState.triggerIdle();
    // 身体纹理就绪后统一显隐（先加载纹理避免灰/透明闪帧）
    await loadTextures([...result.bodyTextures, ...result.headTextures]);
    selfBodyGroup.visible = true;
    selfHeadGroup.visible = true;
    selfBodyArmor = `${jobId}:${armorNum}:${bodyInxOverride ?? ''}`;
    // 真实装备武器挂载（外观决定）；随外观更新重挂
    await mountSelfWeapon();
  }

  /**
   * 换装（增量）：仅替换身体网格，骨架/头部/动画常驻。
   * 新 body 就绪前旧模型保持显示；就绪后同帧 swap，无透明穿帮。
   */
  async function swapSelfBody(appearance: CharacterAppearance | undefined): Promise<void> {
    if (!scene || !charGroup || !selfBodyGroup || !skeleton) return; // 未建模型：忽略（进图用当前外观建）
    selfAppearance = appearance;
    const jobId = appearance?.classId || selfJobId || 1;
    let armorNum = 1;
    let bodyInxOverride: string | null = null;
    if (appearance?.bodyModelIdcode && appearance.bodyModelIdcode > 0) {
      armorNum = armorNumFromIdCode(appearance.bodyModelIdcode);
    } else if (appearance?.bodyModel) {
      bodyInxOverride = resolveCostumeBody(appearance.bodyModel, jobId);
    }
    // 若外观未变（仅武器换）跳过身体重建
    const lastArmor = selfBodyArmor;
    if (lastArmor === `${jobId}:${armorNum}:${bodyInxOverride ?? ''}`) {
      await mountSelfWeapon();
      return;
    }
    selfBodyArmor = `${jobId}:${armorNum}:${bodyInxOverride ?? ''}`;

    // 异步加载新 body（不碰场景），就绪后一次性换掉 bodyGroup 内 mesh
    const result = await loadCharacterModel(jobId, appearance?.head ?? selfHead, 0, armorNum, bodyInxOverride);
    await loadTextures([...result.bodyTextures]);
    // 新 mesh 预置同 visible；构建好后同帧替换（旧 mesh 此刻仍显示）
    const nextBody = new THREE.Group();
    for (const m of result.bodyMeshes) {
      const cm = cloneSkinnedMesh(m, skeleton);
      cm.visible = true;
      nextBody.add(cm);
    }
    // swap：从 charGroup 换掉旧身体组（先加新的再移除旧的，无空白帧）
    if (selfBodyGroup && selfBodyGroup.parent) {
      const parent = selfBodyGroup.parent;
      parent.add(nextBody);
      parent.remove(selfBodyGroup);
    }
    selfBodyGroup = nextBody;
    await mountSelfWeapon();
    console.log('[WorldView] 换装完成: armor=' + armorNum + ' bodyMesh=' + result.bodyMeshes.length);
  }

  /**
   * 换头（增量）：仅替换头部网格（转职换头饰 / 道具换发型 / 创建时改脸型）。
   * 骨架/身体/动画不动；新头就绪后同帧 swap，无透明穿帮。
   * @param jobId 职业
   * @param faceNum 头型（0-2）
   * @param tier 转职阶级（0-3，决定头模后缀）
   */
  async function swapSelfHead(jobId: number, faceNum: number, tier: number): Promise<void> {
    if (!scene || !charGroup || !selfHeadGroup || !skeleton) return;
    if (faceNum === selfHead && tier === selfHeadTier) return; // 头没变
    const headPart = await getHead(jobId, faceNum, tier);
    await loadTextures(headPart.result.texturesToLoad);
    const nextHead = new THREE.Group();
    nextHead.name = 'selfHead';
    for (const m of headPart.result.meshes) {
      const cm = cloneSkinnedMesh(m, skeleton);
      cm.visible = true;
      nextHead.add(cm);
    }
    if (selfHeadGroup && selfHeadGroup.parent) {
      const parent = selfHeadGroup.parent;
      parent.add(nextHead);
      parent.remove(selfHeadGroup);
    }
    selfHeadGroup = nextHead;
    selfHead = faceNum;
    selfHeadTier = tier;
    console.log('[WorldView] 换头完成: face=' + faceNum + ' tier=' + tier + ' headMesh=' + headPart.result.meshes.length);
  }

  /** 当前自机武器语义类型（AXE/SWORD/BOW...，动画白名单匹配用）；无武器/徒手返回 null */
  function selfWeaponType(): string | null {
    return weaponTypeOfIdCode(selfAppearance?.weaponIdcode);
  }

  /** 自机武器单双手（唯一实现见 handTypeOfIdCode） */
  function selfHandType(): HandType {
    return handTypeOfIdCode(selfAppearance?.weaponIdcode);
  }

  /** 自机武器音效码（原版 WeaponPlaySound）：武器类型 + 单双手；法师/祭司的法杖走吟唱音。
   *  传 idcode 是因为**剑族要用低字判短剑**（WS201-203 → small swing 15）。 */
  function selfWeaponSoundCode(): number {
    const job = getGameSnapshot().character?.job ?? 0;
    // 施法职业判据复用 `MAGIC_JOBS`（唯一实现，`render/projectile.ts`）：此前这里是手写的
    // `job === 7 || job === 8`，**漏了萨满 10** ⇒ 空手时 `isCaster` 为假、攻击音落到 punch hit；
    // 萨满拿法杖也会走钝击音而非 casting（用户实测："祭司徒手的攻击音是物理职业的音效"）。
    return weaponSoundCode(selfWeaponType(), selfHandType(), MAGIC_JOBS.has(job), selfAppearance?.weaponIdcode || 0);
  }

  /**
   * 普攻结算音（自机，**按段**）：MISS → 挥空音；暴击 → 暴击音（追加）。
   *
   * ⚠ **MISS 是"替换"不是"叠加"**：原版命中帧那一声由结果决定 —— `WeaponPlaySound` 先判
   * `AttackCritcal < 0`，成立时那一帧**只播挥空音**（12/13），不播武器音。
   * 我们按 B 方案在事件帧**乐观按"命中"**先播了该段的挥击音（与原版 `AttackCritcal = 0` 同义），
   * 所以结果回来说是 miss 时，必须**把**该段**那一声淡出停掉**再播挥空音 ——
   * 否则会听到"打击声 + 挥空声"两层（与原版不符，且是玩家可感知的自相矛盾反馈）。
   * 暴击相反：原版本就是"命中后追加一枚"（码 16），故只追加、不替换。
   *
   * ⚠ 已知的**最差情形**（用户 2026-09-12 认可）：高延迟/丢包时结果晚于事件帧到达 ——
   * 那时玩家**看到 MISS/暴击，听到的却已是命中音**（该声已被淡出，替换音随后才响）。
   * 这是纯音频层的错配：MISS 飘字、伤害数字、HP 全部仍以服务端为准，**结果从不撒谎**。
   * 响应用时赶在事件帧之前时（常见情形）该错配完全不出现。
   */
  /**
   * 应用服务端下发的攻击计划（B 方案）。`clientSeq` 与本次攻击不一致则忽略（过期计划）。
   * 计划一到就缓存起来，事件帧据此直接播正确的结果音 —— 这是把"音效延迟"消掉的关键一步。
   */
  function applyAttackPlan(plan: {
    clientSeq?: number | null;
    attackerId?: number | string | bigint | null;
    segments?: ArrayLike<{ index?: number | null; missed?: boolean | null; isCritical?: boolean | null; attackEffect?: boolean | null }> | null;
  }): void {
    // 旁观分支：计划不是打给自己的（attacker 是视野内别人）→ 交给对应的远端 actor，
    // 让它在自己挥拳的事件帧按同一份计划播正确的结果音（miss/暴击）。
    const attackerId = Number(plan.attackerId ?? 0);
    if (attackerId && attackerId !== selfPlayerId) {
      const actor = remotes.get(attackerId);
      if (actor) applyRemoteAttackPlan(actor, plan.segments ?? []);
      return;
    }
    const seq = Number(plan.clientSeq ?? 0);
    if (seq !== selfAttackSeq) {
      console.log(`[计划] 忽略过期攻击计划 seq=${seq}（当前 ${selfAttackSeq}）`);
      return;
    }
    const map = new Map<number, CritLookSeg>();
    const segs = plan.segments ?? [];
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i]!;
      map.set(Number(s.index ?? i), { missed: !!s.missed, critical: !!s.isCritical, attackEffect: !!s.attackEffect });
    }
    selfAttackPlan = map;
    const miss = [...map.values()].filter((x) => x.missed).length;
    const crit = [...map.values()].filter((x) => !x.missed && x.critical).length;
    console.log(`[计划] 收到攻击计划 seq=${seq} 段数=${map.size}（miss ${miss} / 暴击 ${crit}）→ 各段将直接播对应音`);
  }

  function playSelfAttackResult(missed: boolean, critical: boolean, hitIndex = 0, attackEffect?: boolean): void {
    // 这一段在事件帧已按**服务端计划**播过音了（见事件帧派发）。是否要再动：
    //   计划判定 == 结果判定 → 音已经对了，**不重播**（否则同一段响两声）
    //   计划判定 != 结果判定 → **以服务端结果为准修正**：淡掉计划那一声，改播结果对应的音。
    // 后者就是「miss 时把命中音换成挥空音」——少了这一步，玩家会听到一声命中音，
    // 而账本上这一刀根本没打中（可感知的自相矛盾）。
    const planned = selfPlanSounded.get(hitIndex);
    if (planned) {
      selfPlanSounded.delete(hitIndex);
      const crit = lookCritOf({ missed, critical, attackEffect });
      if (planned.missed === missed && planned.critical === crit) return;
      // 计划与结果不一致（起手时判命中、命中帧判定落空，或反之）→ 以结果为准修正。
      // 这条路径罕见但必须可见：它意味着玩家先听到了一声按计划播的音，然后被纠正。
      console.log(`[音效] 第 ${hitIndex} 段：计划=${planned.missed ? 'miss' : planned.critical ? 'crit' : 'hit'}，`
        + `结果=${missed ? 'miss' : crit ? 'crit' : 'hit'} → 以结果为准修正`);
    }
    const voice = selfAttackVoices.get(hitIndex);
    if (missed) {
      voice?.stop(40);                 // 淡出 40ms：硬停会在波形中间爆音
      selfAttackVoices.delete(hitIndex);
      sfx.playWeaponMiss(selfHandType(), { priority: true });
    } else if (critical) {
      sfx.playCritical({ priority: true });
    } else {
      selfAttackVoices.delete(hitIndex);   // 命中：让该段那声自然播完
    }
  }

  /**
   * 单位**身体中部**的世界坐标（命中特效与投射物的共同落点）。
   *
   * ⚠ 这是**唯一实现**：白光 `NormalHit1`（`spawnEffectOnUnit`）与箭/法术弹的落点都用它
   * —— 用户 2026-09-16 实测"箭的目标位置与视觉不符"，根因就是箭飞向脚下的 `root.position`
   * 而白光打在身上（AGENTS #15：同一判定只能有一份）。
   * 高度规则本身在 `render/projectile.unitBodyAnchorY`（那边也用同一函数，便于自检钉住）。
   */
  function unitBodyAnchor(targetId: number): THREE.Vector3 | null {
    if (targetId === selfPlayerId) return new THREE.Vector3(selfPos.x, unitBodyAnchorY(selfPos.y, selfTopY), selfPos.z);
    const mon = monsters.get(targetId);
    const rem = mon ? null : remotes.get(targetId);
    const root = mon?.root ?? rem?.root;
    if (!root) return null;
    const topY = mon?.topY ?? rem?.topY ?? 1.7;
    return new THREE.Vector3(root.position.x, unitBodyAnchorY(root.position.y, topY), root.position.z);
  }

  /** 命中/暴击等特效：摆到目标单位身体中部（怪物/远端玩家/自机） */
  function spawnEffectOnUnit(targetId: number, name: string): void {
    if (!effects) return;
    const p = unitBodyAnchor(targetId);
    if (!p) return;
    void effects.spawn(name, { pos: { x: p.x, y: p.y, z: p.z } });
  }

  /** 升级闪光 = 原版 `EFFECT_LEVELUP1`（HoEffect.cpp:6915-7008）的四枚 INI 组装。
   *  LevelUpLight1 在本 case 未被引用，不参与（见 levelup 设计 §1.4/§4.1）。
   *  ⚠ 各枚的环向收拢/左右平移由 INI 内在数据自驱，此处只统一摆在单位锚点上。
   */
  function spawnLevelUpEffect(targetId: number): void {
    for (const name of ['levelupparticle1', 'levelup', 'levelup1left', 'levelup1right']) {
      spawnEffectOnUnit(targetId, name);
    }
  }

  /**
   * 切换自机武器姿态：战斗态挂手部骨，收鞘态改挂腰间/背后骨。
   * 主手（含刺客匕首的**镜像份**）交给 `WeaponMount` —— 与远端/检查器同一实现；
   * 本函数只管副手（盾留左臂；匕首 战斗左手 ↔ 收鞘左腰）。
   */
  function setSelfWeaponStance(stance: 'combat' | 'sheathed') {
    if (!charGroup || selfWeaponStance === stance) return;
    const mainRes = selfWeaponMount.setStance(charGroup, stance);
    const offRes = moveOffHandForStance({
      root: charGroup,
      off: selfOffHandGroup,
      idcode: selfAppearance?.weaponIdcode ?? 0,
      offKind: selfAppearance?.offHandKind || 0,
      stance,
    });
    selfWeaponStance = stance;
    const missing = mainRes.missingBone ?? offRes.missingBone;
    if (missing) {
      reportFallback('mount', `自机武器姿态 ${stance}：目标骨 ${missing} 不在骨架里 → 该件留在原挂点（未搬运）`);
    }
    console.log('[WorldView] 自机武器姿态: ' + selfWeaponStance
      + ' 主手=' + (mainRes.mainBone ?? '(无)')
      + (mainRes.mirrorBone ? ' 镜像=' + mainRes.mirrorBone : ''));
  }

  // 挂载当前自机武器（主手 + 副手）；旧武器先清。初始姿态按当前区域。
  async function mountSelfWeapon(): Promise<void> {
    if (!scene || !charGroup) return;
    const sheathed = currentFieldState() === 1;
    // 摘除旧的副手（主手连同镜像份由 WeaponMount 自己摘）
    if (selfOffHandGroup) {
      removeFromAnywhere(charGroup, selfOffHandGroup);
      selfOffHandGroup = null;
    }

    // ---- 主手（含双手武器的镜像份）----
    const dorp = selfAppearance?.weaponDorp;
    let mainGroup: THREE.Group | null = null;
    if (dorp) {
      try {
        const wres = await loadWeaponModel(dorp);
        await loadTextures(wres.texturesToLoad);
        mainGroup = wres.group;
      } catch (e) {
        console.warn('[WorldView] 主手挂载失败 dorp=' + dorp, e);
      }
    }
    // 挂载与姿态判定**全部**在 WeaponMount 里（含刺客匕首克隆一份到另一侧）
    const res = selfWeaponMount.mount(charGroup, mainGroup,
      selfAppearance?.weaponIdcode ?? 0, selfAppearance?.weaponPos, sheathed ? 'sheathed' : 'combat');
    selfWeaponStance = sheathed ? 'sheathed' : 'combat';
    if (res.missingBone) {
      reportFallback('mount', `自机主手挂点缺失 dorp=${dorp} 目标骨=${res.missingBone}（已按回退链挂载）`);
    } else if (mainGroup) {
      console.log('[WorldView] 自机主手挂载: dorp=' + dorp + ' bone=' + res.mainBone
        + (res.mirrorBone ? ' 镜像=' + res.mirrorBone : ''));
    }

    // ---- 副手（盾 → 左臂；匕首 → 战斗左手/收鞘左腰；念珠不挂）----
    const offDorp = selfAppearance?.offHandDorp;
    const offKind = selfAppearance?.offHandKind || 0;
    if (offDorp && offKind !== 0) {
      try {
        const ores = await loadWeaponModel(offDorp);
        await loadTextures(ores.texturesToLoad);
        // 挂载骨规则**不在这里重写**：盾固定左小臂、匕首按 mirrorLeftBone（战斗左手 / 收鞘左腰），
        // 统一由 weapon-loader.offMountBoneOf 判定（自机 / 远端 / 检查器同一实现）。
        const boneName = offMountBoneOf(selfAppearance?.weaponIdcode ?? 0, offKind, sheathed ? 'sheathed' : 'combat');
        const bone = findBone(charGroup, boneName)
          || findBone(charGroup, WEAPON_BONES.LEFT_HAND)
          || findBone(charGroup, WEAPON_BONES.SHIELD);
        if (bone) {
          selfOffHandGroup = ores.group;
          bone.add(ores.group);
          console.log('[WorldView] 自机副手挂载: dorp=' + offDorp + ' kind=' + offKind + ' bone=' + bone.name);
        }
      } catch (e) {
        console.warn('[WorldView] 副手挂载失败 dorp=' + offDorp, e);
      }
    }

    // 模型已变：按当前状态重选动画实例（持剑/持弓站姿、换甲后的身体网格等随装备切换），
    // 一次性状态不打断。**判据在调用方**：`updateSelfAppearance` 已用
    // `appearanceModelKey` 过滤过"模型真的变了"，所以走到这里就是该重选。
    animState?.reselectForCurrentState();
  }

  /**
   * 攻击目标的世界坐标（投射物终点）。怪物优先，其次 NPC/远端玩家 —— 与"点选/追踪"用的是同一批 actor 表。
   * 找不到（目标已消失/还没进视野）返回 null ⇒ 调用方不发射（宁可不射，也不要射向 (0,0,0)）。
   */
  function attackTargetPos(targetId: number): THREE.Vector3 | null {
    const mon = monsters.get(targetId);
    if (mon) return mon.root.position.clone();
    const npc = npcs.get(targetId);
    if (npc) return npc.root.position.clone();
    const rem = remotes.get(targetId);
    if (rem) return rem.root.position.clone();
    return null;
  }

  /**
   * 放一支投射物（**自机与旁观者共用这一处判据**）：
   *   弓/弩 → 一支箭；标枪 → 标枪本身；法杖/图腾（且职业是法师/祭司/萨满）→ 法术弹（粒子）。
   *
   * 只做三件事：判"射什么"（`projectileChoiceOf`，唯一实现）→ 取起点/终点 → 交给投射物管理器。
   * 起点取**武器挂载组所在的那根骨** ⇒ 自机与旁观者用的是同一个"出手位置"（组挂在骨上，父节点即骨）；
   * 飞行时长取"释放 → 首个事件帧"的动画时长 ⇒ 箭正好在命中帧到达目标（见 render/projectile.ts 文件头）。
   *
   * @param eventFrame 首个事件帧（相对 startFrame 的子帧单位，见 `MotionInfo.eventFrame`）；无则按弹速兜底
   * @param rate 该次攻击的动画速率（事件帧时间 = 帧 ÷ (ANIM_UNITS_PER_SEC × rate)）
   * @param planOf 取"本次攻击的服务端计划"的函数（**miss 判定与命中音效同一份数据源**）。
   *   ⚠ 必须是**取值函数**而不是计划本身：自机的计划在起手之后才到（服务端回包），
   *   捕获当时的 `null` 会让 miss 判定永远拿不到 → 静默退化成"永远算命中"。
   */
  function spawnProjectile(
    mount: WeaponMount | null, root: THREE.Object3D, idcode: number, dorpItem: string | null | undefined,
    jobId: number | null | undefined,
    targetId: number, eventFrame: number | undefined, rate: number,
    planOf: () => Map<number, { missed: boolean; critical: boolean }> | null,
    /** 出手抬高（世界单位）—— 原版**逐怪不同**：玩家 34、SKELETONRANGE 28、DARKGUARD/REVIVED_ARCHER 38 */
    launchLift = 34,
  ): void {
    if (!projectileMgr || !scene) {
      console.log('[projectile] 跳过：管理器未就绪 mgr=' + !!projectileMgr + ' scene=' + !!scene);
      return;
    }
    const choice = projectileChoiceOf(idcode, dorpItem, jobId);
    if (!choice) {
      console.log('[projectile] 跳过：该武器不射 idcode=' + idcode + ' dorp=' + (dorpItem ?? '无')
        + ' job=' + (jobId ?? '无') + ' type=' + (getWeaponTypeFromIdCode(idcode) ?? '未知'));
      // "本该射却没有模型"（例如私服新增、OpenItem 里没有的标枪）要可见 —— 但每个 idcode 只报一次，
      // 免得每刀一条。近战武器走不到这里（`isRangedWeapon` 为假）。
      if (isRangedWeapon(idcode) && !reportedNoProjectileModel.has(idcode)) {
        reportedNoProjectileModel.add(idcode);
        reportFallback('projectile', `idcode=${idcode}（dorp=${dorpItem ?? '无'}）没有投射物模型 → 本次不显示飞行物`);
      }
      return;
    }
    // 落点 = **命中特效（白光 NormalHit1）打的那一点**（目标身体中部）——
    // 不是脚下的 root.position（用户实测"箭的目标位置与视觉不符"就是这个）
    const to = unitBodyAnchor(targetId) ?? attackTargetPos(targetId);
    if (!to) {
      console.log('[projectile] 跳过：目标 ' + targetId + ' 不在场内（拿不到落点）');
      return;
    }
    // ★ **出手点 = 纯几何量**（用户 2026-09-17 裁定，台账 §20.4）：
    //   原版射击系统给的是 `ShootingPosi = (pX, pY + 34 * fONE, pZ)`（`character.cpp:3752`）
    //   ⇒ 射手世界坐标 + **34 世界单位**竖直。**不再用骨骼定位**：骨骼名是模型相关的
    //   （换角色/换怪可能就是错的骨、甚至没有那根骨 —— 本项目已多次栽在"押资产命名"上）。
    //   附带收益：不再有"找不到出手骨就发不出来"的分支。
    const from = root.getWorldPosition(new THREE.Vector3());
    from.y += launchLift;
    // 沿武器伸出方向再偏移「半个武器长度」：原版 `GetAttackPoint`（exm `character.cpp:301`）
    // 取 `tz = ChrTool->SizeMax / 2` 沿武器偏移，`SizeMax` 从 mesh 量（`:1413-1424`）。
    // 方向取"出手点 → 武器组包围盒中心"（= 武器伸出方向）——**只用 mesh，不看骨骼名** ✓
    //（起点已改为几何量，见上；本偏移属原版 `GetAttackPoint` 的机制，与"骨骼定位"无关）
    {
      const wg = mount?.group;
      const sizeMax = wg ? weaponSizeMax(wg) : 0;
      if (wg && sizeMax > 0) {
        const dir = new THREE.Box3().setFromObject(wg).getCenter(new THREE.Vector3()).sub(from);
        if (dir.lengthSq() > 1e-6) from.addScaledVector(dir.normalize(), sizeMax / 2);
      }
    }
    // 飞行时长 = "放箭 → 事件帧"那段动画时间（于是到达时刻 = 事件帧）；取不到事件帧则按弹速兜底
    const flightTime = releaseFlightTime(eventFrame, rate);
    console.log('[projectile] 发射 kind=' + choice.kind + ' 从 脚上+34'
      + ' (' + from.x.toFixed(1) + ',' + from.y.toFixed(1) + ',' + from.z.toFixed(1) + ')'
      + ' → 目标 ' + targetId + ' (' + to.x.toFixed(1) + ',' + to.y.toFixed(1) + ',' + to.z.toFixed(1) + ')'
      + ' 飞行=' + (flightTime !== undefined ? flightTime.toFixed(3) + 's' : '按弹速')
      + ' 事件帧=' + (eventFrame ?? '无'));
    projectileMgr.spawn(choice, {
      from, to, flightTime,
      // 目标会走动 ⇒ 每帧取它此刻的锚点，箭才会落在"白光打中的地方"（时长不变，速度自适应）
      track: () => unitBodyAnchor(targetId),
      // miss 判定：与命中音效同源（第 0 段的计划）；计划还没到 → 返回 null（按命中处理，与音效的乐观分支一致）
      // 每帧/到点**现查**（计划可能是在起手之后才到的，见 `planOf` 的说明）
      missed: () => {
        const p = planOf()?.get(0);
        return p ? p.missed : null;
      },
    });
  }
  /** 已上报过"该射却没有模型"的 idcode（去重，见 `spawnProjectile`） */
  const reportedNoProjectileModel = new Set<number>();

  /** 从 root 整棵树里把 target 从其父摘除（target 可能挂任一骨骼下）。 */
  function removeFromAnywhere(root: THREE.Object3D, target: THREE.Object3D): void {
    if (root.children.includes(target)) {
      root.remove(target);
      return;
    }
    for (const c of root.children) removeFromAnywhere(c, target);
  }

  /** 动作列表 —— **与选角预览同一个构造器**（char/anim-player.buildMotionList） */
  function buildMotionList(): void {
    if (animSmb && bipInxInfo) motionList = buildMotionListShared(animSmb, bipInxInfo);
  }

  /** 技能**特效层的上下文**（粒子装配器 + 场景 + 音效）—— 与 `monster-attack-fx` 同理，
   *  粒子本身在 `multi-spark*.ts` 里，这里只提供"在哪、怎么出声"。 */
  function skillFxCtx(): SkillFxFireCtx {
    // 飞出物（Vigor Ball 那类）要"按名字起粒子 + 拿可停止句柄" ⇒ `spawnStoppable`（不是 `spawn`）。
    // 捕获成 const：闭包里读可能为 null 的外层变量会丢空值收窄（TS18047，本项目踩过多次）。
    const fx = effects;
    return {
      effects,
      scene: scene!,
      dynLights,
      playSound: (path, pos) => { sfx.play(path, { pos }); },
      log: (msg) => console.log('[skillfx]' + msg),
      // **技能等级**（唯一实现 `game/skillLevel.ts`，与技能面板读同一个值）——
      // 环的半径/元素数（Pike Wind）、火花颗数（Multi Spark）都随等级变；
      // 取不到时**不猜**（各条目自己决定是"不放并上报"还是"按 1 级并上报"）。
      skillLevel: selfSkillRow
        ? skillLevelByIcon(selfSkillRow.icon, getGameSnapshot().character?.level ?? null) : null,
      spawnAsset: fx ? (a, o) => fx.spawnStoppable(a, o) : undefined,
      // 一次性粒子用 `spawn`（不需要"停下"的句柄）—— 与怪物侧同一条路
      spawnPart: fx ? (a, o) => fx.spawn(a, o) : undefined,
      // **ASE 动画网格**（原版 `StartAni(...)` 那一族，如 Pike Wind 的环）—— 与起手法阵/怪物侧
      // 共用 `spawnAssaMesh`（**唯一实现**，AGENTS #15）
      fireMesh: (spec, at) => spawnAssaMesh(
        { scene: scene!, log: (m) => console.log('[fx]' + m) },
        { mesh: spec.path, pos: at, aniMaxCount: spec.aniMaxCount, aniDelayTime: spec.aniDelayTime,
          scale: spec.scale, rotY: spec.rotY, delaySec: spec.delaySec, upAxis: spec.upAxis,
          note: spec.note },
      ),
      // **攻击落点**（原版 `GetAttackPoint`）：技能起手就取一次（`getter` 见下）
      get weaponBase() { return selfAttackPoint(); },
    };
  }

  /**
   * **玩家的攻击落点** —— 原版 `smCHAR::GetAttackPoint`（`character.cpp:1795-1858`）。
   *
   * ```c
   * ChrTool = &HvRightHand;                       // 右手**工具骨**（不是 AttackObjBip）
   * tz = ChrTool->PatTool ? ChrTool->SizeMax / 2 : 0;   // ← 玩家有武器道具 ⇒ 半个武器长
   * AnimObjectTree(lpObj, frame, …);              // 当前帧
   * *nX = pX + (tz*_31 >> FLOATNS) + _41;  …      // 骨原点 + 工具轴 × tz
   * ```
   *
   * ⚠ **与怪物侧不能互相套**：怪物没有 `dwItemCode`（武器是模型自带的）⇒ `PatTool` 空 ⇒ `tz = 0`
   *   ⇒ 落点是**握持点**（`findAttackBone` 的注释记录了这一点）；玩家有武器道具 ⇒ 落点是
   *   **握持点 + 半个武器长度**（`weaponSizeMax/2`，本仓已有的"从挂点到顶端"的长度）。
   *
   * 骨轴 = 工具骨的**局部 Z**（原版 `_31/_32/_33` 那三个）—— 与自机曳光的 `dir` 是同一个轴
   * （Y-up 转换后落在我们的 +Y 上，见曳光那段的说明）。
   */
  function selfAttackPoint(): { x: number; y: number; z: number } | null {
    const g = selfWeaponMount.group;
    if (!g || !selfPlayer || !charGroup || !animState) return null;
    const bone = combatBoneOf(selfAppearance?.weaponPos);
    const smb = animState.getCurrentMotion()?.animSmb ?? undefined;
    const bf = selfPlayer.sampleBoneEnds(bone, selfPlayer.frame, smb);
    if (!bf) return null;                     // 骨不在（该武器没有这挂点）⇒ 调用方会**上报并不放**
    charGroup.updateWorldMatrix(true, false); // 渲染前手动刷（同曳光：不刷会读到上一帧/单位阵）
    const rm = charGroup.matrixWorld;
    const a = new THREE.Vector3(bf.ox, bf.oy, bf.oz);
    const dir = new THREE.Vector3(bf.ayx, bf.ayy, bf.ayz);
    a.applyMatrix4(rm);
    dir.transformDirection(rm);
    const p = a.addScaledVector(dir, weaponSizeMax(g) / 2);
    return { x: p.x, y: p.y, z: p.z };
  }

  /** 起手（技能动画开始）：记下这一行 + 播起手音（原版 `SkillPlaySound`，在 `BeginSkill` 那一刻） */
  function beginSelfSkill(iconFile: string, aim: THREE.Object3D | null = null): void {
    selfSkillEventFired = 0;
    selfSkillAim = aim;
    selfSkillRow = skillFxRowByIcon(iconFile);
    if (!selfSkillRow) return;      // 表里没有 → 无起手音/无特效（不静默：上面已打过日志）
    fireSkillCast(selfSkillRow, skillFxCtx(), selfPos);
  }

  /**
   * **诊断入口：直接放某个玩家技能**（临时 —— 与 `window.__ptMonsterSkill` 一对）。
   *
   * 走的是**与真实施法同一条路**（`beginSelfSkill` + 播那条技能动作），只绕开
   * "服务端是否允许 / 角色是否学过这一招"：
   *
   * ```js
   * window.__ptSelfSkill(131)            // 动画条目 #131（祭司 Vigor Ball）
   * window.__ptSelfSkill('mp40 v_ball')  // 也可以给图标名（`skill-fx.json` 的 icon，可省 .bmp）
   * ```
   *
   * 条目号 / 图标名都在 `src/game/data/skill-fx.json` 里（`animIndex` / `icon`）。
   */
  (window as unknown as { __ptSelfSkill?: (k: number | string) => void }).__ptSelfSkill = (key) => {
    if (!animState) { console.log('[skill] 世界未就绪（还没有动作状态机）'); return; }
    const row = typeof key === 'number' ? skillFxRowByAnimIndex(key) : skillFxRowByIcon(String(key));
    if (!row) { console.log(`[skill] 技能表里没有 animIndex/icon = ${String(key)}`); return; }
    if (row.animIndex == null) { console.log(`[skill] 「${row.name}」没有动画条目 ⇒ 放不了`); return; }
    const m = motionList.find((x) => x.index === row.animIndex) ?? null;
    if (!m) { console.log(`[skill] 角色动作表里没有条目 #${row.animIndex}（该模型的动画表里没有这一条？）`); return; }
    console.log(`[skill] 直接放技能「${row.name}」（条目 #${row.animIndex}，图标 ${row.icon}）`);
    beginSelfSkill(row.icon);
    // 直接播这一条（`selfPlayer` 是**播放器**，不持动作表；动作表与状态机在 `motionList` / `animState`）
    animState.playMotion(m);
  };

  /**
   * 播放技能动画（调试/装备触发）。
   * @param iconFile skillData iconFile（含 .bmp）；'skill_normal'=普攻动画
   * @returns 是否找到并播放
   */
  function playSkillByIcon(iconFile: string, aim: THREE.Object3D | null = null): boolean {
    if (!animState) return false;
    // **施法前**的"必须有目标"门（用户 2026-09-18 定）：**向无目标施法要拦住**（不是放出去再乱飞）。
    // ⚠ **这是客户端预校验，不是权威判定** —— 权威判定属服务端技能系统（"能不能施法"与攻击命中同源，
    //   见 `CombatService.handleUseSkill`；服务端目前没有技能系统，只在做粒子特效）。
    //   预校验的用途只是"别无谓地白播动画"；技能系统上来后由服务端说了算，这里最多留作提前提示。
    // 出手之后则相反：那颗弹按"发射时快照"继续飞（目标死了飞向它最后的位置，见 `aimFallback`）。
    // ⚠ 判据目前只覆盖**跟踪弹出物**（`code === 'vigorball'`）—— 技能表还没有"是否需目标"这一列，
    //   等它补出来再统一（先只拦会出问题的那一类，不猜别的技能）。
    {
      const norm0 = iconFile.replace(/\.bmp$/i, '');
      const row0 = skillFxRowByIcon(norm0 + '.bmp');
      const needsTarget = row0?.code === 'vigorball';
      if (needsTarget && !aim && !selfAttackTargetId) {
        console.log(`[WorldView][dbg] 「${row0?.name ?? iconFile}」需要目标 ⇒ 未施法（没有选中任何目标）`);
        return false;
      }
    }
    const norm = iconFile.replace(/\.bmp$/i, '');
    if (norm === 'skill_normal') {
      selfTrailSkillIndex = null;   // T1：普攻 → 不染色
      const ok = animState.triggerAttack(true);
      console.log('[WorldView][dbg] 普攻动画 → ' + (ok ? 'OK' : '无匹配'));
      return ok;
    }
    const idx = skillIndexByIcon(norm + '.bmp');
    if (idx != null) {
      // T1：这一击按技能染色（含下面的普攻回退分支 —— Critical Hit 正走这条）。设值只此一处（AGENTS #15）。
      selfTrailSkillIndex = idx;
      // 指定技能：有专属 SKILL 动画则播专属；无则回退普攻（多数技能动作即普攻）
      const ok = animState.triggerSkill(idx);
      if (ok) {
        console.log('[WorldView][dbg] 技能动画 #' + idx + ' ' + iconFile);
        beginSelfSkill(iconFile, aim);
        return true;
      }
      const fallback = animState.triggerAttack(true);
      console.log('[WorldView][dbg] 技能无专属动画→普攻回退 ' + iconFile + ': ' + (fallback ? 'OK' : '无'));
      return fallback;
    }
    // T1：无下标（不是已登记技能）→ 不染色。无 saSkillData 条目（T5 等）：直接任意 SKILL 或普攻
    selfTrailSkillIndex = null;
    const ok = animState.triggerSkill(null);
    if (ok) { console.log('[WorldView][dbg] 任意SKILL动画 ' + iconFile); beginSelfSkill(iconFile, aim); return true; }
    const fallback = animState.triggerAttack(true);
    console.log('[WorldView][dbg] 技能任意SKILL→普攻回退 ' + iconFile + ': ' + (fallback ? 'OK' : '无'));
    return fallback;
  }

  /** 播放当前装备在指定拳的技能动画（左/右拳）。未装备/普通攻击 → 播普攻。 */
  function playEquippedSkill(slot: 'left' | 'right', aim: THREE.Object3D | null = null): boolean {
    const snap = getGameSnapshot();
    const bind = snap.fistBindings[slot];
    const selfClass = CLASS_DIR[selfJobId] ?? 'fighter';
    if (!bind || bind.classDir !== selfClass) {
      return playSkillByIcon('skill_normal', aim);
    }
    const skillIdx = skillIndexByIcon(bind.iconFile + '.bmp');
    // 施放真走服务端（真实链路，#14 结果同步）：有瞄准的怪 + 已登记技能 → 发 C2S_UseSkill。
    // 到目前只有调试施法（Alt/Shift+点击瞄准怪）会带 aim，故实际只影响调试通路；
    // 服务端 handleUseSkill 即时结算该技能（含 44 的 attackEffect）→ S2C_AttackResult 命中外观。
    if (skillIdx != null && aim) {
      const aimId = [...monsters.entries()].find(([, m]) => m.root === aim)?.[0];
      if (aimId != null) opts?.onCastSkill?.(skillIdx, aimId);
    }
    return playSkillByIcon(bind.iconFile + '.bmp', aim);
  }

  // 相机跟随角色（/pt/maps/ updateDummy 同款，Winmain.cpp 卫星相机）
  function updateCamera(dt = 0): void {
    if (!camera) return;
    // 键盘控制相机（复刻 /pt/maps/ updateDummy：Winmain.cpp:2494-2542，角度改弧度）
    const TAU = Math.PI * 2;
    // 视角朝向：固定模式下由角色朝向决定，所以左右方向键只在手动/自动下生效
    if (camMode !== 2) {
      if (keys['ArrowLeft'])  cam.any = (cam.any + CAM_ROT_STEP) % TAU;
      if (keys['ArrowRight']) cam.any = (cam.any - CAM_ROT_STEP + TAU) % TAU;
    }
    if (keys['ArrowUp'])    cam.dist = Math.max(CAM_DIST_MIN, cam.dist - 8);
    if (keys['ArrowDown'])  cam.dist = Math.min(CAM_DIST_MAX, cam.dist + 8);
    if (keys['ControlLeft'] || keys['ControlRight']) {
      if (keys['ArrowUp'])   cam.anx = Math.min(CAM_ANX_MAX, cam.anx + CAM_ROT_STEP * 0.5);
      if (keys['ArrowDown']) cam.anx = Math.max(CAM_ANX_MIN, cam.anx - CAM_ROT_STEP * 0.5);
    }
    if (keys['PageUp'])   cam.anx = Math.min(CAM_ANX_MAX, cam.anx + CAM_ROT_STEP);
    if (keys['PageDown']) cam.anx = Math.max(CAM_ANX_MIN, cam.anx - CAM_ROT_STEP);
    // 相机键也是"手动操作" → 关掉自动回正（原版 Main.cpp:1297-1329 同样置 FALSE）
    const camKeysHeld = !!(keys['ArrowLeft'] || keys['ArrowRight'] || keys['ArrowUp'] || keys['ArrowDown']
      || keys['PageUp'] || keys['PageDown']);
    if (camKeysHeld) setAutoRecenter(false);

    // —— 相机模式（原版小按钮 Z，见文件上方 camMode 注释）——
    // 边缘旋转：原版条件是 `CameraAutoFlag != 2`，即**手动/自动都有、只有固定没有**；
    // 但每次贴边旋转都会把 AutoCameraFlag 置 FALSE（关掉自动回正）——所以两者不会互相打架，
    // 这才是"点画面两侧不乱转"的正确做法（我先前只在自己模式里开边缘，是错的方向）。
    let edgeYaw = 0;
    if (camMode !== 2 && mouseSeen && !typingActive()) {
      const cw = root.clientWidth || 1;
      if (mouseX <= CAM_EDGE_PX) edgeYaw = CAM_EDGE_RATE * dt;
      else if (mouseX >= cw - CAM_EDGE_PX) edgeYaw = -CAM_EDGE_RATE * dt;
      if (edgeYaw !== 0) setAutoRecenter(false);   // 原版：贴边即 AutoCameraFlag = FALSE
      // 注意：光标回到内侧**不**自动重新打开（原版那分支只复位 dsCameraRotation）；
      // 重新打开靠"点空地走路"（见 onGroundTap）——所以手动调过、鼠标又停在边缘时，
      // 跑起来镜头也不再回正，这正是用户观察到的"跑着跑着摄像机就不再变了"。
    }
    if (edgeYaw !== 0) cam.any = (cam.any + edgeYaw + TAU * 2) % TAU;
    // 固定(2)：**每帧把距离与俯仰按死**（原版 PlayD3D 就是这么写的），朝向已在切模式时重置为 45°；
    // 手动挡不了它，因为下一帧就被覆盖 —— 这正是"固定"的意义。
    if (camMode === 2) {
      cam.dist = CAM_FIXED_DIST;
      cam.anx = CAM_FIXED_ANX;
      cam.viewDist = cam.dist;
      cam.viewAnx = cam.anx;
    }

    // 自动(1)：移动中 + **自动回正开着**（没被手动操作打断）时，按"死区 + 外守卫 + 比例步长"
    // 把镜头稳到角色背后（见上方常量注释）。手动调过之后就不再回正 —— 这就是"跑着跑着镜头就不变了"。
    if (camMode === 1 && autoRecenter && wasMoving) {
      const d = wrapPi(selfAngle - cam.any);
      const ad = Math.abs(d);
      if (ad < CAM_AUTO_MAX_DEV && ad > CAM_AUTO_DEAD_ZONE) {
        const step = Math.min(ad, Math.max(ad * CAM_AUTO_GAIN, CAM_AUTO_STEP_MIN) * dt);
        cam.any = (cam.any + Math.sign(d) * step + TAU2 * 2) % TAU2;
      }
    }

    // 视角平滑：指数趋近（帧率无关）。原先是 `±8/帧` 的固定步长，而角度范围只有 ~1.4 弧度
    // → 俯仰实际是"一帧跳到目标"，滚轮微调非常卡（用户 2026-09-12 实测）。
    const kSmooth = 1 - Math.exp(-dt / CAM_SMOOTH_TAU);
    cam.viewAnx += (cam.anx - cam.viewAnx) * kSmooth;
    cam.viewDist += (cam.dist - cam.viewDist) * kSmooth;
    if (Math.abs(cam.anx - cam.viewAnx) < 0.001) cam.viewAnx = cam.anx;
    if (Math.abs(cam.dist - cam.viewDist) < 0.01) cam.viewDist = cam.dist;

    // 手动操作"做完"就把自动回正打开（对应原版：滚轮平滑到位 whAnx 归零 → AutoCameraFlag = TRUE）
    if (!camKeysHeld && edgeYaw === 0
        && Math.abs(cam.anx - cam.viewAnx) < 0.002 && Math.abs(cam.dist - cam.viewDist) < 0.05) {
      setAutoRecenter(true);
    }

    // 距离/角度/**模式/自动回正**被改了就落盘（节流 500ms：方向键连按、贴边旋转、
    // 跑动中的自动回正都会逐帧改动，不能逐帧写 localStorage）
    if (cam.dist !== camSaved.dist || cam.anx !== camSaved.anx || cam.any !== camSaved.any
        || camMode !== camSaved.mode || autoRecenter !== camSaved.autoRecenter) {
      camDirty = true;
    }
    if (camDirty && rafMs - camSavedAt > 500) {
      const next = { dist: cam.dist, anx: cam.anx, any: cam.any, mode: camMode, autoRecenter };
      saveCameraPrefs(next);
      camSaved = next;
      camDirty = false;
      camSavedAt = rafMs;
    }

    const pitchRad = cam.viewAnx;
    const yawRad = cam.any;
    // 屏幕震动：原版 `ViewDist += WaveCameraFactor`（`Main.cpp:1742`）——**只在那帧叠加、值留到后续帧**，
    // 再由相机自己的平滑（上面那句 `viewDist += (dist - viewDist)*k`）把它拉回基准
    // ⇒ 观感是"震一下、然后缓缓归位"，**不是**每帧弹回去（用户 2026-09-18 指出）。
    // ⚠ 必须叠进 `cam.viewDist` 本体（叠到临时变量上 = 每帧归零 = 抽帧式的"被拉回去"）。
    cam.viewDist += updateWaveCamera();
    const d = cam.viewDist;
    camera.position.set(
      selfPos.x - d * Math.sin(yawRad) * Math.cos(pitchRad),
      selfPos.y + d * Math.sin(pitchRad),
      selfPos.z - d * Math.cos(yawRad) * Math.cos(pitchRad),
    );
    camera.lookAt(selfPos.x, selfPos.y + 20, selfPos.z);
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  }

  // ===== 移动（复刻 /pt/maps/ updateDummy 鼠标移动：Winmain.cpp 左键朝鼠标方向走）=====
  // 加载地图（含碰撞网格）到 mapHandles/collisionMeshes，已加载则跳过
  /**
   * 加载一张地图并登记（几何构建走**分帧**，见 `MapRenderer.buildAsync`）。
   * @param shouldCancel 构建期间返回 true → 放弃这次加载（玩家已经跑远/该图不再需要）。
   *   分帧构建会持续若干帧，期间玩家可能又跑到别处去了 —— 没有取消就会白建一张图，
   *   而且它会带着 `dispose()` 掉的几何留在场景里。
   */
  async function loadMapById(mapId: number, shouldCancel?: () => boolean): Promise<boolean> {
    if (!scene || mapHandles.has(mapId)) return false;
    const smdPath = mapSmdPath(mapId);
    if (!smdPath) return false;
    const t0 = performance.now();
    const mh = await loadMap(scene, smdPath, shouldCancel);
    if (!mh) {
      console.log('[WorldView] 地图' + mapId + ' 构建被取消（已不需要），耗时 '
        + (performance.now() - t0).toFixed(0) + 'ms');
      return false;   // 不入场景、不登记
    }
    mapHandles.set(mapId, mh);
    // 新地图的昼夜光照由 renderLoop 每帧 dnUpdate 统一写入（updateDayNight），无需在此处理
    const cm = new CollisionMesh();
    cm.buildFromSMD(mh.data);
    collisionMeshes.set(mapId, cm);
    // 装饰模型（纯色渲染，材质逆向为后续工作）
    const decors = mapDecorList(mapId);
    if (decors.length > 0) {
      const gs = await loadMapDecor(scene, mapId, decors, 0x88aa44);
      decorGroups.set(mapId, gs);
    }
    console.log('[WorldView] 地图' + mapId + ' 加载: 材质=' + mh.mapRenderer.materials.length +
      ' tris=' + mh.mapRenderer.totalFaceCount + ' 碰撞面=' + cm.triangles.length
      + ' 构建=' + mh.mapRenderer.buildTimeMs.toFixed(0) + 'ms 合计=' + (performance.now() - t0).toFixed(0) + 'ms');
    return true;
  }

  /** 该节点是不是某只怪（按 `monsters` 的 root 身份判定 —— 比拿高亮颜色当类型判据稳） */
  function isMonsterRoot(root: THREE.Object3D): boolean {
    for (const m of monsters.values()) if (m.root === root) return true;
    return false;
  }

  function onMouseDown(e: MouseEvent): void {
    if (isInputBlocked()) return;   // 加载页/遮罩期间不接收世界点击（不把正确性押在 DOM 叠放上）
    // [调试] Alt/Shift+点击 → 原地播放左/右拳装备的技能动画（不移动、不选目标）
    if (SKILL_DEBUG && (e.altKey || e.shiftKey) && e.button === 0) {
      const slot = e.altKey ? 'left' : 'right';
      e.preventDefault();
      // 瞄准 = **已有的 hover 目标**（你看到高亮的那只怪）—— 不自己再挑一次判据，
      // 也不依赖 `selfAttackTargetId`（那是自动攻击循环在射程内才赋的值，见其声明处说明）。
      const aim = hoverTarget && isMonsterRoot(hoverTarget.root) ? hoverTarget.root : null;
      // 诊断（用户要求）：把 hover 目标与解析结果都打出来 —— 一次定位，免得来回猜
      const ht = hoverTarget?.root;
      const aimId = aim ? [...monsters.entries()].find(([, m]) => m.root === aim)?.[0] : null;
      console.log('[WorldView][dbg] 施法瞄准：hoverTarget='
        + (ht ? `${ht.name || '(无名)'}@(${ht.position.x.toFixed(1)},${ht.position.y.toFixed(1)},${ht.position.z.toFixed(1)})` : 'null')
        + ` isMonster=${ht ? isMonsterRoot(ht) : false}`
        + ` ⇒ aim=${aim ? `monster#${aimId}` : 'null'}`
        + ` selfPos=(${selfPos.x.toFixed(1)},${selfPos.y.toFixed(1)},${selfPos.z.toFixed(1)})`);
      if (!aim) console.log('[WorldView][dbg] Shift/Alt+点击：光标下没有怪 ⇒ 无目标施放（原版此情形不施放）');
      playEquippedSkill(slot, aim);
      return;
    }
    if (e.button === 0) {
      // 指向可交互目标（掉落物/怪物/玩家/NPC）：整次按压都视为"点击目标"，禁用按住跑，
      // 抬起时做拾取/选目标（原版点目标 vs 按住空地跑 的分界）
      // 名牌也算"点在目标上"（否则按在名牌上会被当成"按住空地朝光标跑"）。
      // 判定用与原版同一套屏幕矩形（pickTargetAt），名牌矩形优先。
      const overTarget = nameplateTargetAt(e.clientX, e.clientY) !== null
        || pickTargetAt(e.clientX, e.clientY) !== null;
      mouseX = e.clientX; mouseY = e.clientY;
      tapDownX = e.clientX; tapDownY = e.clientY; tapDownT = performance.now();
      // 玩家按下（移动/点击）→ 取消进行中的自动追踪目标
      moveTarget = null;
      moveStuckStart = 0;
      if (overTarget) {
        targetPressActive = true;
        mouseDown = false; // 不启动"按住朝光标跑"
        console.log('[WorldView] 指向目标按下 → 点击将拾取/选目标');
      } else {
        targetPressActive = false;
        mouseDown = true;
      }
      // 拾取光标按下态（GetItem2）即时刷新
      if (getCursorMode() === 'pickup') setCursorMode('pickup', mouseDown);
    }
  }
  function onMouseUp(e: MouseEvent): void {
    if (e.button === 0) {
      const wasTargetPress = targetPressActive;
      targetPressActive = false;
      mouseDown = false;
      if (wasTargetPress) {
        // 按在目标上抬起 → 无条件执行点击目标逻辑（不依赖 400ms/位移阈值）
        onGroundTap(e.clientX, e.clientY);
      } else {
        // 按在空地：轻点(允许轻微位移)则取消目标/点地意图；长按移动已由 mouseDown 驱动
        const dt = performance.now() - tapDownT;
        const moved = Math.hypot(e.clientX - tapDownX, e.clientY - tapDownY);
        if (dt < 400 && moved < 12) {
          onGroundTap(e.clientX, e.clientY);
        }
      }
      // 拾取光标抬起态刷新（GetItem2 → GetItem1）
      if (getCursorMode() === 'pickup') setCursorMode('pickup', mouseDown);
      // 停止上报由 renderLoop 检测 wasMoving→false 时带当前位置发送，保证位置是真正停点
    }
  }

  /**
   * 鼠标落在哪块名牌上 —— 返回它对应的目标（id + 类型）。
   * 与悬停检测共用 `nameplateHits`（同一份矩形表），所以"看得到高亮的"就"点得中"：
   * 用户 2026-09-13 实测指出，名牌只接了悬停、点击仍走射线 → 点名牌选不中目标。
   * 类型靠记录时带的 `cursor` 反推（pickup=掉落物 / attack=怪物 / talk=NPC / 其余=远端玩家），id 由 root 反查。
   */
  function nameplateTargetAt(cx: number, cy: number): { kind: 'item' | 'monster' | 'player' | 'npc'; id: number } | null {
    const hit = nameplateHits.find((b) => cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h);
    if (!hit) return null;
    if (hit.cursor === 'pickup') {
      for (const [id, g] of groundItems) if (g.root === hit.root) return { kind: 'item', id };
    } else if (hit.cursor === 'attack') {
      for (const [id, m] of monsters) if (m.root === hit.root) return { kind: 'monster', id };
    } else if (hit.cursor === 'talk') {
      for (const [id, n] of npcs) if (n.root === hit.root) return { kind: 'npc', id };
    } else {
      for (const [id, r] of remotes) if (r.root === hit.root) return { kind: 'player', id };
    }
    return null;
  }

  /** 点击交互（对齐原版目标式操作，无"点地板行走"）：
   *  点怪物 / 点玩家 / 点 NPC → Chase(引用) 实时跟随目标当前位置（目标跑我也实时转向）；
   *  点掉落物 → 够近即时拾取，否则 Chase(引用) 追过去到位自动拾取该目标；
   *  点空地 → 取消当前 Chase 目标（不移动）。
   *
   *  目标从哪来：**名牌矩形优先，其次 `pickTargetAt`（原版屏幕矩形判定）**。
   *  ⚠ 这里曾有一条"近身拾取兜底"（脚下 2m 内有掉落物就算点击意图），它抢在实体之前吞掉点击
   *  （用户 2026-09-14 实测：点怪连报 `近身拾取(兜底) gid=28`，服务端回"金钱超过最大允许数量"）。
   *  已**删除**（本项目不要任何 fallback，见 AGENTS #12/#35）—— 判定一律走原版那套屏幕矩形。 */
  function onGroundTap(cx: number, cy: number): void {
    if (!renderer || !camera || !scene) return;
    // 左键语义对自动回正的影响（原版 Main.cpp:1988-2005）：
    //   点目标/物品（选目标、开打）→ `AutoCameraFlag = FALSE`（不打镜头）
    //   点空地（走路）→ `AutoCameraFlag = TRUE`（跑起来镜头回正）
    // 这里在每条"选中目标"的分支里置 false，落到最后的空地分支再置 true。
    // 名牌命中（overlay 是 DOM 最上层，鼠标能看见就能点中）优先于 3D 判定。
    const tag = nameplateTargetAt(cx, cy) ?? pickTargetAt(cx, cy);
    if (tag) {
      setAutoRecenter(false);
      switch (tag.kind) {
        case 'monster':
          moveTarget = { kind: 'monster', id: tag.id };
          console.log('[WorldView] 选中怪物 mid=' + tag.id + ' → Chase(实时跟随)');
          return;
        case 'player':
          moveTarget = { kind: 'player', id: tag.id };
          console.log('[WorldView] 选中玩家 playerId=' + tag.id + ' → Chase(实时跟随)');
          return;
        case 'npc':
          moveTarget = { kind: 'npc', id: tag.id };
          console.log('[WorldView] 选中 NPC entityId=' + tag.id + ' → Chase');
          return;
        case 'item': {
          const g = groundItems.get(tag.id);
          if (g) {
            const d = Math.hypot(g.root.position.x - selfPos.x, g.root.position.z - selfPos.z);
            if (d <= PICK_ACT_RANGE) {
              console.log('[WorldView] 点击拾取 gid=' + tag.id + ' dist=' + d.toFixed(2) + 'm');
              opts?.onPickupGroundItem?.(tag.id);
            } else {
              moveTarget = { kind: 'item', id: tag.id };
              console.log('[WorldView] 选中掉落物 gid=' + tag.id + ' dist=' + d.toFixed(1) + 'm → Chase');
            }
          }
          return;
        }
      }
    }
    // 空地 → 仅取消当前 Chase 目标（原版点地不产生走点移动，只有按住跑）
    setAutoRecenter(true);   // 原版：点空地 = 走路意图 → 自动回正打开
    if (moveTarget) {
      console.log('[WorldView] 取消 Chase 目标');
      moveTarget = null;
      moveStuckStart = 0;
    }
  }

  /**
   * 取消当前目标（ESC，用户 2026-09-14）—— 与"点空地取消"同一出口，但**不产生移动意图**。
   *
   * 为什么需要它：点了怪就进入攻击/追击循环，除了点别处（会带出移动意图）没法脱身。
   * 攻击循环的驱动条件就是 `moveTarget?.kind === 'monster'`（见主循环 `monsterEngaged`），
   * 所以清掉 `moveTarget` 即可停下追击与后续挥拳；**正在播的那一击让它打完**（原版也没有打断技）。
   *
   * ⚠ 不要在这里清 `selfAttackTargetId` —— 那个值在**命中帧**才被用来上报 `onAttackHit(targetId)`，
   * 提前清掉会让"已经挥出去的那一拳"打空（事件帧上报时目标已变成 0）。
   */
  function cancelTarget(): void {
    if (!moveTarget) return;
    console.log('[WorldView] ESC 取消目标 kind=' + moveTarget.kind
      + (moveTarget.kind === 'ground' ? '' : ' id=' + moveTarget.id));
    moveTarget = null;
    moveStuckStart = 0;
  }

  /**
   * 把目标的"世界空间中点 + 世界空间尺寸"投成**屏幕矩形**，返回 {x,y} 与相机空间深度。
   *
   * 等价原版 `smRENDER3D::GetRect2D`（`smRend3d.cpp:270`）：
   *   `p[i].x = MidX + (p[i].x * viewdistZ) / kz`（kz = 相机空间深度，kz <= 0 即相机背后 → 返回 NULL）。
   * 原版的 `width/height` 是**世界单位**（调用点写 `32 * fONE`），所以矩形随距离自动缩放
   * —— 近处大、远处小。这里用"投影中点 + 投影世界尺寸半量"得到同一效果，
   * 并把返回的 `z` 当原版的 `sez`（选中取最近 = 最小）。
   */
  const _pickCenter = new THREE.Vector3();
  const _pickView = new THREE.Vector3();
  function screenRectOf(
    wx: number, wy: number, wz: number, worldSize: number,
  ): { x: number; y: number; z: number; half: number } | null {
    if (!camera) return null;
    const W = npOverlay?.clientWidth ?? 0;
    const H = npOverlay?.clientHeight ?? 0;
    if (W <= 0 || H <= 0) return null;
    _pickView.set(wx, wy, wz).applyMatrix4(camera.matrixWorldInverse);
    const kz = -_pickView.z;                     // 相机空间深度（原版 GetRect2D 的 cz）
    if (kz <= 0) return null;                    // 相机背后 → 原版返回 NULL
    _pickCenter.set(wx, wy, wz).project(camera);
    const x = (_pickCenter.x * 0.5 + 0.5) * W;
    const y = (1 - (_pickCenter.y * 0.5 + 0.5)) * H;
    // 世界尺寸 → 屏幕像素：焦长 f = H / (2·tan(fovY/2))（three 的投影矩阵元素 [5] = 1/tan(fovY/2)）
    const half = (worldSize * 0.5) * (H * 0.5 * camera.projectionMatrix.elements[5]) / kz;
    return { x, y, z: kz, half };
  }

  /** 屏幕矩形是否含该点（原版：`Rect.left < pCursorPos.x < Rect.right` 且 top/bottom 同理） */
  function inPickRect(cx: number, cy: number, r: { x: number; y: number; half: number }): boolean {
    return cx >= r.x - r.half && cx <= r.x + r.half && cy >= r.y - r.half && cy <= r.y + r.half;
  }

  /** 点击/悬停的判定目标（对齐原版"一帧内遍历全部目标取鼠标下最近者"） */
  type PickTag = { kind: 'item' | 'monster' | 'player' | 'npc'; id: number; root: THREE.Object3D };

  /**
   * 当前指标位置下的交互目标 —— **按原版做屏幕矩形判定**。
   *
   * 权威依据：原版 `playmain.cpp:2900-2990` 每帧遍历全部角色/掉落物，用 `GetRect2D` 取
   * 屏幕矩形 + `sez`（相机空间深度），凡"矩形包含鼠标点"者取 **sez 最小（最近）** 的一个当目标；
   * 命中后再由 `ActionGame.cpp:164` 的 `agFindAttack()` / `agFindItem()` 决定打怪还是拾取。
   * **同一个结果同时驱动悬停光标/轮廓与点击**（原版也是同一个 `lpSelChar`/`lpSelItem`）——
   * 两边各判一套会让"光标说能拾取、点下去却选了怪"。
   *  - 不做遮挡剔除（原版也没有）：只要在屏幕上、矩形含鼠标点，就能选中；
   *  - 类别优先级沿用游戏规则：**实体优先，掉落物最后**（原版 agFindAttack 失败才 agFindItem），
   *    同类别内取最近。
   */
  function pickTargetAt(cx: number, cy: number): PickTag | null {
    if (!camera || !scene) return null;
    const S = WORLD_PICK_SIZE;

    /** 该类别里"鼠标下最近"的一个（命中判定与选优都在这里，无则 null） */
    const nearestIn = (
      list: [PickTag, number, number, number][], size: number,
    ): PickTag | null => {
      let hit: PickTag | null = null;
      let hitZ = 0;
      for (const [tag, wx, wy, wz] of list) {
        const r = screenRectOf(wx, wy, wz, size);
        if (!r || !inPickRect(cx, cy, r)) continue;
        if (hit === null || r.z < hitZ) { hit = tag; hitZ = r.z; }
      }
      return hit;
    };

    // ① 怪物（对齐原版遍历角色取最近）。尸体不参与 —— 原版的目标过滤就是
    //    `Life[0] > 0`（`playsub.cpp` / `playmain.cpp` 的 CancelAttack 判定），
    //    否则会出现"点中尸体当攻击目标、怪死了还在原地挥拳"。
    const monsterList: [PickTag, number, number, number][] = [];
    for (const [id, m] of monsters) {
      if (m.culled || !m.root.visible || m.dead) continue;
      const p = m.root.position;
      monsterList.push([{ kind: 'monster', id, root: m.root }, p.x, p.y + S.monster * 0.5, p.z]);
    }
    const mob = nearestIn(monsterList, S.monster);
    if (mob) return mob;

    // ② 远端玩家
    const playerList: [PickTag, number, number, number][] = [];
    for (const [id, r] of remotes) {
      if (!r.root.visible) continue;
      const p = r.root.position;
      playerList.push([{ kind: 'player', id, root: r.root }, p.x, p.y + S.player * 0.5, p.z]);
    }
    const other = nearestIn(playerList, S.player);
    if (other) return other;

    // ③ NPC
    const npcList: [PickTag, number, number, number][] = [];
    for (const [id, n] of npcs) {
      if (!n.root.visible) continue;
      const p = n.root.position;
      npcList.push([{ kind: 'npc', id, root: n.root }, p.x, p.y + S.npc * 0.5, p.z]);
    }
    const npc = nearestIn(npcList, S.npc);
    if (npc) return npc;

    // ④ 掉落物放最末：原版锚点是"物品位置抬高 16 单位"，矩形 32×32
    const itemList: [PickTag, number, number, number][] = [];
    for (const [id, g] of groundItems) {
      if (!g.root.visible) continue;
      const p = g.root.position;
      itemList.push([{ kind: 'item', id, root: g.root }, p.x, p.y + ITEM_PICK_ANCHOR_UP, p.z]);
    }
    return nearestIn(itemList, S.item);
  }

  function onMouseMove(e: MouseEvent): void {
    if (isInputBlocked()) return;   // 同上：加载中移动鼠标不改朝向/不换光标
    mouseX = e.clientX; mouseY = e.clientY;
    mouseSeen = true;
    probeCursorAt(e.clientX, e.clientY);
  }

  function onMouseLeave(): void {
    mouseSeen = false;
    hoverTarget = null;
    // 离开 canvas（通常就是滑到了 UI 面板上）：UI 也用原版光标，所以恢复 default 而不是系统 auto
    initCursor();
  }

  // 判断角色所属地图（对齐服务端 MapRegionService.findMapPrecise）：
  // 先 AABB 粗筛；多命中或无命中（桥口在图 AABB 外）用已加载图碰撞网格高度判定
  // （对齐原版：遍历 stage 用 GetFloorHeight，谁有地面就在哪）。
  /**
   * 坐标 → 所属地图。**口径与服务端 `MapRegionService.findMapPrecise` 对齐**：
   * ① AABB 唯一命中 → 采纳；② 多命中（图 AABB 重叠的交界）→ 用脚下有没有站立面精判；
   * ③ 无 AABB 命中 → 桥口情形（图 AABB 外但网格有面）由"已加载图"兜底；④ 都判不出 → 保持当前图。
   *
   * ⚠ 旧实现把 ③ 提到了最前面（"优先在已加载图里找实际落地"）—— 后果是**跨图边界时旧图的
   * 地面一直兜着脚，判定永远返回旧图**：`currentMapId` 不更新 → 不触发区域同步 → 新图永远
   * 不加载 → 玩家看到前方一片空白。用户实测：从内维斯克往东跑，古代战场一直刷不出来，
   * 重进游戏（走服务端给的 mapId）才出现。
   */
  function findCurrentMap(wx: number, wz: number): number {
    const fx = wx * 256, fz = wz * 256; // world → collision (z already matches world convention)
    const hits: number[] = [];
    for (const [mapId, [xMin, xMax, zMin, zMax]] of allBounds) {
      if (wx >= xMin && wx <= xMax && wz >= zMin && wz <= zMax) hits.push(mapId);
    }
    // ① 唯一命中：直接采纳
    if (hits.length === 1) return hits[0];
    // ② 多命中：用脚下有没有面精判（同服务端"多命中 → GetHeight"）；仍分不出 → 保持当前图防抖
    if (hits.length > 1) {
      for (const id of hits) {
        const cm = collisionMeshes.get(id);
        if (cm && cm.getPolyHeight(fx, fz).found) return id;
      }
      return hits.includes(currentMapId) ? currentMapId : hits[0];
    }
    // ③ 无 AABB 命中 → 桥口兜底：已加载图里取脚下最高的地面
    let fallback: { mapId: number; y: number } | null = null;
    for (const [mapId, cm] of collisionMeshes) {
      const h = cm.getPolyHeight(fx, fz);
      if (h.found && (!fallback || h.height > fallback.y)) fallback = { mapId, y: h.height };
    }
    if (fallback) return fallback.mapId;
    return currentMapId; // ④ 完全无命中 → 保持当前图
  }

  // 走/跑切换核心：翻转本地状态并经 onMoveInt 出口通报（mode 1/2）；移动中立即切对应动画
  // （原版 character.cpp ChangeMoveMode）
  function setRunMode(next: boolean): boolean {
    if (running === next) return running;
    running = next;
    saveUiPrefs({ running, minimapOpen: mmVisible });   // 立即落盘（低频操作，不必节流）
    // 移动中切换走/跑：**本地动画要立刻换**。原先只在"开始移动"那一刻选一次动画（见 updateMovement
    // 的 !wasMoving 分支），所以跑动中按 R 只变速度、动画仍停在 RUN（用户 2026-09-12 报的就是这个）。
    if (wasMoving && !isRooted() && animState) {
      if (running) animState.triggerRun();
      else animState.triggerWalk();
    }
    // 移动中切换走/跑：立即带当前位置通报新档位（服务端据此广播新动画）
    if (wasMoving || mouseDown) reportMoveNow(running ? 2 : 1, 0);
    return running;
  }

  // 鼠标指向（屏幕投影 → 世界方向角）：用于本地移动朝向
  /**
   * 定身：下落 或 受击硬直（DAMAGE）中 → 禁止水平移动/转向（对齐原版：DAMAGE 与 FALLDOWN 均定身）。
   * 硬直播完（onAnimationEnd→STAND）后自动解除，若仍按住鼠标则恢复走/跑。
   */
  /**
   * 定身：期间**不接受移动/转向**（原版 DEAD 时连点击都无效）。
   *
   * 判据逐条对齐原版 `playmain.cpp:1744` —— 那句 `if (MsTraceMode && State != ATTACK
   * && State != EAT && State != SKILL)` 把**移动与攻击输入整块屏蔽**掉，即
   * **ATTACK / EAT / SKILL 三个状态都不能移动**（攻击中"挥着拳滑走"就是漏了这条，用户 2026-09-16 实测）。
   * 另外两条是原版别处的定身：FALLDOWN（掉落中）与 DEAD（死亡躺下）。
   * DAMAGE（受击硬直）比原版更严 —— 原版硬直其实可动，但我们的停步/追击手感更需要它站住。
   *
   * 硬直播完（`onAnimationEnd` → STAND）后自动解除，若仍按住鼠标则由下面的移动分支恢复走/跑。
   */
  function isRooted(): boolean {
    const st = animState?.getCurrentState();
    return falling || selfDead
      || st === animState?.STATE.ATTACK
      || st === animState?.STATE.SKILL
      || st === animState?.STATE.EAT
      || st === animState?.STATE.DAMAGE
      || st === animState?.STATE.DEAD
      // 落地表现期间同样要定身：**落地那一刻 `falling` 已被置回 false**
      //（见 `updateFalling` 的落地分支），而起身/落地受伤动画还在播
      // ⇒ 不列在这里就能在"起身"中走开（用户实测）。`FALLDOWN` 由 `falling` 覆盖，不必再列。
      || st === animState?.STATE.FALLSTAND
      || st === animState?.STATE.FALLDAMAGE;
  }

  function mouseFacing(): number | null {
    if (!camera || !renderer) return null;
    if (!mouseDown) return null;
    if (isRooted()) return null; // 掉落/受击硬直中禁止水平移动/转向（对齐原版：定身）

    const rect = renderer.domElement.getBoundingClientRect();
    // 1. 角色在屏幕上的投影坐标
    const dummyScreen = new THREE.Vector3(selfPos.x, selfPos.y, selfPos.z).project(camera);
    const projX = (dummyScreen.x + 1) * 0.5 * rect.width + rect.left;
    const projY = (-dummyScreen.y + 1) * 0.5 * rect.height + rect.top;
    // 2. 屏幕方向向量（向右/向上为正）
    const sdx = mouseX - projX;
    const sdy = -(mouseY - projY);
    const slen = Math.hypot(sdx, sdy);
    if (slen < 1) return null;
    const ux = sdx / slen, uy = sdy / slen;
    // 3. 相机 right/forward 向量（XZ 平面）映射到世界
    const camRight = new THREE.Vector3();
    const camFwd = new THREE.Vector3();
    camRight.setFromMatrixColumn(camera.matrixWorld, 0);
    camFwd.setFromMatrixColumn(camera.matrixWorld, 2);
    camFwd.negate();
    camRight.y = 0; camRight.normalize();
    camFwd.y = 0; camFwd.normalize();
    // 4. 世界方向（XZ 平面）
    const wx = ux * camRight.x + uy * camFwd.x;
    const wz = ux * camRight.z + uy * camFwd.z;
    const wlen = Math.hypot(wx, wz);
    if (wlen < 1e-6) return null;
    // 5. 朝向 = atan2(正弦, 余弦)（/pt/maps/：angle = atan2(sin, cos)，对应 world 方向）
    //   world 方向 (wx,wz) → 引擎角度语义：sin 对 x、cos 对 z
    //   （走共享内核 `faceAngleFromDir`：这是"方向 → 朝向角"这一约定的唯一实现）
    return faceAngleFromDir(wx / wlen, wz / wlen);
  }

  // ===== 远端玩家（Phase 2/3：S2C_PlayerAppear/Move/Disappear → 独立克隆演员）=====
  // char-loader 的 body/head/skeleton 是共享单例（同 job 同一组对象），不可加入第二个父节点，
  // 故每个远端角色克隆一套骨骼（保持原 bones 数组顺序，skinIndex 依赖索引）+ 克隆蒙皮网格再新 bind。
  // 远端渲染用"时间戳快照缓冲插值"（Gambetta Part III）：渲染滞后 REMOTE_INTERP_DELAY ms，
  // 在相邻权威快照间线性插值 → 速度恒定、无 chase 橡皮筋、停止即精确停在权威位。
  const REMOTE_INTERP_DELAY = 100;
  // 相邻权威快照间隔超过此值视为"长静默/重新起步"：不跨空闲间隙插值（否则起步那帧
  // 从很久以前的 STAND 锚点 f≈1 直接弹跳到新位 → 瞬移 + 旧动画残留）。
  const REMOTE_RESYNC_MS = 150;
  interface RemoteSnap {
    t: number;        // 本地到达时刻(ms,单调)
    x: number; y: number; z: number;
    angle: number;
    anim: number;
    /** 该玩家**自己播的那一条动画的条目索引**（其客户端随移动上报同步过来）。
     *  有值时旁观者直接播同一条 —— 不再各自匹配/随机（0=未提供，回退本地匹配并上报降级）。 */
    animIndex?: number;
    /** 同一条动画的语义 ID（`SemanticEntry.clip`）：仅用于校验两端动画数据是否同代 */
    animClip?: string;
    /** 使用道具广播的序号（0=非使用道具）—— 去重键的一部分，见 setRemoteAnim */
    useSeq?: number;
    /** 使用道具的 idcode（旁观者据此推表现种类，与自机同一个 useEffectKindOf） */
    useItemIdcode?: number;
  }
  interface RemoteActor {
    playerId: number;
    name: string;
    jobId: number;
    level: number;
    hp: number;
    maxHp: number;
    clanName: string;
    clanMark: string;
    topY: number; // 模型顶高（名牌锚点偏移，modelTopY(group)+0.5）
    root: THREE.Group;
    bodyGroup: THREE.Group;
    headGroup: THREE.Group;
    bones: THREE.Bone[];
    skeleton: THREE.Skeleton;
    animSmb: Awaited<ReturnType<typeof loadCharacterModel>>['animSmb'];
    animState: ReturnType<typeof createAnimStateMachine>;
    motionList: MotionInfo[];
    animFrame: number;
    animRate: number; // 动画播放速率倍率（1=基准；挥拳按攻速对应时长改写，走/跑按移速缩放，其余复原）
    /** 该玩家的移动速度（游戏单位/秒，`S2C_PlayerAppear` 带来）—— 走/跑动画按它缩放播放速度 */
    /** 走/跑动画速率（服务端下发；1 档 = 1.0）—— 不再存速度值（那条消息里那对字段已废弃） */
    animWalkRate: number;
    animRunRate: number;
    faceAngle: number | null; // 挥拳期间强制朝向（signalAttack 算，updateRemotes 在 ATTACK 态采用）
    snaps: RemoteSnap[];
    lastAnimState: number;
    /** 上一次应用过的动画条目索引（对方上报值；用于"同状态内换变体"的识别） */
    lastAnimIndex: number;
    /** 上一次应用过的「使用道具」序号（去重键第三项；站着连喝两瓶时前两项相同，靠它区分） */
    lastUseSeq: number;
    /** 待触发的使用道具粒子/音效（药水在 EAT 事件帧才放，与自机同一条规则） */
    eatEffect: { kind: UseEffectKind; motion: MotionInfo; fired: boolean } | null;
    /** 该远端的外观（武器/副手/头/甲）—— **远端动画 getter 的唯一数据源**。
     *  缺失时动画退化成"通用/空手"（正是此前远端不随武器变化的原因）。 */
    appearance?: CharacterAppearance;
    /** 主手武器挂载器（含双手武器的镜像份与姿态搬运）—— 与自机/检查器同一实现 */
    weaponMount: WeaponMount;
    /** 副手武器组（0=无 1=盾 2=匕首） */
    offHandGroup: THREE.Object3D | null;
    /** 本次攻击的动画与逐段音效状态（旁观者按服务端计划在事件帧直接播正确结果音） */
    attack: {
      motion: MotionInfo;
      /** 非零事件帧（子帧偏移，相对动作起点） */
      eventFrames: number[];
      hitFired: number;
      /** 本次攻击的目标（起手时记下；放箭的落点与 miss 判定都要用） */
      targetId: number;
      /** 本次攻击的投射物是否已放（放箭时刻 = 首个事件帧 − `RELEASE_LEAD_FRAMES`，见 spawnProjectile） */
      projFired: boolean;
      plan: Map<number, CritLookSeg> | null;
      voices: Map<number, VoiceHandle>;
      /** "计划未到"时乐观播过命中音的段号（计划迟到时据此纠正，见 applyRemoteAttackPlan） */
      optimistic: Set<number>;
    } | null;
    /** 比 S2C_AttackStart 先到的攻击计划（起手广播到达时消费；超时作废） */
    pendingAttackPlan: { map: Map<number, CritLookSeg>; at: number } | null;
  }
  const remotes = new Map<number, RemoteActor>();
  const remoteSpawning = new Set<number>();

  // 进场竞态缓存：服务端 onPlayerEnter 广播的 Appear 早于本机 enterGame 到达
  // （此刻 scene 未建、show() 未调用）→ 暂存，show() 建好 scene 后重放，避免被吞。
  const pendingAppears: { playerId: number; name: string; classId: number; level: number; hp?: number; maxHp?: number; clanName?: string; clanMark?: string; x: number; y: number; z: number; angle?: number }[] = [];

  // 克隆骨骼树：按原 bones 数组顺序生成克隆并重建父/子关系（顺序即 skinIndex 语义）
  // 克隆层级/局部变换与源完全一致 ⇒ boneInverses 必须沿用源（bind() 用当前恒等世界矩阵
  // 重算会得到错误逆矩阵 → 蒙皮二次变换 → 模型扭曲）。
  function cloneBoneHierarchy(srcBones: THREE.Bone[], srcSkeleton: THREE.Skeleton): { bones: THREE.Bone[]; skeleton: THREE.Skeleton } {
    const map = new Map<THREE.Bone, THREE.Bone>();
    const clones: THREE.Bone[] = srcBones.map((b) => {
      const nb = new THREE.Bone();
      nb.name = b.name;
      nb.position.copy(b.position);
      nb.quaternion.copy(b.quaternion);
      nb.scale.copy(b.scale);
      nb.userData.nodeName = b.userData.nodeName;
      map.set(b, nb);
      return nb;
    });
    for (const b of srcBones) {
      const nb = map.get(b)!;
      for (const child of b.children) {
        const nchild = map.get(child as THREE.Bone);
        if (nchild && nchild.parent !== nb) nb.add(nchild);
      }
    }
    const skeleton = new THREE.Skeleton(clones);
    skeleton.boneInverses = srcSkeleton.boneInverses.map((m) => m.clone());
    return { bones: clones, skeleton };
  }

  function cloneSkinnedMesh(src: THREE.SkinnedMesh, skel: THREE.Skeleton): THREE.SkinnedMesh {
    const m = src.clone() as THREE.SkinnedMesh;
    // 顶点已烘焙进 bind pose（buildSkinnedMesh 预乘了骨骼 bind 世界矩阵），
    // 故必须复用源 bindMatrix/bindMatrixInverse，仅换新骨架；bind() 会重算成恒等 → 扭曲。
    m.skeleton = skel;
    m.bindMatrix.copy(src.bindMatrix);
    m.bindMatrixInverse.copy(src.bindMatrixInverse);
    return m;
  }

  /**
   * 权威动画值 → actor 状态机（0x0050 WALK / 0x0060 RUN / 0x70~0x72 掉落 / 其余 STAND）。
   *
   * `animIndex` = **该玩家自己播的那一条动画的条目索引**（随 C2S_PlayerMove 上报、服务端透传）。
   * 有值就直接播同一条 —— 旁观者不需要重跑匹配器，也就不会因为"各自随机"
   * （旧实现用 Math.random 选变体）而在不同客户端上看到同一个角色播不同动作。
   * 无值（旧服务端/怪物等没有上报者）→ 回退本地匹配并上报降级。
   */
  function setRemoteAnim(actor: RemoteActor, animState: number, animIndex = 0, animClip = '',
                         useSeq = 0, useItemIdcode = 0): void {

    if (animState !== ANIM_DEAD && actor.animState.getCurrentState() === actor.animState.STATE.DEAD) {
      actor.animState.resurrect();
    }

    if (animState === actor.lastAnimState && animIndex === actor.lastAnimIndex
        && useSeq === actor.lastUseSeq) return;
    actor.lastAnimState = animState;
    actor.lastAnimIndex = animIndex;
    actor.lastUseSeq = useSeq;
    if (animIndex > 0) {
      const picked = actor.motionList.find((m) => m.index === animIndex) ?? null;
      if (picked && actor.animState.playMotion(picked)) {
        verifyRemoteAnimData(actor, animClip);
        return;
      }
      reportFallback('anim', `远端 id=${actor.playerId} 上报动画条目 #${animIndex} 在本地动作表里不存在`
        + `（job=${actor.jobId}）→ 回退本地匹配（两端动画数据版本可能不一致）`);
    }
    if (animState === ANIM_RUN) actor.animState.triggerRun();
    else if (animState === ANIM_WALK) actor.animState.triggerWalk();
    else if (animState === ANIM_FALLDOWN) actor.animState.triggerFallDown();
    else if (animState === ANIM_FALLSTAND) actor.animState.triggerFallStand();
    else if (animState === ANIM_FALLDAMAGE) actor.animState.triggerFallDamage();
    else if (animState === ANIM_EAT) {
      if (actor.animState.triggerEat()) {
        const kind = useEffectKindOf(useItemIdcode);
        if (kind === 'return') {
          fireEatEffectAt(actor.root.position, kind);
        } else {
          const motion = actor.animState.getCurrentMotion();
          actor.eatEffect = kind && motion ? { kind, motion, fired: false } : null;
        }
      }
    }
    else actor.animState.triggerIdle();
  }

  // ==================== 怪物渲染（服务端权威 S2C_Monster*） ====================
  const ANIM_ATTACK = 0x0100;

  interface MonsterActor {
    monsterId: number;
    name: string;
    /** 服务端 `monster_effect_id`：用于音效目录解析 */
    monsterEffectId: number;
    /** 模型资产路径（音效目录名解析用：<怪物名>/<怪物名>.smd → 目录 basename） */
    modelKey: string;
    hp: number;
    maxHp: number;
    stateBar: boolean; // 血条锁存：受击/选中后常显（对齐 exm EnableStateBar，离开视野重置）
    topY: number; // 模型顶高（名牌锚点偏移，modelTopY(group)+0.5）
    root: THREE.Group;
    bones: THREE.Bone[];
    skeleton: THREE.Skeleton;
    animSmb: MonsterModelResult['animSmb'];
    animState: ReturnType<typeof createAnimStateMachine>;
    motionList: MotionInfo[];
    animFrame: number;
    /**
     * 动画播放速率倍率（服务端随 Appear 下发的 `anim_rate`）。
     *
     * 为什么由服务端给：它来自 DB 的 `attackspeed` 档位（原版 `GetAttackFrameSpeed` = 播放步进），
     * 而**客户端没有这个数据**。服务端算成"相对客户端基准的倍率"下发，客户端直接当 `animRate` 用
     * ⇒ `attackspeed` 才真正作用于动画速度，且与**服务端算的动画时长同源**
     * （服务端"等动画播完"必须等于客户端实际播完的时间）。
     */
    animRate: number;
    snaps: RemoteSnap[];
    lastAnimState: number;
    /**
     * 本帧被**显示预算**裁掉了（超出距离档或数量上限）。
     * 被裁的怪：不渲染、不画名牌、不参与射线拾取，**且跳过骨骼求值**
     * （那正是这个机制存在的理由 —— 222 只全算 = 16.6ms/帧，实测见 monster-visibility 文件头）。
     * 但**位置插值与动画相位照常推进**：否则它重新出现时会瞬移、动作从头开始。
     */
    culled: boolean;
    /**
     * 尸体：已收到 `S2C_MonsterDeath`，动画冻在死亡动作末帧，等 `S2C_MonsterDisappear` 才移除。
     *
     * 为什么要这个标志（而不是"看 hp==0"）：尸体**仍然在移动/动画消息的广播范围内**，
     * 服务端只要发一条 `S2C_MonsterMove`（哪怕只是转身）就会把尸体"救活"成站立/行走 ——
     * 服务端在死后不再广播（`broadcastMove` 对 `!isAlive()` 直接 return），但那依赖远端行为，
     * 本地必须有自己的一道门。凡是"服务端 token 驱动的状态机调用"都要先看这个标志。
     */
    dead: boolean;
    /**
     * 主体/副模型的**显示部件**（各自一整个 Group：骨架 + 网格）。
     *
     * 为什么要两组：原版 `smCHAR::SetMotionFromCode` 在主模型动作表里**查不到**某个状态时，
     * 会去查**副模型**（`.inx` 的 `subModelFile`）的动作表，查到就 `MotionSelectFrame = 1`
     * 并改用副模型渲染（`PatDispMode & DISP_MODE_PATSUB` → `Pattern2`）。实测 66 个带 DEAD 的
     * 副模型里 **63 个骨架与主模型完全不同** ⇒ 必须连网格+骨架一起换，只换动画数据会错位。
     * 于是"显示哪一具"由**当前播放条目**的 `subModel` 标记决定（见 updateMonsters）。
     */
    mainPart: THREE.Group;
    subPart?: THREE.Group;
    /** 副模型部件（与 subPart 同生共死；只有一份来源，别在别处再存） */
    sub?: MonsterModelResult['sub'];
    /** 当前显示的是否为副模型（仅在真变化时才翻 visible，避免逐帧写） */
    subActive: boolean;
    /** 上一条应用的**服务端选定条目索引**（去重键的一部分；同一刀内服务端会重发同一条） */
    lastAnimIndex: number;
    /**
     * 本刀**全部**事件帧（进入 ATTACK 时从当前 motion 取，只留非零项）。
     *
     * 原版 `EventAttack()` **每帧**被调（`character.cpp:5837`，紧跟 `frame += FrameStep`），
     * 内部比对 `EventFrame[0..3]`，**每个跨过的事件帧都触发一次**（`:4173-4183`）。
     * 所以"连续打三拳"的条目（如 HULK `[1280,3040,4800]`）要播**三次**粒子和音效。
     * ⚠ 此前只存 `eventFrame[0]` ⇒ 三拳只播一次（用户 2026-09-17 实测发现）。
     */
    attackEventFrames: number[];
    /** 本刀已触发到第几个事件帧（对应原版的 `MotionEvent` 计数） */
    attackFired: number;
    /** 上一帧的 compFrame（用于事件帧交叉检测） */
    lastCompFrame: number;
  }
  const monsters = new Map<number, MonsterActor>();
  const monsterSpawning = new Set<number>();
  // 加载途中被 despawn（消失）的怪 id：异步加载完成后若命中则放弃挂载，避免"尸体复活"孤儿
  const monsterCancelled = new Set<number>();
  /**
   * 加载途中**死亡**的怪 id —— 与 `monsterCancelled` 相反：不是放弃，而是加载完成后直接进入尸体态。
   *
   * 必须分开记，否则"刚现身的怪被秒杀"这类情况**没有尸体**：`monsterDeath` 到达时
   * `monsters` 里还没有这个 actor（模型还在下载），若按"取消"处理，加载完成就什么都不挂。
   * （同族的异步加载竞态：AGENTS #11 第三条 / #25 ④ / #30。）
   */
  const monsterDiedDuringLoad = new Set<number>();
  // 进场竞态：与玩家 pendingAppears 同理（世界未建好时暂存，show() 后重放）
  const pendingMonsterAppears: { monsterId: number; name: string; modelFile: string; hp?: number; maxHp?: number; x: number; y: number; z: number; angle: number; dead?: boolean }[] = [];

  /**
   * 给本刀的攻击音效**装锚点**：记下"事件帧"，由渲染循环在 `compFrame` 跨过它时播
   * （原版 `character.cpp:2687`）。用**当前 motion** 的 `eventFrame`，不是"动作表里第一条 ATTACK"
   * —— 服务端可能选的是别的变体（条目不同、事件帧也不同）。
   * 该条目没有事件帧 → **不播**并上报（原版 `EventFrame[0]` 为 0 时同样不播，AGENTS #12 不静默）。
   */
  // 攻击特效派发表 + "事件帧 → 音效 + 特效"的编排**不在这里**：已抽到
  // `render/effects/monster-attack-fx.ts`（`MONSTER_ATTACK_FX` / `fireMonsterAttackEvent`），
  // 游戏与怪物实验室共用同一份。这里只负责"什么时候到事件帧"。

  /**
   * 每个怪的**武器曳光组**（原版 `cAssaMotionBlur`）—— **共享实现**：
   * 逻辑在 `render/effects/weapon-trail.ts` 的 `MonsterTrails`（登记表 `WEAPON_TRAILS` 也在那里），
   * 怪物实验室调的是**同一个类**（AGENTS #15：不许"实验室一套、游戏一套"）。
   * 惰性建：只有真的有登记的怪才会建出来（`MonsterTrails` 自己按 (kind, 阶段, KeyCode) 查表）。
   */
  const monsterTrails = new WeakMap<object, MonsterTrails>();
  function getMonsterTrails(actor: MonsterActor): MonsterTrails {
    let mt = monsterTrails.get(actor);
    if (!mt) {
      mt = new MonsterTrails({
        who: actor.name ?? actor.modelKey,
        effectId: actor.monsterEffectId,
        // 与自机曳光的诊断同一通道（游戏里没有实验室那个日志面板）
        log: (msg) => console.warn(msg),
      });
      monsterTrails.set(actor, mt);
    }
    return mt;
  }

  function armMonsterMotionEvents(actor: MonsterActor): void {
    // 起手：本招的**事件帧带子**还没到（源码在 `EventSkill_Monster`/`EventAttack` 才 `new`）
    getMonsterTrails(actor).onSwingStart();
    const ef = actor.animState.getCurrentMotion()?.eventFrame;
    const frames = ef ? Array.from(ef).filter((f) => f > 0) : [];
    // **没有事件帧 ≠ 不播**：原版 `EventAttack` 有一条兜底分支
    //   `(MotionEvent == 0 && MotionInfo->EventFrame[0] <= compFrame)`（`character.cpp:4183`）——
    //   `EventFrame[0]` 为 0 时它也成立，于是**动作一开始就触发一次**。
    //   （Runic Guardian 两条 ATTACK 都没有事件帧，而它的攻击特效在原版确实会播。）
    //   故空表视为"在第 0 帧触发一次"。
    actor.attackEventFrames = frames.length > 0 ? frames : [0];
    actor.attackFired = 0;
    actor.lastCompFrame = 0;   // 重置，让首帧也能检测到交叉
  }

  /**
   * **技能动作开始**：武装事件帧 + 起手（音 + 法阵）。
   *
   * 原版这两件事都在 `BeginSkill_Monster`（`character.cpp:14070`）：`SkillPlaySound(CASTING_*)`
   * 与 `sinEffect_StartMagic(&pos, CharFlag)`，且**所有技能共用**一套（取宿主条目的登记值）。
   *
   * ⚠ 此前游戏侧**只有 ATTACK 会武装事件帧** ⇒ 怪物放技能时事件帧用的还是上一刀普攻那一套
   * ⇒ **技能特效在游戏里根本不会触发**（实验室里正常，因为实验室自己管武装）。
   */
  /**
   * 怪物技能的**"打谁"信息** —— `anchor: 'target'` 要的"目标脚下"，以及范围内有哪些玩家。
   *
   * **唯一实现**（AGENTS #15）：事件帧（`fireMonsterAttackEvent`）与起手（`fireMonsterSkillCast`）
   * 两处都要给，各写一份必然漂移。
   *
   * 原版目标就是**玩家**（"这几招打的就是玩家"，与 `aim` 同一条约定）；
   * 范围效果 `SkillPlay_Monster_Effect` 扫的是 `lpCurPlayer` + `chrOtherPlayer[]`，**不含怪物**。
   */
  function monsterTargeting(caster: THREE.Vector3): {
    targetBase: { x: number; y: number; z: number };
    unitsInRange: (range: number) => Array<{ x: number; y: number; z: number }>;
  } {
    const feet = { x: selfPos.x, y: selfPos.y, z: selfPos.z };
    const d2 = (p: { x: number; y: number; z: number }): number =>
      (p.x - caster.x) ** 2 + (p.y - caster.y) ** 2 + (p.z - caster.z) ** 2;
    return {
      targetBase: feet,
      unitsInRange: (range) => {
        const r2 = range * range;
        const out: Array<{ x: number; y: number; z: number }> = [];
        if (d2(feet) < r2) out.push(feet);
        for (const r of remotes.values()) {
          const p = r.root.position;
          if (d2(p) < r2) out.push({ x: p.x, y: p.y, z: p.z });
        }
        return out;
      },
    };
  }

  /**
   * 怪物特效的回调集合（代码内特效 / 飞出物 / 放箭）—— 事件帧与**起手**共用**一份**。
   *
   * 为什么必须共用：CC 的陨石是**起手**放的飞出物（`timing:'cast'` + `fly`），而这三个回调
   * 原先只写在事件帧的 ctx 里 ⇒ 起手路径拿不到 `fireFly`，陨石一颗都不会飞（AGENTS #15）。
   * 谁在哪个阶段放由条目的 `timing` 决定，回调本身不分阶段。
   *
   * @param motionEvent 第几个事件帧（1 起）—— 起手阶段没有事件帧，传 1
   */
  function monsterFxCallbacks(actor: MonsterActor, motionEvent: number): {
    fireCode: (code: string, target: { x: number; y: number; z: number } | null) => void;
    fireFly: (asset: string, fly: MonsterFlySpec, ev: number) => void;
    fireRanged: () => void;
    fireMesh: (spec: { path: string; aniMaxCount: number; aniDelayTime: number; scale?: number; note: string },
               at: { x: number; y: number; z: number }) => void;
  } {
    // 闭包里别读外层可能为 null 的变量（TS18047：收窄不进闭包）—— 先取出来
    const flyOrigin = actor.root.position;
    const flyYaw = actor.root.rotation.y;
    const fxMgr = effects;
    const scn = scene;
    return {
      // **代码内组合特效**（`def.code`，如 Glacial Spike）：转交**与玩家技能同一个注册表**
      // ⇒ 同一招在怪物侧与玩家侧是同一份实现（AGENTS #15）
      fireCode: (code, target) => {
        const fn = CODE_SKILL_FX[code];
        if (!fn) { console.log(`[skillfx] ✗ 代码特效「${code}」未注册`); return; }
        fn({
          ...skillFxCtx(),
          motionEvent,
          casterYaw: flyYaw,
          targetGetter: () => unitBodyAnchor(selfPlayerId),
        }, flyOrigin, target);
      },
      // **飞出物**（`def.fly`，原版 `AssaParticle_*`）：驱动是**共用实现**
      // （`monster-fly-runner.ts`）—— 此前只有实验室实现 ⇒ 游戏里这类特效根本不飞。
      // 目标 = **自机**（与射击怪的箭同一条：这几招打的就是玩家）
      fireFly: (asset, fly, ev) => {
        // 世界未就绪（与 `spawnProjectile` 同款处理：跳过并**说出来**，不静默）
        if (!fxMgr || !scn) {
          console.log('[fly] 跳过：特效管理器/场景未就绪 mgr=' + !!fxMgr + ' scene=' + !!scn);
          return;
        }
        runMonsterFly(
          {
            // `spawnStoppable`：到点要 `stop()`（原版 `SetStop`），否则粒子堆在命中点
            spawn: (a, o) => fxMgr.spawnStoppable(a, o),
            addToScene: (o) => scn.add(o),
            dynLight: dynLights,
            sound: (p, at) => sfx.play(p, { pos: at }),
          },
          asset, fly,
          {
            pos: { x: flyOrigin.x, y: flyOrigin.y + (fly.lift ?? 0), z: flyOrigin.z },
            yaw: flyYaw,
            target: () => unitBodyAnchor(selfPlayerId),
            motionEvent: ev,
          },
        );
      },
      // **射击怪**（`MONSTER_RANGED`）：原版这个事件帧设 `ShootingFlag = TRUE` 并把武器码
      // 硬写成 `sinWS1`（弓）来复用玩家那套箭 ⇒ 这里同样交给 `spawnProjectile`。
      // · 目标 = **自机**（这三只射的就是玩家；`unitBodyAnchor` 已有 `selfPlayerId` 分支 ✓）
      // · 武器码 = `MONSTER_BOW_IDCODE`（怪没有武器数据，原版硬写弓 ✓）
      // · 不传 mount（怪手里拿的不是弓）；出手抬高取本怪的 `launchLift`（28/38，逐怪不同 ✓）
      // · eventFrame 不传 ⇒ 用按弹速飞行（怪物没有玩家那套"放箭提前量"设计）
      // **ASE 静态网格**（原版 `SetAssaEffect`）：与起手法阵**同一份实现**
      fireMesh: (spec, at) => spawnAssaMesh({ scene: scn ?? scene!, log: (m) => console.log('[fx]' + m) },
        { mesh: spec.path, pos: at, aniMaxCount: spec.aniMaxCount, aniDelayTime: spec.aniDelayTime,
          scale: spec.scale, note: spec.note }),
      fireRanged: () => spawnProjectile(
        null, actor.root, MONSTER_BOW_IDCODE, null, null,
        selfPlayerId, undefined, 1, () => null,
        MONSTER_RANGED[actor.monsterEffectId]?.launchLift ?? 34,
      ),
    };
  }

  function beginMonsterSkill(actor: MonsterActor): void {
    armMonsterMotionEvents(actor);
    // 起手音 + 起手法阵 + 起手特效：**共用实现**（`cast-circle-runner.fireMonsterSkillCast`，实验室同一份）。
    // KeyCode 取自**正在起手的那条动作**（原版按它分招：CC 的 `'J'` 与 else 是两招，特效也不同）
    fireMonsterSkillCast({
      ...skillFxCtx(), fx: effects, ...monsterTargeting(actor.root.position),
      // 起手那一招也可能是飞出物（CC 的陨石就是）⇒ 与事件帧**同一份回调**
      ...monsterFxCallbacks(actor, 1),
    }, actor.monsterEffectId, actor.root.position,
    actor.animState.getCurrentMotion()?.keyCode);
  }

  /**
   * **诊断入口：模拟"服务端下发怪物技能"**（临时 —— 服务端接上后删掉即可）。
   *
   * 这条链本该由服务端的状态驱动（`S2C_MonsterMove.animState = 0x150` + `animIndex`），
   * 但服务端还没有技能态 ⇒ 用它先把客户端的**能力**验收掉（动作 → 事件帧武装 → 起手音/法阵
   * → 事件帧特效），不必等服务端：
   *
   * ```js
   * window.__ptMonsterSkill(16)        // 离自己最近的怪，播条目 #16
   * window.__ptMonsterSkill(16, 12345) // 指定怪物 id
   * ```
   *
   * 条目号从**怪物实验室**的控制台日志读（选怪 → 按技能按钮 → `技能 'O' → 条目 idx 12`），
   * 或直接读模型的 `.inx`。
   */
  (window as unknown as { __ptMonsterSkill?: (i: number, id?: number) => void }).__ptMonsterSkill =
    (animIndex: number, monsterId?: number) => {
      let target: MonsterActor | null = null;
      if (monsterId != null) target = monsters.get(monsterId) ?? null;
      else {
        let best = Infinity;
        for (const m of monsters.values()) {
          const dx = m.root.position.x - selfPos.x, dz = m.root.position.z - selfPos.z;
          const d = dx * dx + dz * dz;
          if (d < best) { best = d; target = m; }
        }
      }
      if (!target) { console.log(`[skill] 没有可用的怪（monsterId=${monsterId ?? '未给'}）`); return; }
      console.log(`[skill] 模拟服务端下发：${target.name}#${target.monsterId} → 技能条目 #${animIndex}`);
      setRemoteMonsterAnim(target, CHRMOTION_STATE_SKILL, animIndex);
    };

  function setRemoteMonsterAnim(actor: MonsterActor, animState: number, animIndex = 0): void {
    // 尸体：服务端的移动/动画 token 一律不采信 —— 否则一条迟到的 S2C_MonsterMove（哪怕只是转身）
    // 就会把尸体触发回 STAND/WALK（死亡态本身挡住 triggerIdle 的守卫，但攻击/行走分支会绕过它）。
    if (actor.dead) return;
    // **服务端选定了条目**（攻击时才带，见 `S2C_MonsterMove.anim_index`）→ 直接播那一条。
    // 与玩家 `anim_index` 同一条链路：服务端决定播哪一条，客户端不自己选
    // （见 docs/chars/语义化动画系统.md —— 服务端持有动画数据、选变体、下发 ID）。
    // 去重键含 `animIndex`：同一刀内服务端会因位置变化重发同一条 ⇒ 必须挡住，否则动画每帧从头播。
    // ⚠ 攻击包的重复判定：**只认"这一刀是否还在播"**，不要比 (state, index) 是否相等 ——
    // 同一只怪相邻两刀选到**同一条变体**是常态（服务端每刀强制重发 `lastBroadcastAnim=-1`，
    // 而 `animIndex` 相同），只比 (state,index) 会把第二刀整刀吞掉
    // ⇒ 观感"怪物靠近后攻击动画只播一次"（用户 2026-09-17 实测）。
    // 两条路径（服务端选定条目 / 本地回退）共用这一条守卫（同一个判定只写一处）。
    // ⚠ **技能与普攻同规**：只认"这一刀/这一招是否还在播"，不要比 (state,index) 是否相等 ——
    //   相邻两刀（或连续两次同一技能）选到**同一条变体**是常态，只比 (state,index) 会把第二次整刀吞掉。
    if ((animState === ANIM_ATTACK && actor.animState.getCurrentState() === actor.animState.STATE.ATTACK)
      || (animState === CHRMOTION_STATE_SKILL
        && actor.animState.getCurrentState() === actor.animState.STATE.SKILL)) {
      return;
    }
    if (animIndex > 0) {
      const picked = actor.motionList.find((m) => m.index === animIndex) ?? null;
      if (picked && actor.animState.playMotion(picked)) {
        actor.lastAnimState = animState;
        actor.lastAnimIndex = animIndex;
        if (animState === ANIM_ATTACK) armMonsterMotionEvents(actor);
        else if (animState === CHRMOTION_STATE_SKILL) beginMonsterSkill(actor);
        return;
      }
      reportFallback('anim', `怪物 ${actor.name}#${actor.monsterId} 服务端选定的条目 #${animIndex} `
        + `在本地动作表里不存在（模型 ${actor.modelKey}）→ 回退本地匹配（两端动画数据可能不同代）`);
    }
    // 攻击包的重复判定已上移到函数开头（两条路径共用，见那里的说明）。
    // 技能与普攻一样**不看 (state === lastAnimState)** —— 连续两次同一技能是合法的（见上面的守卫）
    if (animState !== ANIM_ATTACK && animState !== CHRMOTION_STATE_SKILL
      && animState === actor.lastAnimState) {
      return;
    }
    actor.lastAnimState = animState;
    // **忠实照做**：服务端下发什么状态就播什么（`MonsterAOI.animOf` 只会发 0x40/0x50/0x60/0x100）。
    // 没有对应条目 → 失败就失败（状态机内部 `reportFallback` 说明原因），
    // **绝不拿别的动作顶上** —— 顶上会把"缺数据"伪装成"正常播放"（AGENTS #12/#53）。
    if (animState === ANIM_RUN) actor.animState.triggerRun();
    else if (animState === ANIM_WALK) actor.animState.triggerWalk();
    else if (animState === ANIM_ATTACK) {
      if (actor.animState.triggerAttack(true)) armMonsterMotionEvents(actor);
    }
    else if (animState === 0x0110) { // DAMAGE
      actor.animState.triggerDamage();
      sfx.playSoundByName(actor.modelKey, 'CHRMOTION_STATE_DAMAGE', actor.root.position, actor.monsterEffectId);
      console.log(`[MonsterAnim] ${actor.name}#${actor.monsterId} DAMAGE`);
    }
    else if (animState === CHRMOTION_STATE_SKILL) {
      // 技能音（动作态桶 = SKILL ⇒ `skill N.wav`）；起手音与法阵在 `beginMonsterSkill` 里
      if (actor.animState.triggerSkill()) beginMonsterSkill(actor);
      sfx.playSoundByName(actor.modelKey, 'CHRMOTION_STATE_SKILL', actor.root.position, actor.monsterEffectId);
    }
    else {
      actor.animState.triggerIdle();
      // 原版 character.cpp:6220 — 切回 STAND 时 25% 概率播待机音（rand()%4==0）
      if (animState === 0x0040 && Math.random() < 0.25) {
        sfx.playSoundByName(actor.modelKey, 'CHRMOTION_STATE_STAND', actor.root.position, actor.monsterEffectId);
      }
    }
  }

  function spawnMonster(actorInfo: {
    monsterId: number; name: string; modelFile: string;
    hp?: number; maxHp?: number; x: number; y: number; z: number; angle: number;
    /** 服务端 Appear 就带尸体标记（中途进场/重连时看见的已死怪） */
    dead?: boolean;
    /** 服务端 `monster_effect_id`（对应 C++ `dwCharSoundCode` / `EMonsterEffectID`）—— 用于音效目录解析 */
    monsterEffectId?: number;
    /** 服务端算好的动画播放速率倍率（来自 DB `attackspeed`，客户端没有这个数据） */
    animRate?: number;
  }): void {
    if (!scene) {
      pendingMonsterAppears.push(actorInfo);
      return;
    }
    const mid = actorInfo.monsterId;
    if (monsters.has(mid) || monsterSpawning.has(mid)) return;
    monsterSpawning.add(mid);
    void (async () => {
      try {
        const result = await loadMonsterModel(actorInfo.modelFile);
        await loadTextures(result.texturesToLoad);
        if (monsters.has(mid) || monsterCancelled.has(mid)) return; // 加载途中已被 despawn → 放弃
        // 两种"一出生就是尸体"的来源，都必须在**加载完成后**才生效（模型还没到，无法摆姿势）：
        //   ① Appear 自带 dead —— 中途进场/重连时看见的已死怪。这种**永远不会**再收到 Death
        //      （它只发给死亡当刻在场的观察者），不看这个标记就会把尸体当活怪站着；
        //   ② 加载途中收到了 Death —— 模型还在下载时怪就被打死。
        // 不能按"取消"处理（monsterCancelled 那条路）：那会让"刚现身的怪被秒杀"没有尸体。
        const dead = !!actorInfo.dead || monsterDiedDuringLoad.has(mid);

        const root = new THREE.Group();
        // 主体与副模型各包一层 Group：换"哪一具"只需翻一个 visible（见 MonsterActor 注释）
        const mainPart = new THREE.Group();
        mainPart.add(result.skeletonGroup);
        mainPart.add(result.group);
        root.add(mainPart);
        let subPart: THREE.Group | undefined;
        if (result.sub) {
          subPart = new THREE.Group();
          subPart.add(result.sub.skeletonGroup);
          subPart.add(result.sub.group);
          subPart.visible = false;   // 副模型先藏起来，等当前动作条目声明它（如死亡动作）
          root.add(subPart);
        }
        root.position.set(actorInfo.x, actorInfo.y, actorInfo.z);
        root.rotation.y = actorInfo.angle || 0;
        root.userData.monsterId = mid; // 光标 Attack/点选 Chase 命中用
        root.userData.kind = 'monster'; // 场景对象分类标签（调试/诊断用；悬停与点击的判定走 pickTargetAt 的屏幕矩形）
        scene!.add(root);

        let actorObj!: MonsterActor;
        const animState = createAnimStateMachine({
          getMotions: () => actorObj.motionList,
          getClassId: () => 0,
          // 怪物没有"上报者"（它的动画是各客户端自己选的）→ 用**所有客户端共有**的输入
          // (monsterId, 状态) 确定性派生变体：同一只怪在所有人屏幕上播同一条。
          // 这是过渡方案 —— 设计目标是服务端持有怪物动画数据、直接下发条目 ID（见
          // docs/chars/语义化动画系统.md）；届时删掉本行即可。
          getAnimSeed: () => deriveAnimSeed(mid, 0),
          onMotionChange: (motion: MotionInfo) => { actorObj.animFrame = motion.startFrame * 160; },
        });
        actorObj = {
          monsterId: mid,
          monsterEffectId: actorInfo.monsterEffectId || 0,
          name: actorInfo.name,
          modelKey: actorInfo.modelFile,
          hp: actorInfo.hp || 0,
          maxHp: actorInfo.maxHp || 0,
          stateBar: false,
          topY: modelTopY(result.group) + 0.5,
          root,
          bones: result.bones,
          skeleton: result.skeleton,
          animSmb: result.animSmb,
          animState,
          motionList: result.motionList,
          animFrame: 0,
          // 服务端算好的播放速率（来自 DB attackspeed）；0/缺失 → 退成 1（= 客户端基准速度）
          animRate: actorInfo.animRate && actorInfo.animRate > 0 ? actorInfo.animRate : 1,
          snaps: [{ t: performance.now(), x: actorInfo.x, y: actorInfo.y, z: actorInfo.z, angle: actorInfo.angle || 0, anim: dead ? ANIM_DEAD : 0x0040 }],
          lastAnimState: dead ? ANIM_DEAD : 0x0040,
          culled: false,
          dead,
          mainPart,
          subPart,
          sub: result.sub,
          subActive: false,
          lastAnimIndex: 0,
          attackEventFrames: [],
          attackFired: 0,
          lastCompFrame: 0,
        };
        monsters.set(mid, actorObj);
        if (dead) applyMonsterDeathPose(actorObj);
        else animState.triggerIdle();
        console.log('[WorldView] 怪物出现: id=' + mid + ' model=' + actorInfo.modelFile + ' name=' + actorInfo.name
          + (dead ? ' [尸体]' : ''));
      } catch (e) {
        console.warn('[WorldView] 怪物加载失败 id=' + mid + ' model=' + actorInfo.modelFile, e);
      } finally {
        monsterSpawning.delete(mid);
        monsterCancelled.delete(mid);
        monsterDiedDuringLoad.delete(mid);
      }
    })();
  }

  /**
   * 让一只怪进入**尸体态**：播死亡动作并停在末帧（原版 `playsub.cpp` 死亡分支
   * `frame = (MotionInfo->EndFrame - 1) * 160` —— 尸体不起身）。
   *
   * 唯一入口：`monsterDeath`（死亡当刻在场/迟到加载中）与 `spawnMonster`（Appear 就带 dead）
   * 都走这里 —— 两条路必须完全同一种表现，否则"我自己打死的"和"我进场时它已经死了"
   * 会呈现两种尸体（AGENTS #15：同一个判定出现第二份就是 bug 的种子）。
   *
   * 模型没有 DEAD 条目（实测 555 个怪物 .inx 里 94 个没有内联 0x120，资产里另有独立的
   * `*-die` 模型）时 `triggerDead()` 返回 false 并 `reportFallback` —— 此时**不编造动作**，
   * 尸体停在当前帧（"仅停止操作"），降级清单里能看到确切是哪个模型缺条目。
   */
  function applyMonsterDeathPose(actor: MonsterActor): void {
    actor.dead = true;
    actor.hp = 0;
    actor.stateBar = false;
    // 失败时**不做任何替代动作**（AGENTS #12：禁止静默兜底 —— 随机播一条别的动作会让
    // "这个模型没有死亡动画"这件事彻底看不出来）。此时动画停在收到死亡那一刻的姿势，
    // 冻结由 updateMonsters 里"非 DEAD 条目不推进帧"实现，同时 reportFallback 已进降级清单。
    actor.animState.triggerDead();
  }

  /**
   * 已经指向这具尸体的**目标**要在它死掉那一刻失效：`pickTargetAt` 已在源头排除尸体，
   * 所以这里只处理"死之前就已经在追/悬停"的那一个。
   *
   * 清 `moveTarget` 就等于停掉自动攻击循环（主循环的 `monsterEngaged` 以它为驱动），
   * 与原版一致 —— 目标的 `Life[0] <= 0` 时 `CancelAttack()`（`playmain.cpp:1781-1786`）。
   * ⚠ **不清 `selfAttackTargetId`**：已经挥出去的那一拳还要在命中帧上报目标，提前清会让它打空
   * （该纪律见 `cancelTarget` 的注释）；它也不是选点来源。
   */
  function clearMonsterTargets(actor: MonsterActor): void {
    if (moveTarget?.kind === 'monster' && moveTarget.id === actor.monsterId) {
      moveTarget = null;
      moveStuckStart = 0;
    }
    if (hoverTarget?.root === actor.root) {
      hoverTarget = null;
    }
  }

  function monsterDeath(monsterId: number): void {
    const actor = monsters.get(monsterId);
    if (!actor) {
      // 无 actor 的两种"还没挂上"的窗口，都要把死亡意图记下来（原因见下），
      // 否则这两种情况下**没有尸体**，而且客户端还会把它当活怪显示到 Disappear 为止：
      //   ① 世界还没建好，Appear 被暂存在 pendingMonsterAppears（进场首帧就是这个窗口）
      //   ② 模型正在加载（刚现身的怪被秒杀）
      const pending = pendingMonsterAppears.find((p) => p.monsterId === monsterId);
      if (pending) {
        pending.dead = true;
        return;
      }
      if (monsterSpawning.has(monsterId)) monsterDiedDuringLoad.add(monsterId);
      else console.log('[WorldView] 收到未知怪物的死亡事件: id=' + monsterId
        + '（本地没有它的 actor，也没有在加载/暂存 → 可能刚换过图，世界已被清空）');
      return;
    }
    if (actor.dead) return;
    applyMonsterDeathPose(actor);
    sfx.playSoundByName(actor.modelKey, 'CHRMOTION_STATE_DEAD', actor.root.position, actor.monsterEffectId);
    clearMonsterTargets(actor);
    console.log('[WorldView] 怪物死亡(尸体保留): id=' + monsterId + ' name=' + actor.name);
  }

  /** 怪物消失（`S2C_MonsterDisappear`）：真正移除 —— 尸体停留到此为止（服务端 decay 到点发的） */
  function despawnMonster(monsterId: number): void {
    const actor = monsters.get(monsterId);
    if (actor) {
      sfx.playSoundByName(actor.modelKey, 'CHRMOTION_STATE_WARP', actor.root.position, actor.monsterEffectId);
      // 曳光的带子挂在**场景**上（顶点已是世界坐标，不跟随角色变换）⇒ 角色移除时必须一起销毁，
      // 否则"怪物消失、半空留着一条带子"
      monsterTrails.get(actor)?.dispose();
      monsterTrails.delete(actor);
      scene?.remove(actor.root);
      monsters.delete(monsterId);
    }
    if (monsterSpawning.has(monsterId)) monsterCancelled.add(monsterId); // 加载途中 → 标记取消
    monsterSpawning.delete(monsterId);
    monsterDiedDuringLoad.delete(monsterId); // 已经"消失"了，不该再等加载变成尸体
  }

  // ==================== NPC（S2C_NpcAppear，静态站桩） ====================
  interface NpcActor {
    entityId: number;
    root: THREE.Group;
    nameKey: string;
    topY: number; // 模型顶高（名牌锚点偏移，modelTopY(group)+0.5）
    bones: THREE.Bone[];
    skeleton: THREE.Skeleton;
    animSmb: MonsterModelResult['animSmb'];
    animState: ReturnType<typeof createAnimStateMachine>;
    motionList: MotionInfo[];
    animFrame: number;
    standSwitchAt: number; // 下次随机切换 STAND 动画的时间（ms）
  }
  const npcs = new Map<number, NpcActor>();
  const npcSpawning = new Set<number>();
  const pendingNpcAppears: { entityId: number; nameKey: string; modelFile: string; x: number; y: number; z: number; angle: number }[] = [];

  function spawnNpc(info: { entityId: number; nameKey: string; modelFile: string; x: number; y: number; z: number; angle: number }): void {
    if (!scene) {
      pendingNpcAppears.push(info);
      return;
    }
    const nid = info.entityId;
    if (npcs.has(nid) || npcSpawning.has(nid)) return;
    npcSpawning.add(nid);
    void (async () => {
      try {
        const result = await loadMonsterModel(info.modelFile);
        await loadTextures(result.texturesToLoad);
        if (npcs.has(nid)) return;

        const root = new THREE.Group();
        root.add(result.skeletonGroup);
        root.add(result.group);
        root.position.set(info.x, info.y, info.z);
        root.rotation.y = info.angle || 0;
        root.userData.entityId = nid; // 光标 Talk/点选 Chase 命中用
        root.userData.kind = 'npc'; // 场景对象分类标签（调试/诊断用；悬停与点击的判定走 pickTargetAt 的屏幕矩形）
        scene!.add(root);

        let actorObj!: NpcActor;
        const animState = createAnimStateMachine({
          getMotions: () => actorObj.motionList,
          getClassId: () => 0,
          // 同怪物：NPC 无上报者 → 由 (entityId, 状态) 确定性派生，各客户端站姿一致
          getAnimSeed: () => deriveAnimSeed(nid, 0),
          onMotionChange: (motion: MotionInfo) => { actorObj.animFrame = motion.startFrame * 160; },
        });
        actorObj = {
          entityId: nid,
          root,
          nameKey: info.nameKey,
          topY: modelTopY(result.group) + 0.5,
          bones: result.bones,
          skeleton: result.skeleton,
          animSmb: result.animSmb,
          animState,
          motionList: result.motionList,
          animFrame: 0,
          standSwitchAt: performance.now() + 3000 + Math.random() * 5000,
        };
        npcs.set(nid, actorObj);
        animState.triggerIdle();
        console.log('[WorldView] NPC 出现: id=' + nid + ' key=' + info.nameKey + ' model=' + info.modelFile);
      } catch (e) {
        console.warn('[WorldView] NPC 加载失败 id=' + nid + ' model=' + info.modelFile, e);
      } finally {
        npcSpawning.delete(nid);
      }
    })();
  }

  function despawnNpc(entityId: number): void {
    const actor = npcs.get(entityId);
    if (actor) {
      scene?.remove(actor.root);
      npcs.delete(entityId);
    }
    npcSpawning.delete(entityId);
  }

  /** 每帧：NPC 仅播 idle 动画（静态，无位置插值）；STAND 播一段时间后随机切换另一个 STAND（更鲜活） */
  function updateNpcs(dt: number): void {
    const now = performance.now();
    for (const actor of npcs.values()) {
      // 多 STAND 随机切换：STAND 态播 3~8s 后随机换另一个 STAND（排除当前）
      if (actor.animState.getCurrentState() === actor.animState.STATE.STAND && now >= actor.standSwitchAt) {
        actor.standSwitchAt = now + 3000 + Math.random() * 5000;
        actor.animState.triggerIdle(true);
      }
      const motion = actor.animState.getCurrentMotion();
      if (!motion) continue;
      actor.animFrame = advanceAnimFrame(actor.animFrame, motion, dt).frame;
      const endFrame = motion.endFrame * 160;
      const startFrame = motion.startFrame * 160;
      if (actor.animFrame >= endFrame) {
        if (motion.repeat) {
          const len = endFrame - startFrame;
          actor.animFrame = startFrame + ((actor.animFrame - startFrame) % len);
        } else {
          const next = actor.animState.onAnimationEnd();
          if (next) actor.animFrame = next.startFrame * 160;
        }
      }
      // 姿势尾巴 = 共享实现（char/anim-player.applyPose）：求值 + 施加 + 更新矩阵
      applyPose(motion.animSmb ?? actor.animSmb, actor.animFrame, actor.bones, actor.skeleton);
    }
  }

  // ==================== 地面物品（S2C_GroundItem* / C2S_PickupItem） ====================
  // 渲染对齐原版 `scITEM::Draw`（character.cpp，实现见 EU 重写的 RenderDropItemOverride
  // `PristonTale-EU-main/game/game/EXE.cpp:56`；exm 反编译里该函数被遮蔽，只剩声明）：
  //  - 加载 DropItem\it{DorpItem}.smd 物品模型；无模型 → 旗帜兜底（char\flag\wow）
  //  - 位置 = 服务端下发的 x/z + 原版固定微抬 `pY + 6` 单位（6/256 世界单位）
  //  - 朝向 = 位置决定值 `Angle.y = ((pX+pZ) >> 2) & ANGCLIP`，**不是随机**（同坐标恒同朝向）
  //  - **只有武器**（`ITEMBASE_Weapon`，idcode 首字节 0x01）额外 `Angle.x = 90°` 躺平；
  //    防具/盾/药水/宝石/金币等一律保持模型原始竖立姿态
  interface GroundItemActor {
    groundItemId: number;
    name: string;
    /** 名牌文本（名称 + 数量/金额后缀，按原版规则拼好；金币用金额、其余用堆叠数） */
    label: string;
    root: THREE.Group;
    topY: number;
    model: THREE.Group;
    /** 闪烁相位（对齐 scITEM::Draw：周期提亮 vs 正常，交替渲染） */
    blinkOn: boolean;
    mats: { mat: THREE.MeshPhongMaterial; base: THREE.Color }[];
  }
  const groundItems = new Map<number, GroundItemActor>();
  let groundItemLabelsOn = false;
  function toggleGroundItemLabels(): void { groundItemLabelsOn = !groundItemLabelsOn; }
  const pendingGroundItems: { groundItemId: number; name: string; x: number; y: number; z: number; dorpItem: string; itemId: number; quantity: number; money: number }[] = [];
  /** 掉落物离地微抬：原版 `ps->sSelfPosition.iY = ps->sPosition.iY + 6 * 256`（定点 fONE=256）→ 6/256 世界单位 */
  const GROUND_LIFT = 6 / 256;
  /** 掉落物高亮闪烁周期（ms 半个周期）：对齐原版 Color+100 周期脉冲 */
  const GROUND_BLINK_MS = 650;

  /**
   * 物品大类 = idcode 最高字节（原版 `ItemID::ToItemBase()`，掩码 `0xFF000000`）。
   * 判据与原版 `ITEMBASE_Weapon = 0x01000000` 逐位一致，用于"是否躺平"。
   */
  function itemBaseOf(itemId: number): number {
    return itemId === 0 ? 0 : (itemId & 0xFF000000) >>> 0;
  }
  const ITEMBASE_WEAPON = 0x01000000;

  /** 模型组在自身空间里的最高点（用于把名字牌抬到模型顶上，不含模型所处世界平移） */
  function modelTopY(model: THREE.Object3D): number {
    let top = 0;
    model.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    model.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const g = mesh.geometry as THREE.BufferGeometry | undefined;
      if (!g) return;
      if (!g.boundingBox) g.computeBoundingBox();
      const bb = g.boundingBox!;
      // 局部 bbox 顶点 → world → group 空间，取最大 y（去掉 group 世界平移后即自身相对高度）
      for (const [x, y, z] of [[bb.min.x, bb.min.y, bb.min.z], [bb.max.x, bb.max.y, bb.max.z]] as const) {
        v.set(x, y, z);
        mesh.localToWorld(v);
        model.worldToLocal(v);
        top = Math.max(top, v.y);
      }
    });
    return top;
  }

  // ==================== 名牌/血条（Canvas overlay，design-nameplate-hpbar.md）====================
  /** 血条颜色：满血绿(hsl120) → 半血红橙(hsl60) → 低血红(hsl0)，随血量线性渐变（对齐 exm DrawStateBar2 绿区更缓的方向） */
  function hpColor(ratio: number): string {
    const r = Math.max(0, Math.min(1, ratio));
    const hue = 120 * r; // r=1 绿 / 0.5 黄 / 0.25 橙 / ~0 红
    return `hsl(${hue.toFixed(0)} 85% 50%)`;
  }

  function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  /** 世界锚点 → 屏幕坐标（CSS px）。背后/离屏返回 null。 */
  const _npProj = new THREE.Vector3();
  function anchorToScreen(root: THREE.Object3D, topY: number): { x: number; y: number } | null {
    if (!npOverlay || !camera) return null;
    _npProj.setFromMatrixPosition(root.matrixWorld);
    _npProj.y += topY;
    _npProj.project(camera);
    if (_npProj.z > 1) return null; // 相机背后
    const W = npOverlay.clientWidth, H = npOverlay.clientHeight;
    if (W <= 0 || H <= 0) return null;
    const x = (_npProj.x * 0.5 + 0.5) * W;
    const y = (1 - (_npProj.y * 0.5 + 0.5)) * H;
    if (x < -80 || x > W + 80 || y < -80 || y > H + 80) return null;
    return { x, y };
  }

  /** 世界坐标 → overlay 屏幕坐标（与 `anchorToScreen` 同一投影基准；用于锚点实体已消失的飘字） */
  function worldToScreen(wx: number, wy: number, wz: number): { x: number; y: number } | null {
    if (!npOverlay || !camera) return null;
    _npProj.set(wx, wy, wz);
    _npProj.project(camera);
    if (_npProj.z > 1) return null; // 相机背后
    const W = npOverlay.clientWidth, H = npOverlay.clientHeight;
    if (W <= 0 || H <= 0) return null;
    const x = (_npProj.x * 0.5 + 0.5) * W;
    const y = (1 - (_npProj.y * 0.5 + 0.5)) * H;
    if (x < -80 || x > W + 80 || y < -80 || y > H + 80) return null;
    return { x, y };
  }

  /** 名牌是否被"点选/悬停"锁定（选中高亮与怪物血条显隐共用） */
  function isSelected(root: THREE.Object3D): boolean {
    if (hoverTarget?.root === root) return true;
    const t = moveTarget;
    if (!t || t.kind === 'ground') return false;
    if (t.kind === 'monster' && root.userData.monsterId === t.id) return true;
    if (t.kind === 'player' && root.userData.playerId === t.id) return true;
    if (t.kind === 'npc' && root.userData.entityId === t.id) return true;
    return false;
  }

  interface PillStyle {
    nameColor: string;
    clan?: string;       // 公会名（玩家有公会时显示在名字下方）
    showHp: boolean;
    ratio: number;       // hp/maxHp（showHp 时有效）
    selected: boolean;
  }
  /** 在锚点 (x,y) 上方画一块名牌：名牌块(名字+公会)尺寸恒定；血条出现时仅让整块上移，自身不变高 */
  /**
   * 画一块名牌，并**返回它的屏幕矩形**（覆盖名牌块与血条）。
   * 返回矩形是给鼠标拾取用的：用户 2026-09-13 要"指向名牌 = 指向该目标"——
   * 由绘制方给出矩形，命中判定与绘制共用同一份几何，不会各写一套后漂移。
   */
  function drawPill(ctx: CanvasRenderingContext2D, x: number, y: number, name: string, s: PillStyle): { x: number; y: number; w: number; h: number } {
    const NAME_FONT = '13px Verdana, "Microsoft YaHei", "PingFang SC", sans-serif';
    const CLAN_FONT = '11px Verdana, "Microsoft YaHei", "PingFang SC", sans-serif';
    ctx.font = NAME_FONT;
    const nameW = ctx.measureText(name).width;
    const clanW = s.clan ? ctx.measureText('◆ ' + s.clan).width : 0;
    let pillW = Math.max(nameW, clanW) + 16;

    // 名牌块（名字+公会）固定高；血条独立于名牌块下方，出现仅抬高名牌块
    const blockH = 18 + (s.clan ? 3 + 14 : 0);
    const HP_BAR_W = 84, HP_BAR_H = 7;
    const GAP = s.showHp ? 3 : 0; // 名牌块底边与血条顶间距
    if (s.showHp) pillW = Math.max(pillW, HP_BAR_W + 12 + 4); // 血条(含轮廓)比名牌块略宽，居中
    const blockBottom = y - (s.showHp ? HP_BAR_H + GAP : 0) - 4; // 名牌块底边贴着血条下方留 4px
    const blockTop = blockBottom - blockH;

    // 名牌块背景 + 选中描边（描边只圈名牌块，不圈血条）
    ctx.fillStyle = 'rgba(8, 11, 16, 0.55)';
    rrect(ctx, x - pillW / 2, blockTop, pillW, blockH, 4);
    ctx.fill();
    if (s.selected) {
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 1;
      rrect(ctx, x - pillW / 2, blockTop, pillW, blockH, 4);
      ctx.stroke();
    }
    // 命中矩形：从名牌块顶边到锚点 y（含血条），宽度取"名牌块 / 血条"的较宽者
    const hitW = Math.max(pillW, s.showHp ? HP_BAR_W + 16 : pillW);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let rowY = blockTop + 9;
    ctx.font = NAME_FONT;
    ctx.fillStyle = s.nameColor;
    ctx.fillText(name, x, rowY);
    if (s.clan) {
      rowY += 18;
      ctx.font = CLAN_FONT;
      ctx.fillStyle = 'rgba(184, 212, 240, 0.9)';
      ctx.fillText('◆ ' + s.clan, x, rowY);
    }

    // 血条：名牌块下方，深色外轮廓 + 玻璃质感
    if (s.showHp) {
      drawHpBar(ctx, x, blockBottom + GAP, HP_BAR_W + 4, HP_BAR_H, s.ratio);
    }

    // 命中矩形：从名牌块顶边到锚点 y（含下方血条），宽度取较宽者 —— 供"指向名牌 = 指向目标"
    const hitTop = blockTop;
    const hitBottom = s.showHp ? blockBottom + GAP + HP_BAR_H : blockBottom;
    return { x: x - hitW / 2, y: hitTop, w: hitW, h: Math.max(1, hitBottom - hitTop) };
  }

  /** 血条（圆形玻璃质感）: 深色外轮廓 → 深色槽 → 渐变填充 + 顶部高光 */
  function drawHpBar(ctx: CanvasRenderingContext2D, cx: number, top: number, w: number, h: number, ratio: number): void {
    const r = h / 2;
    // 外轮廓（深色描边底板，比槽大一圈）
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    rrect(ctx, cx - w / 2, top - 1, w, h + 2, r + 1);
    ctx.fill();
    // 槽
    const iw = w - 4; // 内缩 2px/边
    ctx.fillStyle = 'rgba(16, 22, 30, 0.92)';
    rrect(ctx, cx - iw / 2, top, iw, h, r);
    ctx.fill();
    // 填充（含 1px 上下内缩，两端圆头）
    const r0 = Math.max(0, Math.min(1, ratio));
    const fw = Math.max(2, (iw - 2) * r0);
    const fx = cx - (iw - 2) / 2;
    const fy = top + 1, fh = h - 2;
    ctx.fillStyle = hpColor(r0);
    rrect(ctx, fx, fy, fw, fh, fh / 2);
    ctx.fill();
    // 玻璃高光：上亮下暗渐变叠加
    const gloss = ctx.createLinearGradient(0, fy, 0, fy + fh);
    gloss.addColorStop(0, 'rgba(255,255,255,0.40)');
    gloss.addColorStop(0.45, 'rgba(255,255,255,0.10)');
    gloss.addColorStop(0.6, 'rgba(255,255,255,0.03)');
    gloss.addColorStop(1, 'rgba(0,0,0,0.30)');
    ctx.fillStyle = gloss;
    rrect(ctx, fx, fy, fw, fh, fh / 2);
    ctx.fill();
  }

  /** 名牌数据变更 / overlay 创建（自机 hp 数据等入口） */
  function setSelfHp(hp: number, maxHp: number): void {
    if (!Number.isFinite(hp) || !Number.isFinite(maxHp)) return;
    if (hp < selfHp) markSelfCombat(); // hp 权威下降 = 受击（怪物反击等目前只经 PlayerState）→ 进入战斗窗口
    selfHp = hp;
    selfMaxHp = Math.max(hp, maxHp);
  }
  /**
   * **换图的唯一入口** —— 底下所有"进了另一张图"的路都必须走这里。
   *
   * 为什么必须唯一：换图要连带做的事有四件（区域预加载 / 音频 / 村庄↔野外姿态 / 地图名大字），
   * 而"谁发现了换图"有三个来源：① 本地判图（走路越界，高频预判）② 服务端校准
   * （`game.mapSwitched`，与本地可能差一个身位）③ 传送（`applyTeleport`）。
   * 我此前只在 ② 里做了大字提示，于是"走过去"和"传送过去"都没有地图名（用户实测）。
   * 收敛到这里之后，**再加换图的连带动作只需改一处**，不会再出现"某条路漏了一件事"。
   *
   * @param reason 仅用于日志（区分是谁发现的换图）
   * @returns 是否真的换了图
   */
  function enterMap(mapId: number, reason: string): boolean {
    // ⚠ 判据必须用 `Number.isFinite`，**不能写 `!mapId`** —— 地图 **0**（阿卡西亚森林）是合法地图，
    //   而 `!0 === true` 会让它永远进不来：切图被吞 → 区域不重载（小地图/大地图都不变）→ 名字大字也不弹。
    //   （用户 2026-09-16 实测："进入地图 0 之后小地图和大地图都不会变了，也不出 mapbanner 了"，
    //     并直接猜到"是不是 mapId 要求大于 0？" —— 就是这个。）
    if (!scene || !Number.isFinite(mapId) || mapId === currentMapId) return false;
    currentMapId = mapId;
    mapAudio.enterMap(currentMapId);
    void syncMapRegions(currentMapId);
    animState?.reselectForCurrentState();   // 村庄↔野外姿态随图变
    showMapBanner(mapId);                   // 进图地图名大字（三条路都走这里）
    console.log(`[WorldView] 换图(${reason}): map=${mapId}`);
    return true;
  }

  /**
   * 服务端权威换图校准（`game.mapSwitched`）：服务端 findMapPrecise 判定玩家跨图后通知。
   * 本地判图是高频预判，可能与服务端差一个身位——以本消息对齐 currentMapId，
   * 防止两端归属漂移。大字提示由 `enterMap` 统一负责：本地已判过则不重复弹。
   */
  function applyMapSwitched(mapId: number): void {
    enterMap(mapId, '服务端校准');
  }

  /**
   * 服务端权威复活（`game.playerRespawn`）：回到出生地图、半血。
   *
   * **为什么必须由客户端搬自己**：自机位置是客户端权威（方向二），服务端只能改自己的账本，
   * 改不了你屏幕上的坐标。不接这条消息，就会出现"服务端在出生地、客户端还站在怪物堆里挨打"。
   * 服务端另有一条 `S2C_PlayerState`（半血）刷新 HUD 数字，这里只管世界层。
   */
  async function applyRespawn(info: { mapId: number; x: number; z: number; y: number; hp: number; maxHp: number }): Promise<void> {
    if (!scene || !charGroup) return; // 未进图：忽略（下次 enterGame 会用服务端给的出生点）
    // 0) 解除死亡态：尸体起身（DEAD 是唯一需要显式解除的状态，stance 同步包推不动它）
    selfDead = false;
    animState?.resurrect();
    await applyTeleport(info);
    // 血量（半血）：HUD 数字由随后的 S2C_PlayerState 刷新，这里同步血条与名牌
    if (info.maxHp > 0) setSelfHp(info.hp, info.maxHp);
    else selfHp = info.hp;
    console.log('[WorldView] 复活: map=' + info.mapId + ' hp=' + info.hp + '/' + info.maxHp);
  }

  /** 不连续位移的公共实现（复活 / 脱困 / 未来传送门都用它 —— 只写一份"怎么搬人"） */
  async function applyTeleport(info: { mapId: number; x: number; y: number; z: number; angle?: number }): Promise<void> {
    if (!scene || !charGroup) return; // 未进图：忽略（下次 enterGame 会用服务端给的出生点）
    // 1) 先打断本地移动/追击/下落 —— 否则传送后仍会朝旧目标跑，或被"下落中"状态接管
    moveTarget = null;
    moveStuckStart = 0;
    mouseDown = false;
    wasMoving = false;
    falling = false;
    fallHeight = 0;

    // 2) **先把目标图加载好，再切图并设置位置** —— 顺序不能反：
    //    旧顺序是"先设位置、再 await 加载"，而 await 期间渲染循环照跑，updateFalling 会拿
    //    "新坐标 + 新图还没进 collisionMeshes"去查地面 → 查不到 → 从虚空逐帧下落
    //    （用户 2026-09-13 实测：卷轴传送到内维斯克、死亡回村庄都"掉到地图外面"）。
    //    先加载的好处：期间角色仍在旧图旧位置（旧图有碰撞面）→ 不会掉；调用方用加载遮罩盖住。
    if (info.mapId !== currentMapId) {
      await loadMapById(info.mapId);
      // ⚠ 加载**失败**时 (图不存在/被取消) 绝不能改坐标：那会变成"新坐标 + 没有碰撞网格"，
      // updateFalling 查不到地面 → 从虚空下坠掉出地图（这正是跨图传送/复活的坑）。
      // 保持原位并留痕，等服务端下一次同步或重登。
      if (!collisionMeshes.has(info.mapId)) {
        reportFallback('teleport:mapNotLoaded',
          `目标图 map ${info.mapId} 未加载成功 → 保持原位不动（避免掉出地图）`);
        return;
      }
      // 与下面的设位置在同一帧内完成，不产生"新图 + 旧位置"；大字提示也由它出
      enterMap(info.mapId, '传送');
    }

    // 3) y：服务端已按**目标地图**地形算过；为 0（该点无可站立地面）时用本地地形补，
    //    否则传送瞬间就会自由落体（那个坏 y 还会被写回存档，见服务端 applyRelocation 注释）。
    let wy = info.y;
    if (!(wy > 0)) {
      // 用**合并视图**取该点最高可站立面（与 updateFalling 同一实现）：只查目标图会在
      // 边界/AABB 缝隙处取不到面，白白退化成服务端的 y=0。
      groundCollision.setSourceIds(null);
      const h = groundCollision.getFloorHeight(info.x * 256, info.z * 256, 0);
      if (h.found) wy = h.height / 256;
      else reportFallback('respawn', `传送点无地形数据 map=${info.mapId} (${info.x},${info.z}) → 用服务端 y=${info.y}`);
    }
    selfPos.set(info.x, wy, info.z);
    if (info.angle !== undefined) { selfAngle = info.angle; charGroup.rotation.y = selfAngle; }
    charGroup.position.copy(selfPos);
    charGroup.userData.teleportedAt = performance.now(); // 供调试/后续做传送特效锚点

    // 4) 区域同步（当前图 + 邻图预加载）。位置与 currentMapId 此时已一致，mapsInRange 用的是新坐标。
    await syncMapRegions(currentMapId);
    animState?.reselectForCurrentState(); // 村庄↔野外姿态随图变

    console.log('[WorldView] 传送: map=' + info.mapId
      + ' world=(' + info.x.toFixed(1) + ',' + wy.toFixed(1) + ',' + info.z.toFixed(1) + ')');
  }

  /** 旁观者侧的传送：换图了就摘掉（不在本图视野内），否则直接搬 actor 并清插值快照 */
  function teleportRemote(playerId: number, info: { mapId: number; x: number; y: number; z: number; angle?: number }): void {
    const actor = remotes.get(playerId);
    if (!actor) return;
    if (info.mapId !== currentMapId) { despawnRemote(playerId); return; }
    actor.root.position.set(info.x, info.y, info.z);
    if (info.angle !== undefined) actor.root.rotation.y = info.angle;
    // 清快照 + 塞一条"当前时刻"的点：否则插值会从旧位置平滑滑过去（看起来像瞬移失败/穿墙）
    actor.snaps.length = 0;
    actor.snaps.push({
      t: performance.now(), x: info.x, y: info.y, z: info.z,
      angle: info.angle ?? actor.root.rotation.y,
      // anim 用**原版状态码**（snaps 的约定见 updateMonsters/playerMove：存的是服务端下发的码，
      // 由 setRemoteAnim 翻译成状态机状态），不是 state machine 的 STATE 枚举
      anim: actor.lastAnimState,
    });
  }

  /**
   * 玩家死亡（`S2C_PlayerDeath`）：播 DEAD 动画躺下并**停在末帧**，等待复活选择。
   *
   * 自机额外：打断移动/追击/下落、置 `selfDead`（期间 isRooted() 为真 → 定身）、播死亡音；
   * 倒计时与三个选项的 UI 由 main.ts 负责（WorldView 不碰 DOM）。
   * 远端：同样躺下（旁观者看得到尸体）。
   */
  function applyPlayerDeath(playerId: number): void {
    if (playerId === selfPlayerId) {
      moveTarget = null;
      moveStuckStart = 0;
      mouseDown = false;
      wasMoving = false;
      falling = false;
      fallHeight = 0;
      selfDead = true;
      // 死亡音（原版 CharPlaySound → wav/effects/player/<职业>/dead N.wav）
      sfx.playPlayerSound(getGameSnapshot().character?.job ?? 0, 'CHRMOTION_STATE_DEAD', selfPos);
      if (!animState?.triggerDead()) {
        console.warn('[WorldView] 自机没有 DEAD 动画条目 → 只停止操作，不播躺下');
      }
      console.log('[WorldView] 自机死亡：已躺下，等待复活选择');
      return;
    }
    const actor = remotes.get(playerId);
    if (actor) actor.animState.triggerDead();
  }

  function setSelfName(name: string): void {
    selfName = name;
  }
  function setSelfLevel(level: number): void {
    if (Number.isFinite(level) && level > 0) selfLevel = level;
  }

  /** 自机发起攻击 → 进入战斗窗口 */
  function markSelfCombat(): void {
    selfCombatUntil = performance.now() + COMBAT_WINDOW_MS;
  }
  /** S2C_Damage/Heal：按 targetId 更新对应实体血量；isDamage=true（受击）才触发自机战斗窗口 */
  function applyUnitHp(targetId: number, hp: number, isDamage: boolean): void {
    if (targetId === selfPlayerId) {
      selfHp = hp;
      if (isDamage) markSelfCombat();
      return;
    }
    const m = monsters.get(targetId);
    if (m) { m.hp = hp; return; }
    const r = remotes.get(targetId);
    if (r) r.hp = hp;
  }
  /** S2C_AttackResult：服务端当前只广播 damage（无 currentHp），客户端从出现血量自减；受击即锁存血条 */
  function applyMonsterHit(monsterId: number, damage: number): void {
    const m = monsters.get(monsterId);
    if (m) {
      m.hp = Math.max(0, m.hp - damage);
      m.stateBar = true;
    }
  }

  /**
   * S2C_AttackStart 旁观同步（design-player-combat.md §6.5）：
   * attackerId 为视野内远端玩家 → 起手即触发挥拳（按 attackSpeed 对应时长变速）+ 朝 targetId 怪转向。
   * 自机（attackerId=self）忽略：自机挥拳由本地攻击循环驱动，避免双重触发。
   */
  function signalAttackStart(attackerId: number, targetId: number, attackSpeed: number, animIndex = 0, animClip = ''): void {
    if (attackerId === selfPlayerId) return;
    const actor = remotes.get(attackerId);
    if (!actor) return;
    // 攻击者**自己播的那一条**（随 C2S_AttackStart 上报、服务端透传）→ 旁观者直接播同一条，
    // 不再本地重跑匹配器（否则各客户端各自随机，同一刀在不同客户端上动作/长度都不一样）。
    const specified = animIndex > 0 ? actor.motionList.find((m) => m.index === animIndex) ?? null : null;
    if (animIndex > 0 && !specified) {
      reportFallback('anim', `远端 id=${actor.playerId} 攻击动画条目 #${animIndex} 在本地动作表里不存在`
        + `（job=${actor.jobId}）→ 回退本地匹配（两端动画数据版本可能不一致）`);
    }
    const started = specified ? actor.animState.playMotion(specified) : actor.animState.triggerAttack(true);
    if (specified) verifyRemoteAnimData(actor, animClip);
    if (started) {
      const m = actor.animState.getCurrentMotion();
      if (m) {
        actor.animRate = attackRate(m, attackSpeed || 0);
        // 本次攻击的逐段音效状态：段序号来自动画事件帧，结果来自服务端计划（见 playRemoteAttackSegment）
        // 计划通常先到（服务端先发计划、再广播起手）；**超过 2s 的作废** —— 否则一次被拒/放弃的
        // 起手会把它的计划留到下一次挥拳上（那一段的结果音就会按上一次的裁定播）。
        const pending = actor.pendingAttackPlan;
        actor.attack = {
          motion: m,
          eventFrames: Array.from(m.eventFrame).filter((f) => f > 0),
          hitFired: 0,
          targetId,
          projFired: false,
          plan: pending && performance.now() - pending.at < 2000 ? pending.map : null,
          voices: new Map(),
          optimistic: new Set(),
        };
        actor.pendingAttackPlan = null;
      }
    }
    const mon = monsters.get(targetId);
    if (mon) {
      // 朝向 = 由两点求水平角（唯一实现 `core/geom.faceAngleOf`）——
      // 本文件原有 4 处同式内联 `Math.atan2(dx, dz)`，属 AGENTS #15 的"同一判定出现第二份"
      actor.faceAngle = faceAngleOf(actor.root.position, mon.root.position);
    }
  }

  /**
   * 播远端玩家攻击的**这一段**结果音（原版 WeaponPlaySound 在命中帧，每段一次）。
   * 有服务端计划 → 直接播正确结果（miss 挥空 / hit 武器音 / crit 追加暴击音），无需等往返；
   * 计划未到（旧服务端/丢包）→ **乐观按命中播**并上报降级，计划迟到时由 applyRemoteAttackPlan 纠正。
   */
  function playRemoteAttackSegment(actor: RemoteActor): void {
    if (!actor.attack) return;
    const seg = actor.attack.hitFired;
    const planned = actor.attack.plan?.get(seg);
    const idcode = actor.appearance?.weaponIdcode ?? 0;
    const pos = actor.root.position;
    if (planned?.missed) {
      sfx.playWeaponMiss(handTypeOfIdCode(idcode), { pos });
      return;
    }
    const code = weaponSoundCode(
      weaponTypeOfIdCode(idcode), handTypeOfIdCode(idcode),
      actor.jobId === 7 || actor.jobId === 8, idcode,
    );
    const voice = sfx.playWeaponAttack(code, { pos });
    if (voice) actor.attack.voices.set(seg, voice);
    if (lookCritOf(planned)) sfx.playCritical({ pos });
    if (!planned) {
      actor.attack.optimistic.add(seg);
      reportFallback('anim', `远端攻击 id=${actor.playerId} 第 ${seg} 段：计划未到 → 乐观按命中播音（结果包到达前无法判定 miss/暴击）`);
    }
  }

  /**
   * 远端攻击计划（S2C_AttackPlan 的旁观分支）。
   * 常见次序是"计划先到、起手广播后到"（服务端先发计划）→ 暂存待起手消费；
   * 若起手已在播（计划迟到）→ 立即挂到本次攻击，并**纠正**此前乐观播出的段。
   */
  function applyRemoteAttackPlan(actor: RemoteActor, segments: ArrayLike<{ index?: number | null; missed?: boolean | null; isCritical?: boolean | null; attackEffect?: boolean | null }>): void {
    const map = new Map<number, CritLookSeg>();
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i]!;
      map.set(Number(s.index ?? i), { missed: !!s.missed, critical: !!s.isCritical, attackEffect: !!s.attackEffect });
    }
    const atk = actor.attack;
    if (!atk || atk.hitFired === 0) {
      // 起手还没发生（或还没走到第一个事件帧）→ 直接挂上
      if (atk) atk.plan = map;
      else actor.pendingAttackPlan = { map, at: performance.now() };
      return;
    }
    atk.plan = map;
    // 纠正乐观段：当时按"命中"播的音，若计划说 miss/暴击 → 换掉/追加
    for (const seg of atk.optimistic) {
      if (seg >= atk.hitFired) continue;
      const p = map.get(seg);
      if (!p) continue;
      const voice = atk.voices.get(seg);
      if (p.missed) {
        voice?.stop(40);
        atk.voices.delete(seg);
        sfx.playWeaponMiss(handTypeOfIdCode(actor.appearance?.weaponIdcode ?? 0), { pos: actor.root.position });
      } else if (lookCritOf(p)) {
        sfx.playCritical({ pos: actor.root.position });
      }
    }
    if (atk.optimistic.size) {
      console.log(`[计划] 远端 id=${actor.playerId} 计划迟到（已乐观播 ${atk.optimistic.size} 段）→ 已按计划纠正`);
      atk.optimistic.clear();
    }
  }

  /**
   * S2C_Damage 受击硬直（§6.4）：targetId 为自机或远端玩家 → 站立/走/跑时播受击动画，
   * 攻击/技能/受击中不打断（状态机 triggerDamage 内建守卫）；damage<=0（抵抗/吸收）不播。
   */
  function onTakeDamage(targetId: number, damage: number): void {
    // 受击硬直只在**有效伤害**时触发 —— 原版 character.cpp:8463：
    //   `... && cnt > 1` 才 SetMotionFromCode(CHRMOTION_STATE_DAMAGE)（cnt = 吸收后、下限 1 的实际伤害）。
    // 所以扣 1 点血的一刀**不定身**、也不播受击音：低等级怪被高等级玩家的防御压到 1 点时，
    // 摸一下就把人定住的现象由此消除（用户 2026-09-12 指出）。
    if (damage <= 1) return;
    const job = getGameSnapshot().character?.job ?? 0;
    if (targetId === selfPlayerId) {
      animState?.triggerDamage();
      // 受击音（原版 CharPlaySound：wav/effects/player/<职业>/damage N.wav）
      sfx.playPlayerSound(job, 'CHRMOTION_STATE_DAMAGE', selfPos);
      return;
    }
    const actor = remotes.get(targetId);
    if (actor) {
      actor.animState.triggerDamage();
      sfx.playPlayerSound(actor.jobId ?? 0, 'CHRMOTION_STATE_DAMAGE', actor.root.position);
    }
  }

  // ==================== 伤害/躲闪飘字（对齐原版 SHOW_DMG：头顶 1s 上飘 + 线性淡出） ====================
  // 字号：暴击 = 普通伤害的 2 倍（要一眼看出来）。描边按字号等比放大，否则大字会被细描边糊住。
  const FLOATER_PX_MONSTER = 21;   // 怪物/玩家头顶的普通伤害
  const FLOATER_PX_SELF = 19;      // 自机与远端玩家的受击/治疗（层级低一档）
  const FLOATER_CRIT_SCALE = 2;
  interface DmgFloater {
    kind: 'self' | 'monster' | 'remote';
    id: number;
    text: string;
    color: string;
    font: string;
    px: number;            // 字号（px）：描边宽度按它等比算
    born: number;
    life: number;
    /** 生成时记下的世界坐标 —— 实体消失（怪被击杀）后飘字改用它的锚点，飘完再消失 */
    wx: number;
    wy: number;
    wz: number;
    /** 屏幕空间方向（攻击者在被攻击者的哪一侧）；null 时保持原版垂直上飘 */
    dir: { x: number; y: number } | null;
    crit: boolean;
  }
  const floaters: DmgFloater[] = [];
  const _floaterWp = new THREE.Vector3();

  /** 飘字锚点 = 实体当前头顶锚（每帧重解析，始终贴角色）；实体已消失 → 用生成时记下的固定坐标 */
  function floaterAnchor(f: DmgFloater): { root: THREE.Object3D; topY: number } | { fx: number; fy: number; fz: number } | null {
    if (f.kind === 'self') {
      return charGroup && charGroup.visible ? { root: charGroup, topY: selfTopY } : { fx: f.wx, fy: f.wy, fz: f.wz };
    }
    if (f.kind === 'monster') {
      const m = monsters.get(f.id);
      return m && m.root.visible ? { root: m.root, topY: m.topY } : { fx: f.wx, fy: f.wy, fz: f.wz };
    }
    const r = remotes.get(f.id);
    return r && r.root.visible ? { root: r.root, topY: r.topY } : { fx: f.wx, fy: f.wy, fz: f.wz };
  }

  /** 入一只飘字；kind=null 时按 targetId 自动解析归属；不在视野的实体直接丢弃（原版服务端 64 格 AOI 过滤的等价物） */
  // ── 进入地图大字提示（中上部，淡入→停→淡出）──
  // 门控：冷却期内（含边缘 A↔B 往返）不重刷；同图不重复提示。
  const MAP_BANNER_FADE_IN_MS = 350;
  const MAP_BANNER_HOLD_MS = 2600;
  const MAP_BANNER_FADE_OUT_MS = 900;
  /**
   * 同一张图的冷却 —— **只做防抖，不做"限制"**：它只需要挡住"贴着边界来回蹭"
   * （跨越一次至少得跑过去再掉头，本来就有跑动时间），所以取 2 秒足够。
   * **按图分别计时**（不是全局一个时间戳）—— 全局时间戳会把"刚去过 A，现在第一次进 B"
   * 也当成刷屏而**吃掉 B 的提示**（那正是"换图了却没字"的成因之一）。
   * 别把这值调大：走过一张图再回来（回城买东西再出门、进副本打完出来）本来就该再报一次。
   */
  const MAP_BANNER_COOLDOWN_MS = 2000;
  let mapBanner: { mapId: number; name: string; born: number } | null = null;
  const mapBannerShownAt = new Map<number, number>();   // mapId → 上次弹的时刻

  function showMapBanner(mapId: number): void {
    if (!Number.isFinite(mapId)) return;   // ⚠ 不是 `!mapId`：地图 0 合法（同 enterMap）
    const now = performance.now();
    const last = mapBannerShownAt.get(mapId) ?? -Infinity;
    if (now - last < MAP_BANNER_COOLDOWN_MS) return;   // 同一张图冷却内不重弹（边缘往返防刷）
    const key = `map.${mapId}`;
    const localized = t(key);
    const name = localized === key ? `Map ${mapId}` : localized;        // 缺翻译回退 Map N
    mapBanner = { mapId, name, born: now };
    mapBannerShownAt.set(mapId, now);
  }

  function drawMapBanner(ctx: CanvasRenderingContext2D, now: number, w: number, h: number): void {
    if (!mapBanner) return;
    const el = now - mapBanner.born;
    const total = MAP_BANNER_FADE_IN_MS + MAP_BANNER_HOLD_MS + MAP_BANNER_FADE_OUT_MS;
    if (el >= total) { mapBanner = null; return; }
    let alpha: number;
    if (el < MAP_BANNER_FADE_IN_MS) alpha = el / MAP_BANNER_FADE_IN_MS;
    else if (el < MAP_BANNER_FADE_IN_MS + MAP_BANNER_HOLD_MS) alpha = 1;
    else alpha = Math.max(0, 1 - (el - MAP_BANNER_FADE_IN_MS - MAP_BANNER_HOLD_MS) / MAP_BANNER_FADE_OUT_MS);
    const px = Math.max(30, Math.round(w * 0.028));   // 大字：随视口宽缩放
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `bold ${px}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const x = w / 2, y = Math.round(h * 0.16);
    ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    ctx.lineWidth = Math.max(5, Math.round(px * 0.18));
    ctx.strokeText(mapBanner.name, x, y);
    ctx.fillStyle = '#f3e9c8';
    ctx.fillText(mapBanner.name, x, y);
    ctx.restore();
  }

  function showFloater(kind: 'self' | 'monster' | 'remote' | null, id: number, text: string, color: string, crit: boolean, attackerId?: number): void {
    let k = kind;
    if (!k) {
      if (id === selfPlayerId) k = 'self';
      else if (monsters.has(id)) k = 'monster';
      else if (remotes.has(id)) k = 'remote';
      else return;
    }
    const px = crit
      ? FLOATER_PX_MONSTER * FLOATER_CRIT_SCALE
      : k === 'monster'
        ? FLOATER_PX_MONSTER
        : FLOATER_PX_SELF;
    const font = `italic 700 ${px}px Verdana, "Microsoft YaHei", sans-serif`;
    // 记下生成瞬间的世界坐标：实体随后消失（怪被击杀）时飘字仍有锚点可用，能飘完再消失。
    let wx = 0, wy = 0, wz = 0;
    if (k === 'self' && charGroup) {
      charGroup.getWorldPosition(_floaterWp);
      wx = _floaterWp.x; wy = _floaterWp.y + selfTopY; wz = _floaterWp.z;
    } else if (k === 'monster') {
      const m = monsters.get(id);
      if (m) { wx = m.root.position.x; wy = m.root.position.y + m.topY; wz = m.root.position.z; }
    } else {
      const r = remotes.get(id);
      if (r) { wx = r.root.position.x; wy = r.root.position.y + r.topY; wz = r.root.position.z; }
    }
    // 生成时算出漂移方向（此时双端都在场；目标随后可能消失，方向按这个瞬间定格）。
    // 攻击者是玩家（自机 / 远端）才有方向；怪打玩家（无 attack）保持原版垂直上飘。
    let dir: { x: number; y: number } | null = null;
    if (attackerId) {
      const t = worldToScreen(wx, wy, wz);
      let awx = 0, awy = 0, awz = 0, aok = false;
      if (attackerId === selfPlayerId) {
        if (charGroup && charGroup.visible) {
          charGroup.getWorldPosition(_floaterWp);
          awx = _floaterWp.x; awy = _floaterWp.y + selfTopY; awz = _floaterWp.z; aok = true;
        }
      } else {
        const a = remotes.get(attackerId);
        if (a && a.root.visible) { awx = a.root.position.x; awy = a.root.position.y + a.topY; awz = a.root.position.z; aok = true; }
      }
      if (aok && t) {
        const a = worldToScreen(awx, awy, awz);
        if (a) dir = dirFromTo(a.x, a.y, t.x, t.y);   // 攻击者 → 受击者，朝向 = 击退方向
      }
    }
    while (floaters.length >= 64) floaters.shift(); // 防爆上限
    floaters.push({ kind: k, id, text, color, font, px, born: performance.now(), life: 1000, wx, wy, wz, dir, crit });
  }

  /** 每帧绘制名牌 + 血条（在 3D 画面渲染完成后调用；Canvas overlay 压制 DOM/React） */
  /** 本帧所有名牌的屏幕矩形（供鼠标拾取：指向名牌 = 指向目标）；每帧重建 */
  const nameplateHits: { x: number; y: number; w: number; h: number; root: THREE.Object3D; color: number; cursor: 'default' | 'pickup' | 'attack' | 'talk' }[] = [];

  /** 记录一块名牌的命中区（与绘制出的矩形同源） */
  function recordPill(box: { x: number; y: number; w: number; h: number } | null, root: THREE.Object3D, color: number, cursor: 'default' | 'pickup' | 'attack' | 'talk'): void {
    if (!box) return;
    nameplateHits.push({ ...box, root, color, cursor });
  }

  function drawNameplateOverlay(): void {
    const ctx = npCtx;
    if (!ctx) return;
    const ov = npOverlay!;
    const W = ov.clientWidth, H = ov.clientHeight;
    if (W <= 0 || H <= 0) return;
    ctx.clearRect(0, 0, W, H);
    nameplateHits.length = 0;               // 每帧重建（与绘制同步）
    const now = performance.now();

    // 掉落物：hover 命中 或 A 键开启且在附近范围内 → 白字名牌
    for (const g of groundItems.values()) {
      if (!g.root.visible) continue;
      const hovered = hoverTarget?.root === g.root;
      if (!hovered) {
        if (!groundItemLabelsOn) continue;
        const dx = g.root.position.x - selfPos.x, dz = g.root.position.z - selfPos.z;
        if (dx * dx + dz * dz > NAME_TAG_RANGE * NAME_TAG_RANGE) continue;
      }
      const pt = anchorToScreen(g.root, g.topY);
      if (!pt) continue;
      recordPill(drawPill(ctx, pt.x, pt.y, g.label || g.name || '', {
        nameColor: '#ffffff', showHp: false, ratio: 1, selected: hovered,
      }), g.root, HOVER_COLOR_ITEM, 'pickup');
    }

    // NPC：名牌 12 格(768)内常显（浅蓝），选中/悬停不受距离限制；对齐 exm NPC RendPoint.z < 12*64*fONE
    for (const a of npcs.values()) {
      if (!a.root.visible) continue;
      const sel = isSelected(a.root);
      if (!sel) {
        const dx = a.root.position.x - selfPos.x, dz = a.root.position.z - selfPos.z;
        if (dx * dx + dz * dz > NPC_TAG_RANGE * NPC_TAG_RANGE) { continue; }
      }
      const pt = anchorToScreen(a.root, a.topY);
      if (!pt) { continue; }
      recordPill(drawPill(ctx, pt.x, pt.y, t(`npc.${a.nameKey}.name`), {
        nameColor: sel ? '#ffffff' : '#a8d8ff',
        showHp: false, ratio: 0, selected: sel,
      }), a.root, HOVER_COLOR_NPC, 'talk');
    }

    // 怪物：范围内常显；远处仅"悬停/点击选中"才显示（对齐 exm：普通怪名的默认行为是选中才显示）
    for (const a of monsters.values()) {
      if (!a.root.visible || a.dead) continue;   // 尸体不挂名牌/血条（原版血条按 Life 判定，尸体已不参与）
      const dx = a.root.position.x - selfPos.x, dz = a.root.position.z - selfPos.z;
      const far = dx * dx + dz * dz > NAME_TAG_RANGE * NAME_TAG_RANGE;
      const sel = isSelected(a.root);
      if (far && !sel) continue;
      const pt = anchorToScreen(a.root, a.topY);
      if (!pt) { continue; }
      const showHp = sel || a.stateBar || (a.maxHp > 0 && a.hp < a.maxHp);
      recordPill(drawPill(ctx, pt.x, pt.y, a.name || '', {
        nameColor: '#ff8080',
        showHp,
        ratio: a.maxHp > 0 ? a.hp / a.maxHp : 1,
        selected: sel,
      }), a.root, HOVER_COLOR_MONSTER, 'attack');
    }

    // 远端玩家：名牌常显（淡黄），选中变白；血条 = 血不满；有公会显示公会名
    for (const a of remotes.values()) {
      if (!a.root.visible) continue;
      const pt = anchorToScreen(a.root, a.topY);
      if (!pt) { continue; }
      const sel = isSelected(a.root);
      recordPill(drawPill(ctx, pt.x, pt.y, a.name || '', {
        nameColor: sel ? '#ffffff' : '#ffe9a8',
        clan: a.clanName || undefined,
        showHp: a.maxHp > 0 && a.hp < a.maxHp,
        ratio: a.maxHp > 0 ? a.hp / a.maxHp : 1,
        selected: sel,
      }), a.root, HOVER_COLOR_PLAYER, 'default');
    }

    // 自机：名牌常显；血条 = 战斗中（3s 窗口）或血不满
    if (charGroup && charGroup.visible && selfName) {
      const pt = anchorToScreen(charGroup, selfTopY);
      if (pt) {
        drawPill(ctx, pt.x, pt.y, selfName, {
          nameColor: '#ffe9a8',
          showHp: now < selfCombatUntil || (selfMaxHp > 0 && selfHp < selfMaxHp),
          ratio: selfMaxHp > 0 ? selfHp / selfMaxHp : 1,
          selected: false,
        });
      }
    }

    // 伤害/躲闪飘字：起点在头顶，1s 内线性淡出（对齐原版 SHOW_DMG 动画）；
    // 打击感 = 初始弹跳（前 bounceMs 内 S 倍 → 略回收 <1 → 回 1）+ 暴击金闪 + 沿"攻击者 → 受击者"方向漂移。
    // 目标是活体 → 每帧跟它的头顶；实体已消失（怪被击杀）→ 用生成时记下的固定世界坐标，
    // 让这一条**飘完再消失**（用户 2026-09-14：击杀瞬间伤害数字/miss 字样不该闪掉）。
    if (floaters.length) {
      const cfg = dmgFxGet();
      const keep: DmgFloater[] = [];
      for (const f of floaters) {
        const el = now - f.born;
        if (el >= f.life) continue;
        const a = floaterAnchor(f);
        if (!a) continue;
        const pt = 'root' in a ? anchorToScreen(a.root, a.topY) : worldToScreen(a.fx, a.fy, a.fz);
        if (!pt) continue;
        const t = el / f.life;
        const s = f.crit
          ? bounceScale(now, f.born, cfg.scaleCrit, cfg.bounceMs)
          : bounceScale(now, f.born, cfg.scaleNormal, cfg.bounceMs);
        // 垂直 = "弹起 → 加速掉落"的弧线（popArc，落在头顶之下）；有攻击者方向再叠加横向漂移
        const bobY = popArc(t, cfg.upPeak, cfg.dropDepth);
        let x = pt.x;
        if (f.dir) {
          const drift = easeOutCubic(t) * (f.crit ? cfg.driftCrit : cfg.driftNormal);
          x = pt.x + f.dir.x * drift;
        }
        const y = pt.y - 10 - bobY;
        ctx.globalAlpha = Math.max(0, 1 - t);
        ctx.font = f.font;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (s !== 1) {   // 弹跳只在出生段发生；s===1 时省掉整组变换
          ctx.save();
          ctx.translate(x, y);
          ctx.scale(s, s);
          ctx.translate(-x, -y);
        }
        // 右下角软阴影（替代黑描边，用户 2026-09-18）：偏移/模糊随字号等比，便于大字在亮背景上分离
        ctx.shadowColor = 'rgba(0,0,0,0.4)';
        ctx.shadowOffsetX = f.px * 0.09;
        ctx.shadowOffsetY = f.px * 0.11;
        ctx.shadowBlur = f.px * 0.07;
        ctx.fillStyle = f.color;
        ctx.fillText(f.text, x, y);
        ctx.shadowColor = 'transparent';   // 清掉 canvas 阴影状态，避免污染同画布后续绘制
        if (s !== 1) ctx.restore();
        ctx.globalAlpha = 1;
        if (s !== 1) ctx.restore();
        ctx.globalAlpha = 1;
        keep.push(f);
      }
      floaters.length = 0;
      for (const f of keep) floaters.push(f);
    }

    // 进入地图大字提示：画面中上部，淡入→停→淡出；带冷却门控（边缘往返不重刷）
    drawMapBanner(ctx, now, W, H);
  }

  function spawnGroundItem(groundItemId: number, name: string, x: number, y: number, z: number, dorpItem: string, itemId: number, quantity: number, money: number): void {
    if (!scene) {
      pendingGroundItems.push({ groundItemId, name, x, y, z, dorpItem, itemId, quantity, money });
      return;
    }
    if (groundItems.has(groundItemId)) return;
    // 名牌文本：**金币**显示金额（`Gold 1000`）、**可堆叠物**显示堆叠数（`红药水 x50`）、单件不加后缀。
    // 数值格式直写，不进 locale —— 与背包格（纯数字）、`CharStatusPanel`（`×{n}`）同一惯例：
    // locale 管文案，不管数字格式。
    const label = money > 0 ? `${name} ${money}` : (quantity > 1 ? `${name} x${quantity}` : name);
    void (async () => {
      try {
        const res = await loadDropItemModel(dorpItem || null);
        await loadTextures(res.texturesToLoad);
        if (groundItems.has(groundItemId)) return; // 加载期间已被 despawn

        const root = new THREE.Group();
        root.position.set(x, y + GROUND_LIFT, z); // 原版 posY + 6 单位固定微抬
        root.userData.pickupItemId = groundItemId;

        // 水平朝向：原版 `Angle.y = ((pX + pZ) >> 2) & ANGCLIP` —— 由**落点**决定，
        // 同一个坐标恒同朝向（不是随机）。x/z 是世界单位，×256 还原成原版定点数再做整数位移，
        // 保持与原版逐位一致（Math.floor 对齐 C 的算术右移对负数的向负取整）。
        const pivot = new THREE.Group();
        const rawAngle = ((Math.floor(x * 256) + Math.floor(z * 256)) >> 2) & 0xFFF;
        pivot.rotation.y = rawAngle / 0xFFF * Math.PI * 2;

        const model = res.group;
        // **只有武器**绕 X 转 90° 躺平（原版 `angle.iX = ANGLE_90`）。
        // 其余大类（防具/盾/药水/宝石/金币/卷轴…）保持模型原始竖立姿态 —— 原版从不给它们 angle.x。
        if (itemBaseOf(itemId) === ITEMBASE_WEAPON) {
          model.rotation.x = Math.PI / 2; // 立轴 → 平躺地面
        }
        model.position.y = 0;
        pivot.add(model);
        root.add(pivot);
        // 名牌锚点：按旋转后的实际顶高（武器平躺→贴近地面；竖立件→抬到模型顶上）
        const topY = modelTopY(model) + 0.5;

        scene!.add(root);
        root.userData.kind = 'item'; // 场景对象分类标签（调试/诊断用；悬停与点击的判定走 pickTargetAt 的屏幕矩形）

        // 收集可提亮材质（对齐 scITEM::Draw 的 Color+=100 白闪：周期整体提亮）
        const mats: { mat: THREE.MeshPhongMaterial; base: THREE.Color }[] = [];
        res.group.traverse(o => {
          const mesh = o as THREE.Mesh;
          const mat = mesh.material as THREE.MeshPhongMaterial | undefined;
          if (mesh.isMesh && mat && mat.color) {
            mats.push({ mat, base: mat.color.clone() });
          }
        });

        groundItems.set(groundItemId, { groundItemId, name, label, root, topY, model, blinkOn: false, mats });
        console.log('[WorldView] 地面物品出现: id=' + groundItemId + ' name=' + name
          + ' label=' + label
          + ' dorp=' + (dorpItem || '(flag)')
          + ' idcode=0x' + (itemId >>> 0).toString(16).padStart(8, '0')
          + ' pose=' + (itemBaseOf(itemId) === ITEMBASE_WEAPON ? '躺平' : '竖立')
          + ' @(' + x.toFixed(2) + ',' + y.toFixed(2) + ',' + z.toFixed(2) + ')');
      } catch (e) {
        console.warn('[WorldView] 地面物品加载失败 id=' + groundItemId + ' name=' + name, e);
      }
    })();
  }

  function despawnGroundItem(groundItemId: number): void {
    const g = groundItems.get(groundItemId);
    if (g) {
      scene?.remove(g.root);
      groundItems.delete(groundItemId);
      console.log('[WorldView] 地面物品消失: id=' + groundItemId);
    }
    // 正在追的物品已被拾取/消失 → 取消目标（物品已入包，人停在原地）
    if (moveTarget?.kind === 'item' && moveTarget.id === groundItemId) {
      moveTarget = null;
      moveStuckStart = 0;
    }
  }

  /** 每帧：掉落物高亮闪烁（scITEM::Draw 的周期提亮，非旋转动画） */
  function updateGroundItems(nowMs: number): void {
    const on = Math.floor(nowMs / GROUND_BLINK_MS) % 2 === 0;
    for (const g of groundItems.values()) {
      if (g.blinkOn === on || g.mats.length === 0) continue;
      g.blinkOn = on;
      const k = on ? 1.8 : 1;
      for (const { mat, base } of g.mats) mat.color.copy(base).multiplyScalar(k);
    }
  }

  function applyMonsterMove(monsterId: number, x: number, y: number, z: number, angle: number,
                            animState: number, animIndex = 0): void {
    const actor = monsters.get(monsterId);
    if (!actor) return;
    const lastSnap = actor.snaps[actor.snaps.length - 1];
    if (lastSnap && performance.now() - lastSnap.t > REMOTE_RESYNC_MS) {
      actor.snaps.length = 0;
    }
    // `animIndex` = **服务端选定的动画条目**（攻击时才有；见 S2C_MonsterMove.anim_index）。
    // 有它就照播那一条 —— 与玩家 `anim_index` 同一条链路（服务端决定，客户端不自己选）。
    actor.snaps.push({ t: performance.now(), x, y, z, angle, anim: animState, animIndex });
    if (actor.snaps.length > 32) actor.snaps.shift();
  }

  /** 每帧：怪物演员按快照插值渲染 + 动画推进（同远端玩家管线） */
  // ==================== 显示预算（谁参与渲染与骨骼求值）====================
  /**
   * 重算节拍：250ms。不必每帧 —— 轮换本来就是"每秒一批"，距离过滤在这点间隔里也不会明显滞后，
   * 而每帧给 200+ 只排序纯属浪费（这是省 CPU 的机制，不该自己先花掉一截）。
   */
  const VIS_RECOMPUTE_MS = 250;
  let visRecomputeAt = 0;
  let visResult: VisibilityResult = { visible: null, hidden: 0, tier: null, cap: Infinity, capped: false };
  let displayPrefs = loadDisplayPrefs();
  setWaveCameraEnabled(displayPrefs.shake);   // 屏幕震动的全局开关（持久化在画面设置里）

  /** 偏好变更入口（系统设置里改完立即生效，不用重进游戏） */
  function setDisplayPrefs(p: DisplayPrefs): void {
    displayPrefs = p;
    // 屏幕震动是全局开关（原版 `WaveCameraMode`）：改完**立刻**生效，关掉时正在震的那次也停
    setWaveCameraEnabled(p.shake);
    visRecomputeAt = 0; // 下一次 updateMonsters 立刻重算
  }

  /**
   * 强制可见 —— **这一条是必需的，不是可选项**：玩家正在选中/追踪/攻击的怪一旦被裁掉，
   * 他会完全不知道发生了什么（点空气打、伤害飘字连锚点都找不到）。所以这几类恒不参与裁剪：
   * 悬停目标、点选/追踪目标（含"正在打的"那只）、自机正在挥拳的目标。
   */
  function isForceVisible(a: MonsterActor): boolean {
    if (hoverTarget?.root === a.root) return true;
    const t = moveTarget;
    if (t?.kind === 'monster' && t.id === a.monsterId) return true;
    if (selfAttackTargetId === a.monsterId) return true;
    return false;
  }

  /** 按当前偏好重算"哪些怪参与渲染与骨骼求值"，并把结果写到 actor.culled / root.visible */
  function updateMonsterVisibility(nowMs: number): void {
    if (nowMs - visRecomputeAt < VIS_RECOMPUTE_MS) return;
    visRecomputeAt = nowMs;
    if (monsters.size === 0) {
      visResult = { visible: null, hidden: 0, tier: null, cap: Infinity, capped: false };
      return;
    }
    const cands: VisibilityCandidate[] = [];
    for (const a of monsters.values()) {
      const dx = a.root.position.x - selfPos.x;
      const dz = a.root.position.z - selfPos.z;
      cands.push({ id: a.monsterId, dist: Math.hypot(dx, dz), forced: isForceVisible(a) });
    }
    visResult = pickVisibleMonsters(cands, {
      enabled: displayPrefs.monsterBudget,
      tier: VIS_TIERS[displayPrefs.range],
      nowMs,
    });
    for (const a of monsters.values()) {
      const vis = visResult.visible === null || visResult.visible.has(a.monsterId);
      a.culled = !vis;
      // 渲染层也一并关掉（visible=false 的 three 对象不进 draw call）。
      // ⚠ `pickTargetAt` 的屏幕矩形判定只认 `root.visible`（它不知道 culled 这个字段），
      // 而显示预算**会真的把 visible 设成 false** ⇒ 被预算裁掉的怪同时也点不到。
      // 这是有意的：屏幕上看不见的东西不该点得中。
      a.root.visible = vis;
    }
  }

  // ==================== 动画求值热路径（零分配 + 只更新根骨）====================
  // 求值工作区（`evalWorkspaceFor`）与骨骼世界矩阵更新（`updateBoneWorlds`）已经收进
  // `char/anim-player.ts` —— 那里是**唯一一份**，自机/远端/怪物/NPC/选角预览共用。此前这里
  // 各留了一份（选角预览连 workspace 都没有，每帧新建），见该文件头部说明。

  function updateMonsters(dt: number): void {
    const now = performance.now();
    const renderT = now - REMOTE_INTERP_DELAY;
    for (const actor of monsters.values()) {
      const snaps = actor.snaps;
      if (snaps.length === 0) continue;

      let i = snaps.length - 1;
      while (i > 0 && snaps[i].t > renderT) i--;
      const s0 = snaps[i];
      let px = s0.x, py = s0.y, pz = s0.z, pAng = s0.angle;
      if (i + 1 < snaps.length) {
        const s1 = snaps[i + 1];
        const span = s1.t - s0.t;
        const f = span > 0 ? Math.max(0, Math.min(1, (renderT - s0.t) / span)) : 1;
        px = s0.x + (s1.x - s0.x) * f;
        py = s0.y + (s1.y - s0.y) * f;
        pz = s0.z + (s1.z - s0.z) * f;
        pAng = s0.angle + wrapAngle(s1.angle - s0.angle) * f;
      } else {
        const k = 1 - Math.exp(-dt / 0.06);
        const cp = actor.root.position;
        px = cp.x + (s0.x - cp.x) * k;
        py = cp.y + (s0.y - cp.y) * k;
        pz = cp.z + (s0.z - cp.z) * k;
        pAng = s0.angle;
      }
      const keepAfter = now - (REMOTE_INTERP_DELAY + 250);
      while (snaps.length > 1 && snaps[1].t < keepAfter) snaps.shift();

      actor.root.position.set(px, py, pz);
      actor.root.rotation.y = pAng;
      // 被显示预算裁掉的怪：位置/朝向照常插值（否则重新出现时会瞬移），但**到此为止** ——
      // 下面的 setRemoteMonsterAnim（状态机）与骨架求值全部跳过。省的就是这 0.075ms/只。
      // animFrame 照常推进，保证它重新出现时动作是连续的、而不是从起手帧重来。
      const motionAtCull = actor.animState.getCurrentMotion();
      if (actor.culled) {
        // 被裁掉也要推进帧（重新出现时动作才是连续的，而不是从起手帧重来）
        if (motionAtCull) actor.animFrame = advanceAnimFrame(actor.animFrame, motionAtCull, dt, actor.animRate).frame;
        continue;
      }
      setRemoteMonsterAnim(actor, s0.anim, s0.animIndex ?? 0);

      const motion = actor.animState.getCurrentMotion();
      if (motion) {
        // 换"哪一具模型"：由**当前播放条目**决定，而不是由"死没死"决定 ——
        // 原版就是这么做的（主表查不到该状态 → 用副模型的动作表 + 副模型的网格，
        // 见 MonsterActor.mainPart 注释）。独立死亡模型（`*-die`）只是这条路最常见的一种用途。
        const useSub = !!motion.subModel && !!actor.subPart;
        if (useSub !== actor.subActive) {
          actor.subActive = useSub;
          actor.mainPart.visible = !useSub;
          if (actor.subPart) actor.subPart.visible = useSub;
        }
        // 骨架/动画源必须与"正在显示的那一具"一致：副模型与主模型骨架**通常完全不同**
        // （实测 63/66），拿副模型的动作套主模型的骨头会错位。
        const partBones = useSub && actor.sub ? actor.sub.bones : actor.bones;
        const partSkel = useSub && actor.sub ? actor.sub.skeleton : actor.skeleton;
        const partSmb = useSub && actor.sub ? actor.sub.animSmb : actor.animSmb;
        // 尸体：只在"当前确实播着死亡条目"时才推进帧（推到末帧后 advanceAnimFrame 自动钳住）。
        // 模型没有 DEAD 条目时（triggerDead 失败）当前 motion 会留在死亡那一刻的 walk/idle，
        // 若照常推进它就会**继续循环/播完回站** —— 所以那种情况下一帧都不推进，原地冻住。
        const deadFrozen = actor.dead && actor.animState.getCurrentState() !== actor.animState.STATE.DEAD;
        if (!deadFrozen) {
          // 播放速率由服务端给（`attackspeed` 档位换算，客户端没这个数据）——
          // 与"服务端等动画播完的时长"同源，两边时间才对得上。
          // `raw` = **未回绕**的帧位置 —— 事件帧交叉检测必须用它（`frame` 在循环处会回绕）
          const animStep = advanceAnimFrame(actor.animFrame, motion, dt, actor.animRate);
          actor.animFrame = animStep.frame;
          // 攻击音效/特效：**每个事件帧各触发一次**（原版每帧比对 `EventFrame[0..3]`）。
          // 用 `while` 而非 `if`：一帧内跨过多个事件帧时（低帧率 / 高 animRate）不能漏。
          const compFrame = animStep.raw - motion.startFrame * 160;
          // 跨过了哪些事件帧 —— 判定本身是**共享实现**（`char/animation.crossEventFrames`），
          // 玩家侧 / 怪物 / 怪物实验室三处不再各写一遍（AGENTS #15）
          const crossed = crossEventFrames(actor.attackEventFrames, actor.attackFired, compFrame);
          actor.attackFired = crossed.fired;
          // 事件帧到了 ⇒ **事件帧阶段**的那条带子此刻才诞生（源码 `EventSkill_Monster`/`EventAttack`
          // 里才 `new cAssaMotionBlur`）—— 起手时它不该存在（Ratoo 就是这样，用户实测）
          if (crossed.hit.length) getMonsterTrails(actor).onEventFrame();
          for (const evFrame of crossed.hit) {
            // 与原版同源：同一个事件帧里既播音效也起特效（共用实现见 monster-attack-fx.ts）
            fireMonsterAttackEvent({
              modelKey: actor.modelKey, effectId: actor.monsterEffectId,
              pos: actor.root.position, facing: actor.root.rotation.y,
              // **攻击骨**（原版 `GetAttackPoint`）：`anchor: 'weapon'` 的条目（如 D_PA 的 G/Z）
              // 用它当落点 —— 取骨策略是共用的 `findAttackBone`（AGENTS #15 唯一实现）
              weaponBase: findAttackBone(actor.root),
              // **普攻还是技能**（原版是两个函数）+ 动作的 KeyCode：多技能怪靠这两个选招式/选普攻那一套
              motionKind: motion.state === ANIM_ATTACK ? 'attack' : 'skill',
              keyCode: motion.keyCode,
              // 动态光池（原版 `SetDynLight`）：此前游戏侧没建池 ⇒ 所有动态光无处落地
              effects, sfx, dynLights,
              // 本条动作的第几个事件帧（原版 `MotionEvent`）—— 有的飞出物靠它分左右（VigorBall）
              motionEvent: motionEventIndexOf(motion.eventFrame, evFrame),
              // 这一招的目标（身体中部）—— 目前只被 `code` 类特效用（如 Glacial Spike 用不到）
              aim: unitBodyAnchor(selfPlayerId),
              ...monsterTargeting(actor.root.position),
              // 代码内特效 / 飞出物 / 放箭 —— **与起手共用同一份**（见 `monsterFxCallbacks`）
              ...monsterFxCallbacks(actor, motionEventIndexOf(motion.eventFrame, evFrame)),
              // 动作音的音效桶 = **正在播的那条动作的动作态**（原版 `CharPlaySound` 用 `MotionInfo->State`）
              // ⇒ 技能动作播 `skill N.wav`、普攻播 `attack N.wav`（此前一律按普攻取，技能在播普攻音）
              motionSound: eventFrameSoundState(motion.state),
            });
          }
          actor.lastCompFrame = compFrame;
          const endFrame = motion.endFrame * 160;
          const startFrame = motion.startFrame * 160;
          if (actor.animFrame >= endFrame) {
            if (motion.repeat) {
              const len = endFrame - startFrame;
              actor.animFrame = startFrame + ((actor.animFrame - startFrame) % len);
            } else {
              const next = actor.animState.onAnimationEnd();
              if (next) actor.animFrame = next.startFrame * 160;
            }
          }
        }
        // 姿势尾巴 = 共享实现（char/anim-player.applyPose）：求值 + 施加 + 更新矩阵
        applyPose(motion.animSmb ?? partSmb, actor.animFrame, partBones, partSkel);
      }
      // **武器曳光**（原版 `cAssaMotionBlur`）—— **共享实现**（`weapon-trail.ts` 的 `MonsterTrails`，
      // 与怪物实验室同一份，AGENTS #15）。放在 `deadFrozen` 之外：不满足条件时它自己会 `hide()`
      // （带子属于某一次挥击；尸体/站立时原版没有这些对象）。
      // ⚠ 采样用**主模型**的动画包（副模型只用于尸体）；单骨求值是为了 32 段/帧不卡成 PPT。
      // ⚠ `matrixWorld` 在渲染时才更新，而这里跑在渲染之前 ⇒ 必须手动刷新，否则第一次挥击
      //   读到的是未更新的矩阵（带子跑到世界原点附近 —— 实验室里怪物恰在原点附近，这个 bug 藏得住）。
      if (motion) {
        // ⚠ **动画包必须与 `applyPose` 用的那一份相同**（上面那行是 `motion.animSmb ?? partSmb`）——
        //   怪物动作常自带动画包，用错了取到的是**另一个动作**的姿势 ⇒ 带子形状全错。
        //   （实验室侧同一约定；副模型只用于尸体，攻击/技能时就是主包。）
        const trailSmb = motion.animSmb ?? actor.animSmb;
        getMonsterTrails(actor).update({
          kind: motion.state === ANIM_ATTACK ? 'attack' : 'skill',
          keyCode: motion.keyCode,
          inAction: motion.state === ANIM_ATTACK || motion.state === CHRMOTION_STATE_SKILL,
          motion,
          frame: actor.animFrame,
          startFrame: motion.startFrame * 160,
          sampleBone: (bone, f) => {
            const bf = evalBoneFrame(trailSmb, bone, f, evalWorkspaceFor(trailSmb));
            if (!bf) return null;
            actor.root.updateWorldMatrix(true, false);
            return new THREE.Vector3(bf.ox, bf.oy, bf.oz).applyMatrix4(actor.root.matrixWorld);
          },
          addToScene: (o) => { scene?.add(o); },
        });
      }
    }
  }

  /**
   * 两端动画数据同代校验：对端上报的语义 ID（clip）在本端找不到 → **明确上报**。
   * 索引能对上并不保证数据同源（条目顺序/数量变了仍可能命中错的那一条），
   * 语义 ID 让"两端资产不同代"这件事在日志里可见，而不是表现为"动画莫名其妙不对"。
   */
  function verifyRemoteAnimData(actor: RemoteActor, clip: string): void {
    if (!clip) return;
    const entries = semanticEntriesForJob(actor.jobId);
    if (entries.length && !entries.some((e) => e.clip === clip)) {
      reportFallback('anim', `远端 id=${actor.playerId} 上报语义动画 ${clip} 不在本地语义数据里`
        + `（job=${actor.jobId}）→ 两端动画数据不同代，条目索引可能已错位`);
    }
  }

  /** 该远端是否仍挂在场上（异步加载后校验，防止把武器挂到已移除的骨架上） */
  function remoteAlive(actor: RemoteActor): boolean {
    return remotes.get(actor.playerId) === actor;
  }

  /**
   * 挂载远端玩家的主手/副手武器。骨规则与自机**同源**（主手走 `WeaponMount`，副手走
   * `offMountBoneOf`），初始姿态按当前区域；之后由状态机 onStanceChange 驱动持械/收械搬运。
   * 旧实现只用 `weaponPos===2 ? 左手 : 右手` 挂主手、完全不管副手，也不随姿态搬运。
   */
  async function mountRemoteWeapon(actor: RemoteActor): Promise<void> {
    const app = actor.appearance;
    if (!app) return;
    const root = actor.root;
    const sheathed = currentFieldState() === 1;
    if (actor.offHandGroup) {
      actor.offHandGroup.parent?.remove(actor.offHandGroup);
      actor.offHandGroup = null;
    }
    const idcode = app.weaponIdcode ?? 0;
    const stance: 'combat' | 'sheathed' = sheathed ? 'sheathed' : 'combat';

    // ---- 主手（含双手武器的镜像份）----
    let mainGroup: THREE.Group | null = null;
    if (app.weaponDorp) {
      try {
        const wres = await loadWeaponModel(app.weaponDorp);
        await loadTextures(wres.texturesToLoad);
        if (!remoteAlive(actor)) return;
        mainGroup = wres.group;
      } catch (e) {
        console.warn('[WorldView] 远端武器加载失败: id=' + actor.playerId + ' dorp=' + app.weaponDorp, e);
      }
    }
    const mainRes = actor.weaponMount.mount(root, mainGroup, idcode, app.weaponPos, stance);
    if (mainRes.missingBone) {
      reportFallback('mount', `远端主手挂点缺失 id=${actor.playerId} dorp=${app.weaponDorp} 目标骨=${mainRes.missingBone}（已按回退链挂载）`);
    }

    // ---- 副手（盾 → 左臂；匕首 → 战斗左手 / 收械左腰）----
    const offDorp = app.offHandDorp;
    const offKind = app.offHandKind || 0;
    if (offDorp && offKind !== 0) {
      try {
        const ores = await loadWeaponModel(offDorp);
        await loadTextures(ores.texturesToLoad);
        if (!remoteAlive(actor)) return;
        const boneName = offMountBoneOf(idcode, offKind, stance);
        const bone = findBone(root, boneName)
          || findBone(root, WEAPON_BONES.LEFT_HAND)
          || findBone(root, WEAPON_BONES.SHIELD);
        if (bone) {
          actor.offHandGroup = ores.group;
          bone.add(ores.group);
        } else {
          reportFallback('mount', `远端副手挂点缺失 id=${actor.playerId} kind=${offKind} bone=${boneName}`);
        }
      } catch (e) {
        console.warn('[WorldView] 远端副手挂载失败: id=' + actor.playerId + ' dorp=' + offDorp, e);
      }
    }

    // 武器就位 → 按当前状态重选动画实例（持剑站姿 / 收械姿态等）
    if (remoteAlive(actor)) actor.animState.reselectForCurrentState();
  }

  /** 远端武器姿态切换（主手走 WeaponMount，副手走 moveOffHandForStance —— 与自机同一实现） */
  function setRemoteWeaponStance(actor: RemoteActor, stance: 'combat' | 'sheathed'): void {
    if (actor.weaponMount.currentStance === stance) return;
    const mainRes = actor.weaponMount.setStance(actor.root, stance);
    const offRes = moveOffHandForStance({
      root: actor.root,
      off: actor.offHandGroup,
      idcode: actor.appearance?.weaponIdcode ?? 0,
      offKind: actor.appearance?.offHandKind || 0,
      stance,
    });
    const missing = mainRes.missingBone ?? offRes.missingBone;
    if (missing) {
      reportFallback('mount', `远端武器姿态 ${stance}：目标骨 ${missing} 不在骨架里 id=${actor.playerId}`);
    }
  }

  function spawnRemote(actorInfo: { playerId: number; name: string; classId: number; level: number; hp?: number; maxHp?: number; clanName?: string; clanMark?: string; x: number; y: number; z: number; angle?: number; appearance?: CharacterAppearance; animWalkRate?: number; animRunRate?: number }): void {
    if (!scene) {
      // 世界未就绪（进场竞态）：缓存待 show() 重放，而不是静默丢弃
      pendingAppears.push(actorInfo);
      return;
    }
    const pid = actorInfo.playerId;
    if (remotes.has(pid) || remoteSpawning.has(pid)) return;
    remoteSpawning.add(pid);
    void (async () => {
      try {
        // 外观：头/防具（idcode→armorNum，时装 dorp→costume body）与自机同源，武器单独挂载
        const app = actorInfo.appearance;
        const jobId = actorInfo.classId || app?.classId || 1;
        let armorNum = 1;
        let bodyInxOverride: string | null = null;
        if (app?.bodyModelIdcode && app.bodyModelIdcode > 0) {
          armorNum = armorNumFromIdCode(app.bodyModelIdcode);
        } else if (app?.bodyModel) {
          bodyInxOverride = resolveCostumeBody(app.bodyModel, jobId);
        }
        const head = app?.head || 0;
        const result = await loadCharacterModel(jobId, head, 0, armorNum, bodyInxOverride);
        // 远端可能先于自机出现，需单独加载其纹理（共享材质幂等，重复 map 无害）
        await loadTextures([...result.bodyTextures, ...result.headTextures]);
        if (remotes.has(pid)) return;

        const { bones, skeleton } = cloneBoneHierarchy(result.bones, result.skeleton);
        const bodyGroup = new THREE.Group();
        for (const m of result.bodyMeshes) bodyGroup.add(cloneSkinnedMesh(m, skeleton));
        const headGroup = new THREE.Group();
        for (const m of result.headMeshes) headGroup.add(cloneSkinnedMesh(m, skeleton));
        const root = new THREE.Group();
        const boneRoot = new THREE.Group();
        boneRoot.add(bones[0]);
        root.add(boneRoot);
        root.add(bodyGroup);
        root.add(headGroup);
        const pos = new THREE.Vector3(actorInfo.x, actorInfo.y, actorInfo.z);
        root.position.copy(pos);
        root.rotation.y = actorInfo.angle ?? 0;
        root.userData.playerId = pid; // 点选/追踪（Chase）命中用
        root.userData.kind = 'player'; // 场景对象分类标签（调试/诊断用；悬停与点击的判定走 pickTargetAt 的屏幕矩形）
        scene.add(root);

        const motionList2 = buildMotionListShared(result.animSmb, result.bipInxInfo);
        let actorObj!: RemoteActor;
        // 远端动画状态机：**getter 与自机同一套**（此前只有 getMotions/getClassId/onMotionChange
        // 三个 → 没有武器语义、也没有场所位，于是远端永远播通用/空手动画、进安全区也不换姿态）。
        const animState2 = createAnimStateMachine({
          getMotions: () => actorObj.motionList,
          getClassId: () => actorObj.jobId,
          getWeaponIdCode: () => actorObj.appearance?.weaponIdcode || 0,
          getWeaponType: () => weaponTypeOfIdCode(actorObj.appearance?.weaponIdcode),
          getHandType: () => {
            const h = handTypeOfIdCode(actorObj.appearance?.weaponIdcode);
            return h === '1H' || h === '2H' ? h : null;
          },
          getSemanticEntries: () => semanticEntriesForJob(actorObj.jobId),
          // AOI 只含同图玩家 → 本地图即远端所在地图，村庄/野外判定与自机共用同一个函数
          getFieldState: () => currentFieldState(),
          onStanceChange: (stance) => { setRemoteWeaponStance(actorObj, stance); },
          onMotionChange: (motion: MotionInfo) => { actorObj.animFrame = motion.startFrame * 160; },
        });
        actorObj = {
          playerId: pid,
          name: actorInfo.name,
          jobId,
          level: actorInfo.level,
          hp: actorInfo.hp || 0,
          maxHp: actorInfo.maxHp || 0,
          clanName: actorInfo.clanName || '',
          clanMark: actorInfo.clanMark || '',
          topY: modelTopY(root) + 0.5,
          root, bodyGroup, headGroup,
          bones, skeleton,
          animSmb: result.animSmb,
          animState: animState2,
          motionList: motionList2,
          animFrame: 0,
          animRate: 1,
          // 移动速度（0 = 服务端没给 ⇒ 退成 1 档基准，播放速率恒 1）
          animWalkRate: actorInfo.animWalkRate ?? 1,
          animRunRate: actorInfo.animRunRate ?? 1,
          faceAngle: null,
          snaps: [{ t: performance.now(), x: actorInfo.x, y: actorInfo.y, z: actorInfo.z, angle: actorInfo.angle ?? 0, anim: 0x0040 }],
          lastAnimState: 0x0040,
          lastAnimIndex: 0,
          lastUseSeq: 0,
          eatEffect: null,
          appearance: app,
          weaponMount: new WeaponMount(),
          offHandGroup: null,
          attack: null,
          pendingAttackPlan: null,
        };
        remotes.set(pid, actorObj);
        animState2.triggerIdle();
        console.log('[WorldView] 远端玩家出现: id=' + pid + ' job=' + jobId + ' name=' + actorInfo.name
          + ' weapon=' + (app?.weaponIdcode ? app.weaponIdcode.toString(16) : '(无)'));
        await mountRemoteWeapon(actorObj);
      } catch (e) {
        console.warn('[WorldView] 远端玩家加载失败 id=' + pid, e);
      } finally {
        remoteSpawning.delete(pid);
      }
    })();
  }

  function despawnRemote(playerId: number): void {
    const actor = remotes.get(playerId);
    if (actor) {
      scene?.remove(actor.root);
      remotes.delete(playerId);
    }
    remoteSpawning.delete(playerId);
    // 正在追的目标玩家离视野/登出 → 取消 Chase
    if (moveTarget?.kind === 'player' && moveTarget.id === playerId) {
      moveTarget = null;
      moveStuckStart = 0;
    }
  }

  /**
   * 开始一次新的进场（客户端发 `C2S_SelectCharacter` 时由 `main.ts` 的 `enterCharacter` 调）。
   *
   * 只做一件事：丢掉**上一局**残留的 Appear 暂存（玩家/怪物/地面物品/NPC）。
   *
   * ⚠ 为什么不能把"清暂存"和"清场景"放在一起（`clearWorldActors`，它跑在 `show()` 里）：
   * 服务端的顺序是 **先 `aoiManager.onPlayerEnter(...)` 发视野内 Appear，再发 `S2C_EnterGame`**
   * （`AccountService` 里就是 `onPlayerEnter` 在前）。于是**本局**的 Appear 会在本机世界建好之前
   * 就到达并进入暂存，等 `show()` 重放 —— 若在 `show()` 里清暂存，等于把本局刚收到的全清掉，
   * 症状就是"进场后看不到附近任何玩家/地面物品"（用户 2026-09-16 联机实测）。
   * 判据是"**这次进场之前 vs 之后**"，所以清点必须落在进场发起那一刻。
   */
  function beginWorldEnter(): void {
    pendingAppears.length = 0;
    pendingMonsterAppears.length = 0;
    pendingGroundItems.length = 0;
    pendingNpcAppears.length = 0;
  }

  // 进图重进（show 再次调用）前清场：移除上一段游戏生涯的远端演员/怪物/自机模型。
  // 小退→重进同/换号时，旧 charGroup 若不移除会残留场景（出生点出现"自己的另一个号"）。
  // ⚠ 只清**场景对象与已挂载的表**，**不动 pending* 暂存** —— 那些暂存属于本局（见 beginWorldEnter）。
  function clearWorldActors(): void {
    for (const actor of remotes.values()) {
      scene?.remove(actor.root);
    }
    remotes.clear();
    remoteSpawning.clear();

    for (const actor of monsters.values()) {
      scene?.remove(actor.root);
    }
    monsters.clear();
    monsterSpawning.clear();
    monsterCancelled.clear();
    monsterDiedDuringLoad.clear();   // 清场时同样要清 —— 否则换图后残留的 id 会把下一只同 id 的怪错当尸体

    for (const g of groundItems.values()) {
      scene?.remove(g.root);
    }
    groundItems.clear();

    for (const a of npcs.values()) {
      scene?.remove(a.root);
    }
    npcs.clear();
    npcSpawning.clear();

    if (charGroup) {
      scene?.remove(charGroup);
      charGroup = null;
      selfBodyGroup = null;
      selfHeadGroup = null;
      selfBodyArmor = null;
    }
  }

  // 每帧：远端演员按"时间戳快照插值"渲染（滞后 REMOTE_INTERP_DELAY ms）+ 动画推进
  function updateRemotes(dt: number): void {
    const now = performance.now();
    const renderT = now - REMOTE_INTERP_DELAY;
    for (const actor of remotes.values()) {
      const snaps = actor.snaps;
      if (snaps.length === 0) continue;

      // 选中最新满足 t<=renderT 的快照 s0；若有后继 s1 则线性插值
      let i = snaps.length - 1;
      while (i > 0 && snaps[i].t > renderT) i--;
      const s0 = snaps[i];
      let px = s0.x, py = s0.y, pz = s0.z, pAng = s0.angle;
      if (i + 1 < snaps.length) {
        const s1 = snaps[i + 1];
        const span = s1.t - s0.t;
        const f = span > 0 ? Math.max(0, Math.min(1, (renderT - s0.t) / span)) : 1;
        px = s0.x + (s1.x - s0.x) * f;
        py = s0.y + (s1.y - s0.y) * f;
        pz = s0.z + (s1.z - s0.z) * f;
        pAng = s0.angle + wrapAngle(s1.angle - s0.angle) * f;
      } else {
        // 无后继（移动刚停/短暂微移/上报稀疏）：向最新点指数缓动而非原地冻结 →
        // 避免"停在原地 → 新点一到直接硬跳"的小位移瞬移；连续移动不受影响（恒有后继）。
        const k = 1 - Math.exp(-dt / 0.06);
        const cp = actor.root.position;
        px = cp.x + (s0.x - cp.x) * k;
        py = cp.y + (s0.y - cp.y) * k;
        pz = cp.z + (s0.z - cp.z) * k;
        pAng = s0.angle;
      }
      // 过旧快照清理（保留至少 1 条，覆盖 100ms 延迟 + 抖动余量）
      const keepAfter = now - (REMOTE_INTERP_DELAY + 250);
      while (snaps.length > 1 && snaps[1].t < keepAfter) snaps.shift();

      actor.root.position.set(px, py, pz);
      // 挥拳期间强制朝向目标（signalAttack 算）；否则用移动快照插值角
      actor.root.rotation.y =
        (actor.animState.getCurrentState() === actor.animState.STATE.ATTACK && actor.faceAngle !== null)
          ? actor.faceAngle
          : pAng;
      setRemoteAnim(actor, s0.anim, s0.animIndex ?? 0, s0.animClip ?? '',
        s0.useSeq ?? 0, s0.useItemIdcode ?? 0);

      const motion = actor.animState.getCurrentMotion();
      if (motion) {
        // 播放速率（与自机同一套规则）：
        //   ATTACK → 保持 signalAttack 设的倍率（按攻速）；WALK/RUN → 按**实际移速 ÷ 1档**缩放
        //   （动画按 1 档做的，加速装备/药水让位移变快后步频要跟上，否则看起来在滑行）；
        //   其余 → 1。移速由 `S2C_PlayerAppear` 带来，0 = 服务端没给 ⇒ 退成 1 档（速率 1）。
        const rst = actor.animState.getCurrentState();
        if (rst === actor.animState.STATE.WALK) {
          actor.animRate = actor.animWalkRate > 0 ? actor.animWalkRate : 1;
        } else if (rst === actor.animState.STATE.RUN) {
          actor.animRate = actor.animRunRate > 0 ? actor.animRunRate : 1;
        } else if (rst !== actor.animState.STATE.ATTACK) {
          actor.animRate = 1;
        }
        // 帧推进走共享实现（与自机/检查器同一函数）—— 命中帧判定必须用未回绕的 raw
        const step = advanceAnimFrame(actor.animFrame, motion, dt, actor.animRate);
        actor.animFrame = step.frame;
        // 命中帧派发（旁观者看别人挥拳）：判定与自机同一条（compFrame 跨过事件帧），
        // 区别只是结果音来自**服务端广播的攻击计划**，而不是本机的段序号上报。
        if (actor.animState.getCurrentState() === actor.animState.STATE.ATTACK
            && actor.attack && actor.attack.motion === motion) {
          const compFrame = step.raw - motion.startFrame * 160;
          // 放箭：与自机同一条规则（事件帧前 RELEASE_LEAD_FRAMES 帧、飞行用掉这段提前量）
          if (!actor.attack.projFired && actor.attack.eventFrames.length > 0
              && compFrame >= actor.attack.eventFrames[0]! - RELEASE_LEAD_FRAMES * 160) {
            actor.attack.projFired = true;
            spawnProjectile(actor.weaponMount, actor.root, actor.appearance?.weaponIdcode ?? 0, actor.appearance?.weaponDorp ?? null,
              actor.appearance?.classId ?? null, actor.attack.targetId, actor.attack.eventFrames[0], actor.animRate,
              () => actor.attack?.plan ?? null);
          }
          while (actor.attack.hitFired < actor.attack.eventFrames.length
                 && compFrame >= actor.attack.eventFrames[actor.attack.hitFired]!) {
            playRemoteAttackSegment(actor);
            actor.attack.hitFired++;
          }
        }
        // 别人使用道具（药水）：粒子/音效在 EAT 的**事件帧**放 —— 与自机同一条规则
        if (actor.eatEffect && !actor.eatEffect.fired
            && actor.animState.getCurrentState() === actor.animState.STATE.EAT) {
          const ev = actor.eatEffect.motion.eventFrame.find((f) => f > 0);
          if (ev && step.raw - actor.eatEffect.motion.startFrame * 160 >= ev) {
            actor.eatEffect.fired = true;
            fireEatEffectAt(actor.root.position, actor.eatEffect.kind);
          }
        }
        if (step.ended) {
          if (actor.animState.getCurrentState() === actor.animState.STATE.DEAD) {
            actor.animFrame = Math.max(motion.startFrame, motion.endFrame - 1) * 160;   // 尸体停在末帧
          } else {
            const next = actor.animState.onAnimationEnd();
            if (next) actor.animFrame = next.startFrame * 160;
          }
        }
        // 姿势尾巴 = 共享实现（char/anim-player.applyPose）：求值 + 施加 + 更新矩阵
        applyPose(motion.animSmb ?? actor.animSmb, actor.animFrame, actor.bones, actor.skeleton);
      }
    }
  }

  // C 键调试：打印角色/相机状态、脚下地面/材质
  function debugDump(): void {
    const rawX = selfPos.x * 256;
    const rawZ = selfPos.z * 256;
    const rawY = selfPos.y * 256;
    console.log('========== WorldView Debug ==========');
    console.log(`[角色] mapId=${currentMapId} pos=(${selfPos.x.toFixed(2)}, ${selfPos.y.toFixed(2)}, ${selfPos.z.toFixed(2)}) raw=(${rawX.toFixed(0)}, ${rawY.toFixed(0)}, ${rawZ.toFixed(0)}) angle(rad)=${selfAngle.toFixed(4)}`);
    // 脚下地面/材质
    const cm = collisionMeshes.get(currentMapId);
    if (cm) {
      const h = cm.getFloorHeight(rawX, rawZ, rawY);
      console.log(`[脚下] 地面高度 found=${h.found} raw=${h.found ? h.height.toFixed(0) : '-'} world=${h.found ? (h.height / 256).toFixed(2) : '-'}`);
      // 找角色脚下（raw 投影）命中的三角形材质
      const idxs = cm._nearbyTriangleIdx(rawX, rawZ);
      let best: { dist: number; tri: (typeof cm.triangles)[number] } | null = null;
      for (const i of idxs) {
        const tri = cm.triangles[i];
        if (rawX < tri.minX || rawX > tri.maxX || rawZ < tri.minZ || rawZ > tri.maxZ) continue;
        const dy = rawY - tri.maxY;
        if (dy < 0) continue; // 三角形在角色上方
        if (!best || dy < best.dist) best = { dist: dy, tri };
      }
      if (best) {
        const t = best.tri;
        console.log(`[脚下材质] matIdx=${t.matIdx} nyNorm=${t.nyNorm.toFixed(3)} triY(raw)=(${t.y1},${t.y2},${t.y3})`);
      } else {
        console.log('[脚下材质] 无命中三角形（悬空？）');
      }
    }
    // 相机
    if (camera) {
      console.log(`[相机] pos=(${camera.position.x.toFixed(2)}, ${camera.position.y.toFixed(2)}, ${camera.position.z.toFixed(2)}) rot(x)=${(camera.rotation.x * 180 / Math.PI).toFixed(2)}° rot(y)=${(camera.rotation.y * 180 / Math.PI).toFixed(2)}° fov=${cam.fov} near=${camera.near} far=${camera.far} dist=${cam.dist.toFixed(1)} anx=${cam.anx.toFixed(3)} any=${cam.any.toFixed(3)}`);
    }
    console.log(`[已加载地图] ${[...mapHandles.keys()].join(', ')}`);
    console.log('=====================================');
  }

  // 掉落（对齐原版 character.cpp:1984-2009）：
  // 地面高度差 > 8*fONE 视为下落，每帧 pY -= 8*fONE（下落速度）；
  // 下落超 32*fONE 触发 FALLDOWN 动画；落地时 FALLDOWN → FallHeight>200 → FALLDAMAGE 否则 FALLSTAND。
  // 同步地图区域：加载当前图的相邻图（含 2 跳，保留回程中间图），卸载更远的图
  let regionLoading = new Set<number>();
  /**
   * 坐标落在**哪些图的 AABB 内**（全量 `allBounds`）。
   *
   * ⚠ 不能用 `findCurrentMap` 代替它：那个函数**优先看"脚下在已加载图里有没有面"**
   * （为处理桥口：图 AABB 外但网格有面），跨图边界时旧图的地面还兜着脚 → 它会一直判回旧图。
   * 而"该不该预加载某张图"要看**坐标属于谁**，不是"脚下此刻踩的是谁"。
   */
  function mapsInRange(wx: number, wz: number, r: number): number[] {
    const out: number[] = [];
    for (const [mapId, [xMin, xMax, zMin, zMax]] of allBounds) {
      // ⚠ **相交**判定，不是点包含：边界处平行于边界的墙要靠它才不会被漏掉。
      if (wx + r < xMin || wx - r > xMax || wz + r < zMin || wz - r > zMax) continue;
      out.push(mapId);
    }
    return out;
  }

  async function syncMapRegions(centerMapId: number): Promise<void> {
    // wanted = 当前图 + 直接相邻（1 跳）
    const wanted = new Set<number>([centerMapId, ...neighborMaps(centerMapId)]);
    // **玩家坐标实际落进的图也必须加载** —— 包括还没成为 currentMapId 的那张。
    // 不这么做会死锁：换图判定（findCurrentMap）用"脚下有没有面"，跨边界时一直被旧图兜住 →
    // currentMapId 不变 → syncMapRegions 不被调用 → 新图永远不加载，也就永远走不进去。
    // 用户实测：从内维斯克(navisko,9) 往东跑，古代战场(desert3,11) 一直刷不出来，重进游戏才出现
    // （重进走的是服务端给的 mapId，直接 syncMapRegions(9)，所以正常）。
    for (const id of mapsInRange(selfPos.x, selfPos.z, COLLIDE_MAP_RADIUS)) {
      wanted.add(id);
      for (const n of neighborMaps(id)) wanted.add(n);   // 即将进入的图，它的邻居也要跟上
    }
    // 记下"当前想要的图"：进行中的分帧构建据此判断自己是否已被抛弃（玩家跑远 → 取消）
    wantedMaps = wanted;
    // 加载 wanted 中未加载的图（构建是分帧的，这里 await 的是"建完"，不是"阻塞主线程建完"）
    const toLoad = [...wanted].filter(id => !mapHandles.has(id) && !regionLoading.has(id));
    if (toLoad.length) {
      regionLoading = new Set([...regionLoading, ...toLoad]);
      try {
        await Promise.all(toLoad.map(id => loadMapById(id, () => !wantedMaps.has(id))));
      } finally {
        for (const id of toLoad) regionLoading.delete(id);
      }
    }
    // **延迟卸载**：不再需要的图不立刻卸，先登记到期时间。
    // 玩家在地图边界来回走动时，wanted 会反复抖动；立即卸载会导致"卸了又装"
    // （每装一次要走一遍解析 + 分帧构建），表现为边界处的持续卡顿（用户 2026-09-13 指出）。
    const now = performance.now();
    for (const id of [...mapHandles.keys()]) {
      if (wanted.has(id)) {
        pendingUnload.delete(id);        // 又需要了 → 取消卸载
      } else if (!pendingUnload.has(id)) {
        pendingUnload.set(id, now + MAP_UNLOAD_DECAY_MS);
      }
    }
    flushPendingUnload(now);
  }

  /** 真正卸载一张地图（几何/材质/碰撞/装饰一并释放） */
  function unloadMap(mapId: number): void {
    const mh = mapHandles.get(mapId);
    if (!mh) return;
    mh.mapRenderer.dispose?.();
    mapHandles.delete(mapId);
    collisionMeshes.delete(mapId);
    collisionDebug.forgetMap(mapId);
    const dg = decorGroups.get(mapId);
    if (dg && scene) { unloadDecor(dg, scene); decorGroups.delete(mapId); }
    console.log('[WorldView] 卸载地图' + mapId);
  }

  /** 到期且仍不在需要集合里的图 → 卸载 */
  function flushPendingUnload(now: number): void {
    if (pendingUnload.size === 0) return;
    for (const [id, at] of [...pendingUnload]) {
      if (now < at) continue;
      pendingUnload.delete(id);
      if (wantedMaps.has(id)) continue;   // 这段时间里又变成需要的了 → 留着
      unloadMap(id);
    }
  }

  let frameCount = 0, fpsAcc = 0;

  // ===== 自机（方向二：客户端位置上权威）=====
  // 本地即时移动（鼠标驱动 + 本地碰撞，dt 等速 → 手感跟手）；位置按节奏上报服务端做限速校验。
  // 本地即时移动（客户端位置上权威）：完整还原方案 A 之前的跨图碰撞/贴地逻辑。
  function updateMovement(dt: number, forcedFace?: number): boolean {
    if (!camera || !renderer) return false;
    if (isRooted()) return false; // 掉落/受击硬直定身：即便 chase 传入 forcedFace 也不移动
    // 自动寻路目标帧传 forcedFace；否则按按住鼠标朝向（mouseFacing 在定身中返回 null）
    const face = forcedFace !== undefined ? forcedFace : mouseFacing();
    if (face === null) return false;
    selfAngle = face;

    const mdt = Math.min(dt, 0.1); // 掉帧/切页兜底，避免单帧超大位移
    let step = (running ? selfRunWps : selfWalkWps) * mdt; // world 步长（与服务端限速同源）

    // **追目标时不过冲**（用户 2026-09-14 实测抖动）：本帧位移若会让人踏进停步环以内，
    // 就把它缩短到刚好停在那个环上。否则满步长会把人送到"判定边界内侧一步"（如 36.5），
    // 而进入/离开判定是**每帧重算**的 —— 位置与控制有抖动时会越线来回翻，
    // 表现为角色贴着目标高频来回蹭。
    // 停步环按目标类别取：交互类（掉落物/NPC/玩家）= `INTERACT_RANGE`（要够得着判定），
    // 怪物 = `monsterStopRing(攻击距离)`（**必须落在攻击距离以内**，否则停在这儿就够不着怪，
    // 见 `game/combatRange.ts`；2026-09-15 空手/单手武器就死在这上面）。
    if (forcedFace !== undefined && moveTarget) {
      const tp = chaseTargetPos();
      if (tp) {
        const ring = moveTarget.kind === 'monster' ? monsterStopRing(selfAttackRange()) : INTERACT_RANGE;
        const gap = Math.hypot(tp.x - selfPos.x, tp.z - selfPos.z) - ring;
        if (gap <= 0) return false;                  // 已在环内 → 停住，交给交互/攻击判定
        if (step > gap) step = gap;                  // 本帧会越线 → 只走到环上
      }
    }

    const sinVal = Math.sin(selfAngle);
    const cosVal = Math.cos(selfAngle);
    const dx = sinVal * step;
    const dz = cosVal * step;
    const dist = Math.hypot(dx, dz);

    // world → collision coords（raw = world×256；z 与 world 同域）
    const sx = selfPos.x * 256;
    const sy = selfPos.y * 256;
    const sz = selfPos.z * 256;
    const rawAngle = selfAngle;

    // 一帧的位移**切成若干次 ≤MAX_SUBSTEP_RAW 的调用**。
    // 原版每 tick 只走一小步（70Hz：跑 449~592 raw，走路 175~232），碰撞粒度就是这个量级；
    // 而我们的速度上限比原版高（档位 51 → 1365 raw/帧 @60fps ≈ 原版上限 592 的 2.3 倍），
    // 一次调用走完整帧位移等于把探测点直接扔到远端 —— 高速时掠过薄墙/窄缝、跨过小台阶，
    // 掉帧时（dt 被夹到 0.1s）单次位移甚至可达 8000+ raw。故按原版粒度分子步，
    // **不改速度**，只改碰撞的采样密度。
    let remainingRaw = dist * 256;
    let moved = false;
    let curX = sx, curY = sy, curZ = sz;   // raw 坐标，逐子步推进
    while (remainingRaw > 0) {
      const stepRaw = Math.min(remainingRaw, MAX_SUBSTEP_RAW);
      // 参与判定的图 = **玩家坐标 AABB 命中**的已加载图（+ 当前图兜底，应对 AABB 缝隙/桥口）。
      // 这取代了旧的"当前图优先、被挡再试别的图"：那种做法会让另一张图给出的"能走"
      // 顶掉当前图的墙（用户实测的穿空气墙），而且每张图各跑一遍完整判定（更慢）。
      // 现在只有一份判定，任何一张图的墙都算墙 —— 与地图怎么切分无关。
      moveSources.clear();
      for (const id of mapsInRange(curX / 256, curZ / 256, COLLIDE_MAP_RADIUS)) {
        if (collisionMeshes.has(id)) moveSources.add(id);
      }
      // 当前图无条件加入：它的存在只会**多挡**（判定是"任一面命中即挡"），不会少挡；
      // 而万一坐标落在所有 AABB 之外（桥口/AABB 缝隙）或 currentMapId 判偏，它保证还有几何可用。
      if (collisionMeshes.has(currentMapId)) moveSources.add(currentMapId);
      moveCollision.setSourceIds(moveSources);
      const r = moveCollision.checkNextMove(curX, curY, curZ, rawAngle, stepRaw);
      if (r.collision) {
        // 这一小步走不动就停（保留本帧已走过的部分，不再强推剩余位移）
        break;
      }
      // 跨图边界的**等级门槛**（原版：等级不够最多只能跑到地图边缘）。
      // 判"这一步会走到哪张图"是**地图身份**的事，故仍用 findCurrentMap —— 与碰撞无关。
      // 与主服务端 `MapManager.canEnter` 同一份数据（`maplist.levelreq` 经 S2C_EnterGame.maps 下发）。
      // 未知图（表里没有）→ 不拦：宁可不挡，也不要凭空挡住玩家。
      {
        const destMap = findCurrentMap(r.x / 256, r.z / 256);
        if (destMap !== currentMapId) {
          const verdict = canEnterMap(destMap, selfLevel);
          if (verdict === 'level' || verdict === 'locked') {
            if (rafMs - lastGateMsgAt > 1500) {
              lastGateMsgAt = rafMs;
              appendSystemMessage(t(verdict === 'locked' ? 'map.notOpen' : 'map.levelTooLow',
                { level: mapLevelRequirement(destMap) ?? 0 }), Date.now());
            }
            break;   // 停在这一步（保留本帧已走的距离）
          }
        }
      }
      curX = r.x;
      // 下坡/贴地：非大幅下坠才采纳结果 y（大幅下坠交给 updateFalling 逐帧下落）
      if (r.y >= curY - 8 * 256) curY = r.y;
      curZ = r.z;
      moved = true;
      remainingRaw -= stepRaw;
    }
    if (moved) {
      selfPos.x = curX / 256;
      selfPos.y = curY / 256;
      selfPos.z = curZ / 256;
      // 换图：移动后用 AABB+高度精确判定所属地图，跨图时同步地图区域（2 跳内保留）
      const foundMap = findCurrentMap(selfPos.x, selfPos.z);
      if (foundMap !== currentMapId && rafMs - lastMapSwitch > 200) {
        lastMapSwitch = rafMs;
        // 走过去的换图：区域/音频/姿态/地图名大字都由 enterMap 一并处理
        enterMap(foundMap, '本地判图');
      }
      // 坐标已经落进某张**尚未加载**的图 → 立刻触发区域同步。
      // 这一条不能省：换图判定被"脚下有面"兜住时 currentMapId 不会变，上面那个分支永不执行，
      // 于是玩家会看到东边一片空白且再也刷不出来（用户实测的古代战场）。
      if (rafMs - lastRegionCheck > REGION_CHECK_MS) {
        lastRegionCheck = rafMs;
        if (mapsInRange(selfPos.x, selfPos.z, COLLIDE_MAP_RADIUS).some(id => !mapHandles.has(id) && !regionLoading.has(id))) {
          void syncMapRegions(currentMapId);
        }
        // 延迟卸载也在这里到期检查（与加载检查同一节奏，无需另设定时器）
        flushPendingUnload(rafMs);
      }
      // 更新角色位置
      if (charGroup) { charGroup.position.copy(selfPos); charGroup.rotation.y = selfAngle; }
      return true;
    }
    return false;
  }

  // 地面跟随 + 掉落（还原方案 A 之前的 updateFalling）：每帧把 y 贴到脚下最高地面；
  // 高于地面 >8 world 逐帧下落并进入 falling（FALLDOWN 动画），落地触发 FALLSTAND/FALLDAMAGE。
  // 下落中 mouseFacing 返回 null → 不能水平移动/转向。
  function updateFalling(): boolean {
    if (!animState) return false;
    // 当前图还没进碰撞集合（换图/传送的加载瞬时）→ 不能把"查不到地面"当成虚空往下掉，
    // 那会把角色一路丢出地图（用户实测）。等图就绪后再按正常逻辑落地。
    if (!collisionMeshes.has(currentMapId)) return false;
    const rawX = selfPos.x * 256;
    const rawZ = selfPos.z * 256;
    const pY = selfPos.y * 256;
    let groundY = -80 * 256; // 悬空 → 虚空
    groundCollision.setSourceIds(null);   // 地面：全部已加载图（取最高，范围大无副作用）
    const gh = groundCollision.getFloorHeight(rawX, rawZ, pY);
    if (gh.found) groundY = gh.height;
    const diff = pY - groundY;

    if (diff > 8 * 256) {
      // 下落中：逐帧下落（对齐原版 PHeight 8/帧），首帧触发 FALLDOWN
      selfPos.y = (pY - 8 * 256) / 256;
      if (diff > 32 * 256 && !falling) {  // > 32 才进 FALLDOWN（8~32 只有下落、不播动画）
        falling = true;
        fallHeight = diff;
        animState.triggerFallDown();
      }
      return true;
    }
    // 落地
    selfPos.y = groundY / 256;
    if (falling) {
      falling = false;
      // 落地扬尘 —— 照原版 `smCHAR::SetSmoking`（exm `character.cpp:1685-1693`，它在
      // `updateFalling` 的落地分支被调，`:1785` / `:1874`）：
      //   ① **左右各一团**（原版 `GetMoveLocation(±4 * fONE, 0, 0, 0, Angle.y, 0)`）
      //   ② 尺寸 **20 × 20**（`StartEffect(..., 20, 20, EFFECT_DUST1)`）
      //   ③ 位置 **脚下 + 8**（`pY + 8 * fONE`）
      // ⚠ 只在**真的掉落**时喷：这里的 `if (falling)` 已经把"掉落落地"与"贴地跟随"
      //（`diff <= 8`，不置 falling）分开了，后者不该有扬尘。
      // ⚠ 跑步**没有**这个效果 —— 原版脚步声事件帧里只有音效、涉水波纹、冰面脚印（`:4231-4262`）。
      if (effects) {
        const rad = ((selfAngle ?? 0) * Math.PI) / 180;
        const rx = Math.cos(rad);
        const rz = -Math.sin(rad);
        for (const side of [-4, 4]) {
          void effects.spawn('Dust1', {
            pos: {
              x: selfPos.x + rx * side,
              y: selfPos.y + 8,
              z: selfPos.z + rz * side,
            },
            size: 20,
          });
        }
      }
      if (fallHeight > 200 * 256) animState.triggerFallDamage();
      else animState.triggerFallStand();
    }
    return false;
  }

  /** 上报客户端权威移动。mode=0（停止）立即发；移动中按 MOVE_REPORT_MS 节流。
   *  anim=动画覆盖（0=按 mode 推导；下落/落地传 FALL* token 让远端播放）。 */
  /**
   * 随移动上报的动画条目 —— **只报持续姿态**（站/走/跑/掉落）。
   *
   * 攻击/技能/受击这类一次性动画**不随移动上报**（它们的条目由 C2S_AttackStart 等各自携带）：
   * 否则攻击期间偶然发出的一条移动包，会把旁观者正在播的那一挥**重置**回站姿条目。
   */
  function reportableAnimIndex(): number {
    const st = animState?.getCurrentState();
    if (st === undefined) return 0;
    const S = animState!.STATE;
    if (st === S.ATTACK || st === S.SKILL || st === S.DAMAGE || st === S.TAUNT || st === S.YAHOO) return 0;
    return animState!.getCurrentMotion()?.index ?? 0;
  }

  /** 立即上报一次（跳过节流）：带上当前动画条目 —— 状态刚切换的路径用它 */
  function reportMoveNow(mode: 0 | 1 | 2, anim = 0): void {
    opts?.onMoveInt?.(selfAngle, mode, selfPos.x, selfPos.y, selfPos.z, anim,
      reportableAnimIndex(), selfAnimClip);
  }

  function reportMove(mode: 0 | 1 | 2, anim = 0): void {
    const now = performance.now();
    // 每次上报都带"我正在播哪一条动画"：服务端透传后，旁观者直接播同一条，
    // 不必各自再跑一遍匹配器（那正是"同一角色在不同客户端动作不一致"的根源）。
    const animIndex = reportableAnimIndex();
    if (mode === 0) {
      opts?.onMoveInt?.(selfAngle, 0, selfPos.x, selfPos.y, selfPos.z, anim, animIndex, selfAnimClip);
      lastMoveReportAt = now;
      return;
    }
    if (now - lastMoveReportAt < MOVE_REPORT_MS) return;
    lastMoveReportAt = now;
    opts?.onMoveInt?.(selfAngle, running ? 2 : 1, selfPos.x, selfPos.y, selfPos.z, anim, animIndex, selfAnimClip);
  }

  // 可调客户端帧率（0=跟随显示器刷新率；>0=上限 fps）。localStorage 'pt.fps' 持久化；window.__ptSetFps(n) 调整。
  let targetFps = Number(localStorage.getItem('pt.fps') || 0) || 0;
  let lastFrameMs = -1e9; // 保证首帧（含直接调用的 tsMs=0）必定渲染
  function setTargetFps(fps: number): void {
    targetFps = fps > 0 ? Math.round(fps) : 0;
    localStorage.setItem('pt.fps', String(targetFps));
  }
  (window as unknown as { __ptSetFps?: (n: number) => void }).__ptSetFps = setTargetFps;

  function renderLoop(tsMs = 0): void {
    animFrameId = requestAnimationFrame(renderLoop);
    // 帧率上限：未到目标间隔则跳过本帧（动画/移动已 delta-time 化，任意帧率速度一致）
    if (targetFps > 0) {
      const minInterval = 1000 / targetFps;
      if (tsMs - lastFrameMs < minInterval - 1) return;
      lastFrameMs = tsMs;
    }
    if (!renderer || !scene || !camera) return;
    // 剖析器：从"这一帧确实要渲染"处开始计时（被限帧跳过的帧不计入，fps 才是真实帧率）
    perfFrameStart();
    // 自适应视口尺寸
    const w = root.clientWidth, h = root.clientHeight;
    if (w > 0 && h > 0 && (renderer.domElement.width !== Math.floor(w * renderer.getPixelRatio()) || renderer.domElement.height !== Math.floor(h * renderer.getPixelRatio()))) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
      composer?.setSize(w, h);
    }
    perfMark('帧准备');
    const dt = clock.getDelta();
    rafMs += dt * 1000;

    // 自机动画（delta-time：帧率无关）—— 帧推进/求值/施加全走共享播放器（char/anim-player.ts），
    // 与选角预览、远端玩家、怪物、NPC 同一份实现
    if (animState && selfPlayer) {
      const motion = animState.getCurrentMotion();
      if (motion) {
        // 挥拳变速：非 ATTACK 态复原基准速率；ATTACK 用触发攻击时按攻速设的 selfAnimRate
        // 播放速率：攻击用起手时按攻速算的倍率；走/跑按**实际移速 ÷ 1档移速**缩放
        // （否则穿上加速装备后位移变快、步频不变 ⇒ 看起来在滑行，用户 2026-09-16）；
        // 其余状态（站/受击/吃药…）恒 1。
        const curSt = animState.getCurrentState();
        if (curSt === animState.STATE.ATTACK) {
          // 保持起手时设的 selfAnimRate（按攻速镜像服务端公式）
        } else if (curSt === animState.STATE.WALK) {
          selfAnimRate = selfWalkAnimRate;      // 走：服务端下发的速率（查表值，1 档 = 1.0）
        } else if (curSt === animState.STATE.RUN) {
          selfAnimRate = selfRunAnimRate;       // 跑：同上
        } else {
          selfAnimRate = 1;
        }
        const step = selfPlayer.advance(motion, dt, selfAnimRate);
        // 命中帧检测（原版 exm character.cpp:2631）：compFrame 跨过 eventFrame[i] → 发该段 C2S_AttackHit
        // 用 step.raw（未回绕）判定，否则循环动作回绕后会漏判/重判
        // **技能的事件帧**：玩家技能的音效 + 特效（原版 `EventSkill` 那一侧）。
        // 判据与下面 ATTACK 分支**同一份**（`crossEventFrames`），只是状态是 SKILL。
        if (curSt === animState.STATE.SKILL && selfSkillRow) {
          const sm = animState.getCurrentMotion();
          if (sm) {
            const ef = Array.from(sm.eventFrame).filter((f) => f > 0);
            // 无事件帧 → 原版兜底分支（`EventFrame[0] <= compFrame`）在**动作起点**触发一次
            const frames = ef.length > 0 ? ef : [0];
            const compFrame = step.raw - sm.startFrame * 160;
            const crossed = crossEventFrames(frames, selfSkillEventFired, compFrame);
            selfSkillEventFired = crossed.fired;
            for (const _f of crossed.hit) {
              // 目标 = 当前选中的怪（原版 `lpCharSelPlayer`）；**没有就传 null** ——
              // 原版 `if (DesChar)` 两处守卫都不成立 ⇒ 不收敛、不改瞄（不是"退而求其次"）
              // 瞄准点优先用**本次技能自己的**（见 `selfSkillAim` 的说明），
              // 其次才是自动攻击的当前目标；都没有就是原版的"无目标"路径
              // 瞄准点写成**函数**：快照（给不需要跟目标的那类）与 `targetGetter`（给飞出物那类 ——
              // 飞行最长 100 帧，目标走动时不跟随会落在它身后）共用同一条规则，不写两份。
              // ⚠ **目标在"发射这一刻"定死（引用快照）**：闭包里**只读它的位置**（目标走动仍跟随），
              //   不再读 `selfAttackTargetId` —— 否则中途换目标会让**还在半空**的飞出物改道。
              //   用户实测：祭司的 VigorBall 飞在半路时切换目标，法球会拐向新目标 ✗。
              //   （实验室那份是同一处修法：`const tgt = points[a.targetIdx]` 快照 —— 两边语义一致 ✓）
              const aimRootAtCast = selfSkillAim
                ?? (selfAttackTargetId ? monsters.get(selfAttackTargetId)?.root ?? null : null);
              const aimTargetOf = (): { x: number; y: number; z: number } | null =>
                // 怪 → 抬到身中；非怪（无目标）→ null（原版无目标路径）
                (aimRootAtCast
                  ? { x: aimRootAtCast.position.x, y: aimRootAtCast.position.y + TARGET_BODY_LIFT, z: aimRootAtCast.position.z }
                  : null);
              const targetPos = aimTargetOf();
              console.log('[WorldView][dbg] 技能事件帧：caster=(' + selfPos.x.toFixed(1) + ',' + selfPos.y.toFixed(1) + ',' + selfPos.z.toFixed(1) + ')'
                + ' target=' + (targetPos ? `(${targetPos.x.toFixed(1)},${targetPos.y.toFixed(1)},${targetPos.z.toFixed(1)})` : 'null'));
              fireSkillEvent(selfSkillRow, {
                ...skillFxCtx(),
                // 本条动作的第几个事件帧（1 起）—— Vigor Ball 靠它分左右（第 1 帧 −45°、其后 +45°）
                motionEvent: motionEventIndexOf(sm.eventFrame, _f),
                // 出手朝向 = 角色朝向（原版 `Angle.y`）
                casterYaw: selfAngle,
                // 目标**每帧现取**（飞出物最长飞 100 帧，目标走动时要跟着）
                targetGetter: aimTargetOf,
              }, selfPos, targetPos);
            }
          }
        }
        if (animState.getCurrentState() === animState.STATE.ATTACK && selfAttackMotion) {
          const compFrame = step.raw - selfAttackMotion.startFrame * 160;
          // 放箭：拉满弓那一下（首个事件帧前 RELEASE_LEAD_FRAMES 帧）—— 与射出去的命中音效同一时刻
          // 到达（飞行时长 = 这段提前量）。放一次就够（同一刀不会连放）。
          if (!selfProjectileFired && selfAttackEventFrames.length > 0
              && compFrame >= selfAttackEventFrames[0]! - RELEASE_LEAD_FRAMES * 160) {
            selfProjectileFired = true;
            spawnProjectile(selfWeaponMount, charGroup!, selfAppearance?.weaponIdcode ?? 0, selfAppearance?.weaponDorp ?? null,
              selfAppearance?.classId ?? null, selfAttackTargetId, selfAttackEventFrames[0], selfAnimRate,
              () => selfAttackPlan);
          }
          while (selfAttackHitFired < selfAttackEventFrames.length
                 && compFrame >= selfAttackEventFrames[selfAttackHitFired]) {
            const seg = selfAttackHitFired;
            // 上报该段（服务端逐段结算）+ **在该段的事件帧播这一声**（原版 WeaponPlaySound 即在此处）
            opts?.onAttackHit?.(selfAttackTargetId, seg);
            const planned = selfAttackPlan?.get(seg);
            if (planned) {
              // **B 方案命中**：结果已在起手时送达 → 这一帧直接播**正确**的音，不需要之后再替换。
              // 记下"这一声是按哪套判定播的"，结果包到达时据此判断要不要修正（见 playSelfAttackResult）。
              selfPlanSounded.set(seg, { missed: planned.missed, critical: lookCritOf(planned), attackEffect: planned.attackEffect });
              if (planned.missed) {
                sfx.playWeaponMiss(selfHandType(), { priority: true });
              } else {
                selfAttackVoices.set(seg, sfx.playWeaponAttack(selfWeaponSoundCode(), { priority: true }));
                if (lookCritOf(planned)) sfx.playCritical({ priority: true });
              }
            } else {
              // 计划未到（高延迟/丢包/起手被拒）→ 乐观按命中播，等 AttackResult 到达再替换/追加
              selfAttackVoices.set(seg, sfx.playWeaponAttack(selfWeaponSoundCode(), { priority: true }));
            }
            selfAttackHitFired++;
          }
        }
        // 使用道具：粒子/音效在 EAT 的**事件帧**放（原版 character.cpp:6324 同一处判定）
        if (selfEatEffect && !selfEatEffect.fired
            && animState.getCurrentState() === animState.STATE.EAT) {
          const ev = selfEatEffect.motion.eventFrame.find((f) => f > 0);
          if (ev && step.raw - selfEatEffect.motion.startFrame * 160 >= ev) {
            selfEatEffect.fired = true;
            fireEatEffectAt(selfPos, selfEatEffect.kind);
          }
        }
        if (step.ended) {
          // 死亡：停在末帧前一帧（原版 `frame = (EndFrame-1)*160`），尸体不起身 —— 等复活消息
          if (animState.getCurrentState() === animState.STATE.DEAD) {
            selfPlayer.setFrame(Math.max(motion.startFrame, motion.endFrame - 1) * 160);
          } else {
            const next = animState.onAnimationEnd();
            if (next) selfPlayer.setFrame(next.startFrame * 160);
          }
        }
        selfPlayer.apply();
        // **近战武器曳光**（原版 `smCHAR::DrawMotionBlur`，`character.cpp:10121`；端点算法见
        // `DrawMotionBlurTool:10147`）。它是**常驻**的：动作是 `ATTACK` **或** `SKILL`、手里有武器
        // ⇒ 每次挥击出一条带子（原版每挥一次 `new cAssaMotionBlur`，活 `LiveTime` 帧后销毁）。
        // · **每只手一条**（`:10137-10141` 左右手各调一次）—— 刺客匕首双持时左手那条挂 `Bip weapon05`
        // · 段数/回溯：`ActionPattern == 0` ⇒ **32 段 × 40 帧**（`:10173-10187` 第一套）
        // · 端点 = **武器骨原点** 与 **沿骨轴 × `SizeMax`**（`:10214-10245` 的 pTop/pBot）
        // · 闸门照源码：`ATTACK|SKILL`（`:10134`）、有武器（`PatTool` 非空）、收械时不画
        // 探针：**记录出现过的所有 `motion.state`**（去重，每见一个新值打一行）。
        // ⚠ 只打一次会抓到待机那帧（0x40）——看不出攻击/技能时到底是什么值（我第一版就吃了这个亏）。
        if (!selfTrailStates.has(motion.state)) {
          selfTrailStates.add(motion.state);
          console.warn('[曳光] 见到 motion.state =', motion.state, '=0x' + motion.state.toString(16),
            ' stance=', selfWeaponStance, ' hasWeapon=', !!selfWeaponMount.group);
        }
        // **射击/施法时不画**：源码 `DrawMotionBlur:10134` 的 `if (ShootingMode || …) return FALSE;`
        // —— 弓弩、标枪/投掷一律；法杖只在法师7/祭司8、图腾只在萨满10（判据见 `isShootingMode`）。
        // 弓射箭、掷标枪、法师/祭司/萨满施法都出光就"太怪了"（用户 2026-09-20）。
        const selfJob = getGameSnapshot().character?.job ?? 0;
        if ((motion.state === ANIM_ATTACK || motion.state === CHRMOTION_STATE_SKILL)
            && selfWeaponStance === 'combat'
            && !isShootingMode(selfAppearance?.weaponIdcode ?? 0, selfJob)) {
          const handSlots: Array<{ group: THREE.Group | null; bone: string; idcode: number }> = [
            { group: selfWeaponMount.group, bone: combatBoneOf(selfAppearance?.weaponPos),
              idcode: selfAppearance?.weaponIdcode ?? 0 },
            // 镜像份只在"刺客匕首"时存在（`WeaponMount.mirror`），骨见 `szBipName_Assassin_LeftHand`
            { group: selfWeaponMount.mirror, bone: WEAPON_BONES.ASSASSIN_LEFT,
              idcode: (selfAppearance?.weaponIdcode ?? 0) + 1 },
          ];
          for (let hi = 0; hi < handSlots.length; hi++) {
            const slot = handSlots[hi]!;
            if (!slot.group) {
              selfTrails[hi]?.dispose();
              selfTrails[hi]?.object.removeFromParent();
              selfTrails[hi] = null;
              selfTrailWeaponIds[hi] = -1;
              continue;
            }
            if (!selfTrails[hi] || selfTrailWeaponIds[hi] !== slot.idcode) {
              selfTrails[hi]?.dispose();
              selfTrails[hi]?.object.removeFromParent();
              selfTrailWeaponIds[hi] = slot.idcode;
              const len = weaponSizeMax(slot.group);
              selfTrails[hi] = createWeaponTrail({
                // ⚠ **不传 `liveTime`**（= 常驻，见 `weapon-trail.ts` 的字段说明）：玩家侧没有
                //   "活 X 帧"这回事，传了就会在 80 帧后 alpha 永久归零 ⇒「只有第一次攻击有曳光」
                //   （我上一轮只删了 `restart`、漏删了这一行）。
                framesPerLevel: 40,   // 玩家侧 `DrawMotionBlurTool:10175` 是 **40**（怪物侧 30）
                label: `${slot.bone}(长 ${len.toFixed(1)})`,
                // （不用纹理：曳光是我方 shader 方案，见 `weapon-trail.ts` 顶部说明）
                sample: (f) => {
                  const smb = motion.animSmb ?? undefined;
                  // ⚠ **单骨求值**（`sampleBoneEnds`）—— 32 段/帧若走"摆整骨架"那条会卡成 PPT
                  const bf = selfPlayer!.sampleBoneEnds(slot.bone, f, smb);
                  if (!bf) return null;
                  // ⚠⚠ `evalBoneFrame` 给的是**模型空间**（`calcBone` 只算 `tmRot`/`tmPos`，
                  //   **不含角色 root 的位置与朝向**）——必须补上角色的世界变换。
                  //   原版那行就是 `pX + (rx>>FLOATNS) + mWorld->_41`：**角色坐标 + 骨在模型空间的平移**。
                  //   漏了这一步，带子会被放到世界原点附近（角色在 (2211,210,14329) ⇒ 差一万四千单位，
                  //   屏幕上什么都没有；而 lab 里怪物恰在原点附近 ⇒ 看着正常，这个 bug 就藏住了）。
                  // ⚠ `matrixWorld` 由 three 在**渲染时**更新，而这里在渲染之前 ⇒ 手动刷新，
                  //   否则读到的是**上一帧**（首次挥击更是接近单位阵 ⇒ 带子跑到世界原点、看不见）。
                  charGroup?.updateWorldMatrix(true, false);
                  const rootMat = charGroup?.matrixWorld;
                  const a = new THREE.Vector3(bf.ox, bf.oy, bf.oz);
                  const dir = new THREE.Vector3(bf.ayx, bf.ayy, bf.ayz);
                  if (rootMat) { a.applyMatrix4(rootMat); dir.transformDirection(rootMat); }
                  return { a, b: a.clone().addScaledVector(dir, len) };
                },
                log: (msg) => console.warn(msg),
              });
              scene?.add(selfTrails[hi]!.object);
              // 建完报数（长度 = `weaponSizeMax` 的结果、武器网格数、是否进了场景）——
              // 用来区分"没建 / 建了但长度为 0（带子退化）/ 建了没进场景 / 建了但画不出来"
              let meshN = 0;
              slot.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshN++; });
              console.warn('[曳光] 已建：bone=', slot.bone, ' len=', len.toFixed(2),
                ' 武器网格数=', meshN, ' inScene=', !!selfTrails[hi]!.object.parent,
                ' 顶点数=', (selfTrails[hi]!.object as THREE.Mesh).geometry.attributes.position?.count);
            }
            const tr = selfTrails[hi]!;
            // ⚠ 玩家侧**不传 `liveTime`、不做 restart**：源码的 `DrawMotionBlurTool` 是**每帧画**
            //   （带子由"回溯历史帧"构成，没有"某次触发后活 X 帧"这个概念）。先前用"帧回绕"判
            //   新一轮挥击 —— 连续攻击时帧号不回绕就判不到 ⇒ `timeCount` 一直涨 ⇒ alpha 归零
            //   ⇒ **那一次没有曳光**（用户实测"有时候莫名其妙攻击没有曳光"）。
            //   常驻之后：挥动时出现，停下时两骨几乎不动 ⇒ 带子自然收短/消失。
            const curF = selfPlayer.frame;
            tr.setTint(trailTintOfSkill(selfTrailSkillIndex));   // T1：残影染色（写 uColor）
            tr.update(curF, motion.startFrame * 160);
            // （**不再需要** `selfPlayer.apply()` 复原 —— `sampleBoneEnds` 只求骨矩阵、不摆姿势；
            //   这里原先每帧多摆一次整骨架，是卡顿的另一半来源。）
          }
        } else {
          // **离开动作态就什么都不画** —— 原版 `DrawMotionBlur` 每帧先过这道闸门（`:10134`），
          // 带子本身也只在挥击时有内容。⚠ 只"停更"不隐藏的话，带子会**冻在最后一帧**的位置
          //（玩家侧是常驻、`alpha` 恒 1）⇒ 半空中挂着一条静止的带子。
          selfTrails[0]?.hide();
          selfTrails[1]?.hide();
        }
        // 兑现待切的武器套：原版同一处判据 `MotionInfo->State < 0x100`（站/走/跑才算"动作播完"）
        if (pendingSwitchWeapon && animState.getCurrentState() < 0x100) {
          pendingSwitchWeapon = false;
          // **乐观切换**（用户 2026-09-16 定）：发请求的**同一帧**就把外观换成备用套的，
          // 不等服务器往返 —— 否则本帧稍后攻击循环起手时 `selfAppearance` 还是旧武器，
          // 那一刀会用旧武器选动画，等外观到了就"模型新、动画旧"。
          // 预测可能不准，但服务端的 `S2C_AppearanceUpdate` 一到就按指纹校正（见 applySelfAppearance）。
          const predicted = predictSwitchAppearance(
            selfAppearance, getGameSnapshot().inventory?.items ?? []);
          if (predicted) applySelfAppearance(predicted);
          opts?.onSwitchWeapon?.();
        }
      }
    }

    // ===== 自机（方向二）：本地即时移动 + 上报位置（无对账/回拉）=====
    const wasFallingNow = falling;
    // Chase：无鼠标按下且有目标 → 每帧读目标实时坐标算朝向(GetMouseSelAngle 语义)；
    // 目标移动实时跟随；到位(道具=拾取 / 怪物/玩家=贴身) 触发。
    let targetFace: number | undefined;
    let targetReached = false;
    let targetLost = false;
    let monsterEngaged = false; // moveTarget=存活怪 且已进入攻击距离（停步挥拳，moveTarget 保留）
    if (!mouseDown && moveTarget && !isRooted()) {
      const tp = chaseTargetPos();
      if (tp === null) {
        targetLost = true; // 目标已消失/离视野 → 取消
      } else {
        const dx = tp.x - selfPos.x;
        const dz = tp.z - selfPos.z;
        const d = Math.hypot(dx, dz);
        lastChaseDist = d;   // 记下来：到位时 moveTarget 已被清空，那时再算就取不到了
        // 朝向角只算一次（这段里原本三处各写了一遍 `Math.atan2(dx, dz)` —— 同一个判定）
        const face = faceAngleOf(selfPos, tp);
        if (moveTarget.kind === 'monster') {
          // 怪物目标：攻击距离内 → 停步进入攻击循环（不移动）；超出 → 持续 Chase
          if (d <= selfAttackRange()) {
            monsterEngaged = true;
            selfAngle = face;
          } else {
            targetFace = face;
          }
        } else {
          // 交互类目标（掉落物 / NPC / 其他玩家）：和怪物一样停在环上，
          // **不要跑到对方的精确 xyz**（用户 2026-09-14：接近 NPC/玩家时会一路贴到坐标为止，
          // 既不自然、又因为"位置每帧重算"而在动态目标身边蹭）。
          // 环半径见 `INTERACT_RANGE` —— 必须留在各类判定之内（拾取/对话）才够得着。
          // 单帧最多走 `step`，所以到位判定带一个 `stepNow` 的滞回：走进去就停止追击，
          // 不会出现"贴着环进进出出"。
          const stepNow = (running ? selfRunWps : selfWalkWps) * Math.min(dt, 0.1);
          if (d <= INTERACT_RANGE + stepNow) {
            targetReached = true;
          } else {
            targetFace = face;
          }
        }
      }
    }
    if (targetReached || targetLost) {
      const hit = moveTarget;
      moveTarget = null;
      moveStuckStart = 0;
      if (hit && targetReached && hit.kind === 'item') {
        // 到位 → 对"选中的这一件"发拾取请求（服务端裁决并入包推送）
        const cd = lastChaseDist;
   // 在计算到达时记下的距离（这里 moveTarget 已清空，不能再算）
        // 打出**客户端此刻自己算的距离**：服务端若回 "too far"，两者一比就能判定是
        // "客户端到位判定错"还是"跑动位移没上报到服务端"（用户 2026-09-14 实测：服务端报 33.27
        // 恰等于**点击时**的距离，这行日志用来一刀切开）。
        console.log('[WorldView] Chase 到位拾取 gid=' + hit.id
          + ' 客户端距离=' + cd.toFixed(2) + ' selfPos=(' + selfPos.x.toFixed(1) + ',' + selfPos.z.toFixed(1) + ')');
        opts?.onPickupGroundItem?.(hit.id);
      } else if (hit && targetReached && hit.kind === 'player') {
        console.log('[WorldView] Chase 到位(贴身) player=' + hit.id + '（交互动作待接入）');
      } else if (hit && targetReached && hit.kind === 'npc') {
        console.log('[WorldView] Chase 到位 npc=' + hit.id + ' → 交互');
        opts?.onNpcInteract?.(hit.id);
      } else if (targetLost) {
        console.log('[WorldView] Chase 目标消失，取消');
      }
    }
    const moved = updateMovement(dt, targetFace); // falling 中 mouseFacing=null → 不移动
    // 碰撞调试可视化：每帧刷 T 形线/碰撞盒，候选面与各图地面按 100ms 节流重建
    if (collisionDebug.isEnabled()) {
      const stepNow = (running ? selfRunWps : selfWalkWps) * Math.min(dt, 0.1);
      collisionDebug.update({
        meshes: collisionMeshes,
        x: selfPos.x, y: selfPos.y, z: selfPos.z,
        angle: selfAngle,
        step: stepNow,
        bodyWidth: OBJ_WIDTH_RAW / 256,
        bodyHeight: OBJ_HEIGHT_RAW / 256,
        substep: Math.min(stepNow, MAX_SUBSTEP_RAW / 256),
      });
    }
    // 卡住检测：连续 ~0.9s 无法接近目标（撞墙/不可达）→ 放弃寻路
    if (moveTarget && !targetReached && !isRooted() && !monsterEngaged) {
      if (moved) {
        moveStuckStart = 0;
      } else {
        if (moveStuckStart === 0) moveStuckStart = rafMs;
        else if (rafMs - moveStuckStart > 900) {
          const tp = chaseTargetPos();
          const idDesc = 'id' in moveTarget ? ' id=' + moveTarget.id : '';
          console.warn('[WorldView] 寻路受阻，放弃目标 kind=' + moveTarget.kind
            + idDesc
            + (tp ? ' (' + tp.x.toFixed(1) + ',' + tp.z.toFixed(1) + ')' : ''));
          moveTarget = null;
          moveStuckStart = 0;
        }
      }
    } else {
      moveStuckStart = 0;
    }
    const fell = updateFalling();
    if (fell && selfPos.y !== lastY) {
      // 下落/落地时角色同步 y（x/z 未变）
      if (charGroup) charGroup.position.y = selfPos.y;
    }
    lastY = selfPos.y;

    if (falling) {
      // 下落中：不切换 RUN/IDLE（FALLDOWN 由 updateFalling 管理）；已上报的运行状态置为停
      if (wasMoving) {
        wasMoving = false;
        reportMove(0);
      }
      // 同步下落 y + FALLDOWN：按 MOVE_REPORT_MS 节奏上报，服务端原样广播 → 别人能看到下降+掉落动画
      const fnow = performance.now();
      if (fnow - lastMoveReportAt >= MOVE_REPORT_MS) {
        lastMoveReportAt = fnow;
        reportMoveNow(0, ANIM_FALLDOWN);
      }
    } else if (wasFallingNow && !wasMoving) {
      // 刚落地：上报一次落地动画（FALLSTAND / 高差大 FALLDAMAGE），随后归 IDLE
      const landAnim = fallHeight > 200 * 256 ? ANIM_FALLDAMAGE : ANIM_FALLSTAND;
      reportMoveNow(0, landAnim);
      if (animState) animState.triggerIdle();
    } else if (moved) {
      wasMoving = true;
      // 走/跑：**每帧对齐**（不是边沿触发）。
      //
      // 为什么不能只在"开始移动"那一下触发：一次性动作（挥拳/受击/吃药）播完时，
      // 没人会再喊一次"我在跑"，边沿触发就会让它停在 STAND 上滑行。
      // 每帧对齐则"动作播完 → 回 STAND → 下一帧这里接回走/跑"，自动成立。
      //
      // 守卫放在**这里**（自机本地输入这一层），不在状态机里 ——
      // 怪物/远端的动画由服务端状态包驱动，状态机必须对它们忠实照做（用户 2026-09-16 指出）。
      if (animState && !animState.isOneShot()) {
        const st = animState.getCurrentState();
        const S = animState.STATE;
        // 失败就失败（`triggerRun` 内部会上报"该模型没有 RUN 条目"），**不拿走路顶上**：
        // 顶上会让"缺数据"看起来像正常播放，而且掩盖了"服务端在跑、客户端在走"的真实差异。
        if (st !== S.WALK && st !== S.RUN) {
          if (running) animState.triggerRun();
          else animState.triggerWalk();
        }
      }
      reportMove(running ? 2 : 1);
    } else if (wasMoving && !isRooted()) {
      // 本地已停：**先切 IDLE，再上报停止**（顺序不能反）。
      //
      // 上报带的是"我正在播哪一条动画"（`reportableAnimIndex`），而旁观者的
      // `setRemoteAnim` 是**条目优先于状态**（`if (animIndex > 0) playMotion(该条目)`）。
      // 若先上报再 triggerIdle，此刻状态机还是 WALK/RUN ⇒ 透传过去的是**行走条目**，
      // 旁观者照着播它，而行走动画是 `repeat` ⇒ **永远原地走下去**
      // （用户 2026-09-16 联机实测："别人停下后我这看到的还是走/跑动画"）。
      // 先切 IDLE 则上报的是站姿条目，两端一致。
      //
      // ⚠ `!isRooted()`：**定身**（攻击/技能/吃药/受击/掉落）期间的"停步"不在这里处理 ——
      // 位置本来就没动（服务端收不到新移动包），而此刻服务端对动画的认知（攻击由
      // `S2C_AttackStart` 单独广播）比一条 STAND 更准；上报 STAND 反而会把旁观者的攻击动画掐掉。
      // 定身解除后由上面的 `moved` 分支自然接回（它每帧对齐，会重新声明走/跑）。
      wasMoving = false;
      if (animState) animState.triggerIdle();
      reportMove(0);
      if (charGroup) { charGroup.position.copy(selfPos); charGroup.rotation.y = selfAngle; }
    } else if (mouseDown) {
      // 静止但按着鼠标（光标贴角色，方向无效）：保持朝向即时
      const f = mouseFacing();
      if (f !== null && charGroup) charGroup.rotation.y = f;
    }

    // ===== 自机普通攻击循环（design-player-combat.md §6.2）=====
    // 动画驱动：进入攻击距离后挥拳，挥拳播完（onAnimationEnd→STAND）自动下一击；不挂定时器。
    // 攻速→挥拳时长镜像服务端公式；离 ATTACK 态复原基准步进（见上方自机动画推进）。
    if (monsterEngaged && moveTarget && moveTarget.kind === 'monster' && !falling && charGroup) {
      charGroup.rotation.y = selfAngle; // 面向目标（停步时 updateMovement 不接管旋转）
      const st = animState?.getCurrentState();
      // EAT 也在内：喝药期间不能起手攻击（原版 playmain.cpp:1744 屏蔽的正是 ATTACK/EAT/SKILL 三者）。
      const busy = st === animState?.STATE.ATTACK || st === animState?.STATE.SKILL
        || st === animState?.STATE.DAMAGE || st === animState?.STATE.EAT;
      if (!busy && animState && rafMs - lastSelfAttackStartMs >= selfAttackGateMs()) {
        // 非攻击/技能/受击中，且已过起手闸门（镜像服务端冷却）→ 发起下一次挥拳（普攻动画）
        if (animState.triggerAttack(true)) {
          lastSelfAttackStartMs = rafMs;
          selfTrailSkillIndex = null;   // T1：新一轮普攻挥击 → 残影不染色
          const m = animState.getCurrentMotion();
          const targetId = moveTarget.id;
          if (m) {
            selfAnimRate = attackRate(m, getGameSnapshot().character?.attackSpeed ?? 0);
            // 记录本次挥拳的命中帧（非零 eventFrame，相对 startFrame×160；原版最多 4 段）
            selfAttackMotion = m;
            selfAttackTargetId = targetId;
            selfAttackEventFrames = Array.from(m.eventFrame).filter((f) => f > 0);
            selfAttackHitFired = 0;
            selfProjectileFired = false;
            selfAttackVoices.clear();
            selfAttackPlan = null;            // 新一次攻击：上一份计划作废
            selfPlanSounded.clear();
            selfAttackSeq++;
            // 无命中帧数据 → 兜底：起手后立即结算 1 段（该段的挥击音也在此刻播）
            if (selfAttackEventFrames.length === 0) {
              opts?.onAttackHit?.(targetId, 0);
              selfAttackVoices.set(0, sfx.playWeaponAttack(selfWeaponSoundCode(), { priority: true }));
            }
          }
          // 起手广播（旁观者立刻挥拳）——同时把**序号 + 段数**报给服务端，它据此预排各段结果
          // 并回 S2C_AttackPlan（B 方案）。段数 = 非零事件帧个数（无事件帧则 1 段）。
          opts?.onAttackStart?.(targetId, selfAttackSeq, selfAttackEventFrames.length || 1,
            selfAttackMotion?.index ?? 0, selfAnimClip);
          // ⚠ 投射物**不在这里**放（用户 2026-09-16 实测："抬手拉弓时箭就飞出去了"）：
          //   原版放箭在事件帧那一刻，而我们的命中判定/音效也在事件帧 ⇒ 改到"事件帧前
          //   RELEASE_LEAD_FRAMES 帧"放箭、飞行正好用掉这段时间（到达时刻仍 = 事件帧）。
          //   见下方逐帧的"放箭检查"。
          // ⚠ 挥击音**不在这里播**：原版在**命中帧**（事件帧）才调 WeaponPlaySound，
          //   且是**每段一次**（多段攻击每段都响）。见下方逐帧的事件帧派发。
        }
      }
    }

    // 自机段到此结束（骨骼动画 + 移动/上报 + 普攻循环）——剖析器按段记账，故在此打点
    perfMark('自机');
    // 远端玩家（Phase 2/3）
    updateRemotes(dt);
    perfMark('远端玩家');
    // 怪物（服务端权威, S2C_MonsterMove）
    // 显示预算必须先算：本帧 updateMonsters 要按 actor.culled 决定"算不算这 0.075ms/只"。
    // 用 rafMs（帧累加时钟）而不是 performance.now()：与 visRecomputeAt 同一时基、单调。
    updateMonsterVisibility(rafMs);
    updateMonsters(dt);
    perfMark('怪物');
    // NPC（静态站桩，仅 idle 动画）
    updateNpcs(dt);
    perfMark('NPC');
    // 投射物（弓/弩的箭、标枪）：纯表现，飞行到点即消失
    projectileMgr?.update(dt);
    perfMark('投射物');
    // 地面物品：周期高亮闪烁（对齐 scITEM::Draw）
    updateGroundItems(rafMs);
    perfMark('地面物品');
    // 光标 overlay：世界滚动/物品增减时静态光标下的指向也会变 → 逐帧(节流)重探测
    if (mouseSeen) probeCursorAt(mouseX, mouseY);
    perfMark('光标探测');

    // 相机跟随角色
    updateCamera(dt);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    perfMark('相机');

    // 昼夜光照驱动（每帧）：darkLevel/BackColor 渐变 + 火把 + 场景灯 → 各地图 shader uniform
    dnUpdate();
    perfMark('昼夜光照');

    // 地图音效：3D 声源按角色距离更新音量（BGM/环境音已在进入/换图时设置）
    mapAudio.updateAt(selfPos);
    // 音效听者位置（战斗/技能音效按此做距离衰减）
    sfx.update(selfPos);
    perfMark('音频更新');
    // 特效逐帧推进（INI 帧时长以 70Hz 计；.part 需要相机做朝向）
    // `effects.update` 内部会推进 quarksFx（唯一的推进者，见上面的说明）
    if (effects && camera) effects.update(dt);
    updateCastCircleMeshes(dt);       // 法阵本体的 alpha 包络（共用实现）
    updateMultiSparkRunners(dt);      // 火花驱动（共用实现；须每帧调，否则火花不动）
    updateMonsterFlies(dt);           // 怪物飞出物（共用实现；漏了它 = 停在起点不动）
    updateGlacialSpikes(dt);          // 冰枪网格的 alpha 包络与寿命（共用实现）
    dynLights?.update(dt);            // 动态光衰减（原版逐帧 power -= decPower）
    perfMark('技能特效');

    // 小地图
    drawMinimap();
    perfMark('小地图');

    for (const mh of mapHandles.values()) {
      mh.mapRenderer.render(camera);
      mh.mapRenderer.updateScroll(rafMs);
      mh.mapRenderer.updateWind(rafMs);
      mh.mapRenderer.updateWater(rafMs);
      updateFrameAnimations(mh.animatedMeshes, rafMs);
    }
    perfMark('地图渲染');
    // hover 发光外轮廓（官方 OutlinePass 后处理）：设置目标与分类色后再整帧渲染
    if (composer && outlinePass) {
      if (hoverTarget) {
        outlinePass.selectedObjects = [hoverTarget.root];
        outlinePass.visibleEdgeColor.set(hoverTarget.color);
        outlinePass.enabled = true;
      } else {
        outlinePass.selectedObjects = [];
        outlinePass.enabled = false;
      }
    }
    if (composer) composer.render();
    perfMark('3D提交');
    // 名牌/血条 overlay（Canvas，压制被测遮挡）
    drawNameplateOverlay();
    perfMark('名牌飘字');
    // 诊断（临时，默认关）：console 执行 window.__hoverScan=1 开启，每 ~1.5s 扫描主 framebuffer
    if ((window as unknown as { __hoverScan?: number }).__hoverScan === 1 && hoverTarget && rafMs - lastHoverScanAt > 1500) {
      lastHoverScanAt = rafMs;
      hoverOutlineScanDiag();
    }

    // 首帧渲染完成 → 通知 main.ts 收起加载页
    if (firstFramePending) {
      firstFramePending = false;
      loadHooks?.onProgress?.(4, 4);
      loadHooks?.onReady?.();
      showMapBanner(currentMapId);   // 进图/传送落地后的地图名大字（等加载页收起再弹，否则被遮罩盖住）
    }

    // ── 剖析器：场景侧计数 + 整帧渲染统计 ──
    // 每帧必采的 O(1) 项：实体数（"怪物暴增"时这些数字是线性增长的，配合各段耗时即可定位）
    perfSetCounter('怪物', monsters.size);
    perfSetCounter('怪物(可见)', monsters.size - visResult.hidden);
    perfSetCounter('怪物(隐藏)', visResult.hidden);
    perfSetCounter('远端玩家', remotes.size);
    perfSetCounter('NPC', npcs.size);
    perfSetCounter('地面物品', groundItems.size);
    perfSetCounter('名牌', nameplateHits.length);
    perfSetCounter('飘字', floaters.length);
    // 场景上下文：脱离它看帧时间没有意义（哪张图、多大分辨率、像素比多少）
    perfSetCounter('地图', currentMapId);
    perfSetCounter('视口宽', root.clientWidth);
    perfSetCounter('视口高', root.clientHeight);
    perfSetCounter('渲染像素比', renderer ? renderer.getPixelRatio() : 0);
    {
      const st = effects?.stats();
      perfSetCounter('特效(活动)', st ? st.active : 0);
      perfSetCounter('特效(已载)', st ? st.loaded : 0);
    }
    // 整帧渲染统计：info.autoReset 已关（见 ensure3D），此处读完手动重置
    if (renderer) {
      const ri = renderer.info;
      perfSetCounter('Draw(整帧)', ri.render.calls);
      perfSetCounter('三角形(整帧)', ri.render.triangles);
      perfSetCounter('GPU程序', ri.programs ? ri.programs.length : 0);
      perfSetCounter('几何体', ri.memory.geometries);
      perfSetCounter('纹理', ri.memory.textures);
      ri.reset();
    }
    // 场景遍历统计：遍历本身有成本（怪物多时上千对象），故 500ms 一次，不每帧做
    if (rafMs - lastSceneScanAt > 500) {
      lastSceneScanAt = rafMs;
      let visibleMesh = 0, skinned = 0;
      const mats = new Set<THREE.Material>(), geos = new Set<THREE.BufferGeometry>();
      scene.traverseVisible((o) => {
        // 用 traverseVisible 而不是 traverse + `o.visible`：visible 是**逐节点**的，
        // 父节点不可见时子节点自身仍为 true —— 那样统计会把"被显示预算整棵关掉的怪"
        // 算成可见网格（实测误导过一次：隐藏 170 只怪，可见蒙皮网格却几乎没变）。
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        visibleMesh++;
        if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) skinned++;
        const m = mesh.material;
        if (Array.isArray(m)) for (const mm of m) mats.add(mm);
        else if (m) mats.add(m);
        if (mesh.geometry) geos.add(mesh.geometry);
      });
      perfSetCounter('可见网格', visibleMesh);
      perfSetCounter('可见蒙皮网格', skinned);
      perfSetCounter('不同材质', mats.size);
      perfSetCounter('不同几何体', geos.size);
    }
    perfMark('统计面板');
    perfFrameEnd();

    // 统计面板（map-demo 同款）
    fpsAcc += dt;
    frameCount++;
    if (fpsAcc >= 0.4 && mapHandles.size > 0) {
      const fps = frameCount / fpsAcc;
      let dc = 0, visT = 0, totT = 0, verts = 0;
      for (const mh of mapHandles.values()) {
        dc += mh.mapRenderer.drawCallCount;
        visT += mh.mapRenderer.visibleFaceCount;
        totT += mh.mapRenderer.totalFaceCount;
        verts += mh.mapRenderer.drawnVertexCount;
      }
      // 摘要行：JS 总耗时 + 最贵的一段（明细按 Ctrl+Shift+P 打开剖析面板）
      const pr = perfReport();
      const top = pr.sections.find((s) => s.avgMs >= 0.05);
      statsEl.textContent =
        `FPS   ${fps.toFixed(0)}  地图 ${mapHandles.size}\n` +
        `Draw  ${dc}\n` +
        `Tris  ${Math.round(visT).toLocaleString()} / ${totT.toLocaleString()}\n` +
        `Verts ${verts.toLocaleString()}\n` +
        `Perf  JS ${pr.jsMs.toFixed(1)}ms  非JS ${pr.otherMs.toFixed(1)}ms` +
        (top ? `  最贵 ${top.name} ${top.avgMs.toFixed(2)}ms` : '') + '\n' +
        `Pos   ${selfPos.x.toFixed(1)}, ${selfPos.y.toFixed(1)}, ${selfPos.z.toFixed(1)}  m${currentMapId}\n` +
        `Time  ${String(dnDebugHour ?? dayNightHour).padStart(2, '0')}:${String(dayNightMin).padStart(2, '0')}${dnDebugHour !== null ? '*' : ''} Dark ${dayDark}`;
      frameCount = 0; fpsAcc = 0;
    }
  }

  function resize(): void {
    if (!camera || !renderer || !root) return;
    camera.aspect = root.clientWidth / root.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(root.clientWidth, root.clientHeight, false);
    composer?.setSize(root.clientWidth, root.clientHeight);
    if (npOverlay && npCtx) {
      const dpr = renderer.getPixelRatio();
      npOverlay.width = Math.max(1, Math.floor(root.clientWidth * dpr));
      npOverlay.height = Math.max(1, Math.floor(root.clientHeight * dpr));
      npCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  // —— 外观更新（穿脱装备/武器切换/转职换头 S2C_AppearanceUpdate 驱动）——
  // 自机：增量替换（身体网格 swapSelfBody / 头部 swapSelfHead），骨架/动画常驻；就绪前旧模型保持显示
  /**
   * 应用一份自机外观 —— **唯一入口**（服务端推送 `updateSelfAppearance` 与
   * W 键的**乐观预测**都走它）。
   *
   * **模型真的变了才重建**：判据是外观指纹（覆盖武器/副手/躯干甲/头/转职，见
   * `appearanceModelKey`）。服务端已经做了"没变就不推"，这里是客户端自己的第二道闸 ——
   * 即便收到冗余推送（或乐观预测与服务端答案一致）也不会重建模型、不会把动画从头播一遍
   * （用户 2026-09-16 实测"整理背包动画就重播"）。
   */
  function applySelfAppearance(appearance: CharacterAppearance | undefined): void {
    const key = appearanceModelKey(appearance);
    if (key === selfAppearanceKey) return;
    selfAppearanceKey = key;
    void reloadSelfModel(appearance);
  }

  async function reloadSelfModel(appearance: CharacterAppearance | undefined): Promise<void> {
    if (appearance) selfAppearance = appearance;
    if (!scene) return;
    if (!charGroup || !selfBodyGroup || !skeleton) return; // 未进图/无模型：外观已记录，下次 show() 用
    const jobId = appearance?.classId || selfJobId || 1;
    // 头/转职阶级变了 → 先换头（不改身体）
    if (appearance && (((appearance.head ?? 0) !== selfHead) || ((appearance.rank ?? 0) !== selfHeadTier))) {
      await swapSelfHead(jobId, appearance.head ?? selfHead, appearance.rank ?? selfHeadTier);
    }
    await swapSelfBody(appearance);
  }

  // 远端：移除旧演员 → 用其当前位置重建（新外观）
  async function reloadRemoteModel(playerId: number, appearance: CharacterAppearance | undefined): Promise<void> {
    const old = remotes.get(playerId);
    if (!old) return;
    const p = old.root.position;
    const name = old.name || '';
    const jobId = appearance?.classId || old.jobId || 1;
    const level = old.level ?? 1;
    const angle = old.root.rotation.y;
    despawnRemote(playerId);
    spawnRemote({
      playerId, name, classId: jobId, level,
      hp: old.hp, maxHp: old.maxHp,
      clanName: old.clanName, clanMark: old.clanMark,
      x: p.x, y: p.y, z: p.z, angle,
      appearance,
    });
  }

  /**
   * 使用道具：EAT 动画 + 事件帧的粒子/音效（**唯一实现**，`playEatRequest` / `playEat` 都走它）。
   *
   * 音走道具音表：原版 `sinUsePotion` 里 `sinPlaySound(SIN_SOUND_EAT_POTION)` = 20 = drink1.wav。
   * **不写死 `'/res/wav/...'`** —— `sfx.play()` 内部已拼 `RES_BASE='/res/'`，再带一次就是 404。
   */
  function playEatInternal(kind: UseEffectKind): boolean {
    // 家族未登记（既不是药水也不是以太核心）→ 原版根本不会进 EAT
    // （`sinActionPotion` / `ActionEtherCore` 只被这两类调）⇒ 不播，且报出来（AGENTS #12：别静默）。
    if (!kind) { reportFallback('use-item', '该物品未登记使用表现（非药水/以太核心）'); return false; }
    // **正在吃 / 刚吃过 → 这一下按键无效**（不吃、不播、也不发请求）。原版两条守卫：
    //   ① `sinActionPotion()` 开头 `State != EAT && != DEAD`，在 EAT 中直接 `return FALSE`
    //      ⇒ 调用方连 `pUsePotion` 都不设（`playsub.cpp:1078`）；
    //   ② `sinUsePotionDelayFlag`：吃完后 **50 帧**（70Hz ≈ 0.71s）内不能再吃
    //      （`sinInvenTory.cpp:791-798` 计时、:1176 置位）。
    // 少了这两条，连按 123 会让 EAT 动画一次次从头重播（用户 2026-09-16 实测）。
    const now = performance.now();
    if (animState?.getCurrentState() === animState?.STATE.EAT) {
      console.log('[potion] 正在吃上一个（EAT 中）→ 这一下按键无效');
      return false;
    }
    if (now - lastEatAt < EAT_COOLDOWN_MS) {
      console.log('[potion] 距上次吃药 ' + Math.round(now - lastEatAt) + 'ms < '
        + EAT_COOLDOWN_MS + 'ms（原版 sinUsePotionDelayFlag 50 帧）→ 这一下按键无效');
      return false;
    }
    const ok = animState?.triggerEat() ?? false;   // 失败已在状态机里 reportFallback
    if (!ok) return false;
    lastEatAt = now;
    if (kind === 'return') {
      // 以太核心：原版在**点击瞬间**就放（playsub.cpp:1111 ActionEtherCore）
      fireEatEffectAt(selfPos, kind);
    } else {
      // 药水：记下待触发，由渲染循环在 EAT 事件帧放（character.cpp:6324）
      const motion = animState!.getCurrentMotion();
      selfEatEffect = motion ? { kind, motion, fired: false } : null;
    }
    return true;
  }

  /**
   * 放「使用道具」的粒子 + 音效（**自机与旁观者同一实现**）。
   * 位置 = 脚下 + `EAT_EFFECT_LIFT`（原版 `pY + 48 * fONE`；fONE=256 且我方世界单位 = 原版 float 单位）。
   */
  function fireEatEffectAt(base: { x: number; y: number; z: number }, kind: UseEffectKind): void {
    if (!kind) return;
    const pos = { x: base.x, y: base.y + EAT_EFFECT_LIFT, z: base.z };
    if (kind === 'return') {
      void effects?.spawn(USE_EFFECT_INI[kind], { pos });
      // EFFECT_RETURN1 配 SKILL_SOUND_LEARN（effectsnd.cpp:414 → wav/effects/skill/learn_skill.wav）
      sfx.playSkill(0x1000);
    } else {
      // 药水：**30 颗物理粒子**（原版 EFFECT_POTION{1,2,3}，见 potion-burst.ts 的调查结论）——
      // 不是"一张会飘的动画"，是每颗各自四散 + 上抛 + 重力 + 自转，寿命到就消失。
      // size 必须显式给：potion1.ini 无 Size 段，否则会大 4 倍（见 POTION_PARTICLE_SIZE）。
      // 药水已改走 **three.quarks**（见 `render/effects/quarks-runtime.ts`）：30 颗物理粒子 +
      // 那记 120×120 闪光，参数仍是同一份 `POTION_BURST`。
      // 换的原因之一：旧实现把粒子寿命截断在 INI 动画播完那一刻（`potion1.ini` 65 帧 = 0.929s），
      // 而原版是寿命独立控制（`SetLive(rand()%20+55)` = 55~74 帧 = 0.786~1.057s，动画是 `ANI_LOOP`）。
      // `kind` 决定用哪支：HP/MP/STM 三种药水的贴图（颜色）不同，参数共用
      quarksFx?.playPotion(kind, pos);
      playItemSound(20);   // SIN_SOUND_EAT_POTION
    }
  }

  playEatRequest = (kind: UseEffectKind) => playEatInternal(kind);

  return {
    beginWorldEnter: () => beginWorldEnter(),
    async show(enterGame, hooks) {
      loadHooks = hooks ?? null;
      firstFramePending = false;
      // 换角色/重进：地图名大字的"同图冷却"计时作废 —— 否则小退→换号→重进同一张图时
      // 会被上一局的计时吃掉（用户实测"进图没有地图名"）
      mapBannerShownAt.clear();
      root.style.display = 'block';
      ensure3D();
      if (!scene || !camera) {
        loadHooks?.onReady?.();
        return;
      }
      // 重进清场：移除上次进图残留的自机/远端/怪物（小退→重进/换号必须，否则旧模型残留场景）
      clearWorldActors();
      if (enterGame.appearance) {
        selfAppearance = enterGame.appearance;
        // 进图这套外观就是"当前模型"⇒ 记下指纹，之后的 AppearanceUpdate 才能正确判断"变没变"
        selfAppearanceKey = appearanceModelKey(enterGame.appearance);
      }

      // 重放进场竞态期间缓存的远端 Appear（此刻 scene 已就绪）
      if (pendingAppears.length > 0) {
        const batch = pendingAppears.splice(0);
        for (const a of batch) spawnRemote(a);
      }
      // 怪物同理（可能早于本机 enterGame 到达）
      if (pendingMonsterAppears.length > 0) {
        const batch = pendingMonsterAppears.splice(0);
        for (const a of batch) spawnMonster(a);
      }
      // 地面物品同理（可能早于本机进场到达）
      if (pendingGroundItems.length > 0) {
        const batch = pendingGroundItems.splice(0);
        for (const g of batch) spawnGroundItem(g.groundItemId, g.name, g.x, g.y, g.z, g.dorpItem, g.itemId, g.quantity, g.money);
      }

      try {
        // 全量地图包围盒：服务端 EnterGame 下发（曾在此下载全部 63 张 SMD 取 bounds = 334MB 隐藏预取）
        if (allBounds.size === 0 && enterGame.maps?.length) {
          for (const m of enterGame.maps) {
            if (m.bounds) allBounds.set(m.mapId, m.bounds);
          }
          const missing = Object.keys(MAP_CATALOG).map(Number).filter((id) => !allBounds.has(id));
          if (missing.length) {
            reportFallback('map', `服务端未下发 ${missing.length} 张图的 bounds（id=${missing.slice(0, 8).join(',')}…）→ 这些图不参与判图/预加载`);
          }
        }

        const smdPath = mapSmdPath(enterGame.mapId);
        if (!smdPath) {
          console.warn('WorldView: 未知地图 mapId=' + enterGame.mapId);
          loadHooks?.onReady?.();
          return;
        }
        selfPos = rawToWorld(enterGame.position.x, enterGame.position.y, enterGame.position.z);
        selfAngle = enterGame.rotation?.y || 0;
        currentMapId = enterGame.mapId;
        mapAudio.enterMap(currentMapId);
        mapAudio.resume();
        console.log('[WorldView] mapId=' + enterGame.mapId + ' 自机 world=(' +
          selfPos.x.toFixed(1) + ',' + selfPos.y.toFixed(1) + ',' + selfPos.z.toFixed(1) + ') angle=' + selfAngle);

        // 阶段进度：1=本图 2=相邻图 3=角色 4=首帧（renderLoop 里触发）
        await loadMapById(enterGame.mapId);
        loadHooks?.onProgress?.(1, 4);
        // 加载相邻图 + 卸载非相邻图
        await syncMapRegions(enterGame.mapId);
        loadHooks?.onProgress?.(2, 4);

        // 鼠标移动监听（对齐 /pt/maps/：左键按住朝鼠标方向移动）
        const canvasEl = renderer!.domElement;
        canvasEl.addEventListener('mousedown', onMouseDown);
        canvasEl.addEventListener('mouseup', onMouseUp);
        canvasEl.addEventListener('mousemove', onMouseMove);
        canvasEl.addEventListener('mouseleave', onMouseLeave);
        // 滚轮调俯仰（原版手动视角；固定模式在 onWheel 内部忽略）
        canvasEl.addEventListener('wheel', onWheel, { passive: false });
        window.addEventListener('mouseup', onMouseUp);

        // 自机外观：职业 → 渲染
        const jobId = enterGame.appearance?.classId || 1;
        await loadPlayer(enterGame.appearance, jobId);
        loadHooks?.onProgress?.(3, 4);
      } catch (e) {
        // 加载失败也要收起加载页：黑屏世界好过错死的加载图
        console.error('[WorldView] 进图加载失败', e);
        loadHooks?.onReady?.();
        return;
      }

      window.addEventListener('resize', resize);
      requestAnimationFrame(() => requestAnimationFrame(resize));
      clock.getDelta();
      firstFramePending = true;
      renderLoop();
    },
    setGameTime,
    toggleMinimap,
    isMinimapOn,
    toggleCameraMode,
    cameraMode: () => camMode,
    toggleGroundItemLabels,
    cancelTarget,
    setDisplayPrefs,
    displayBudgetStatus: () => ({
      visible: monsters.size - visResult.hidden,
      hidden: visResult.hidden,
      range: visResult.tier ? visResult.tier.range : Infinity,
      cap: visResult.cap,
    }),
    toggleRun: () => setRunMode(!running),
    isRunning: () => running,
    setTargetFps,
    getTargetFps: () => targetFps,
    setSelfId: (id: number) => { selfPlayerId = id; },
    isSelf: (id: number) => id === selfPlayerId,
    // 名牌/血条数据（main.ts 消息派发喂入；design-nameplate-hpbar.md）
    setSelfHp,
    setSelfName,
    setSelfLevel,
    playEat: (kind: UseEffectKind = null) => playEatInternal(kind),
    requestSwitchWeapon: () => {
      // 站/走/跑（STATE < 0x100）→ 立刻兑现；否则缓存，等渲染循环里动作播完
      if ((animState?.getCurrentState() ?? 0) < 0x100) { opts?.onSwitchWeapon?.(); return; }
      pendingSwitchWeapon = true;
    },
    setCollisionDebug: (on: boolean) => collisionDebug.setEnabled(on),
    isCollisionDebug: () => collisionDebug.isEnabled(),
    scanNaNGeometry: () => {
      if (!scene) return [];
      const hits = scanNaNGeometry(scene);
      reportNaNGeometry(hits, '(worldView.scanNaNGeometry 手动扫描)');
      return hits;
    },
    markSelfCombat,
    applyUnitHp,
    applyMonsterHit,
    playSelfAttackResult,
    applyAttackPlan,
    spawnEffectOnUnit,
    spawnLevelUpEffect,
    signalAttackStart,
    onTakeDamage,
    showFloater,
    applyRespawn,
    applyTeleport,
    teleportRemote,
    applyPlayerDeath,
    applyMapSwitched,
    respawnNeedsMapLoad: (mapId: number) => !!scene && mapId !== currentMapId,
    /** 大地图（`src/ui/WorldMap.ts`）用：当前地图 + 自机世界坐标 —— 世界图上画"你在这" */
    worldMapPlayer: () => ({ mapId: currentMapId, x: selfPos.x, z: selfPos.z, angle: selfAngle }),
    /**
     * 大地图用：地图上的其他实体（图标与小地图同源）。
     *   · NPC  = `npcs`（原版小地图也只画这些）
     *   · 怪物 = `monsters`（**原版小地图不画怪物**，用户要求画；标红区分）
     *   · 队友 = **暂无数据源** —— 客户端还没接队伍系统（协议里是 `S2C_PartyUpdate`），
     *           队伍状态一落地就往这里塞，别的地方不用改
     */
    worldMapEntities: () => {
      const out: { kind: 'npc' | 'monster' | 'party'; x: number; z: number; angle?: number }[] = [];
      // ⚠ **不要**按"这只实体属于哪张图"过滤：怪物的出现/消失由服务端 **AOI（全局坐标 + 距离）**
      //   推送，玩家站在图 A 边缘时，图 B 的怪本来就会被推过来 —— 这是**正确的**，因为它确实离玩家近。
      //   （曾试图用"收到 appear 时玩家在哪张图"当归属，被用户指出是错的：那会把图 B 的怪误标成图 A，
      //   玩家真进了图 B 反而不显示。归属判据必须是坐标，不是"收到消息时的场景"。）
      //   地图侧再用**当前图的 AABB** 收窄（`WorldMap.drawnEntities`），两层各管各的。
      for (const [, n] of npcs) out.push({ kind: 'npc', x: n.root.position.x, z: n.root.position.z });
      // 怪物不按"显示预算"过滤：地图要看到全部（`culled` 只是这一帧不渲染）。
      // **带上朝向** `rotation.y`（服务端 `S2C_MonsterAppear.angle` / `MonsterMove` 一直在发，
      // 我们一直存在 `root.rotation.y`）—— 地图把它画成三角形，尖指朝向（用户 2026-09-16）。
      for (const [, m] of monsters) {
        // 尸体不上图：它不是"这里的怪"，标上去只会让玩家以为还有活怪在（原版小地图本来也不画怪）
        if (m.dead) continue;
        out.push({ kind: 'monster', x: m.root.position.x, z: m.root.position.z, angle: m.root.rotation.y });
      }
      return out;
    },
    applyPlayerMove: (playerId, x, y, z, angle, animState, animIndex = 0, animClip = '', useSeq = 0, useItemIdcode = 0) => {
      const pid = Number(playerId);
      if (pid === selfPlayerId) {
        // 方向二：自机位置自己权威，忽略回推（服务端不修正正常移动；换图/重生等由 enterGame 处理）
        return;
      } else {
        const actor = remotes.get(pid);
        if (actor) {
          // 存入权威快照缓冲（本地到达时刻作为时间戳），由 updateRemotes 按延迟插值渲染。
          // 跨长静默（空闲期无广播）到达的新快照 → 重锚：清空旧缓冲，避免跨空闲间隙插值造成起步瞬移。
          const lastSnap = actor.snaps[actor.snaps.length - 1];
          if (lastSnap && performance.now() - lastSnap.t > REMOTE_RESYNC_MS) {
            actor.snaps.length = 0;
          }
          actor.snaps.push({ t: performance.now(), x, y, z, angle, anim: animState, animIndex, animClip, useSeq, useItemIdcode });
          if (actor.snaps.length > 32) actor.snaps.shift();
        }
      }
    },
    playerAppear: (playerId, name, classId, level, hp, maxHp, clanName, clanMark, x, y, z, angle, appearance, animWalkRate, animRunRate) => {
      spawnRemote({ playerId: Number(playerId), name, classId: classId || 1, level, hp: hp || 0, maxHp: maxHp || 0, clanName: clanName || '', clanMark: clanMark || '', x, y, z, angle, appearance, animWalkRate, animRunRate });
    },
    setSpeed: (walkWps, runWps, walkAnimRate, runAnimRate) => {
      // 速度（世界/秒）—— 用于**本地移动步长**；非法值忽略，保留当前值
      if (Number.isFinite(walkWps) && walkWps > 0) selfWalkWps = walkWps;
      if (Number.isFinite(runWps) && runWps > 0) selfRunWps = runWps;
      // 动画速率：**服务端查表算好下发**（`GameConstants.WALK_ANIM_RATE`）—— 客户端不再自己换算。
      // 此前是"速度 ÷ 本地硬编码基准"，而那份基准停在档位 25 ⇒ 一档动画被拖慢一半（用户实测）。
      if (typeof walkAnimRate === 'number' && walkAnimRate > 0) selfWalkAnimRate = walkAnimRate;
      if (typeof runAnimRate === 'number' && runAnimRate > 0) selfRunAnimRate = runAnimRate;
    },
    playerDisappear: (playerId) => despawnRemote(Number(playerId)),
    updateSelfAppearance: (appearance) => { applySelfAppearance(appearance); },
    updateRemoteAppearance: (playerId, appearance) => { void reloadRemoteModel(Number(playerId), appearance); },
    changeSelfHead: (jobId, faceNum, tier) => { void swapSelfHead(jobId, faceNum, tier); },
    monsterAppear: (monsterId, _templateId, name, modelFile, _level, hp, maxHp, x, y, z, angle, dead, monsterEffectId, animRate) => {
      spawnMonster({ monsterId: Number(monsterId), name: name || '', modelFile, monsterEffectId: Number(monsterEffectId) || 0, hp: hp || 0, maxHp: maxHp || 0, x, y, z, angle: angle || 0, dead: !!dead, animRate: Number(animRate) || 0 });
    },
    monsterMove: (monsterId, x, y, z, angle, animState, animIndex) => {
      applyMonsterMove(Number(monsterId), x, y, z, angle, animState, animIndex ?? 0);
    },
    monsterDisappear: (monsterId) => despawnMonster(Number(monsterId)),
    monsterDeath: (monsterId) => monsterDeath(Number(monsterId)),
    npcAppear: (entityId, nameKey, modelFile, x, y, z, angle) => {
      spawnNpc({ entityId: Number(entityId), nameKey: nameKey || '', modelFile: modelFile || '', x: Number(x), y: Number(y), z: Number(z), angle: Number(angle) || 0 });
    },
    npcDisappear: (entityId) => despawnNpc(Number(entityId)),
    groundItemAppear: (groundItemId, name, x, y, z, dorpItem, itemId, quantity, money) => {
      spawnGroundItem(
        Number(groundItemId), name || '', Number(x), Number(y), Number(z),
        dorpItem || '', Number(itemId) || 0, Number(quantity) || 0, Number(money) || 0,
      );
    },
    groundItemDisappear: (groundItemId) => despawnGroundItem(Number(groundItemId)),
    playSkillByIcon: (iconFile) => playSkillByIcon(iconFile),
    playEquippedSkill: (slot) => playEquippedSkill(slot),
    hide() {
      root.style.display = 'none';
      mapAudio.suspend();
      if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = 0; }
    },
    destroy() {
      if (animFrameId) cancelAnimationFrame(animFrameId);
      for (const actor of remotes.values()) {
        scene?.remove(actor.root);
        actor.bodyGroup.children.forEach((c) => (c as THREE.SkinnedMesh).geometry?.dispose?.());
      }
      remotes.clear();
      remoteSpawning.clear();
      pendingAppears.length = 0;
      for (const actor of monsters.values()) {
        scene?.remove(actor.root);
        actor.skeleton.dispose?.();
      }
      monsters.clear();
      monsterSpawning.clear();
      monsterCancelled.clear();
      pendingMonsterAppears.length = 0;
      for (const g of groundItems.values()) {
        scene?.remove(g.root);
      }
      groundItems.clear();
      pendingGroundItems.length = 0;
      mapAudio.dispose();
      window.removeEventListener('resize', resize);
      window.removeEventListener('mouseup', onMouseUp);
      if (renderer && renderer.domElement) {
        renderer.domElement.removeEventListener('mousedown', onMouseDown);
        renderer.domElement.removeEventListener('mouseup', onMouseUp);
        renderer.domElement.removeEventListener('mousemove', onMouseMove);
        renderer.domElement.removeEventListener('wheel', onWheel);
        renderer.domElement.remove();
      }
      npOverlay?.remove();
      npOverlay = null;
      npCtx = null;
      if (composer) { composer.dispose(); composer = null; }
      if (outlinePass) outlinePass = null;
      if (renderer) renderer.dispose();
      renderer = null;
      // 投射物：摘掉在飞的（模型缓存留着 —— 按 URL 缓存，与 asset-manager 同一约定，换图不必重下）
      projectileMgr?.dispose();
      clearMonsterFlies();            // 飞出物载体节点随世界一起清（否则残留到下一个世界）
      projectileMgr = null;
      scene = null;
      camera = null;
      // **两份相机注册表都要注销**（billboard + orient）—— 否则下一个世界还拿着这台已释放的相机
      setBillboardCamera(null);
      setOrientCamera(null);
      mapHandles.clear();
      collisionMeshes.clear();
      charGroup = null;
      statsEl.remove();
      root.remove();
    },
  };
}
