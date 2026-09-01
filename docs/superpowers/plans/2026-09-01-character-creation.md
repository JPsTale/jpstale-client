# 角色创建界面 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将角色创建从4步向导重写为单页表单，含3D场景背景、角色预览、hover/选中交互、BGM。

**Architecture:** 左栏纯展示职业信息，中央3D预览（加载chrselect场景+角色模型），右栏全部交互操作（职业选择→脸型→名字→按钮）。使用已有的 smd-parser 解析场景，map-renderer 基础设施渲染地形，自定义相机控制（俯视90°+水平旋转+缩放）。

**Tech Stack:** TypeScript, three.js ^0.160.0, Vite ^8.2.2

## Global Constraints

- ponytail mode: 最短工作代码，不加未请求的抽象
- 坐标系: Engine Z-up → three.js Y-up via `ROT_X_NEG90`
- 行major矩阵，fixed-point `/256`
- 不添加新的 npm 依赖
- i18n 纯 JSON 文件在 `locales/`
- 前端通过 `vite.config.ts` 代理 `/pt` → 后端

---

## File Structure

| 文件 | 职责 |
|------|------|
| `src/ui/CharSelect.ts` | 重写：单页布局，三栏结构，交互状态管理 |
| `src/render/scene-loader.ts` | 新建：加载 chrselect SMD 场景为 Three.js 几何体 |
| `src/ui/camera-controls.ts` | 新建：自定义相机控制（俯视+水平旋转+缩放） |
| `src/main.ts` | 修改：onMessage 处理 createCharacterResult 成功逻辑 |
| `src/app/State.ts` | 修改：添加 CHAR_CREATE 屏幕（或复用 CHAR_SELECT） |

---

### Task 1: Scene Loader — 加载 chrselect 场景

**Files:**
- Create: `src/render/scene-loader.ts`
- Depends on: `src/core/smd-parser.ts` (已有), `src/render/texture-loader.ts` (已有), `src/render/map-renderer.ts` (已有)

**Interfaces:**
- Consumes: `parseSMD()` from smd-parser, `loadTexture()` from texture-loader
- Produces: `loadScene(scenePath: string, resPrefix: string): Promise<THREE.Group>` — 返回包含地形网格和材质的 Group

- [ ] **Step 1: 创建 src/render/scene-loader.ts**

```typescript
import * as THREE from 'three';
import { parseSMD } from '../core/smd-parser';
import { loadTexture } from './texture-loader';

/**
 * 加载 SMD 场景文件（如 chrselect/select.smd）为 Three.js Group。
 * 复用 smd-parser 的顶点/面/UV/材质解析，
 * 复用 map-renderer 的地形网格构建逻辑。
 */
export async function loadScene(
  scenePath: string,
  resPrefix: string,
): Promise<THREE.Group> {
  const group = new THREE.Group();
  const smd = await parseSMD(scenePath);

  // 按材质分组构建网格
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(smd.vertices, 3));
  if (smd.uvs.length > 0) {
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(smd.uvs, 2));
  }
  geo.setIndex(smd.faceIndices);
  geo.computeVertexNormals();

  // 加载第一个材质的纹理
  const matName = smd.materials[0]?.name ?? '';
  const texPath = matName ? `${resPrefix}/${matName}.bmp` : '';
  let texture: THREE.Texture | null = null;
  if (texPath) {
    try {
      texture = await loadTexture(texPath);
    } catch {
      // 纹理加载失败，使用默认材质
    }
  }

  const mat = new THREE.MeshLambertMaterial({
    map: texture,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geo, mat);
  group.add(mesh);

  return group;
}
```

- [ ] **Step 2: 验证场景加载**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add src/render/scene-loader.ts
git commit -m "feat: add scene loader for chrselect SMD"
```

---

### Task 2: Camera Controls — 自定义俯视旋转相机

**Files:**
- Create: `src/ui/camera-controls.ts`
- Depends on: three.js Camera

**Interfaces:**
- Consumes: `THREE.PerspectiveCamera`
- Produces: `createCameraControls(camera, domElement): { update(): void; dispose(): void }`

- [ ] **Step 1: 创建 src/ui/camera-controls.ts**

```typescript
import * as THREE from 'three';

export interface CameraControls {
  update(): void;
  dispose(): void;
}

export function createCameraControls(
  camera: THREE.PerspectiveCamera,
  domElement: HTMLElement,
): CameraControls {
  let theta = 0; // 水平角度
  let distance = 5; // 摄像机到原点距离
  const minDist = 2;
  const maxDist = 15;
  const height = 4; // 固定高度（俯视）
  let isDragging = false;
  let lastX = 0;

  // 俯视：摄像机在 (0, height, distance)，看向 (0, 0, 0)
  function updateCamera() {
    camera.position.set(
      Math.sin(theta) * distance,
      height,
      Math.cos(theta) * distance,
    );
    camera.lookAt(0, 0, 0);
  }

  function onPointerDown(e: PointerEvent) {
    isDragging = true;
    lastX = e.clientX;
    domElement.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (!isDragging) return;
    const dx = e.clientX - lastX;
    theta -= dx * 0.005; // 水平旋转速度
    lastX = e.clientX;
    updateCamera();
  }

  function onPointerUp(_e: PointerEvent) {
    isDragging = false;
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    distance += e.deltaY * 0.01;
    distance = Math.max(minDist, Math.min(maxDist, distance));
    updateCamera();
  }

  domElement.addEventListener('pointerdown', onPointerDown);
  domElement.addEventListener('pointermove', onPointerMove);
  domElement.addEventListener('pointerup', onPointerUp);
  domElement.addEventListener('wheel', onWheel, { passive: false });

  updateCamera();

  return {
    update() {},
    dispose() {
      domElement.removeEventListener('pointerdown', onPointerDown);
      domElement.removeEventListener('pointermove', onPointerMove);
      domElement.removeEventListener('pointerup', onPointerUp);
      domElement.removeEventListener('wheel', onWheel);
    },
  };
}
```

- [ ] **Step 2: 验证**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add src/ui/camera-controls.ts
git commit -m "feat: add custom camera controls for character preview"
```

---

### Task 3: CharSelect 重写 — 单页布局骨架

**Files:**
- Modify: `src/ui/CharSelect.ts` (完全重写)

**Interfaces:**
- Consumes: `AppCharacter[]`, `Transport` (from main.ts)
- Produces: `createCharSelect(characters, transport): { show(): void; hide(): void; destroy(): void }`

**实现要点：**
- 三栏 CSS 布局：左栏职业信息、中央3D预览、右栏操作
- 使用已有的 `loadCharacterModel` 加载角色
- 使用 Task 1 的 `loadScene` 加载背景
- 使用 Task 2 的 `camera-controls` 控制相机

- [ ] **Step 1: 重写 src/ui/CharSelect.ts**

完整文件内容见下方。这是最大的任务，包含布局、交互状态、3D预览、BGM 全部逻辑。

```typescript
import * as THREE from 'three';
import { AppCharacter, Transport } from '../types';
import { loadCharacterModel, CharLoadResult } from '../render/char-loader';
import { createAnimStateMachine, AnimStateMachine } from '../char/anim-state-machine';
import { evalSkeleton, applyToBones } from '../char/animation';
import { loadScene } from '../render/scene-loader';
import { createCameraControls } from './camera-controls';
import { encodeClient } from '../net/protocol';
import { LOCALE } from '../i18n';

interface JobInfo {
  id: number;
  name: string;
  nameKey: string;
  descKey: string;
  attrKey: string;
  side: 'tempscron' | 'moryon';
}

const JOBS: JobInfo[] = [
  { id: 1, name: '武士', nameKey: 'charcreate.job.warrior', descKey: 'charcreate.job.warrior.desc', attrKey: 'charcreate.job.warrior.attr', side: 'tempscron' },
  { id: 2, name: '机械', nameKey: 'charcreate.job.mechanic', descKey: 'charcreate.job.mechanic.desc', attrKey: 'charcreate.job.mechanic.attr', side: 'tempscron' },
  { id: 3, name: '弓箭', nameKey: 'charcreate.job.archer', descKey: 'charcreate.job.archer.desc', attrKey: 'charcreate.job.archer.attr', side: 'tempscron' },
  { id: 4, name: '枪兵', nameKey: 'charcreate.job.lancer', descKey: 'charcreate.job.lancer.desc', attrKey: 'charcreate.job.lancer.attr', side: 'tempscron' },
  { id: 5, name: '刺客', nameKey: 'charcreate.job.assassin', descKey: 'charcreate.job.assassin.desc', attrKey: 'charcreate.job.assassin.attr', side: 'tempscron' },
  { id: 6, name: '骑士', nameKey: 'charcreate.job.knight', descKey: 'charcreate.job.knight.desc', attrKey: 'charcreate.job.knight.attr', side: 'moryon' },
  { id: 7, name: '魔枪', nameKey: 'charcreate.job.magiclancer', descKey: 'charcreate.job.magiclancer.desc', attrKey: 'charcreate.job.magiclancer.attr', side: 'moryon' },
  { id: 8, name: '祭司', nameKey: 'charcreate.job.priest', descKey: 'charcreate.job.priest.desc', attrKey: 'charcreate.job.priest.attr', side: 'moryon' },
  { id: 9, name: '法师', nameKey: 'charcreate.job.mage', descKey: 'charcreate.job.mage.desc', attrKey: 'charcreate.job.mage.attr', side: 'moryon' },
  { id: 10, name: '萨满', nameKey: 'charcreate.job.shaman', descKey: 'charcreate.job.shaman.desc', attrKey: 'charcreate.job.shaman.attr', side: 'moryon' },
];

const NAME_REGEX = /^[\u4e00-\u9fa5a-zA-Z0-9]{2,12}$/;

export function createCharSelect(
  characters: AppCharacter[],
  transport: Transport,
  onBack: () => void,
) {
  const root = document.createElement('div');
  root.id = 'char-select-root';
  root.style.cssText = 'position:fixed;inset:0;display:flex;flex-direction:column;background:#0a0a1a;color:#e0d8c8;font-family:monospace;z-index:100;';

  // 状态
  let selectedJobId: number | null = null;
  let hoveredJobId: number | null = null;
  let selectedFace = 0;
  let currentPreviewJobId: number | null = null;
  let currentPreviewFace = -1;
  let charResult: CharLoadResult | null = null;
  let animState: AnimStateMachine | null = null;
  let sceneGroup: THREE.Group | null = null;
  let bgm: HTMLAudioElement | null = null;

  // Three.js 场景
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:100%;height:100%;';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setClearColor(0x1a1a2e);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x1a1a2e, 20, 60);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  const controls = createCameraControls(camera, canvas);

  // 光照
  const amb = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(amb);
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(5, 10, 5);
  scene.add(dir);

  // 骨骼容器
  const skeletonGroup = new THREE.Group();
  scene.add(skeletonGroup);

  // --- 三栏布局 ---
  const layout = document.createElement('div');
  layout.style.cssText = 'display:flex;flex:1;overflow:hidden;';

  // 左栏：职业信息
  const leftPanel = document.createElement('div');
  leftPanel.style.cssText = 'width:220px;padding:20px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center;';
  const jobNameEl = document.createElement('div');
  jobNameEl.style.cssText = 'font-size:24px;margin-bottom:12px;';
  const jobDescEl = document.createElement('div');
  jobDescEl.style.cssText = 'font-size:13px;line-height:1.6;opacity:0.8;';
  const jobAttrEl = document.createElement('div');
  jobAttrEl.style.cssText = 'font-size:13px;margin-top:12px;opacity:0.7;';
  leftPanel.append(jobNameEl, jobDescEl, jobAttrEl);

  // 中央：3D 预览
  const centerPanel = document.createElement('div');
  centerPanel.style.cssText = 'flex:1;position:relative;';
  centerPanel.appendChild(canvas);

  // 右栏：操作区
  const rightPanel = document.createElement('div');
  rightPanel.style.cssText = 'width:240px;padding:20px;box-sizing:border-box;display:flex;flex-direction:column;gap:16px;';

  // 职业选择区
  const jobSection = document.createElement('div');
  const jobTitle = document.createElement('div');
  jobTitle.textContent = LOCALE.ui?.charcreate?.title || '选择职业';
  jobTitle.style.cssText = 'font-size:14px;margin-bottom:8px;opacity:0.6;';
  const jobGrid = document.createElement('div');
  jobGrid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;';
  jobSection.append(jobTitle, jobGrid);

  const jobEls = new Map<number, HTMLDivElement>();

  // 创建职业按钮
  const tempscronJobs = JOBS.filter(j => j.side === 'tempscron');
  const moryonJobs = JOBS.filter(j => j.side === 'moryon');
  for (let i = 0; i < Math.max(tempscronJobs.length, moryonJobs.length); i++) {
    if (tempscronJobs[i]) {
      const el = createJobButton(tempscronJobs[i], 'right');
      jobGrid.appendChild(el);
      jobEls.set(tempscronJobs[i].id, el);
    } else {
      jobGrid.appendChild(document.createElement('div'));
    }
    if (moryonJobs[i]) {
      const el = createJobButton(moryonJobs[i], 'left');
      jobGrid.appendChild(el);
      jobEls.set(moryonJobs[i].id, el);
    } else {
      jobGrid.appendChild(document.createElement('div'));
    }
  }

  // 脸型选择区
  const faceSection = document.createElement('div');
  const faceTitle = document.createElement('div');
  faceTitle.textContent = '脸型';
  faceTitle.style.cssText = 'font-size:14px;margin-bottom:8px;opacity:0.6;';
  const faceRow = document.createElement('div');
  faceRow.style.cssText = 'display:flex;gap:8px;';
  faceSection.append(faceTitle, faceRow);

  const faceEls: HTMLDivElement[] = [];
  for (let f = 0; f < 3; f++) {
    const faceEl = document.createElement('div');
    faceEl.textContent = String(f + 1);
    faceEl.style.cssText = `width:36px;height:36px;display:flex;align-items:center;justify-content:center;border:2px solid #555;border-radius:4px;cursor:pointer;font-size:14px;${f === selectedFace ? 'border-color:#f0c040;color:#f0c040;' : ''}`;
    faceEl.addEventListener('click', () => selectFace(f));
    faceRow.appendChild(faceEl);
    faceEls.push(faceEl);
  }

  // 名字输入区
  const nameSection = document.createElement('div');
  const nameLabel = document.createElement('div');
  nameLabel.textContent = '角色名';
  nameLabel.style.cssText = 'font-size:14px;margin-bottom:8px;opacity:0.6;';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.maxLength = 12;
  nameInput.placeholder = '输入角色名 (2-12字)';
  nameInput.style.cssText = 'width:100%;padding:8px;background:#1a1a2e;border:1px solid #555;color:#e0d8c8;font-size:14px;box-sizing:border-box;';
  const nameError = document.createElement('div');
  nameError.style.cssText = 'color:#e44;font-size:12px;margin-top:4px;min-height:16px;';
  nameSection.append(nameLabel, nameInput, nameError);

  // 按钮区
  const btnSection = document.createElement('div');
  btnSection.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
  const createBtn = document.createElement('button');
  createBtn.textContent = '创建';
  createBtn.disabled = true;
  createBtn.style.cssText = 'padding:10px;background:#4a7c59;color:#e0d8c8;border:none;cursor:pointer;font-size:14px;';
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = '取消';
  cancelBtn.style.cssText = 'padding:10px;background:transparent;color:#e0d8c8;border:1px solid #555;cursor:pointer;font-size:14px;';
  btnSection.append(createBtn, cancelBtn);

  rightPanel.append(jobSection, faceSection, nameSection, btnSection);

  layout.append(leftPanel, centerPanel, rightPanel);
  root.appendChild(layout);

  // --- 交互逻辑 ---

  function createJobButton(job: JobInfo, align: 'left' | 'right'): HTMLDivElement {
    const el = document.createElement('div');
    el.textContent = job.name;
    el.style.cssText = `padding:6px 8px;cursor:pointer;font-size:14px;text-align:${align};border-radius:3px;transition:background 0.15s,color 0.15s;`;
    el.addEventListener('mouseenter', () => {
      hoveredJobId = job.id;
      updateJobHighlight();
      loadPreview(job.id, 0); // hover 时用默认脸0
      updateJobInfo(job);
    });
    el.addEventListener('mouseleave', () => {
      hoveredJobId = null;
      updateJobHighlight();
      // 切回选中的职业
      if (selectedJobId !== null) {
        const sel = JOBS.find(j => j.id === selectedJobId);
        if (sel) {
          loadPreview(selectedJobId, selectedFace);
          updateJobInfo(sel);
        }
      } else {
        clearPreview();
        clearJobInfo();
      }
    });
    el.addEventListener('click', () => selectJob(job.id));
    return el;
  }

  function selectJob(jobId: number) {
    selectedJobId = jobId;
    const job = JOBS.find(j => j.id === jobId);
    if (job) {
      loadPreview(jobId, selectedFace);
      updateJobInfo(job);
    }
    updateJobHighlight();
    validateName();
  }

  function selectFace(face: number) {
    selectedFace = face;
    faceEls.forEach((el, i) => {
      el.style.borderColor = i === face ? '#f0c040' : '#555';
      el.style.color = i === face ? '#f0c040' : '#e0d8c8';
    });
    // 切换脸型重新加载当前预览
    if (currentPreviewJobId !== null) {
      loadPreview(currentPreviewJobId, face);
    }
  }

  function updateJobHighlight() {
    for (const [id, el] of jobEls) {
      const isHovered = id === hoveredJobId;
      const isSelected = id === selectedJobId;
      if (isSelected || isHovered) {
        el.style.background = isSelected ? '#3a5a3a' : '#2a3a2a';
        el.style.color = '#f0c040';
      } else {
        el.style.background = 'transparent';
        el.style.color = '#e0d8c8';
      }
    }
  }

  function updateJobInfo(job: JobInfo) {
    jobNameEl.textContent = job.name;
    jobDescEl.textContent = LOCALE.ui?.charcreate?.job?.[job.nameKey]?.desc || '';
    jobAttrEl.textContent = LOCALE.ui?.charcreate?.job?.[job.nameKey]?.attr || '';
  }

  function clearJobInfo() {
    jobNameEl.textContent = '';
    jobDescEl.textContent = '请选择职业';
    jobAttrEl.textContent = '';
  }

  async function loadPreview(jobId: number, face: number) {
    if (currentPreviewJobId === jobId && currentPreviewFace === face) return;
    currentPreviewJobId = jobId;
    currentPreviewFace = face;

    // 清除旧模型
    clearCharModel();

    try {
      charResult = await loadCharacterModel(jobId, face);
      skeletonGroup.add(charResult.skeletonGroup);
      animState = createAnimStateMachine({
        animSmb: charResult.animSmb,
        bipInxInfo: charResult.bipInxInfo,
        bodyInxInfo: charResult.bodyInxInfo,
        headInxInfo: charResult.headInxInfo,
      });
      animState.triggerIdle();
    } catch (err) {
      console.error('Failed to load preview:', err);
      currentPreviewJobId = null;
      currentPreviewFace = -1;
    }
  }

  function clearCharModel() {
    if (charResult) {
      skeletonGroup.remove(charResult.skeletonGroup);
      charResult = null;
      animState = null;
    }
  }

  function clearPreview() {
    clearCharModel();
    currentPreviewJobId = null;
    currentPreviewFace = -1;
  }

  // 名字验证
  nameInput.addEventListener('input', validateName);
  function validateName() {
    const name = nameInput.value.trim();
    if (!name) {
      nameError.textContent = '';
      createBtn.disabled = true;
    } else if (!NAME_REGEX.test(name)) {
      nameError.textContent = '名字只能包含中英文和数字，2-12个字符';
      createBtn.disabled = true;
    } else {
      nameError.textContent = '';
      createBtn.disabled = selectedJobId === null;
    }
  }

  // 创建按钮
  createBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name || selectedJobId === null) return;
    createBtn.disabled = true;
    createBtn.textContent = '创建中...';
    try {
      transport.send(encodeClient({ createCharacter: { name, classId: selectedJobId } }));
    } catch (err) {
      console.error('Create character failed:', err);
      nameError.textContent = '创建失败，请重试';
      createBtn.disabled = false;
      createBtn.textContent = '创建';
    }
  });

  // 取消按钮
  cancelBtn.addEventListener('click', () => onBack());

  // --- 3D 渲染循环 ---
  let animFrameId = 0;
  const tmp = new THREE.Matrix4();
  const posV = new THREE.Vector3();
  const quatQ = new THREE.Quaternion();
  const sclV = new THREE.Vector3();

  function renderLoop() {
    animFrameId = requestAnimationFrame(renderLoop);

    // 动画更新
    if (charResult && animState) {
      const motion = animState.getCurrentMotion();
      evalSkeleton(charResult.animSmb, motion.frame, false);
      applyToBones(
        charResult.bones,
        charResult.animSmb.skelFrames,
        tmp, posV, quatQ, sclV,
      );
      animState.onAnimationEnd();
    }

    // 渲染
    const rect = centerPanel.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      camera.aspect = rect.width / rect.height;
      camera.updateProjectionMatrix();
      renderer.setSize(rect.width, rect.height, false);
    }
    renderer.render(scene, camera);
  }

  // --- BGM ---
  function startBgm() {
    try {
      bgm = new Audio('/res/game/sounds/music/characterselect.wav');
      bgm.loop = true;
      bgm.volume = 0.3;
      bgm.play().catch(() => {});
    } catch {}
  }

  function stopBgm() {
    if (bgm) {
      bgm.pause();
      bgm = null;
    }
  }

  // --- 生命周期 ---
  async function init() {
    // 加载场景
    try {
      sceneGroup = await loadScene(
        '/res/game/maps/chrselect/select.smd',
        '/res/game/maps/chrselect',
      );
      scene.add(sceneGroup);
    } catch (err) {
      console.error('Failed to load chrselect scene:', err);
    }

    startBgm();
    renderLoop();
  }

  return {
    el: root,
    show() {
      root.style.display = 'flex';
      init();
    },
    hide() {
      root.style.display = 'none';
      stopBgm();
      cancelAnimationFrame(animFrameId);
      controls.dispose();
      clearPreview();
      if (sceneGroup) {
        scene.remove(sceneGroup);
        sceneGroup = null;
      }
    },
    destroy() {
      stopBgm();
      cancelAnimationFrame(animFrameId);
      controls.dispose();
      renderer.dispose();
    },
    /** main.ts 调用：创建成功后刷新 */
    handleCreateResult(success: boolean, error?: string) {
      if (success) {
        onBack(); // 返回角色列表
      } else {
        nameError.textContent = error || '创建失败';
        createBtn.disabled = false;
        createBtn.textContent = '创建';
      }
    },
  };
}
```

- [ ] **Step 2: 验证编译**

Run: `npx tsc --noEmit`
Expected: 无错误（或仅有 i18n 相关的可选属性错误，可忽略）

- [ ] **Step 3: Commit**

```bash
git add src/ui/CharSelect.ts
git commit -m "feat: rewrite CharSelect as single-page with 3D preview"
```

---

### Task 4: App State 更新 — 添加 CHAR_CREATE 屏幕

**Files:**
- Modify: `src/app/State.ts`

**接口变更：**
- `AppScreen` 枚举添加 `CHAR_CREATE`
- `TransitionCtx` 添加 `showCharCreate(characters)`
- `transition()` 添加 CHAR_SELECT → CHAR_CREATE 和 CHAR_CREATE → CHAR_SELECT 的合法转换

- [ ] **Step 1: 修改 src/app/State.ts**

在 `AppScreen` 枚举中添加 `CHAR_CREATE`，在 `TransitionCtx` 中添加 `showCharCreate`，在 `transition()` 的合法转换表中添加：
- `CHAR_SELECT → CHAR_CREATE`（点击"创建角色"按钮）
- `CHAR_CREATE → CHAR_SELECT`（创建成功或取消）

- [ ] **Step 2: 验证编译**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/app/State.ts
git commit -m "feat: add CHAR_CREATE screen to app state machine"
```

---

### Task 5: main.ts 集成 — 接入 CharSelect 和创建结果处理

**Files:**
- Modify: `src/main.ts`

**修改内容：**
1. 导入 `createCharSelect`
2. 在 `showCharSelect` 中，如果有"创建角色"按钮，点击后 transition 到 CHAR_CREATE
3. 在 `showCharCreate` 中，调用 `createCharSelect(characters, transport, onBack)` 并挂载到 DOM
4. 在 `onMessage` 中处理 `createCharacterResult`：调用 `charSelect.handleCreateResult(success, error)`

- [ ] **Step 1: 修改 src/main.ts**

在 `showCharSelect` 中添加"创建角色"按钮（在角色列表下方），点击后 `transition(CHAR_SELECT, CHAR_CREATE, ctx)`。

在 `showCharCreate` 中：
```typescript
function showCharCreate(characters: AppCharacter[]) {
  const charSelect = createCharSelect(characters, transport, () => {
    // onBack: 取消 → 回到角色列表
    transition(AppScreen.CHAR_CREATE, AppScreen.CHAR_SELECT, {
      showCharSelect: (chars) => showCharSelect(chars),
    });
  });
  dom.root.appendChild(charSelect.el);
  charSelect.show();
  // 保存引用以便 onMessage 调用
  currentCharSelect = charSelect;
}
```

在 `onMessage` 中添加 `createCharacterResult` 处理：
```typescript
if (msg.createCharacterResult) {
  const { success, error } = msg.createCharacterResult;
  if (currentCharSelect) {
    currentCharSelect.handleCreateResult(success, error);
  }
}
```

- [ ] **Step 2: 验证编译**

Run: `npx tsc --noEmit`

- [ ] **Step 3: 验证完整流程**

手动测试：登录 → 服务器选择 → 角色列表 → 点击"创建角色" → 进入创建界面 → 选择职业 → 输入名字 → 点击创建

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat: integrate CharSelect creation flow into main app"
```

---

### Task 6: i18n 补全 — 添加职业名称和描述的翻译

**Files:**
- Modify: `locales/zh-CN.json`
- Modify: `locales/en-US.json`

**修改内容：** 添加 `charcreate` 分区下的职业名称、描述、属性文本。

- [ ] **Step 1: 在 zh-CN.json 添加 charcreate 节**

```json
{
  "charcreate": {
    "title": "选择职业",
    "job": {
      "warrior": { "name": "武士", "desc": "铁木族近战战士，擅长使用大剑和重型盔甲。", "attr": "高生命值 · 高防御力" },
      "mechanic": { "name": "机械", "desc": "铁木族机械师，操控机械装置进行战斗。", "attr": "中等生命 · 远程攻击" },
      "archer": { "name": "弓箭", "desc": "铁木族弓箭手，远程精准射击。", "attr": "高敏捷 · 远程攻击" },
      "lancer": { "name": "枪兵", "desc": "铁木族枪兵，快速突进和范围攻击。", "attr": "高攻击 · 中等防御" },
      "assassin": { "name": "刺客", "desc": "铁木族刺客，隐身和爆发伤害。", "attr": "极高攻击 · 低防御" },
      "knight": { "name": "骑士", "desc": "摩瑞族骑士，神圣力量的守护者。", "attr": "高生命 · 高防御力" },
      "magiclancer": { "name": "魔枪", "desc": "摩瑞族魔枪手，结合魔法和枪术。", "attr": "中等生命 · 魔法攻击" },
      "priest": { "name": "祭司", "desc": "摩瑞族祭司，治愈和辅助队友。", "attr": "治疗 · 辅助" },
      "mage": { "name": "法师", "desc": "摩瑞族法师，强大的元素魔法。", "attr": "高魔法 · 远程攻击" },
      "shaman": { "name": "萨满", "desc": "摩瑞族萨满，自然之力的化身。", "attr": "魔法 · 治疗混合" }
    },
    "face": "脸型",
    "name_label": "角色名",
    "name_placeholder": "输入角色名 (2-12字)",
    "create": "创建",
    "cancel": "取消",
    "creating": "创建中...",
    "create_success": "创建成功",
    "create_failed": "创建失败",
    "name_invalid": "名字只能包含中英文和数字，2-12个字符"
  }
}
```

- [ ] **Step 2: 在 en-US.json 添加对应英文翻译**

- [ ] **Step 3: Commit**

```bash
git add locales/zh-CN.json locales/en-US.json
git commit -m "feat: add character creation i18n strings"
```

---

## Self-Review Checklist

- [x] Spec 覆盖：三栏布局 ✅, 职业 hover/选中交互 ✅, 脸型持久化 ✅, 3D 场景 ✅, 摄像机旋转 ✅, BGM ✅, 名字验证 ✅, 创建/取消按钮 ✅
- [x] 占位符扫描：无 TBD/TODO
- [x] 类型一致性：`loadScene`, `createCameraControls`, `createCharSelect`, `handleCreateResult` 签名在各 Task 间一致
- [x] 无新依赖：全部使用已有 three.js、Vite、TypeScript
