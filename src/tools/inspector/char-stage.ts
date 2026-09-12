/**
 * 资产检查器 —— three.js 舞台层。
 *
 * 职责：场景/相机/灯光、按任意外观组合加载角色（或怪物/NPC）、播放任意动作（逐帧可控）、
 * 武器挂载、以及调试可视化（线框/骨骼/坐标轴）。
 *
 * 与 WorldView 的区别：不接网络、不做状态机随机选择、不做预测，纯粹"把资产摆出来"。
 * 玩家与怪物/NPC 共用同一套 actor 抽象（两者最终都是 bones + animSmb + motions）。
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  getSkeleton, getBody, getHead, getBodyInxPath, getHeadInxPath, JOB_DATA,
} from '../../render/char-loader.js';
import { loadMonsterModel, buildMotionList } from '../../render/monster-loader.js';
import { loadCharTextures } from '../../render/char-texture-loader.js';
import { loadWeaponModel, findBone, WEAPON_BONES, WeaponMount, offMountBoneOf } from '../../render/weapon-loader.js';
import type { MountResult } from '../../render/weapon-loader.js';
import { createEffectManager } from '../../render/effects/effect-manager.js';
import type { LoadedPart } from '../../render/effects/part-assets.js';
import type { EffectDiag } from '../../render/effects/effect-assets.js';
import { evalSkeleton, applyToBones, advanceAnimFrame } from '../../char/animation.js';
import { motionStateName } from '../../char/char-format.js';
import type { MotionInfo } from '../../char/char-format.js';
import type { SmbData } from '../../char/char-format.js';

/** 检查器可任意伪造的外观（对齐 CharacterAppearance + 检查器额外的覆盖项） */
export interface InspectorAppearance {
  jobId: number;
  faceNum: number;
  tier: number;
  armorNum: number;
  /** 体型档（原版 SizeLevel；影响音效变调） */
  sizeLevel: number;
  weaponIdcode: number;
  weaponDorp: string;
  weaponPos: number;
  offHandIdcode: number;
  offHandDorp: string;
  /** 0=无 1=盾 2=匕首 */
  offHandKind: number;
  offHandPos: number;
  /** 可选：换装身体 .inx 覆盖（costume） */
  bodyInxOverride: string | null;
}

/** 诊断一条：期望路径 vs 实际是否拿到 */
export interface DiagEntry {
  group: string;
  label: string;
  expected: string;
  ok: boolean;
  note?: string;
}

export interface StageLoadResult {
  ok: boolean;
  diag: DiagEntry[];
  motions: MotionInfo[];
  /** 纹理成功/失败统计（失败路径供诊断面板高亮） */
  textures: { loaded: number; failed: string[] };
  /** 是否为玩家角色（决定装备面板与职业音效是否可用） */
  isPlayer: boolean;
  /** 怪物/NPC 的音效目录键（模型 basename）；玩家为空串 */
  soundKey: string;
  /** 骨骼名（骨骼信息面板） */
  boneNames: string[];
}

export type CameraPreset = 'full' | 'upper' | 'weapon';

export interface CharStage {
  /** 加载角色。`stance` = 武器初始姿态（持械/收械）；不传按持械（调用方随后可用
   *  `setWeaponStance` 纠正，那才是姿态的唯一入口）。 */
  loadPlayer(app: InspectorAppearance, stance?: 'combat' | 'sheathed'): Promise<StageLoadResult>;
  /** 局部换头：只增删头部网格组，**不动骨架与 mixer**（换脸不中断动画、不撕裂） */
  swapHead(app: InspectorAppearance): Promise<{ loaded: number; failed: string[]; note: string }>;
  /** 直接按 .inx 路径加载（怪物/NPC/宠物，也可喂玩家 body inx） */
  loadModel(inxPath: string, label?: string): Promise<StageLoadResult>;
  /** 直放指定动作（不走状态机随机选择） */
  playMotion(m: MotionInfo | null): void;
  currentMotion(): MotionInfo | null;
  currentFrame(): number;
  /** 当前动作的帧范围（时间轴用）；无动作时 null */
  frameRange(): { start: number; end: number } | null;
  /** 直接跳到绝对帧号（时间轴拖动） */
  setFrame(f: number): void;
  motions(): MotionInfo[];
  paused: boolean;
  speed: number;
  looping: boolean;
  setPaused(v: boolean): void;
  /**
   * 切换武器姿态（持械 ↔ 收械）。**骨判定与镜像份全在 `WeaponMount` 里**
   * （自机 / 远端 / 检查器同一实现）——调用方只给姿态，不再自己算骨骼名。
   */
  setWeaponStance(stance: 'combat' | 'sheathed'): MountResult;
  /** 暂停态下逐帧步进（n 可为负） */
  stepFrames(n: number): void;
  /** 停止：回到当前动作首帧并暂停（对齐 pviewer 的"停止"） */
  stop(): void;
  setSpeed(v: number): void;
  setLooping(v: boolean): void;
  setCamera(preset: CameraPreset): void;
  /** 调试可视化（吸收自 pviewer 的渲染开关） */
  setWireframe(v: boolean): void;
  setShowBones(v: boolean): void;
  setShowAxes(v: boolean): void;
  /** 演员当前世界位置 */
  actorPos(): { x: number; y: number; z: number } | null;
  /** 直接设置演员世界位置（暂时无地图，用于手动摆位） */
  setActorPos(x: number, y: number, z: number): void;
  /** 播放一个 INI 广告牌特效（相对演员的偏移；缺省在身前胸口高度） */
  spawnEffect(name: string, offset?: { x: number; y: number; z: number }): Promise<boolean>;
  /** 最近一次特效的解析结果（诊断面板用） */
  effectDiag(): EffectDiag | null;
  /** 最近一次 `.part` 粒子的解析结果（那 401 个脚本） */
  partDiag(): LoadedPart['diag'] | null;
  /** 动作播到末尾且未循环 */
  finished(): boolean;
  onFrame?: (frame: number, motion: MotionInfo | null) => void;
  /**
   * 当前动作的**事件帧**回调（机制同 WorldView 的攻击命中帧）：
   * 帧位置跨过 `motion.eventFrame[i]`（相对 startFrame ×160）时触发一次，每次 playMotion 重置。
   * 技能的"落地/命中"时刻就用它 —— 特效与打击音效应在这一刻放，而不是起手。
   */
  onMotionEvent?: (index: number) => void;
  dispose(): void;
}

/** 统一演员：玩家与怪物/NPC 加载后的共同形态。
 *  结构对齐 WorldView：**骨骼与蒙皮网格必须同在一个 root 下**，
 *  否则（a）移动 root 不会移动视觉（蒙皮位置由骨骼决定），
 *  （b）findBone(root, ...) 找不到骨骼 → 武器挂载静默失败。 */
interface StageActor {
  root: THREE.Group;
  skeleton: THREE.Skeleton;
  bones: THREE.Bone[];
  animSmb: SmbData;
  motions: MotionInfo[];
  meshes: THREE.Mesh[];
  /** 身体/头部网格组：局部替换（换脸/换甲）时只增删这一个组，
   *  **不动骨架与 mixer**，从而不中断当前动画、不产生撕裂。 */
  bodyGroup?: THREE.Object3D;
  headGroup?: THREE.Object3D;
  bodyMeshes?: THREE.Mesh[];
}

export function createCharStage(container: HTMLElement): CharStage {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a24);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 20000);
  camera.position.set(0, 120, 340);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 80, 0);

  scene.add(new THREE.AmbientLight(0x8899bb, 1.4));
  const dir = new THREE.DirectionalLight(0xffffff, 0.9);
  dir.position.set(120, 260, 160);
  scene.add(dir);
  const fill = new THREE.DirectionalLight(0x6688aa, 0.5);
  fill.position.set(-140, 120, -120);
  scene.add(fill);

  // 地面格网：给动作一个参照（高度/位移一眼可见）
  const grid = new THREE.GridHelper(600, 12, 0x445566, 0x2a3340);
  scene.add(grid);

  // 调试可视化（默认关）
  const axes = new THREE.AxesHelper(120);
  axes.visible = false;
  scene.add(axes);
  let boneHelper: THREE.SkeletonHelper | null = null;

  function resize(): void {
    camera.aspect = container.clientWidth / Math.max(1, container.clientHeight);
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  }
  window.addEventListener('resize', resize);
  resize();

  /* ─────────── 演员状态 ─────────── */

  let actor: StageActor | null = null;
  /** 主手武器挂载器（含双手武器镜像份）—— 与自机/远端同一实现，本层不再自己判骨骼/镜像 */
  const mainMount = new WeaponMount();
  let offWeapon: THREE.Group | null = null;

  let animFrame = 0;
  let curMotion: MotionInfo | null = null;
  let wasFinished = false;
  /** 本次播放已触发过的事件帧个数（playMotion 时重置） */
  let eventsFired = 0;

  const tmpMat4 = new THREE.Matrix4();
  const posV = new THREE.Vector3();
  const quatQ = new THREE.Quaternion();
  const sclV = new THREE.Vector3();

  /* ─────────── 装配 ─────────── */

  /**
   * **装配代际号**：每次 `loadPlayer`/`loadModel` 自增；**过期的加载不得再动场景**。
   *
   * 为什么必须下沉到这一层：`getSkeleton`/`getBody`/`getHead` 都是**记忆化**的，
   * 骨骼对象跨加载**复用**。若上一轮加载在 `adopt()` 之后才走到 `attachWeapon`（其中有两处
   * await），它会把武器挂到**新角色正在使用的同一套骨骼**上 —— 于是旧武器残留可见。
   * 用户实测症状：萨满拿弓时"一把在手里、一把在背上"（`applyStance` 只管当前那把，
   * 遗留的那把停在被挂时的骨骼上不动）。
   * 调用方（asset-inspector）的 `reloadSeq` 只能丢弃**返回结果**，挡不住这里的场景改动。
   */
  let stageLoadSeq = 0;

  /** 把加载结果接管进来（清旧、入场、建 helper、播 STAND） */
  function adopt(next: StageActor, diag: DiagEntry[]): StageLoadResult {
    clearActor();
    actor = next;
    scene.add(actor.root);

    boneHelper = new THREE.SkeletonHelper(actor.root);
    boneHelper.visible = false;
    scene.add(boneHelper);

    const valid = actor.motions.filter((m) => m.startFrame !== 0 || m.endFrame !== 0);
    diag.push({
      group: '动作', label: `motion 条目 ${valid.length}/${actor.motions.length}`,
      expected: '每个 state 至少 1 条', ok: valid.length > 0,
      note: summarizeStates(valid),
    });

    const stand = actor.motions.find((m) => m.endFrame > m.startFrame && motionStateName(m.state) === 'STAND')
      ?? valid[0] ?? null;
    playMotion(stand);

    return {
      ok: true, diag, motions: actor.motions,
      textures: { loaded: 0, failed: [] },
      isPlayer: false, soundKey: '', boneNames: actor.bones.map((b) => b.name),
    };
  }

  /** 玩家角色 */
  async function loadPlayer(app: InspectorAppearance, stance: 'combat' | 'sheathed' = 'combat'): Promise<StageLoadResult> {
    const diag: DiagEntry[] = [];
    const mySeq = ++stageLoadSeq;          // 本轮的代际号（过期即不得动场景）
    const superseded = () => mySeq !== stageLoadSeq;
    const job = JOB_DATA[app.jobId];
    if (!job) {
      return fail(diag, '角色', `职业 ${app.jobId}`, 'JOB_DATA 条目',
        '无该职业的模型数据（注意 JOB_DATA 只覆盖职业 1-10）');
    }

    const bodyInxPath = app.bodyInxOverride || getBodyInxPath(app.jobId, app.armorNum) || job.bodyInx;
    const headInxPath = getHeadInxPath(app.jobId, app.faceNum, app.tier) || '(空)';

    let skelData: Awaited<ReturnType<typeof getSkeleton>> | null = null;
    try {
      skelData = await getSkeleton(app.jobId);
      diag.push({ group: '角色', label: '骨骼+动画', expected: `${job.bipInx} → ${job.bipSmb}`, ok: true });
    } catch (e) {
      diag.push({ group: '角色', label: '骨骼+动画', expected: `${job.bipInx} → ${job.bipSmb}`, ok: false, note: msg(e) });
    }

    let bodyPart: Awaited<ReturnType<typeof getBody>> | null = null;
    try {
      bodyPart = await getBody(app.jobId, app.armorNum, app.bodyInxOverride);
      diag.push({
        group: '角色', label: `身体 (armor=${app.armorNum})`, expected: bodyInxPath, ok: true,
        note: bodyPart.bodyInxInfo.modelFile ? `model=${bodyPart.bodyInxInfo.modelFile}` : undefined,
      });
    } catch (e) {
      diag.push({ group: '角色', label: `身体 (armor=${app.armorNum})`, expected: bodyInxPath, ok: false, note: msg(e) });
    }

    let headPart: Awaited<ReturnType<typeof getHead>> | null = null;
    try {
      headPart = await getHead(app.jobId, app.faceNum, app.tier);
      diag.push({
        group: '角色', label: `头部 (face=${app.faceNum}, tier=${app.tier})`, expected: headInxPath, ok: true,
        note: headPart.headInxInfo.modelFile ? `model=${headPart.headInxInfo.modelFile}` : undefined,
      });
    } catch (e) {
      diag.push({ group: '角色', label: `头部 (face=${app.faceNum}, tier=${app.tier})`, expected: headInxPath, ok: false, note: msg(e) });
    }

    if (!skelData || !bodyPart) return fail(diag, '角色', '组合', '骨骼+身体', '骨骼或身体加载失败，无法装配');
    // 过期检查①：已有更新的加载在进行 → **不 adopt、不动场景**（否则清掉新角色的装配）
    if (superseded()) return fail(diag, '角色', '装配', '(更新的加载)', '本次加载已被取代，未改动场景');

    const root = new THREE.Group();
    // 骨骼先入 root（蒙皮位置由骨骼决定；WorldView 同款结构）
    root.add(skelData.skel.skeletonGroup);
    root.add(bodyPart.result.group);
    if (headPart) root.add(headPart.result.group);

    const nextActor: StageActor = {
      root,
      skeleton: skelData.skel.skeleton,
      bones: skelData.skel.bones,
      animSmb: skelData.animSmb,
      // 必须用 char/motion-list.ts 的构建器（CHRMOTION_EXT 起 + tmFrame 偏移）；
      // 直接用 bipInxInfo.motions 会让所有动作的帧范围错误
      motions: buildMotionList(skelData.animSmb, skelData.bipInxInfo),
      meshes: [...bodyPart.result.meshes, ...(headPart ? headPart.result.meshes : [])] as unknown as THREE.Mesh[],
      bodyGroup: bodyPart.result.group,
      headGroup: headPart ? headPart.result.group : undefined,
      bodyMeshes: bodyPart.result.meshes as unknown as THREE.Mesh[],
    };

    const texTargets = [
      ...bodyPart.result.texturesToLoad,
      ...(headPart ? headPart.result.texturesToLoad : []),
    ];
    const texRes = await loadCharTextures(texTargets, renderer.capabilities.getMaxAnisotropy());

    const res = adopt(nextActor, diag);
    res.textures = texRes;
    res.isPlayer = true;
    diag.push({
      group: '纹理', label: `${texTargets.length} 张（身体+头部）`,
      expected: `${texRes.loaded} 成功 / ${texRes.failed.length} 失败`,
      ok: texRes.failed.length === 0,
      note: texRes.failed.slice(0, 6).join(', ') || undefined,
    });

    // 武器（玩家专有）。⚠ 挂武器前**再查一次代际**：`attachWeapon` 内部有 await，
    // 若期间又触发了一次加载，本轮的武器会被挂到**新角色复用的同一套骨骼**上而残留可见。
    if (superseded()) return res;
    await attachMainWeapon(app.weaponDorp, app, stance, diag, superseded);
    if (superseded()) return res;
    if (app.offHandDorp && app.offHandKind) {
      await attachOffWeapon(app.offHandDorp, app, stance, diag, superseded);
    }

    applyDebugFlags();
    res.boneNames = nextActor.bones.map((b) => b.name);
    return res;
  }

  /** 怪物 / NPC / 宠物：按 .inx 路径加载 */
  async function loadModel(inxPath: string, label?: string): Promise<StageLoadResult> {
    const diag: DiagEntry[] = [];
    const mySeq = ++stageLoadSeq;          // 同 loadPlayer：过期的加载不得动场景
    const name = label || inxPath;
    try {
      const r = await loadMonsterModel(inxPath);
      const root = new THREE.Group();
      root.add(r.skeletonGroup);   // 同玩家：骨骼与网格同 root
      root.add(r.group);
      const nextActor: StageActor = {
        root,
        skeleton: r.skeleton,
        bones: r.bones,
        animSmb: r.animSmb,
        motions: r.motionList,
        meshes: r.meshes as unknown as THREE.Mesh[],
      };
      const texRes = await loadCharTextures(r.texturesToLoad, renderer.capabilities.getMaxAnisotropy());
      // 过期检查：已有更新的加载 → 不 adopt（否则会把新角色清掉）
      if (mySeq !== stageLoadSeq) return fail(diag, '模型', name, inxPath, '本次加载已被取代，未改动场景');
      diag.push({ group: '模型', label: name, expected: inxPath, ok: true });
      diag.push({ group: '模型', label: '网格 .smd', expected: r.modelBase, ok: true });
      diag.push({
        group: '模型', label: '动画源 .smb', expected: r.animBase, ok: true,
        note: `motion 条目源 ${r.motionInx.motionFile || r.motionInx.modelFile || '(自身 inx)'}`,
      });
      diag.push({
        group: '纹理', label: `${r.texturesToLoad.length} 张`,
        expected: `${texRes.loaded} 成功 / ${texRes.failed.length} 失败`,
        ok: texRes.failed.length === 0,
        note: texRes.failed.slice(0, 6).join(', ') || undefined,
      });

      const res = adopt(nextActor, diag);
      res.textures = texRes;
      res.isPlayer = false;
      res.soundKey = basename(inxPath);
      res.boneNames = nextActor.bones.map((b) => b.name);
      applyDebugFlags();
      return res;
    } catch (e) {
      return fail(diag, '模型', name, inxPath, msg(e));
    }
  }

  /**
   * 挂主手武器（含双手武器的镜像份）。**只负责加载与代际校验** ——
   * 挂到哪根骨、要不要镜像、姿态怎么搬，全在 `WeaponMount`（自机/远端/检查器同一实现）。
   * 这里不再自己算骨骼名：检查器曾因此成为唯一实现了镜像的地方，游戏内反而没有。
   */
  async function attachMainWeapon(
    dorp: string, app: InspectorAppearance, stance: 'combat' | 'sheathed',
    diag: DiagEntry[], superseded?: () => boolean,
  ): Promise<void> {
    if (!actor) return;
    if (!dorp) {
      mainMount.mount(actor!.root, null, 0, 0, stance);
      diag.push({ group: '装备', label: '主手', expected: '(未装备)', ok: true });
      return;
    }
    const expected = `image/sinimage/items/dropitem/it${dorp.toLowerCase()}.smd`;
    try {
      const wres = await loadWeaponModel(dorp);
      const tx = await loadCharTextures(wres.texturesToLoad, renderer.capabilities.getMaxAnisotropy());
      // ⚠ 两处 await 之后**必须复查代际**：过期就丢弃这个组，绝不挂到（被复用的）骨骼上
      if (superseded?.()) {
        diag.push({ group: '装备', label: `主手 ${dorp}`, expected, ok: true, note: '加载期间已被新的加载取代，未挂载' });
        return;
      }
      const res = mainMount.mount(actor!.root, wres.group, app.weaponIdcode, app.weaponPos, stance);
      diag.push({
        group: '装备', label: `主手 ${dorp}`, expected,
        ok: !res.missingBone,
        note: `纹理 ${tx.loaded} 成功 / ${tx.failed.length} 失败`
          + (res.mainBone ? `｜挂 ${res.mainBone}` : '')
          + (res.mirrorBone ? `｜镜像 ${res.mirrorBone}` : '')
          + (res.missingBone ? `｜缺骨 ${res.missingBone}` : ''),
      });
    } catch (e) {
      diag.push({ group: '装备', label: `主手 ${dorp}`, expected, ok: false, note: msg(e) });
    }
  }

  /** 挂副手件（盾/匕首）：骨名走 `offMountBoneOf`（与自机/远端同一判定） */
  async function attachOffWeapon(
    dorp: string, app: InspectorAppearance, stance: 'combat' | 'sheathed',
    diag: DiagEntry[], superseded?: () => boolean,
  ): Promise<void> {
    if (!actor) return;
    const slot = `副手(${app.offHandKind === 1 ? '盾' : '匕首'})`;
    if (!dorp) { diag.push({ group: '装备', label: slot, expected: '(未装备)', ok: true }); return; }
    const expected = `image/sinimage/items/dropitem/it${dorp.toLowerCase()}.smd`;
    try {
      const wres = await loadWeaponModel(dorp);
      const tx = await loadCharTextures(wres.texturesToLoad, renderer.capabilities.getMaxAnisotropy());
      if (superseded?.()) {
        diag.push({ group: '装备', label: `${slot} ${dorp}`, expected, ok: true, note: '加载期间已被新的加载取代，未挂载' });
        return;
      }
      offWeapon = wres.group;
      attach(wres.group, offMountBoneOf(app.weaponIdcode, app.offHandKind, stance));
      diag.push({ group: '装备', label: `${slot} ${dorp}`, expected, ok: true, note: `纹理 ${tx.loaded} 成功 / ${tx.failed.length} 失败` });
    } catch (e) {
      diag.push({ group: '装备', label: `${slot} ${dorp}`, expected, ok: false, note: msg(e) });
    }
  }

  /** 挂到骨骼；找不到指定骨则按回退链尝试 */
  function attach(obj: THREE.Group, boneName: string): void {
    if (!actor) return;
    const bone = findBone(actor.root, boneName)
      || findBone(actor.root, WEAPON_BONES.RIGHT_HAND)
      || findBone(actor.root, WEAPON_BONES.LEFT_HAND);
    if (bone) bone.add(obj);
    else console.warn('[inspector] 找不到挂载骨:', boneName);
  }

  function fail(diag: DiagEntry[], group: string, label: string, expected: string, note: string): StageLoadResult {
    diag.push({ group, label, expected, ok: false, note });
    return { ok: false, diag, motions: [], textures: { loaded: 0, failed: [] }, isPlayer: false, soundKey: '', boneNames: [] };
  }

  /**
   * 局部换头。与原 loadPlayer 的区别：**不新建 root、不 scene.remove、不重建 mixer**，
   * 只把头部网格组换掉 —— 骨架与当前动作完全不动。
   * （loadPlayer 每次都会新建 root 并重建动画，故换脸/换甲会把动画重置；
   *   且摘装之间蒙皮与新挂载骨架存在一帧不同步 → 视觉撕裂。用户实测踩到过。）
   */
  async function swapHead(app: InspectorAppearance): Promise<{ loaded: number; failed: string[]; note: string }> {
    const a = actor;
    if (!a || !a.bodyGroup) return { loaded: 0, failed: ['尚未加载玩家角色'], note: '' };
    let headPart;
    try {
      headPart = await getHead(app.jobId, app.faceNum, app.tier);
    } catch (e) {
      return { loaded: 0, failed: [msg(e)], note: '' };
    }
    a.headGroup?.removeFromParent();
    a.headGroup = headPart.result.group;
    a.root.add(a.headGroup);
    a.meshes = [
      ...(a.bodyMeshes ?? []),
      ...(headPart.result.meshes as unknown as THREE.Mesh[]),
    ];
    const texRes = await loadCharTextures(headPart.result.texturesToLoad, renderer.capabilities.getMaxAnisotropy());
    // 档位变体不是每个 (家族,脸) 都有（新职业只有脸 01~03）→ 回退到基础档时明确告知，
    // 免得"选了 tier4 却是 tier1 的样子"被当成 bug。
    const fellBack = /[a-d]\.inx$/.test(headPart.headInxUsed) === false && app.tier > 0;
    const notes: string[] = [];
    if (fellBack) notes.push(`该档位无此脸，已用基础档（${headPart.headInxUsed.split('/').pop()}）`);
    // 未知骨名 = 顶点会被兜底绑到根骨 → 表现为"变形"。把名字报出来，别让它只以变形示人。
    const ub = headPart.diag.unknownBones;
    if (ub.length) notes.push(`未知骨名 ${ub.length} 个（会绑到根骨致变形）：${ub.map((u) => `${u.name}×${u.count}`).join(', ')}`);
    if (headPart.diag.meshFilterMissed) notes.push(`网格名一个未中，已用全部 ${headPart.diag.meshCount} 个网格`);
    return { loaded: texRes.loaded, failed: texRes.failed, note: notes.join('；') };
  }

  function msg(e: unknown): string { return e instanceof Error ? e.message : String(e); }

  function basename(p: string): string {
    const s = p.replace(/\\/g, '/').toLowerCase();
    return s.slice(s.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
  }

  function summarizeStates(motions: MotionInfo[]): string {
    const groups = new Map<string, number>();
    for (const m of motions) {
      const n = motionStateName(m.state);
      groups.set(n, (groups.get(n) ?? 0) + 1);
    }
    return [...groups.entries()].map(([k, v]) => `${k}×${v}`).join(' ');
  }

  function clearActor(): void {
    mainMount.detach();          // 主手 + 镜像份一起摘（WeaponMount 管）
    if (offWeapon) offWeapon.parent?.remove(offWeapon);
    if (actor) scene.remove(actor.root);
    if (boneHelper) { scene.remove(boneHelper); boneHelper = null; }
    offWeapon = null;
    actor = null;
    curMotion = null;
    animFrame = 0;
  }

  /* ─────────── 播放 ─────────── */

  function playMotion(m: MotionInfo | null): void {
    curMotion = m;
    animFrame = m ? m.startFrame * 160 : 0;
    wasFinished = false;
    eventsFired = 0;   // 每次重播都重置事件帧计数
  }

  function frameRange(): { start: number; end: number } | null {
    if (!curMotion) return null;
    return { start: curMotion.startFrame * 160, end: curMotion.endFrame * 160 };
  }

  function setFrame(f: number): void {
    const r = frameRange();
    if (!r) return;
    animFrame = Math.max(r.start, Math.min(r.end, f));
  }

  function stepFrames(n: number): void { setFrame(animFrame + n * 160); }

  /* ─────────── 调试可视化 ─────────── */

  let wireframe = false, showBones = false, showAxes = false;

  function applyDebugFlags(): void {
    if (!actor) return;
    for (const m of actor.meshes) {
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        const mm = mat as THREE.MeshPhongMaterial;
        if ('wireframe' in mm) mm.wireframe = wireframe;
      }
    }
    if (boneHelper) boneHelper.visible = showBones;
    axes.visible = showAxes;
  }


  /** 演员世界位置 */
  function actorPos(): { x: number; y: number; z: number } | null {
    if (!actor) return null;
    const p = actor.root.position;
    return { x: p.x, y: p.y, z: p.z };
  }

  function setActorPos(x: number, y: number, z: number): void {
    if (!actor) return;
    actor.root.position.set(x, y, z);
  }

  /* ─────────── 特效（INI 广告牌） ─────────── */

  const effects = createEffectManager(scene);
  let lastEffectDiag: EffectDiag | null = null;
  let lastPartDiag: LoadedPart['diag'] | null = null;

  /** 在演员附近播放一个 INI 特效（缺省：身前、胸口高度） */
  async function spawnEffect(
    name: string,
    offset: { x: number; y: number; z: number } = { x: 0, y: 25, z: 30 },
  ): Promise<boolean> {
    const base = actor ? actor.root.position : new THREE.Vector3();
    const ok = await effects.spawn(name, {
      pos: { x: base.x + offset.x, y: base.y + offset.y, z: base.z + offset.z },
    });
    lastEffectDiag = effects.lastDiag();
    lastPartDiag = effects.lastPart();
    return ok;
  }

  /* ─────────── 每帧 ─────────── */

  const clock = new THREE.Clock();
  const stage: CharStage = {
    loadPlayer,
    swapHead,
    loadModel,
    playMotion,
    currentMotion: () => curMotion,
    currentFrame: () => animFrame,
    frameRange,
    setFrame,
    motions: () => actor?.motions ?? [],
    paused: false,
    speed: 1,
    looping: true,
    setPaused(v) { stage.paused = v; },
    stepFrames,
    stop() { const r = frameRange(); if (r) setFrame(r.start); stage.paused = true; },
    setWeaponStance(stance) {
      if (!actor) return { mainBone: null, mirrorBone: null, missingBone: null };
      // 主手（含刺客匕首镜像份）交给共用实现；调用方不再自己算骨骼名
      return mainMount.setStance(actor.root, stance);
    },
    setSpeed(v) { stage.speed = Math.max(0.05, v); },
    setLooping(v) { stage.looping = v; },
    setCamera(preset) {
      // 相对演员位置取景（有地图后演员不在原点）
      const p = actor ? actor.root.position : new THREE.Vector3();
      const targetY = p.y + (preset === 'full' ? 80 : 110);
      controls.target.set(p.x, targetY, p.z);
      if (preset === 'full') camera.position.set(p.x, p.y + 130, p.z + 360);
      else if (preset === 'upper') camera.position.set(p.x, p.y + 130, p.z + 170);
      else camera.position.set(p.x + 90, p.y + 120, p.z + 150);
      camera.updateProjectionMatrix();
    },
    setWireframe(v) { wireframe = v; applyDebugFlags(); },
    setShowBones(v) { showBones = v; applyDebugFlags(); },
    setShowAxes(v) { showAxes = v; applyDebugFlags(); },
    setActorPos,
    actorPos,
    spawnEffect,
    effectDiag: () => lastEffectDiag,
    partDiag: () => lastPartDiag,
    finished: () => wasFinished,
    dispose() {
      clearActor();
      renderer.dispose();
    },
  };

  function tick(): void {
    requestAnimationFrame(tick);
    const dt = clock.getDelta();
    controls.update();

    // 调试句柄：控制台/自动化里可查场景、绘制统计与特效实例（开发工具，不参与游戏）
    (globalThis as unknown as { __inspector?: unknown }).__inspector = {
      scene, camera, renderer, actor,
      effects,
      sprites: () => {
        const out: Array<Record<string, unknown>> = [];
        scene.traverse((o) => {
          const sp = o as THREE.Sprite;
          if ((sp as unknown as { isSprite?: boolean }).isSprite) {
            const m = sp.material as THREE.SpriteMaterial;
            out.push({
              pos: [+sp.position.x.toFixed(1), +sp.position.y.toFixed(1), +sp.position.z.toFixed(1)],
              scale: [+sp.scale.x.toFixed(1), +sp.scale.y.toFixed(1)],
              visible: sp.visible, opacity: +m.opacity.toFixed(3),
              hasMap: !!m.map, blending: m.blending,
            });
          }
        });
        return out;
      },
    };

    // 特效逐帧推进（INI 帧时长以 70Hz 计；.part 需要相机做朝向）
    effects.update(dt, camera);

    if (actor && curMotion) {
      if (!stage.paused) {
        // 帧推进走共享实现（与 WorldView 同一函数）；检查器的"循环"开关覆盖动作自身的 repeat
        const step = advanceAnimFrame(
          animFrame, { ...curMotion, repeat: stage.looping ? 1 : 0 }, dt, stage.speed,
        );
        // 循环回绕（帧号跳回起点）→ 重置事件帧计数，使循环预览每轮都能再次触发事件
        //（否则第二圈起事件不再触发，攻击音只在第一圈响一次）
        if (step.frame < animFrame) eventsFired = 0;
        animFrame = step.frame;
        if (step.ended) wasFinished = true;
      }

      // 求值用"该条目自带的 .smb 优先，回退主体 .smb"——子模型动画条目（MotionInfo.animSmb）
      // 若一律用主体 smb 求值，姿态全错。此处与 WorldView 保持一致（WorldView:1979/2551/2769）。
      const frames = evalSkeleton(curMotion.animSmb ?? actor.animSmb, animFrame, false);
      applyToBones(actor.bones, frames, tmpMat4, posV, quatQ, sclV);
      actor.skeleton.update();

      // 事件帧派发（相对 startFrame；跨过即触发一次）
      const evs = Array.from(curMotion.eventFrame ?? []).filter((x) => x > 0).sort((a, b) => a - b);
      const comp = animFrame - curMotion.startFrame * 160;
      while (eventsFired < evs.length && comp >= evs[eventsFired]!) {
        stage.onMotionEvent?.(eventsFired);
        eventsFired++;
      }

      stage.onFrame?.(animFrame, curMotion);
    }

    renderer.render(scene, camera);
  }
  tick();

  return stage;
}
