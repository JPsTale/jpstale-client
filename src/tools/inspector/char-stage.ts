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
import { loadWeaponModel, findBone, WEAPON_BONES } from '../../render/weapon-loader.js';
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
  loadPlayer(app: InspectorAppearance): Promise<StageLoadResult>;
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
  /** 动作播到末尾且未循环 */
  finished(): boolean;
  onFrame?: (frame: number, motion: MotionInfo | null) => void;
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
  let mainWeapon: THREE.Group | null = null;
  let offWeapon: THREE.Group | null = null;

  let animFrame = 0;
  let curMotion: MotionInfo | null = null;
  let wasFinished = false;

  const tmpMat4 = new THREE.Matrix4();
  const posV = new THREE.Vector3();
  const quatQ = new THREE.Quaternion();
  const sclV = new THREE.Vector3();

  /* ─────────── 装配 ─────────── */

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
  async function loadPlayer(app: InspectorAppearance): Promise<StageLoadResult> {
    const diag: DiagEntry[] = [];
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

    // 武器（玩家专有）
    await attachWeapon(app.weaponDorp, app.weaponPos === 2 ? WEAPON_BONES.LEFT_HAND : WEAPON_BONES.RIGHT_HAND,
      '主手', diag);
    if (app.offHandDorp && app.offHandKind) {
      await attachWeapon(app.offHandDorp, app.offHandKind === 1 ? WEAPON_BONES.SHIELD : WEAPON_BONES.LEFT_HAND,
        `副手(${app.offHandKind === 1 ? '盾' : '匕首'})`, diag);
    }

    applyDebugFlags();
    res.boneNames = nextActor.bones.map((b) => b.name);
    return res;
  }

  /** 怪物 / NPC / 宠物：按 .inx 路径加载 */
  async function loadModel(inxPath: string, label?: string): Promise<StageLoadResult> {
    const diag: DiagEntry[] = [];
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

  async function attachWeapon(dorp: string, boneName: string, slot: string, diag: DiagEntry[]): Promise<void> {
    if (!dorp) { diag.push({ group: '装备', label: slot, expected: '(未装备)', ok: true }); return; }
    const expected = `image/sinimage/items/dropitem/it${dorp.toLowerCase()}.smd`;
    try {
      const wres = await loadWeaponModel(dorp);
      const tx = await loadCharTextures(wres.texturesToLoad, renderer.capabilities.getMaxAnisotropy());
      if (slot === '主手') mainWeapon = wres.group; else offWeapon = wres.group;
      attach(wres.group, boneName);
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
    if (mainWeapon) mainWeapon.parent?.remove(mainWeapon);
    if (offWeapon) offWeapon.parent?.remove(offWeapon);
    if (actor) scene.remove(actor.root);
    if (boneHelper) { scene.remove(boneHelper); boneHelper = null; }
    mainWeapon = offWeapon = null;
    actor = null;
    curMotion = null;
    animFrame = 0;
  }

  /* ─────────── 播放 ─────────── */

  function playMotion(m: MotionInfo | null): void {
    curMotion = m;
    animFrame = m ? m.startFrame * 160 : 0;
    wasFinished = false;
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

  /* ─────────── 每帧 ─────────── */

  const clock = new THREE.Clock();
  const stage: CharStage = {
    loadPlayer,
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

    if (actor && curMotion) {
      if (!stage.paused) {
        // 帧推进走共享实现（与 WorldView 同一函数）；检查器的"循环"开关覆盖动作自身的 repeat
        const step = advanceAnimFrame(
          animFrame, { ...curMotion, repeat: stage.looping ? 1 : 0 }, dt, stage.speed,
        );
        animFrame = step.frame;
        if (step.ended) wasFinished = true;
      }

      // 求值用"该条目自带的 .smb 优先，回退主体 .smb"——子模型动画条目（MotionInfo.animSmb）
      // 若一律用主体 smb 求值，姿态全错。此处与 WorldView 保持一致（WorldView:1979/2551/2769）。
      const frames = evalSkeleton(curMotion.animSmb ?? actor.animSmb, animFrame, false);
      applyToBones(actor.bones, frames, tmpMat4, posV, quatQ, sclV);
      actor.skeleton.update();
      stage.onFrame?.(animFrame, curMotion);
    }

    renderer.render(scene, camera);
  }
  tick();

  return stage;
}
