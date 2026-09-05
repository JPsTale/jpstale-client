/**
 * WORLD 屏：复刻 /pt/maps/ 的地图渲染 + dummy 角色 + debug 相机跟随。
 * 唯一差异：地图从服务端 enterGame 的 mapId/出生点读取，而非下拉选择。
 * 权威依据：pt-web-server/static/maps/index.html + docs/fields/pt-map-renderer-design.md §3.10.2。
 * 坐标：出生点 world = (-z, y, -x)；地图顶点 world = raw/256 + 轴交换（map-renderer 内部处理）。
 */
import * as THREE from 'three';
import { loadMap, updateFrameAnimations, getMapWorldBounds } from '../maps/fore1.js';
import { mapSmdPath, MAP_CATALOG } from '../maps/map-catalog.js';
import { minimapBase } from '../maps/map-data.js';
import { mapDecorList } from '../maps/map-decor.js';
import { loadMapDecor, unloadDecor } from '../maps/decor-loader.js';
import { neighborMaps } from '../maps/map-gates.js';
import { CollisionMesh } from '../maps/collision.js';
import { mapLightProfile } from '../maps/map-light.js';
import { t } from '../i18n/index.js';
import { loadCharacterModel } from '../render/char-loader.js';
import { mapAudio } from '../maps/map-audio.js';
import type { SceneLightWorld } from '../render/map-renderer.js';
import { createAnimStateMachine } from '../char/anim-state-machine.js';
import type { MotionInfo } from '../char/char-format.js';
import { CHRMOTION_EXT } from '../char/char-format.js';
import { evalSkeleton, applyToBones } from '../char/animation.js';
import { decodeTextureAsync } from '../core/texture.js';
import type { CharacterAppearance } from './CharSelect.js';
import { armorNumFromIdCode } from './CharSelect.js';
import { resolveCostumeBody } from '../render/costume-body-map.js';
import { loadWeaponModel, findBone, WEAPON_BONES } from '../render/weapon-loader.js';

export interface EnterGameInfo {
  playerId: number;
  mapId: number;
  position: { x: number; y: number; z: number };
  rotation?: { x: number; y: number; z: number }; // 出生朝向（ay=引擎角度 0-4095）
  appearance?: CharacterAppearance;
}

/** 进图加载出口：main.ts 喂给 LoadingScreen（阶段进度 + 首帧渲染完成） */
export interface WorldLoadHooks {
  onProgress?: (current: number, max: number) => void;
  onReady?: () => void;
}

export interface WorldView {
  show(enterGame: EnterGameInfo, hooks?: WorldLoadHooks): void;
  hide(): void;
  destroy(): void;
  /** 游戏时间（0-23时/0-59分）：昼夜驱动源（忠实 /pt/maps darkLevel/BackColor 渐变） */
  setGameTime(hour: number, min: number): void;
  /** 切换场内小地图显示（原版 TAB） */
  toggleMinimap(): void;
  /** 走/跑模式（真源）；返回切换后的值 */
  toggleRun(): boolean;
  /** 当前是否跑 */
  isRunning(): boolean;
  /** 记录自机 playerId（enterGame.playerId），供 S2C_PlayerMove 路由收敛 */
  setSelfId(playerId: number): void;
  /** playerId 是否为自机（供 S2C_PlayerAppear 丢弃自己的外观快照） */
  isSelf(playerId: number): boolean;
  /** 服务端权威移动（S2C_PlayerMove）：自机→阈值收敛插值；他人→远端演员跟踪 */
  applyPlayerMove(playerId: number, x: number, y: number, z: number, angle: number, animState: number): void;
  /** 玩家进入视野（S2C_PlayerAppear）→ 异步加载独立克隆演员 */
  playerAppear(playerId: number, name: string, classId: number, level: number, x: number, y: number, z: number, appearance?: CharacterAppearance): void;
  /** 玩家离开视野（S2C_PlayerDisappear）→ 移除演员 */
  playerDisappear(playerId: number): void;
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
   *  anim=动画覆盖：0=按 mode 推导；下落 FALLDOWN=0x70、落地 FALLSTAND=0x71/FALLDAMAGE=0x72。 */
  onMoveInt?: (angle: number, mode: 0 | 1 | 2, x: number, y: number, z: number, anim?: number) => void;
}

// 动画状态 wire token（与 S2C_PlayerMove.anim_state / C2S anim_state 同义）
const ANIM_WALK = 0x0050;
const ANIM_RUN = 0x0060;
const ANIM_FALLDOWN = 0x0070;
const ANIM_FALLSTAND = 0x0071;
const ANIM_FALLDAMAGE = 0x0072;

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

  // ---- 走/跑模式（真源；移动中切换经 onMoveInt 出口上报 C2S）---
  let running = true; // 默认跑
  let dirLight: THREE.DirectionalLight | null = null; // 平行光（供角色等受光材质，强度随昼夜压暗）

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
  const mapHandles = new Map<number, Awaited<ReturnType<typeof loadMap>>>();
  const collisionMeshes = new Map<number, CollisionMesh>();
  const decorGroups = new Map<number, THREE.Group[]>(); // mapId → 装饰 group 列表
  // 全部 44 图 world AABB（预取，用于 findCurrentMap 判归属，不依赖是否已加载）
  const allBounds = new Map<number, [number, number, number, number]>();
  let charGroup: THREE.Group | null = null;
  let dummyGroup: THREE.Group | null = null;
  let selfAngle = 0; // 角色朝向（弧度）
  let animSmb: Awaited<ReturnType<typeof loadCharacterModel>>['animSmb'] | null = null;
  let bipInxInfo: Awaited<ReturnType<typeof loadCharacterModel>>['bipInxInfo'] | null = null;
  let bones: THREE.Bone[] = [];
  let skeleton: THREE.Skeleton | null = null;
  let animState: ReturnType<typeof createAnimStateMachine> | null = null;
  let motionList: MotionInfo[] = [];
  let animFrameId = 0;
  let animFrame = 0;
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
  let mouseDown = false;
  let mouseX = 0, mouseY = 0;

  // 本地移动步速 world/s（与服务端限速同源：EU 最高档 run=×460 / walk=×180 @cnt25）
  const RUN_WPS = (((25 * 10 + 250) * 460) >> 8) / 256 * 60;   // ≈210.5
  const WALK_WPS = (((25 * 10 + 250) * 180) >> 8) / 256 * 60;  // ≈82.3
  // 上报状态机
  let wasMoving = false;        // 上一帧是否在移动（本地动画/停止上报去重）
  let lastMoveReportAt = 0;
  const MOVE_REPORT_MS = 40;    // 移动中上报节奏 ≈25Hz（服务端 20Hz tick 消费）
  // 掉落状态（对齐原版：下落有 FALLDOWN 动画，下落中不能水平移动/转向）
  let falling = false;          // 是否正在下落
  let fallHeight = 0;           // 下落起始高度差（触发 FALLDAMAGE 判定）
  let lastY = 0;                // 上一帧自机 y（检测下落位移，同步角色高度）

  function wrapAngle(a: number): number {
    const tau = Math.PI * 2;
    return ((a + Math.PI) % tau + tau) % tau - Math.PI;
  }

  const keys: Record<string, boolean> = {};
  window.addEventListener('keydown', (e) => { keys[e.code] = true; });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });
  // C 键：控制台打印角色/相机调试信息
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyC') debugDump();
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
  // 俯仰角 anx 初始 33.75°（引擎角度 384 → 弧度），any=0；fov=40.9, near=20, far=4000（JS 世界单位）
  const cam = {
    dist: 100,
    viewDist: 100,
    anx: (384 / 4096) * Math.PI * 2,   // 33.75°
    viewAnx: (384 / 4096) * Math.PI * 2,
    any: 0,
    fov: 40.9,
  };
  const CAM_ROT_STEP = (16 / 4096) * Math.PI * 2; // 引擎角度 ±16 → 弧度
  const CAM_ANX_MIN = (40 / 4096) * Math.PI * 2;
  const CAM_ANX_MAX = (976 / 4096) * Math.PI * 2;
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
  let mmVisible = true;
  const mmImg = new Map<string, HTMLImageElement>(); // url → image
  const mmLoading = new Set<string>();
  let mmAssetsInit = false;          // arrow/mapbox 一次性

  async function ensureMMImg(url: string): Promise<void> {
    if (mmImg.has(url) || mmLoading.has(url)) return;
    mmLoading.add(url);
    try {
      const resp = await fetch(url);
      if (!resp.ok) return;
      const buf = await resp.arrayBuffer();
      // dev 服务器对缺失文件回退成 index.html(200)；按魔数排除
      if (buf.byteLength === 0 || new Uint8Array(buf)[0] === 0x3c /* '<' */) return;
      const dec = await decodeTextureAsync(buf);
      if (!dec) return;
      const c = document.createElement('canvas');
      c.width = dec.width; c.height = dec.height;
      c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(dec.pixels), dec.width, dec.height), 0, 0);
      const img = new Image();
      img.src = c.toDataURL();
      await new Promise<void>((r) => { img.onload = () => r(); img.onerror = () => r(); });
      mmImg.set(url, img);
    } catch { /* 缺资源忽略 */ } finally {
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

  function toggleMinimap(): void {
    mmVisible = !mmVisible;
    mmEl.style.display = mmVisible ? 'block' : 'none';
  }

  const tmp = new THREE.Matrix4();
  const posV = new THREE.Vector3();
  const quatQ = new THREE.Quaternion();
  const sclV = new THREE.Vector3();
  const clock = new THREE.Clock();

  function ensure3D(): void {
    if (renderer) return;
    renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(root.clientWidth, root.clientHeight, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    root.appendChild(renderer.domElement);
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111122);
    camera = new THREE.PerspectiveCamera(cam.fov, 1, 20, 4000);
    camera.position.set(0, 200, 400);
    const amb = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(amb);
    const dir = new THREE.DirectionalLight(0xffffff, 0.85);
    dir.position.set(200, 400, 200);
    scene.add(dir);
    dirLight = dir;
    buildAxis();
    buildDummy();
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
      mh.mapRenderer.updateDayNight(envLight, sceneLights, torchPos, torchColor, torchRange);
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

  // 坐标轴参考（复刻 /pt/maps/：三色圆柱+圆锥+标签），用于判断朝向。挂到出生点。
  let axisGroup: THREE.Group | null = null;
  function buildAxis(): void {
    if (!scene) return;
    const g = new THREE.Group();
    const axisLen = 50;
    const axisColors = [0xff3333, 0x33ff33, 0x3333ff];
    const axisDirs = [new THREE.Vector3(1,0,0), new THREE.Vector3(0,1,0), new THREE.Vector3(0,0,1)];
    const axisLabels = ['X', 'Y', 'Z'];
    axisDirs.forEach((d, i) => {
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, axisLen, 8), new THREE.MeshBasicMaterial({ color: axisColors[i] }));
      cyl.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), d.clone().normalize());
      cyl.position.copy(d.clone().multiplyScalar(axisLen/2));
      g.add(cyl);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(1.4, 5, 10), new THREE.MeshBasicMaterial({ color: axisColors[i] }));
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), d.clone().normalize());
      cone.position.copy(d.clone().multiplyScalar(axisLen));
      g.add(cone);
      const canvas = document.createElement('canvas');
      canvas.width = 64; canvas.height = 64;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#fff'; ctx.font = 'bold 40px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(axisLabels[i], 32, 32);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false }));
      sprite.position.copy(d).multiplyScalar(axisLen + 3);
      sprite.scale.set(6, 6, 1);
      g.add(sprite);
    });
    scene.add(g);
    axisGroup = g;
  }

  // 复刻 /pt/maps/ dummy 角色：蓝线框盒（碰撞体）+ 红前向线 + 绿 beacon
  function buildDummy(): void {
    if (!scene) return;
    const PAT_HEIGHT = 44, PAT_WIDTH = 44;
    const BODY_HEIGHT = 0.75 * PAT_HEIGHT - 12;
    const BODY_WIDTH = 0.25 * PAT_WIDTH;
    const g = new THREE.Group();
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(BODY_WIDTH * 2, BODY_HEIGHT, BODY_WIDTH * 2),
      new THREE.MeshBasicMaterial({ color: 0x4488ff, wireframe: true }),
    );
    box.position.y = 12 + BODY_HEIGHT / 2;
    g.add(box);
    const fwdGeo = new THREE.BufferGeometry();
    fwdGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 16, 0, 0, 16, 20]), 3));
    g.add(new THREE.Line(fwdGeo, new THREE.LineBasicMaterial({ color: 0xff4444 })));
    const beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 0.5, 80, 6),
      new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true }),
    );
    beacon.position.y = 40 + 80 / 2;
    g.add(beacon);
    scene.add(g);
    dummyGroup = g;
  }

  // 角色纹理加载（复刻 CharSelect：隐藏→加载纹理→显示）
  async function fetchAndDecodeTexture(url: string): Promise<THREE.DataTexture | null> {
    try {
      const resp = await fetch(url, { cache: 'no-store' });
      if (!resp.ok) return null;
      const buf = await resp.arrayBuffer();
      const decoded = await decodeTextureAsync(buf);
      if (!decoded) return null;
      const tex = new THREE.DataTexture(new Uint8Array(decoded.pixels), decoded.width, decoded.height, THREE.RGBAFormat);
      tex.flipY = true;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      return tex;
    } catch { return null; }
  }

  async function loadTextures(textures: { url: string; mat: THREE.MeshPhongMaterial }[]): Promise<void> {
    await Promise.allSettled(textures.map(async (t) => {
      const texPath = t.url.replace(/\\/g, '/').toLowerCase();
      const tex = await fetchAndDecodeTexture('/res/' + texPath);
      if (tex) {
        t.mat.map = tex;
        t.mat.color.set(0xffffff);
        t.mat.alphaTest = 0.5;
        t.mat.transparent = true;
        t.mat.needsUpdate = true;
      }
    }));
  }

  async function loadPlayer(appearance: CharacterAppearance | undefined, jobId: number): Promise<void> {
    if (!scene) return;
    let armorNum = 1;
    let bodyInxOverride: string | null = null;
    if (appearance?.bodyModelIdcode && appearance.bodyModelIdcode > 0) {
      armorNum = armorNumFromIdCode(appearance.bodyModelIdcode);
    } else if (appearance?.bodyModel) {
      bodyInxOverride = resolveCostumeBody(appearance.bodyModel, jobId);
    }
    const head = appearance?.head || 0;
    const result = await loadCharacterModel(jobId, head, 0, armorNum, bodyInxOverride);
    console.log('[WorldView] 自机加载: job=' + jobId + ' bodyMesh=' + result.bodyMeshes.length + ' headMesh=' + result.headMeshes.length);
    charGroup = new THREE.Group();
    result.bodyGroup.visible = false;
    result.headGroup.visible = false;
    // 角色整体（骨骼+身体+头）挂到 charGroup，整体摆位到出生点（对齐 CharSelect 的 skeletonGroup 用法）
    if (result.skeletonGroup) charGroup.add(result.skeletonGroup);
    charGroup.add(result.bodyGroup);
    charGroup.add(result.headGroup);
    scene.add(charGroup);
    charGroup.position.copy(selfPos);
    // 角色朝向：模型默认朝 +Z（引擎 angle 0 基准），按引擎角度绕 Y 旋转
    charGroup.rotation.y = selfAngle;
    animSmb = result.animSmb;
    bipInxInfo = result.bipInxInfo;
    bones = result.bones;
    skeleton = result.skeleton;
    buildMotionList();
    // 加载纹理后显示（复刻 CharSelect：防止灰色闪屏）
    await loadTextures([...result.bodyTextures, ...result.headTextures]);
    result.bodyGroup.visible = true;
    result.headGroup.visible = true;
    animState = createAnimStateMachine({
      getMotions: () => motionList,
      getClassId: () => jobId,
      onMotionChange: (motion: MotionInfo) => {
        animFrame = motion.startFrame * 160;
      },
    });
    animState.triggerIdle();
  }

  function buildMotionListFor(
    animSmb: Awaited<ReturnType<typeof loadCharacterModel>>['animSmb'],
    bipInxInfo: Awaited<ReturnType<typeof loadCharacterModel>>['bipInxInfo'],
  ): MotionInfo[] {
    const list: MotionInfo[] = [];
    const tmFrame = animSmb.tmFrame;
    for (let i = CHRMOTION_EXT; i < bipInxInfo.motionCount; i++) {
      const mi = bipInxInfo.motions[i];
      if (!mi.state && !mi.startFrame && !mi.endFrame) continue;
      let startFrame = mi.startFrame;
      let endFrame = mi.endFrame;
      if (tmFrame && mi.motionFrame > 0 && tmFrame[mi.motionFrame - 1]) {
        const off = tmFrame[mi.motionFrame - 1].startFrame / 160;
        startFrame += off;
        endFrame += off;
      }
      list.push({ ...mi, startFrame, endFrame });
    }
    return list;
  }

  function buildMotionList(): void {
    if (animSmb && bipInxInfo) motionList = buildMotionListFor(animSmb, bipInxInfo);
  }

  // 相机跟随角色（/pt/maps/ updateDummy 同款，Winmain.cpp 卫星相机）
  function updateCamera(): void {
    if (!camera) return;
    // 键盘控制相机（复刻 /pt/maps/ updateDummy：Winmain.cpp:2494-2542，角度改弧度）
    const TAU = Math.PI * 2;
    if (keys['ArrowLeft'])  cam.any = (cam.any + CAM_ROT_STEP) % TAU;
    if (keys['ArrowRight']) cam.any = (cam.any - CAM_ROT_STEP + TAU) % TAU;
    if (keys['ArrowUp'])    cam.dist = Math.max(40, cam.dist - 8);
    if (keys['ArrowDown'])  cam.dist = Math.min(440, cam.dist + 8);
    if (keys['ControlLeft'] || keys['ControlRight']) {
      if (keys['ArrowUp'])   cam.anx = Math.min(CAM_ANX_MAX, cam.anx + CAM_ROT_STEP * 0.5);
      if (keys['ArrowDown']) cam.anx = Math.max(CAM_ANX_MIN, cam.anx - CAM_ROT_STEP * 0.5);
    }
    if (keys['PageUp'])   cam.anx = Math.min(CAM_ANX_MAX, cam.anx + CAM_ROT_STEP);
    if (keys['PageDown']) cam.anx = Math.max(CAM_ANX_MIN, cam.anx - CAM_ROT_STEP);

    if (cam.viewAnx < cam.anx) cam.viewAnx = Math.min(cam.viewAnx + 8, cam.anx);
    if (cam.viewAnx > cam.anx) cam.viewAnx = Math.max(cam.viewAnx - 8, cam.anx);
    if (cam.viewDist < cam.dist) cam.viewDist = Math.min(cam.viewDist + 8, cam.dist);
    if (cam.viewDist > cam.dist) cam.viewDist = Math.max(cam.viewDist - 8, cam.dist);
    const pitchRad = cam.viewAnx;
    const yawRad = cam.any;
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
  async function loadMapById(mapId: number): Promise<boolean> {
    if (!scene || mapHandles.has(mapId)) return false;
    const smdPath = mapSmdPath(mapId);
    if (!smdPath) return false;
    const mh = await loadMap(scene, smdPath);
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
      ' tris=' + mh.mapRenderer.totalFaceCount + ' 碰撞面=' + cm.triangles.length);
    return true;
  }

  function onMouseDown(e: MouseEvent): void {
    if (e.button === 0) { mouseDown = true; mouseX = e.clientX; mouseY = e.clientY; }
  }
  function onMouseUp(e: MouseEvent): void {
    if (e.button === 0) {
      mouseDown = false;
      // 停止上报由 renderLoop 检测 wasMoving→false 时带当前位置发送，保证位置是真正停点
    }
  }
  function onMouseMove(e: MouseEvent): void {
    mouseX = e.clientX; mouseY = e.clientY;
  }

  // 判断角色所属地图（对齐服务端 MapRegionService.findMapPrecise）：
  // 先 AABB 粗筛；多命中或无命中（桥口在图 AABB 外）用已加载图碰撞网格高度判定
  // （对齐原版：遍历 stage 用 GetFloorHeight，谁有地面就在哪）。
  function findCurrentMap(wx: number, wz: number): number {
    const fx = wx * 256, fz = wz * 256; // world → collision (z already matches world convention)
    const hits: number[] = [];
    for (const [mapId, [xMin, xMax, zMin, zMax]] of allBounds) {
      if (wx >= xMin && wx <= xMax && wz >= zMin && wz <= zMax) hits.push(mapId);
    }
    // 优先在已加载图里找实际落地（含桥口：图 AABB 外但网格有面）
    let fallback: { mapId: number; y: number } | null = null;
    for (const [mapId, cm] of collisionMeshes) {
      const h = cm.getPolyHeight(fx, fz);
      if (h.found) {
        // 高度最高者（对齐原版取最高地面）
        if (!fallback || h.height > fallback.y) fallback = { mapId, y: h.height };
      }
    }
    if (fallback) {
      return fallback.mapId;
    }
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) return hits.includes(currentMapId) ? currentMapId : hits[0];
    return currentMapId; // 完全无命中 → 保持当前图
  }

  // 走/跑切换核心：翻转本地状态并经 onMoveInt 出口通报（mode 1/2）；移动中立即切对应动画
  // （原版 character.cpp ChangeMoveMode）
  function setRunMode(next: boolean): boolean {
    if (running === next) return running;
    running = next;
    // 移动中切换走/跑：立即带当前位置通报新档位（服务端据此广播新动画）
    if (mouseDown) opts?.onMoveInt?.(selfAngle, running ? 2 : 1, selfPos.x, selfPos.y, selfPos.z, 0);
    return running;
  }

  // 鼠标指向（屏幕投影 → 世界方向角）：用于本地移动朝向
  function mouseFacing(): number | null {
    if (!camera || !renderer) return null;
    if (!mouseDown) return null;
    if (falling) return null; // 掉落中禁止水平移动/转向（对齐原版：下落时不动）

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
    return Math.atan2(wx / wlen, wz / wlen);
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
  }
  interface RemoteActor {
    playerId: number;
    name: string;
    root: THREE.Group;
    bodyGroup: THREE.Group;
    headGroup: THREE.Group;
    bones: THREE.Bone[];
    skeleton: THREE.Skeleton;
    animSmb: Awaited<ReturnType<typeof loadCharacterModel>>['animSmb'];
    animState: ReturnType<typeof createAnimStateMachine>;
    motionList: MotionInfo[];
    animFrame: number;
    snaps: RemoteSnap[];
    lastAnimState: number;
  }
  const remotes = new Map<number, RemoteActor>();
  const remoteSpawning = new Set<number>();

  // 进场竞态缓存：服务端 onPlayerEnter 广播的 Appear 早于本机 enterGame 到达
  // （此刻 scene 未建、show() 未调用）→ 暂存，show() 建好 scene 后重放，避免被吞。
  const pendingAppears: { playerId: number; name: string; classId: number; level: number; x: number; y: number; z: number }[] = [];

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

  /** 权威动画值 → actor 状态机（0x0050 WALK / 0x0060 RUN / 0x70~0x72 掉落 / 其余 STAND） */
  function setRemoteAnim(actor: RemoteActor, animState: number): void {
    if (animState === actor.lastAnimState) return;
    actor.lastAnimState = animState;
    if (animState === ANIM_RUN) actor.animState.triggerRun();
    else if (animState === ANIM_WALK) actor.animState.triggerWalk();
    else if (animState === ANIM_FALLDOWN) actor.animState.triggerFallDown();
    else if (animState === ANIM_FALLSTAND) actor.animState.triggerFallStand();
    else if (animState === ANIM_FALLDAMAGE) actor.animState.triggerFallDamage();
    else actor.animState.triggerIdle();
  }

  function spawnRemote(actorInfo: { playerId: number; name: string; classId: number; level: number; x: number; y: number; z: number; appearance?: CharacterAppearance }): void {
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
        root.rotation.y = 0;
        scene.add(root);

        const motionList2 = buildMotionListFor(result.animSmb, result.bipInxInfo);
        let actorObj!: RemoteActor;
        const animState2 = createAnimStateMachine({
          getMotions: () => actorObj.motionList,
          getClassId: () => jobId,
          onMotionChange: (motion: MotionInfo) => { actorObj.animFrame = motion.startFrame * 160; },
        });
        actorObj = {
          playerId: pid,
          name: actorInfo.name,
          root, bodyGroup, headGroup,
          bones, skeleton,
          animSmb: result.animSmb,
          animState: animState2,
          motionList: motionList2,
          animFrame: 0,
          snaps: [{ t: performance.now(), x: actorInfo.x, y: actorInfo.y, z: actorInfo.z, angle: 0, anim: 0x0040 }],
          lastAnimState: 0x0040,
        };
        remotes.set(pid, actorObj);
        animState2.triggerIdle();
        console.log('[WorldView] 远端玩家出现: id=' + pid + ' job=' + jobId + ' name=' + actorInfo.name);
        // 武器：挂到克隆骨架的手部骨骼（WEAPON_BONES），随动画姿态移动
        if (app?.weaponDorp) {
          try {
            const wres = await loadWeaponModel(app.weaponDorp);
            await loadTextures(wres.texturesToLoad);
            const boneName = app.weaponPos === 2 ? WEAPON_BONES.LEFT_HAND : WEAPON_BONES.RIGHT_HAND;
            const bone = findBone(root, boneName);
            if (bone) bone.add(wres.group);
            else console.warn('[WorldView] 远端武器挂点缺失: id=' + pid + ' bone=' + boneName);
          } catch (e) {
            console.warn('[WorldView] 远端武器加载失败: id=' + pid + ' dorp=' + app.weaponDorp, e);
          }
        }
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
      actor.root.rotation.y = pAng;
      setRemoteAnim(actor, s0.anim);

      const motion = actor.animState.getCurrentMotion();
      if (motion) {
        actor.animFrame += 80;
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
        const skelFrames = evalSkeleton(actor.animSmb, actor.animFrame, false);
        applyToBones(actor.bones, skelFrames, tmp, posV, quatQ, sclV);
        actor.skeleton.update();
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
  async function syncMapRegions(centerMapId: number): Promise<void> {
    // wanted = 当前图 + 直接相邻（1 跳）
    const wanted = new Set<number>([centerMapId, ...neighborMaps(centerMapId)]);
    // 加载 wanted 中未加载的图
    const toLoad = [...wanted].filter(id => !mapHandles.has(id) && !regionLoading.has(id));
    if (toLoad.length) {
      regionLoading = new Set([...regionLoading, ...toLoad]);
      try {
        await Promise.all(toLoad.map(id => loadMapById(id)));
      } finally {
        for (const id of toLoad) regionLoading.delete(id);
      }
    }
    // 卸载非相邻图
    for (const id of [...mapHandles.keys()]) {
      if (!wanted.has(id)) {
        const mh = mapHandles.get(id);
        if (mh) mh.mapRenderer.dispose?.();
        mapHandles.delete(id);
        collisionMeshes.delete(id);
        // 清装饰
        const dg = decorGroups.get(id);
        if (dg) { unloadDecor(dg, scene!); decorGroups.delete(id); }
        console.log('[WorldView] 卸载地图' + id);
      }
    }
  }

  let frameCount = 0, fpsAcc = 0;

  // ===== 自机（方向二：客户端位置上权威）=====
  // 本地即时移动（鼠标驱动 + 本地碰撞，dt 等速 → 手感跟手）；位置按节奏上报服务端做限速校验。
  // 本地即时移动（客户端位置上权威）：完整还原方案 A 之前的跨图碰撞/贴地逻辑。
  function updateMovement(dt: number): boolean {
    if (!camera || !renderer) return false;
    const face = mouseFacing();
    if (face === null) return false;
    selfAngle = face;

    const mdt = Math.min(dt, 0.1); // 掉帧/切页兜底，避免单帧超大位移
    const step = (running ? RUN_WPS : WALK_WPS) * mdt; // world 步长（与服务端限速同源）
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

    // 跨图碰撞：遍历所有已加载图的碰撞网格，取第一个能走的（对齐原版双 stage）；
    // 解决桥等跨图边界：桥前半在 A 图、后半在 B 图，单图碰撞会让角色在交界处掉落。
    let moved = false;
    for (const cm of collisionMeshes.values()) {
      const result = cm.checkNextMove(sx, sy, sz, rawAngle, dist * 256);
      if (!result.collision) {
        selfPos.x = result.x / 256;
        // 诊断：单步大幅下沉（下坡/穿透放行）打印决策
        if (result.y < sy - 8 * 256) {
          let alts = '';
          for (const [mid, c2] of collisionMeshes) {
            const j = c2.getFloorHeight(result.x, result.z, sy);
            alts += ` m${mid}:${j.found ? (j.height / 256).toFixed(1) : '无'}`;
          }
          console.log(`[pen] step=${step} 前y=${(sy / 256).toFixed(1)} 新地面=${(result.y / 256).toFixed(1)} 新x=${(result.x / 256).toFixed(1)} 新z=${(result.z / 256).toFixed(1)}${alts}`);
        }
        // 下坡/贴地：非大幅下坠才采纳结果 y（大幅下坠交给 updateFalling 逐帧下落）
        if (result.y >= sy - 8 * 256) {
          selfPos.y = result.y / 256;
        }
        selfPos.z = result.z / 256;
        moved = true;
        break;
      }
    }
    if (moved) {
      // 换图：移动后用 AABB+高度精确判定所属地图，跨图时同步地图区域（2 跳内保留）
      const foundMap = findCurrentMap(selfPos.x, selfPos.z);
      if (foundMap !== currentMapId && rafMs - lastMapSwitch > 200) {
        currentMapId = foundMap;
        lastMapSwitch = rafMs;
        mapAudio.enterMap(currentMapId);
        void syncMapRegions(currentMapId);
      }
      // 更新角色 / dummy / 坐标轴位置
      if (charGroup) { charGroup.position.copy(selfPos); charGroup.rotation.y = selfAngle; }
      if (dummyGroup) { dummyGroup.position.copy(selfPos); dummyGroup.rotation.y = selfAngle; }
      if (axisGroup) axisGroup.position.copy(selfPos);
      return true;
    }
    return false;
  }

  // 地面跟随 + 掉落（还原方案 A 之前的 updateFalling）：每帧把 y 贴到脚下最高地面；
  // 高于地面 >8 world 逐帧下落并进入 falling（FALLDOWN 动画），落地触发 FALLSTAND/FALLDAMAGE。
  // 下落中 mouseFacing 返回 null → 不能水平移动/转向。
  function updateFalling(): boolean {
    if (!animState) return false;
    const rawX = selfPos.x * 256;
    const rawZ = selfPos.z * 256;
    const pY = selfPos.y * 256;
    let groundY = -80 * 256; // 悬空 → 虚空
    for (const cm of collisionMeshes.values()) {
      const h = cm.getFloorHeight(rawX, rawZ, pY);
      if (h.found && h.height > groundY) groundY = h.height;
    }
    const diff = pY - groundY;

    if (diff > 8 * 256) {
      // 下落中：逐帧下落（对齐原版 PHeight 8/帧），首帧触发 FALLDOWN
      selfPos.y = (pY - 8 * 256) / 256;
      if (diff > 32 * 256 && !falling) {
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
      if (fallHeight > 200 * 256) animState.triggerFallDamage();
      else animState.triggerFallStand();
    }
    return false;
  }

  /** 上报客户端权威移动。mode=0（停止）立即发；移动中按 MOVE_REPORT_MS 节流。
   *  anim=动画覆盖（0=按 mode 推导；下落/落地传 FALL* token 让远端播放）。 */
  function reportMove(mode: 0 | 1 | 2, anim = 0): void {
    const now = performance.now();
    if (mode === 0) {
      opts?.onMoveInt?.(selfAngle, 0, selfPos.x, selfPos.y, selfPos.z, anim);
      lastMoveReportAt = now;
      return;
    }
    if (now - lastMoveReportAt < MOVE_REPORT_MS) return;
    lastMoveReportAt = now;
    opts?.onMoveInt?.(selfAngle, running ? 2 : 1, selfPos.x, selfPos.y, selfPos.z, anim);
  }

  function renderLoop(): void {
    animFrameId = requestAnimationFrame(renderLoop);
    if (!renderer || !scene || !camera) return;
    // 自适应视口尺寸
    const w = root.clientWidth, h = root.clientHeight;
    if (w > 0 && h > 0 && (renderer.domElement.width !== Math.floor(w * renderer.getPixelRatio()) || renderer.domElement.height !== Math.floor(h * renderer.getPixelRatio()))) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    }
    const dt = clock.getDelta();
    rafMs += dt * 1000;

    // 自机动画
    if (animState && animSmb && skeleton && bones.length) {
      const motion = animState.getCurrentMotion();
      if (motion) {
        animFrame += 80;
        const endFrame = motion.endFrame * 160;
        const startFrame = motion.startFrame * 160;
        if (animFrame >= endFrame) {
          if (motion.repeat) {
            const len = endFrame - startFrame;
            animFrame = startFrame + ((animFrame - startFrame) % len);
          } else {
            const next = animState.onAnimationEnd();
            if (next) animFrame = next.startFrame * 160;
          }
        }
        const skelFrames = evalSkeleton(animSmb, animFrame, false);
        applyToBones(bones, skelFrames, tmp, posV, quatQ, sclV);
        skeleton.update();
      }
    }

    // ===== 自机（方向二）：本地即时移动 + 上报位置（无对账/回拉）=====
    const wasFallingNow = falling;
    const moved = updateMovement(dt); // falling 中 mouseFacing=null → 不移动
    const fell = updateFalling();
    if (fell && selfPos.y !== lastY) {
      // 下落/落地时角色/dummy/坐标轴同步 y（x/z 未变）
      if (charGroup) charGroup.position.y = selfPos.y;
      if (dummyGroup) dummyGroup.position.y = selfPos.y;
      if (axisGroup) axisGroup.position.y = selfPos.y;
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
        opts?.onMoveInt?.(selfAngle, 0, selfPos.x, selfPos.y, selfPos.z, ANIM_FALLDOWN);
      }
    } else if (wasFallingNow && !wasMoving) {
      // 刚落地：上报一次落地动画（FALLSTAND / 高差大 FALLDAMAGE），随后归 IDLE
      const landAnim = fallHeight > 200 * 256 ? ANIM_FALLDAMAGE : ANIM_FALLSTAND;
      opts?.onMoveInt?.(selfAngle, 0, selfPos.x, selfPos.y, selfPos.z, landAnim);
      if (animState) animState.triggerIdle();
    } else if (moved) {
      if (!wasMoving) {
        wasMoving = true;
        if (running) animState?.triggerRun();
        else animState?.triggerWalk();
      }
      reportMove(running ? 2 : 1);
    } else if (wasMoving) {
      // 本地已停：立即上报停止（mode 0 + 当前位置），随后切 IDLE
      wasMoving = false;
      reportMove(0);
      if (animState) animState.triggerIdle();
      if (charGroup) { charGroup.position.copy(selfPos); charGroup.rotation.y = selfAngle; }
      if (dummyGroup) { dummyGroup.position.copy(selfPos); dummyGroup.rotation.y = selfAngle; }
    } else if (mouseDown) {
      // 静止但按着鼠标（光标贴角色，方向无效）：保持朝向即时
      const f = mouseFacing();
      if (f !== null && charGroup) charGroup.rotation.y = f;
    }

    // 远端玩家（Phase 2/3）
    updateRemotes(dt);

    // 相机跟随角色
    updateCamera();
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();

    // 昼夜光照驱动（每帧）：darkLevel/BackColor 渐变 + 火把 + 场景灯 → 各地图 shader uniform
    dnUpdate();

    // 地图音效：3D 声源按角色距离更新音量（BGM/环境音已在进入/换图时设置）
    mapAudio.updateAt(selfPos);

    // 小地图
    drawMinimap();

    for (const mh of mapHandles.values()) {
      mh.mapRenderer.render(camera);
      mh.mapRenderer.updateScroll(rafMs);
      mh.mapRenderer.updateWind(rafMs);
      mh.mapRenderer.updateWater(rafMs);
      updateFrameAnimations(mh.animatedMeshes, rafMs);
    }
    renderer.render(scene, camera);

    // 首帧渲染完成 → 通知 main.ts 收起加载页
    if (firstFramePending) {
      firstFramePending = false;
      loadHooks?.onProgress?.(4, 4);
      loadHooks?.onReady?.();
    }

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
      statsEl.textContent =
        `FPS   ${fps.toFixed(0)}  地图 ${mapHandles.size}\n` +
        `Draw  ${dc}\n` +
        `Tris  ${Math.round(visT).toLocaleString()} / ${totT.toLocaleString()}\n` +
        `Verts ${verts.toLocaleString()}\n` +
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
  }

  return {
    async show(enterGame, hooks) {
      loadHooks = hooks ?? null;
      firstFramePending = false;
      root.style.display = 'block';
      ensure3D();
      if (!scene || !camera) {
        loadHooks?.onReady?.();
        return;
      }

      // 重放进场竞态期间缓存的远端 Appear（此刻 scene 已就绪）
      if (pendingAppears.length > 0) {
        const batch = pendingAppears.splice(0);
        for (const a of batch) spawnRemote(a);
      }

      try {
        // 预取全部 44 图 world AABB（缓存 SMD 命中，用于 findCurrentMap 判归属）
        if (allBounds.size === 0) {
          await Promise.all(Object.keys(MAP_CATALOG).map(async (k) => {
            const id = Number(k);
            const b = await getMapWorldBounds('/res/field/' + MAP_CATALOG[id]);
            if (b) allBounds.set(id, b);
          }));
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
        window.addEventListener('mouseup', onMouseUp);

        // dummy 摆到出生点，朝向与角色一致（红线指向角色面朝方向）
        if (dummyGroup) {
          dummyGroup.position.copy(selfPos);
          dummyGroup.rotation.y = selfAngle;
        }
        // 坐标轴挂到出生点（参考坐标系，判断朝向用）
        if (axisGroup) axisGroup.position.copy(selfPos);

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
    toggleRun: () => setRunMode(!running),
    isRunning: () => running,
    setSelfId: (id: number) => { selfPlayerId = id; },
    isSelf: (id: number) => id === selfPlayerId,
    applyPlayerMove: (playerId, x, y, z, angle, animState) => {
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
          actor.snaps.push({ t: performance.now(), x, y, z, angle, anim: animState });
          if (actor.snaps.length > 32) actor.snaps.shift();
        }
      }
    },
    playerAppear: (playerId, name, classId, level, x, y, z, appearance) => {
      spawnRemote({ playerId: Number(playerId), name, classId: classId || 1, level, x, y, z, appearance });
    },
    playerDisappear: (playerId) => despawnRemote(Number(playerId)),
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
      mapAudio.dispose();
      window.removeEventListener('resize', resize);
      window.removeEventListener('mouseup', onMouseUp);
      if (renderer && renderer.domElement) {
        renderer.domElement.removeEventListener('mousedown', onMouseDown);
        renderer.domElement.removeEventListener('mouseup', onMouseUp);
        renderer.domElement.removeEventListener('mousemove', onMouseMove);
        renderer.domElement.remove();
      }
      if (renderer) renderer.dispose();
      renderer = null;
      scene = null;
      camera = null;
      mapHandles.clear();
      collisionMeshes.clear();
      charGroup = null;
      dummyGroup = null;
      axisGroup = null;
      statsEl.remove();
      root.remove();
    },
  };
}
