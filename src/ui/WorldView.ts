/**
 * WORLD 屏：复刻 /pt/maps/ 的地图渲染 + dummy 角色 + debug 相机跟随。
 * 唯一差异：地图从服务端 enterGame 的 mapId/出生点读取，而非下拉选择。
 * 权威依据：pt-web-server/static/maps/index.html + docs/fields/pt-map-renderer-design.md §3.10.2。
 * 坐标：出生点 world = (-z, y, -x)；地图顶点 world = raw/256 + 轴交换（map-renderer 内部处理）。
 */
import * as THREE from 'three';
import { loadMap, updateFrameAnimations, getMapWorldBounds } from '../maps/fore1.js';
import { mapSmdPath, MAP_CATALOG } from '../maps/map-catalog.js';
import { neighborMaps } from '../maps/map-gates.js';
import { CollisionMesh } from '../maps/collision.js';
import { loadCharacterModel } from '../render/char-loader.js';
import { createAnimStateMachine } from '../char/anim-state-machine.js';
import type { MotionInfo } from '../char/char-format.js';
import { CHRMOTION_EXT } from '../char/char-format.js';
import { evalSkeleton, applyToBones } from '../char/animation.js';
import { decodeTextureAsync } from '../core/texture.js';
import type { CharacterAppearance } from './CharSelect.js';
import { armorNumFromIdCode } from './CharSelect.js';
import { resolveCostumeBody } from '../render/costume-body-map.js';

export interface EnterGameInfo {
  playerId: number;
  mapId: number;
  position: { x: number; y: number; z: number };
  rotation?: { x: number; y: number; z: number }; // 出生朝向（ay=引擎角度 0-4095）
  appearance?: CharacterAppearance;
}

export interface WorldView {
  show(enterGame: EnterGameInfo): void;
  hide(): void;
  destroy(): void;
}

/** 服务端出生点 → 世界坐标（对齐 /pt/maps/ positionDummyAtSpawn：worldX=-z, worldZ=-x，y 是地形高度） */
export function rawToWorld(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(-z, y, -x);
}

export function createWorldView(container: HTMLElement): WorldView {
  const root = document.createElement('div');
  root.id = 'world-root';
  root.style.cssText = 'display:none;position:fixed;inset:0;z-index:50;background:#0d0d0d;';
  container.appendChild(root);

  let renderer: THREE.WebGLRenderer | null = null;
  let scene: THREE.Scene | null = null;
  let camera: THREE.PerspectiveCamera | null = null; // 游戏相机（/pt/maps/ 的 debugCamera）
  let currentMapId = 0; // 当前所在地图
  let lastMapSwitch = 0; // 上次换图时间（防抖）
  const mapHandles = new Map<number, Awaited<ReturnType<typeof loadMap>>>();
  const collisionMeshes = new Map<number, CollisionMesh>();
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

  // 移动状态（复刻 /pt/maps/ dummy 移动）
  let moveSpeed = 3;         // 移动速度（world 单位/帧）
  let wasMoving = false;     // 上一帧是否在移动（状态机切换防抖）
  let mouseDown = false;
  let mouseX = 0, mouseY = 0;

  const keys: Record<string, boolean> = {};
  window.addEventListener('keydown', (e) => { keys[e.code] = true; });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });

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
    const amb = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(amb);
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(200, 400, 200);
    scene.add(dir);
    buildAxis();
    buildDummy();
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

  function buildMotionList(): void {
    if (!animSmb || !bipInxInfo) return;
    motionList = [];
    const smb = animSmb;
    const tmFrame = smb.tmFrame;
    const bip = bipInxInfo;
    for (let i = CHRMOTION_EXT; i < bip.motionCount; i++) {
      const mi = bip.motions[i];
      if (!mi.state && !mi.startFrame && !mi.endFrame) continue;
      let startFrame = mi.startFrame;
      let endFrame = mi.endFrame;
      if (tmFrame && mi.motionFrame > 0 && tmFrame[mi.motionFrame - 1]) {
        const off = tmFrame[mi.motionFrame - 1].startFrame / 160;
        startFrame += off;
        endFrame += off;
      }
      motionList.push({ ...mi, startFrame, endFrame });
    }
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
    const cm = new CollisionMesh();
    cm.buildFromSMD(mh.data);
    collisionMeshes.set(mapId, cm);
    console.log('[WorldView] 地图' + mapId + ' 加载: 材质=' + mh.mapRenderer.materials.length +
      ' tris=' + mh.mapRenderer.totalFaceCount + ' 碰撞面=' + cm.triangles.length);
    return true;
  }

  function onMouseDown(e: MouseEvent): void {
    if (e.button === 0) { mouseDown = true; mouseX = e.clientX; mouseY = e.clientY; }
  }
  function onMouseUp(e: MouseEvent): void {
    if (e.button === 0) mouseDown = false;
  }
  function onMouseMove(e: MouseEvent): void {
    mouseX = e.clientX; mouseY = e.clientY;
  }

  // 判断角色所属地图（对齐服务端 MapRegionService.findMapPrecise）：
  // 用全部 44 图 AABB 粗筛（不依赖是否已加载）→ 唯一命中返回；
  // 多命中（交界重叠）用已加载图的碰撞网格高度精确判定；仍歧义保持当前图防抖。
  function findCurrentMap(wx: number, wz: number): number {
    const hits: number[] = [];
    for (const [mapId, [xMin, xMax, zMin, zMax]] of allBounds) {
      if (wx >= xMin && wx <= xMax && wz >= zMin && wz <= zMax) hits.push(mapId);
    }
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) {
      // 多命中：用已加载图的碰撞网格高度（raw 坐标，对齐服务端 getHeight(-z,-x)>0）
      const fx = -wz * 256, fz = -wx * 256;
      for (const mapId of hits) {
        const cm = collisionMeshes.get(mapId);
        if (!cm) continue;
        if (cm.getPolyHeight(fx, fz).found) return mapId;
      }
      // 多命中但都无高度（交界处角色悬空或图未加载）→ 返回 AABB 中最靠近当前图的（防抖，避免抖动）
      return hits.includes(currentMapId) ? currentMapId : hits[0];
    }
    return currentMapId; // 无命中 → 保持当前图
  }

  // 每帧移动：朝鼠标方向（屏幕投影方向）移动，跨图碰撞校验。返回是否实际移动。
  function updateMovement(): boolean {
    if (!camera || !renderer) return false;
    if (!mouseDown) return false;

    const rect = renderer.domElement.getBoundingClientRect();
    // 1. 角色在屏幕上的投影坐标
    const dummyScreen = new THREE.Vector3(selfPos.x, selfPos.y, selfPos.z).project(camera);
    const projX = (dummyScreen.x + 1) * 0.5 * rect.width + rect.left;
    const projY = (-dummyScreen.y + 1) * 0.5 * rect.height + rect.top;
    // 2. 屏幕方向向量（向右/向上为正）
    const sdx = mouseX - projX;
    const sdy = -(mouseY - projY);
    const slen = Math.hypot(sdx, sdy);
    if (slen < 1) return false;
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
    if (wlen < 1e-6) return false;
    // 5. 朝向 = atan2(正弦, 余弦)（/pt/maps/：angle = atan2(sin, cos)，对应 world 方向）
    //   world 方向 (wx,wz) → 引擎角度语义：sin 对 x、cos 对 z
    selfAngle = Math.atan2(wx / wlen, wz / wlen);

    // 6. 移动一步（复刻 /pt/maps/ MoveAngle2）
    const step = moveSpeed;
    const sinVal = Math.sin(selfAngle);
    const cosVal = Math.cos(selfAngle);
    const dx = sinVal * step;
    const dz = cosVal * step;
    const dist = Math.hypot(dx, dz);

    // world → raw SMD 坐标（地图逆变换）
    const sx = -selfPos.z * 256;
    const sy = selfPos.y * 256;
    const sz = -selfPos.x * 256;
    // 移动方向转 raw 角度（world 方向 (sinA, cosA) → raw 增量 (-cosA, -sinA)）
    const rawAngle = Math.atan2(-cosVal, -sinVal);

    // 跨图碰撞：遍历所有已加载图的碰撞网格，都试 checkNextMove，取第一个能走的（对齐原版双 stage）
    // 解决桥等跨图边界：桥前半在 A 图、后半在 B 图，单图碰撞会让角色在交界处掉落。
    let moved = false;
    for (const cm of collisionMeshes.values()) {
      const result = cm.checkNextMove(sx, sy, sz, rawAngle, dist * 256);
      if (!result.collision) {
        // raw → world
        selfPos.x = -result.z / 256;
        selfPos.y = result.y / 256;
        selfPos.z = -result.x / 256;
        moved = true;
        break;
      }
    }
    if (moved) {
      // 换图：移动后用 AABB+高度精确判定角色所属地图（对齐服务端 findMapPrecise），
      // 跨图时同步地图区域（2 跳内保留，避免回程困在已卸载的中间图）
      const foundMap = findCurrentMap(selfPos.x, selfPos.z);
      if (foundMap !== currentMapId && rafMs - lastMapSwitch > 200) {
        currentMapId = foundMap;
        lastMapSwitch = rafMs;
        syncMapRegions(currentMapId);
      }
      // 更新角色/ dummy /坐标轴位置
      if (charGroup) {
        charGroup.position.copy(selfPos);
        charGroup.rotation.y = selfAngle;
      }
      if (dummyGroup) {
        dummyGroup.position.copy(selfPos);
        dummyGroup.rotation.y = selfAngle;
      }
      if (axisGroup) axisGroup.position.copy(selfPos);
      return true;
    }
    return false;
  }

  // 同步地图区域：加载当前图的相邻图（含 2 跳，保留回程中间图），卸载更远的图
  let regionLoading = new Set<number>();
  async function syncMapRegions(centerMapId: number): Promise<void> {
    // wanted = 当前图 + 相邻 + 相邻的相邻（2 跳内不卸载，避免回程困在已卸载的中间图）
    const wanted = new Set<number>([centerMapId]);
    for (const n of neighborMaps(centerMapId)) {
      wanted.add(n);
      for (const n2 of neighborMaps(n)) wanted.add(n2);
    }
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
        console.log('[WorldView] 卸载地图' + id);
      }
    }
  }

  let frameCount = 0, fpsAcc = 0;

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

    // 移动（鼠标左键朝鼠标方向），先移动再让相机跟随
    const moved = updateMovement();

    // 状态机切换：移动中 RUN，停下 Idle（只在状态变化时触发，避免每帧重置动画）
    if (animState) {
      if (moved && !wasMoving) {
        animState.triggerRun();
      } else if (!moved && wasMoving) {
        animState.triggerIdle();
      }
    }
    wasMoving = moved;

    // 相机跟随角色
    updateCamera();
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();

    for (const mh of mapHandles.values()) {
      mh.mapRenderer.render(camera);
      mh.mapRenderer.updateScroll(rafMs);
      mh.mapRenderer.updateWind(rafMs);
      mh.mapRenderer.updateWater(rafMs);
      updateFrameAnimations(mh.animatedMeshes, rafMs);
    }
    renderer.render(scene, camera);

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
        `Verts ${verts.toLocaleString()}`;
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
    async show(enterGame) {
      root.style.display = 'block';
      ensure3D();
      if (!scene || !camera) return;

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
        return;
      }
      selfPos = rawToWorld(enterGame.position.x, enterGame.position.y, enterGame.position.z);
      selfAngle = enterGame.rotation?.y || 0;
      currentMapId = enterGame.mapId;
      console.log('[WorldView] mapId=' + enterGame.mapId + ' 自机 world=(' +
        selfPos.x.toFixed(1) + ',' + selfPos.y.toFixed(1) + ',' + selfPos.z.toFixed(1) + ') angle=' + selfAngle);
      await loadMapById(enterGame.mapId);
      // 加载相邻图 + 卸载非相邻图
      await syncMapRegions(enterGame.mapId);

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

      window.addEventListener('resize', resize);
      requestAnimationFrame(() => requestAnimationFrame(resize));
      clock.getDelta();
      renderLoop();
    },
    hide() {
      root.style.display = 'none';
      if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = 0; }
    },
    destroy() {
      if (animFrameId) cancelAnimationFrame(animFrameId);
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
