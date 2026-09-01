import * as THREE from 'three';
import { t } from '../i18n/index.js';
import { loadCharacterModel, CharLoadResult } from '../render/char-loader.js';
import { createAnimStateMachine, AnimStateMachine } from '../char/anim-state-machine.js';
import { evalSkeleton, applyToBones } from '../char/animation.js';
import { loadScene } from '../render/scene-loader.js';
import { createCameraControls } from './camera-controls.js';

export interface CharacterInfo { characterId: number; name: string; classId: number; level: number; }

export interface CharSelect {
  show(characters: CharacterInfo[], opts: {
    onSelect: (characterId: number) => void;
    onCreate: (name: string, classId: number, head: number) => void;
    onLogout: () => void;
  }): void;
  hide(): void;
  destroy(): void;
  handleCreateResult(success: boolean, error?: string): void;
}

interface JobInfo {
  id: number;
  nameKey: string;
  side: 'tempscron' | 'moryon';
}

const JOBS: JobInfo[] = [
  { id: 1, nameKey: 'job.fighter', side: 'tempscron' },
  { id: 2, nameKey: 'job.mechanician', side: 'tempscron' },
  { id: 3, nameKey: 'job.archer', side: 'tempscron' },
  { id: 4, nameKey: 'job.pikeman', side: 'tempscron' },
  { id: 5, nameKey: 'job.assassin', side: 'tempscron' },
  { id: 6, nameKey: 'job.knight', side: 'moryon' },
  { id: 7, nameKey: 'job.atalanta', side: 'moryon' },
  { id: 8, nameKey: 'job.priestess', side: 'moryon' },
  { id: 9, nameKey: 'job.magician', side: 'moryon' },
  { id: 10, nameKey: 'job.shaman', side: 'moryon' },
];

const NAME_REGEX = /^[\u4e00-\u9fa5a-zA-Z0-9]{2,12}$/;

export function createCharSelect(container: HTMLElement): CharSelect {
  const root = document.createElement('div');
  root.id = 'char-select-root';
  root.style.cssText = 'display:none;position:fixed;inset:0;background:#0a0a1a;color:#e0d8c8;font-family:monospace;z-index:100;flex-direction:column;';
  container.appendChild(root);

  let characters: CharacterInfo[] = [];
  let opts: { onSelect: (id: number) => void; onCreate: (name: string, classId: number, head: number) => void; onLogout: () => void } | null = null;

  // creation mode state
  let selectedJobId: number | null = null;
  let hoveredJobId: number | null = null;
  let selectedFace = 0;
  let currentPreviewJobId: number | null = null;
  let currentPreviewFace = -1;

  // 3D
  let canvas: HTMLCanvasElement | null = null;
  let renderer: THREE.WebGLRenderer | null = null;
  let scene: THREE.Scene | null = null;
  let camera: THREE.PerspectiveCamera | null = null;
  let controls: ReturnType<typeof createCameraControls> | null = null;
  let sceneGroup: THREE.Group | null = null;
  let skeletonGroup: THREE.Group | null = null;
  let charResult: CharLoadResult | null = null;
  let animState: AnimStateMachine | null = null;
  let animFrameId = 0;
  let animFrame = 0;
  const tmp = new THREE.Matrix4();
  const posV = new THREE.Vector3();
  const quatQ = new THREE.Quaternion();
  const sclV = new THREE.Vector3();

  // BGM
  let bgm: HTMLAudioElement | null = null;

  // --- list mode ---
  const listEl = document.createElement('div');
  listEl.style.cssText = 'display:none;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:12px;background:rgba(0,0,0,0.85);color:#fff;font-size:14px;';

  function renderList() {
    listEl.innerHTML = '';
    listEl.style.display = 'flex';
    const title = document.createElement('h2');
    title.textContent = t('gui.charSel.title');
    listEl.appendChild(title);

    const cardList = document.createElement('div');
    cardList.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;justify-content:center;max-width:600px';
    for (const c of characters) {
      const card = document.createElement('div');
      card.style.cssText = 'padding:12px 16px;background:#222;border-radius:4px;cursor:pointer;min-width:160px;text-align:center';
      card.innerHTML = `<div style="font-weight:bold">${c.name}</div><div style="color:#aaa">${t('job.' + jobKeyById(c.classId))} ${t('gui.charSel.level', { level: c.level })}</div>`;
      card.onclick = () => opts?.onSelect(c.characterId);
      cardList.appendChild(card);
    }
    listEl.appendChild(cardList);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:12px;margin-top:12px';
    const createBtn = document.createElement('button');
    createBtn.textContent = t('gui.charSel.create');
    createBtn.style.cssText = 'padding:8px 20px;font-size:14px;cursor:pointer';
    createBtn.onclick = () => enterCreateMode();
    btnRow.appendChild(createBtn);
    const logoutBtn = document.createElement('button');
    logoutBtn.textContent = t('gui.charSel.logout');
    logoutBtn.style.cssText = 'padding:8px 20px;font-size:14px;cursor:pointer';
    logoutBtn.onclick = () => opts?.onLogout();
    btnRow.appendChild(logoutBtn);
    listEl.appendChild(btnRow);
  }

  function jobKeyById(id: number): string {
    const j = JOBS.find(j => j.id === id);
    return j ? j.nameKey.split('.')[1] : 'fighter';
  }

  // --- create mode ---
  const createEl = document.createElement('div');
  createEl.style.cssText = 'display:none;flex:1;flex-direction:column;overflow:hidden;';

  // DOM refs
  let jobNameEl: HTMLDivElement;
  let jobDescEl: HTMLDivElement;
  let jobAttrEl: HTMLDivElement;
  let jobGrid: HTMLDivElement;
  let faceEls: HTMLDivElement[] = [];
  let nameInput: HTMLInputElement;
  let nameError: HTMLDivElement;
  let createBtn: HTMLButtonElement;
  let centerPanel: HTMLDivElement;
  const jobEls = new Map<number, HTMLDivElement>();

  function buildCreateUI() {
    createEl.innerHTML = '';

    const layout = document.createElement('div');
    layout.style.cssText = 'display:flex;flex:1;overflow:hidden;';

    // left panel
    const leftPanel = document.createElement('div');
    leftPanel.style.cssText = 'width:220px;padding:20px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center;';
    jobNameEl = document.createElement('div');
    jobNameEl.style.cssText = 'font-size:24px;margin-bottom:12px;';
    jobDescEl = document.createElement('div');
    jobDescEl.style.cssText = 'font-size:13px;line-height:1.6;opacity:0.8;';
    jobAttrEl = document.createElement('div');
    jobAttrEl.style.cssText = 'font-size:13px;margin-top:12px;opacity:0.7;';
    leftPanel.append(jobNameEl, jobDescEl, jobAttrEl);
    clearJobInfo();

    // center panel
    centerPanel = document.createElement('div');
    centerPanel.style.cssText = 'flex:1;position:relative;';

    // right panel
    const rightPanel = document.createElement('div');
    rightPanel.style.cssText = 'width:240px;padding:20px;box-sizing:border-box;display:flex;flex-direction:column;gap:16px;overflow-y:auto;';

    // job section
    const jobSection = document.createElement('div');
    const jobTitle = document.createElement('div');
    jobTitle.textContent = t('gui.charCreate.job');
    jobTitle.style.cssText = 'font-size:14px;margin-bottom:8px;opacity:0.6;';
    jobGrid = document.createElement('div');
    jobGrid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;';
    jobSection.append(jobTitle, jobGrid);
    buildJobGrid();

    // face section
    const faceSection = document.createElement('div');
    const faceTitle = document.createElement('div');
    faceTitle.textContent = t('gui.charCreate.face');
    faceTitle.style.cssText = 'font-size:14px;margin-bottom:8px;opacity:0.6;';
    const faceRow = document.createElement('div');
    faceRow.style.cssText = 'display:flex;gap:8px;';
    faceSection.append(faceTitle, faceRow);
    faceEls = [];
    for (let f = 0; f < 3; f++) {
      const el = document.createElement('div');
      el.textContent = String(f + 1);
      el.style.cssText = `width:36px;height:36px;display:flex;align-items:center;justify-content:center;border:2px solid #555;border-radius:4px;cursor:pointer;font-size:14px;`;
      el.addEventListener('click', () => selectFace(f));
      faceRow.appendChild(el);
      faceEls.push(el);
    }
    updateFaceHighlight();

    // name section
    const nameSection = document.createElement('div');
    const nameLabel = document.createElement('div');
    nameLabel.textContent = t('gui.charCreate.name');
    nameLabel.style.cssText = 'font-size:14px;margin-bottom:8px;opacity:0.6;';
    nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.maxLength = 12;
    nameInput.placeholder = t('gui.charCreate.placeholder');
    nameInput.style.cssText = 'width:100%;padding:8px;background:#1a1a2e;border:1px solid #555;color:#e0d8c8;font-size:14px;box-sizing:border-box;';
    nameError = document.createElement('div');
    nameError.style.cssText = 'color:#e44;font-size:12px;margin-top:4px;min-height:16px;';
    nameInput.addEventListener('input', validateName);
    nameSection.append(nameLabel, nameInput, nameError);

    // buttons
    const btnSection = document.createElement('div');
    btnSection.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
    createBtn = document.createElement('button');
    createBtn.textContent = t('gui.charCreate.create');
    createBtn.disabled = true;
    createBtn.style.cssText = 'padding:10px;background:#4a7c59;color:#e0d8c8;border:none;cursor:pointer;font-size:14px;';
    createBtn.addEventListener('click', doCreate);
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = t('gui.charCreate.back');
    cancelBtn.style.cssText = 'padding:10px;background:transparent;color:#e0d8c8;border:1px solid #555;cursor:pointer;font-size:14px;';
    cancelBtn.addEventListener('click', exitCreateMode);
    btnSection.append(createBtn, cancelBtn);

    rightPanel.append(jobSection, faceSection, nameSection, btnSection);
    layout.append(leftPanel, centerPanel, rightPanel);
    createEl.appendChild(layout);
  }

  buildCreateUI();

  function buildJobGrid() {
    jobGrid.innerHTML = '';
    jobEls.clear();
    const tempscron = JOBS.filter(j => j.side === 'tempscron');
    const moryon = JOBS.filter(j => j.side === 'moryon');
    for (let i = 0; i < Math.max(tempscron.length, moryon.length); i++) {
      if (tempscron[i]) {
        const el = createJobEl(tempscron[i], 'right');
        jobGrid.appendChild(el);
        jobEls.set(tempscron[i].id, el);
      } else {
        jobGrid.appendChild(document.createElement('div'));
      }
      if (moryon[i]) {
        const el = createJobEl(moryon[i], 'left');
        jobGrid.appendChild(el);
        jobEls.set(moryon[i].id, el);
      } else {
        jobGrid.appendChild(document.createElement('div'));
      }
    }
  }

  function createJobEl(job: JobInfo, align: 'left' | 'right'): HTMLDivElement {
    const el = document.createElement('div');
    el.textContent = t(job.nameKey);
    el.style.cssText = `padding:6px 8px;cursor:pointer;font-size:14px;text-align:${align};border-radius:3px;transition:background 0.15s,color 0.15s;`;
    el.addEventListener('mouseenter', () => {
      hoveredJobId = job.id;
      updateJobHighlight();
      loadPreview(job.id, 0);
      updateJobInfo(job);
    });
    el.addEventListener('mouseleave', () => {
      hoveredJobId = null;
      updateJobHighlight();
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
    updateFaceHighlight();
    if (currentPreviewJobId !== null) {
      loadPreview(currentPreviewJobId, face);
    }
  }

  function updateFaceHighlight() {
    faceEls.forEach((el, i) => {
      el.style.borderColor = i === selectedFace ? '#f0c040' : '#555';
      el.style.color = i === selectedFace ? '#f0c040' : '#e0d8c8';
    });
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
    jobNameEl.textContent = t(job.nameKey);
    jobDescEl.textContent = '';
    jobAttrEl.textContent = '';
  }

  function clearJobInfo() {
    jobNameEl.textContent = '';
    jobDescEl.textContent = t('gui.charCreate.selectJob');
    jobAttrEl.textContent = '';
  }

  // --- 3D ---
  function ensure3D() {
    if (canvas) {
      if (!controls) controls = createCameraControls(camera!, canvas);
      return;
    }
    canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:100%;height:100%;';
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x1a1a2e);
    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x1a1a2e, 20, 60);
    camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    controls = createCameraControls(camera, canvas);
    skeletonGroup = new THREE.Group();
    scene.add(skeletonGroup);
    const amb = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(amb);
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(5, 10, 5);
    scene.add(dir);
  }

  async function loadSceneAsync() {
    try {
      sceneGroup = await loadScene('/res/game/maps/chrselect/select.smd', '/res/game/maps/chrselect');
      scene!.add(sceneGroup);
    } catch (err) {
      console.warn('CharSelect: failed to load chrselect scene', err);
    }
  }

  async function loadPreview(jobId: number, face: number) {
    if (currentPreviewJobId === jobId && currentPreviewFace === face) return;
    currentPreviewJobId = jobId;
    currentPreviewFace = face;
    clearCharModel();
    try {
      charResult = await loadCharacterModel(jobId, face);
      skeletonGroup!.add(charResult.skeletonGroup);
      animState = createAnimStateMachine({
        getMotions: () => charResult!.bipInxInfo.motions,
        getClassId: () => jobId,
        onMotionChange: () => {},
      });
      animState.triggerIdle();
      animFrame = 0;
    } catch (err) {
      console.warn('CharSelect: loadPreview failed', err);
      currentPreviewJobId = null;
      currentPreviewFace = -1;
    }
  }

  function clearCharModel() {
    if (charResult && skeletonGroup) {
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

  function startRenderLoop() {
    if (animFrameId) return;
    function loop() {
      animFrameId = requestAnimationFrame(loop);
      if (!renderer || !scene || !camera || !centerPanel) return;

      if (charResult && animState) {
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
              animState.onAnimationEnd();
              const next = animState.getCurrentMotion();
              if (next) animFrame = next.startFrame * 160;
            }
          }
          const skelFrames = evalSkeleton(charResult.animSmb, animFrame, false);
          applyToBones(charResult.bones, skelFrames, tmp, posV, quatQ, sclV);
        }
      }

      const rect = centerPanel.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        camera.aspect = rect.width / rect.height;
        camera.updateProjectionMatrix();
        renderer.setSize(rect.width, rect.height, false);
      }
      renderer.render(scene, camera);
    }
    loop();
  }

  function stopRenderLoop() {
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = 0;
    }
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
    if (bgm) { bgm.pause(); bgm = null; }
  }

  // --- mode switching ---
  function enterCreateMode() {
    listEl.style.display = 'none';
    createEl.style.display = 'flex';
    ensure3D();
    centerPanel.appendChild(canvas!);
    loadSceneAsync();
    startBgm();
    startRenderLoop();
    // select first job by default
    selectJob(1);
  }

  function exitCreateMode() {
    stopRenderLoop();
    stopBgm();
    clearPreview();
    if (sceneGroup && scene) { scene.remove(sceneGroup); sceneGroup = null; }
    controls?.dispose();
    controls = null;
    if (canvas) canvas.remove();
    canvas = null;
    createEl.style.display = 'none';
    listEl.style.display = 'flex';
  }

  // --- name validation ---
  function validateName() {
    const name = nameInput.value.trim();
    if (!name) {
      nameError.textContent = '';
      createBtn.disabled = true;
    } else if (!NAME_REGEX.test(name)) {
      nameError.textContent = t('gui.charCreate.nameInvalid');
      createBtn.disabled = true;
    } else {
      nameError.textContent = '';
      createBtn.disabled = selectedJobId === null;
    }
  }

  function doCreate() {
    const name = nameInput.value.trim();
    if (!name || selectedJobId === null) return;
    createBtn.disabled = true;
    createBtn.textContent = t('gui.charCreate.creating');
    try {
      opts?.onCreate(name, selectedJobId, selectedFace);
    } catch (err) {
      console.error('Create character failed:', err);
      nameError.textContent = t('gui.charCreate.failedRetry');
      createBtn.disabled = false;
      createBtn.textContent = t('gui.charCreate.create');
    }
  }

  root.append(listEl, createEl);

  return {
    show(chars, o) {
      characters = chars;
      opts = o;
      if (createEl.style.display !== 'none') exitCreateMode();
      renderList();
      root.style.display = 'flex';
    },
    hide() {
      root.style.display = 'none';
      stopRenderLoop();
      stopBgm();
      clearPreview();
      controls?.dispose();
      controls = null;
      if (canvas) canvas.remove();
      canvas = null;
      if (sceneGroup && scene) { scene.remove(sceneGroup); sceneGroup = null; }
    },
    destroy() {
      stopRenderLoop();
      stopBgm();
      if (renderer) renderer.dispose();
      if (canvas) canvas.remove();
      if (controls) controls.dispose();
      root.remove();
    },
    handleCreateResult(success: boolean, error?: string) {
      if (success) {
        exitCreateMode();
      } else {
        nameError.textContent = error || t('gui.charCreate.failed');
        createBtn.disabled = false;
        createBtn.textContent = t('gui.charCreate.create');
      }
    },
  };
}
