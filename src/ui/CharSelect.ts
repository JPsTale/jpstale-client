import * as THREE from 'three';
import { t } from '../i18n/index.js';
import { loadCharacterModel, CharLoadResult } from '../render/char-loader.js';
import { createAnimStateMachine, AnimStateMachine } from '../char/anim-state-machine.js';
import { evalSkeleton, applyToBones } from '../char/animation.js';
import { decodeTextureAsync } from '../core/texture.js';
import { createCameraControls } from './camera-controls.js';
import { CHRMOTION_EXT } from '../char/char-format.js';
import type { MotionInfo } from '../char/char-format.js';
import { resolveCostumeBody } from '../render/costume-body-map.js';
import { loadWeaponModel, findBone, WEAPON_BONES } from '../render/weapon-loader.js';
import { getWeaponTypeFromIdCode } from '../char/weapon-type.js';

export interface CharacterAppearance {
  classId: number;
  head: number;
  rank: number;
  bodyModel?: string;
  bodyModelIdcode: number;
  weaponDorp?: string;
  weaponIdcode: number;
  weaponPos: number;
  sizeLevel: number;
}

// 浠?idCode 璁＄畻閾犵敳缂栧彿锛堝榻?pviewer armorNumFromIdCode锛夛細(idcode >> 8) & 0xff, >25 鏃?-=17
export function armorNumFromIdCode(idCode: number): number {
  let n = (idCode >> 8) & 0xff;
  if (n > 25) n -= 17;
  return n;
}

export interface CharacterInfo { characterId: number; name: string; classId: number; level: number; appearance?: CharacterAppearance; }

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

// 鑱屼笟褰掑睘锛坈haracter-model-mapping.md 搂2/搂3锛夛細鍧︽櫘鏃?1,2,3,4,9锛涢瓟鐏垫棌=5,6,7,8,10
const JOBS: JobInfo[] = [
  { id: 1, nameKey: 'job.fighter', side: 'tempscron' },
  { id: 2, nameKey: 'job.mechanician', side: 'tempscron' },
  { id: 3, nameKey: 'job.archer', side: 'tempscron' },
  { id: 4, nameKey: 'job.pikeman', side: 'tempscron' },
  { id: 9, nameKey: 'job.assassin', side: 'tempscron' },
  { id: 5, nameKey: 'job.atalanta', side: 'moryon' },
  { id: 6, nameKey: 'job.knight', side: 'moryon' },
  { id: 7, nameKey: 'job.magician', side: 'moryon' },
  { id: 8, nameKey: 'job.priestess', side: 'moryon' },
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
  let selectedHead = 0;
  let currentPreviewJobId: number | null = null;
  let currentPreviewHead = -1;
  let currentPreviewAppearance = '';

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
  let loadGeneration = 0; // prevents stale async loads from adding models
  let motionList: MotionInfo[] = []; // TmFrame 偏移后的动画列表（调试列表用）
  const tmp = new THREE.Matrix4();
  const posV = new THREE.Vector3();
  const quatQ = new THREE.Quaternion();
  const sclV = new THREE.Vector3();

  // BGM
  let bgm: HTMLAudioElement | null = null;

  // Texture loading (same as char-demo.ts)
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

  // --- list mode ---
  const listEl = document.createElement('div');
  listEl.style.cssText = 'display:none;flex-direction:row;height:100%;background:rgba(0,0,0,0.85);color:#fff;font-size:14px;';
  const listPreviewHost = document.createElement('div');
  listPreviewHost.style.cssText = 'flex:1;position:relative;';
  listEl.appendChild(listPreviewHost);

  let selectedCharId: number | null = null;

  function renderList() {
    listEl.querySelector('.char-side')?.remove();
    listPreviewHost.innerHTML = '';

    const side = document.createElement('div');
    side.className = 'char-side';
    side.style.cssText = 'width:300px;padding:24px;box-sizing:border-box;border-left:1px solid #333;display:flex;flex-direction:column;gap:12px;';

    const title = document.createElement('h2');
    title.textContent = t('gui.charSel.title');
    side.appendChild(title);

    const charList = document.createElement('div');
    charList.style.cssText = 'flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:8px;';
    for (const c of characters) {
      const card = document.createElement('div');
      card.dataset.characterId = String(c.characterId);
      card.style.cssText = 'padding:14px 16px;background:#222;border-radius:4px;cursor:pointer;border:2px solid transparent;';
      card.innerHTML = `<div style="font-weight:bold">${c.name}</div><div style="color:#aaa">${t('job.' + jobKeyById(c.classId))} ${t('gui.charSel.level', { level: c.level })}</div>`;
      card.onclick = () => selectCharacter(c.characterId);
      charList.appendChild(card);
    }
    side.appendChild(charList);

    const enterBtn = document.createElement('button');
    enterBtn.textContent = t('gui.charSel.enter');
    enterBtn.style.cssText = 'padding:10px;background:#4a7c59;color:#fff;border:none;cursor:pointer;font-size:14px;';
    enterBtn.onclick = () => { if (selectedCharId !== null) opts?.onSelect(selectedCharId); };

    const createBtn = document.createElement('button');
    createBtn.textContent = t('gui.charSel.create');
    createBtn.style.cssText = 'padding:10px;background:transparent;color:#fff;border:1px solid #555;cursor:pointer;font-size:14px;';
    createBtn.onclick = () => enterCreateMode();

    const logoutBtn = document.createElement('button');
    logoutBtn.textContent = t('gui.charSel.logout');
    logoutBtn.style.cssText = 'padding:10px;background:transparent;color:#fff;border:1px solid #555;cursor:pointer;font-size:14px;';
    logoutBtn.onclick = () => opts?.onLogout();

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
    btnRow.append(enterBtn, createBtn, logoutBtn);
    side.appendChild(btnRow);

    listEl.appendChild(side);
    listEl.style.display = 'flex';

    ensure3D();
    if (canvas && canvas.parentElement !== listPreviewHost) listPreviewHost.appendChild(canvas);
    loadSceneAsync();
    startBgm();
    startRenderLoop();

    if (characters.length) selectCharacter(characters[0].characterId);
    else clearPreview();
  }

  function selectCharacter(characterId: number) {
    selectedCharId = characterId;
    const c = characters.find(x => x.characterId === characterId);
    if (c) loadPreview(c.classId, c.appearance?.head ?? 0, c.appearance);
    listEl.querySelectorAll('[data-character-id]').forEach((el) => {
      const active = el.getAttribute('data-character-id') === String(characterId);
      (el as HTMLDivElement).style.borderColor = active ? '#f0c040' : 'transparent';
      (el as HTMLDivElement).style.background = active ? '#3a5a3a' : '#222';
    });
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
  let headEls: HTMLDivElement[] = [];
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

    // head section
    const headSection = document.createElement('div');
    const headTitle = document.createElement('div');
    headTitle.textContent = t('gui.charCreate.face');
    headTitle.style.cssText = 'font-size:14px;margin-bottom:8px;opacity:0.6;';
    const headRow = document.createElement('div');
    headRow.style.cssText = 'display:flex;gap:8px;';
    headSection.append(headTitle, headRow);
    headEls = [];
    for (let h = 0; h < 3; h++) {
      const el = document.createElement('div');
      el.textContent = String(h + 1);
      el.style.cssText = `width:36px;height:36px;display:flex;align-items:center;justify-content:center;border:2px solid #555;border-radius:4px;cursor:pointer;font-size:14px;`;
      el.addEventListener('click', () => selectHead(h));
      headRow.appendChild(el);
      headEls.push(el);
    }
    updateHeadHighlight();

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

    rightPanel.append(jobSection, headSection, nameSection, btnSection);
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
      loadPreview(job.id, selectedHead);
      updateJobInfo(job);
    });
    el.addEventListener('mouseleave', () => {
      hoveredJobId = null;
      updateJobHighlight();
      if (selectedJobId !== null) {
        const sel = JOBS.find(j => j.id === selectedJobId);
        if (sel) {
          loadPreview(selectedJobId, selectedHead);
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
      loadPreview(jobId, selectedHead);
      updateJobInfo(job);
    }
    updateJobHighlight();
    validateName();
  }

  function selectHead(head: number) {
    selectedHead = head;
    updateHeadHighlight();
    if (currentPreviewJobId !== null) {
      loadPreview(currentPreviewJobId, head);
    }
  }

  function updateHeadHighlight() {
    headEls.forEach((el, i) => {
      el.style.borderColor = i === selectedHead ? '#f0c040' : '#555';
      el.style.color = i === selectedHead ? '#f0c040' : '#e0d8c8';
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
    camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
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
    // Ponytail: select.smd is a game map, not chrselect scene. Use solid background for now.
    scene!.background = new THREE.Color(0x1a1a2e);
    camera!.position.set(0, 40, 80);
    camera!.lookAt(0, 25, 0);
    controls!.setTarget(new THREE.Vector3(0, 25, 0));
  }

  async function loadPreview(jobId: number, head: number, appearance?: CharacterAppearance) {
    const appSig = appearance
      ? `${appearance.bodyModel ?? ''}|${appearance.bodyModelIdcode}|${appearance.weaponDorp ?? ''}|${appearance.weaponIdcode}|${appearance.weaponPos}`
      : '';
    if (currentPreviewJobId === jobId && currentPreviewHead === head && currentPreviewAppearance === appSig) return;
    currentPreviewJobId = jobId;
    currentPreviewHead = head;
    currentPreviewAppearance = appSig;
    clearCharModel();
    const gen = ++loadGeneration;
    try {
      // bodyModel=时装 dorpItem（查 COSTUME_BODY_MAP），bodyModelIdcode=普通防具 idcode（算 armorNum）
      let armorNum = 1;
      let bodyInxOverride: string | null = null;
      if (appearance?.bodyModelIdcode && appearance.bodyModelIdcode > 0) {
        armorNum = armorNumFromIdCode(appearance.bodyModelIdcode);
      } else if (appearance?.bodyModel) {
        bodyInxOverride = resolveCostumeBody(appearance.bodyModel, jobId);
      }
      const result = await loadCharacterModel(jobId, head, 0, armorNum, bodyInxOverride);
      if (gen !== loadGeneration) return; // stale load, discard
      charResult = result;
      // Hide meshes until textures load (prevent grey flash)
      result.bodyGroup.visible = false;
      result.headGroup.visible = false;
      skeletonGroup!.add(result.skeletonGroup);
      skeletonGroup!.add(result.bodyGroup);
      skeletonGroup!.add(result.headGroup);
      // Load textures
      await loadTextures([...result.bodyTextures, ...result.headTextures]);
      if (gen !== loadGeneration) return;
      result.bodyGroup.visible = true;
      result.headGroup.visible = true; // stale after texture load
      // 姝﹀櫒鎸傝浇锛堝鏈夛級
      currentWeaponIdcode = appearance?.weaponIdcode && appearance.weaponIdcode > 0 ? appearance.weaponIdcode : null;
      currentWeaponType = currentWeaponIdcode ? getWeaponTypeFromIdCode(currentWeaponIdcode) : null;
      currentWeaponPos = appearance?.weaponPos || 4;
      weaponStance = 'combat';
      if (appearance?.weaponDorp) {
        await attachWeaponPreview(appearance.weaponDorp, appearance.weaponPos);
      }
      if (gen !== loadGeneration) return;
      animState = createAnimStateMachine({
        getMotions: () => motionList,
        getClassId: () => jobId,
        getWeaponIdCode: () => currentWeaponIdcode,
        getWeaponType: () => currentWeaponType,
        onStanceChange: (stance) => { setWeaponStance(stance); },
        onMotionChange: (motion: MotionInfo) => {
          // 1 tick = 160 帧；.inx startFrame/endFrame 单位是 tick（已 TmFrame 偏移）
          animFrame = motion.startFrame * 160;
        },
      });
      buildMotionList();
      animState.triggerIdle(); // onMotionChange 已设 animFrame=startFrame*160，勿再覆盖
    } catch (err) {
      console.warn('CharSelect: loadPreview failed', err);
      currentPreviewJobId = null;
      currentPreviewHead = -1;
      currentPreviewAppearance = '';
    }
  }

  let weaponGroup: THREE.Group | null = null;
  let currentWeaponIdcode: number | null = null;
  let currentWeaponType: string | null = null;
  let currentWeaponPos = 4;
  let weaponStance = 'combat';

  // 鏀惰捣濮挎€侀楠硷紙鏂囨。 搂8.2 / m6 瀹炴祴锛夛細鍓戞枾鍏ヨ儗 in01锛屽紦 in-bow锛屽崄瀛楀紦 in-cro锛屽寱棣?in_DaggerL/R
  function sheatheBoneForType(weaponType: string | null, weaponPos: number): string {
    switch (weaponType) {
      case 'BOW': return WEAPON_BONES.SHEATHE_BOW;
      case 'CROSSBOW': return WEAPON_BONES.SHEATHE_CROSSBOW;
      case 'DAGGER': return weaponPos === 2 ? 'Bip in_DaggerL' : 'Bip in_DaggerR';
      default: return WEAPON_BONES.SHEATHE_BACK; // AXE/SWORD/HAMMER/JAVELIN/SCYTHE/STAFF 鍏ヨ儗
    }
  }

  async function setWeaponStance(stance: 'combat' | 'sheathed') {
    if (!weaponGroup || !skeletonGroup || weaponStance === stance) return;
    const fromBone = stance === 'combat' ? sheatheBoneForType(currentWeaponType, currentWeaponPos) : currentCombatBone;
    const toBone = stance === 'combat' ? currentCombatBone : sheatheBoneForType(currentWeaponType, currentWeaponPos);
    if (!fromBone || !toBone) return;
    const from = findBone(skeletonGroup, fromBone);
    const to = findBone(skeletonGroup, toBone);
    if (!from || !to) return;
    weaponGroup.parent?.remove(weaponGroup);
    to.add(weaponGroup);
    weaponStance = stance;
  }

  let currentCombatBone = WEAPON_BONES.RIGHT_HAND;

  async function attachWeaponPreview(dorpItem: string, weaponPos: number) {
    if (!weaponGroup) {
      try {
        const result = await loadWeaponModel(dorpItem);
        weaponGroup = result.group;
        // modelPosition: 2=LeftHand, 4=RightHand (default) 鈥斺€?瀵归綈 pviewer
        const boneName = weaponPos === 2 ? WEAPON_BONES.LEFT_HAND : WEAPON_BONES.RIGHT_HAND;
        currentCombatBone = boneName;
        const bone = findBone(skeletonGroup!, boneName);
        if (!bone) {
          console.warn('CharSelect: 找不到武器挂载骨骼', boneName);
          weaponGroup = null;
          return;
        }
        bone.add(weaponGroup);
        weaponStance = 'combat';
        await loadTextures(result.texturesToLoad.map(x => ({ url: x.url, mat: x.mat })));
      } catch (err) {
        console.warn('CharSelect: 姝﹀櫒鍔犺浇澶辫触', dorpItem, err);
        weaponGroup = null;
      }
    }
  }

  function clearCharModel() {
    if (charResult && skeletonGroup) {
      skeletonGroup.remove(charResult.skeletonGroup);
      skeletonGroup.remove(charResult.bodyGroup);
      skeletonGroup.remove(charResult.headGroup);
    }
    if (weaponGroup && skeletonGroup) {
      skeletonGroup.traverse((o) => {
        if (o !== skeletonGroup && weaponGroup && o.children.includes(weaponGroup)) {
          o.remove(weaponGroup);
        }
      });
    }
    weaponGroup = null;
    currentWeaponIdcode = null;
    currentWeaponType = null;
    charResult = null;
    animState = null;
    motionList = [];
  }

  function clearPreview() {
    clearCharModel();
    currentPreviewJobId = null;
    currentPreviewHead = -1;
    currentPreviewAppearance = '';
  }

  // 构建 TmFrame 偏移后的动画列表（供动画状态机使用）
  function buildMotionList() {
    if (!charResult) return;
    motionList = [];
    const smb = charResult.animSmb;
    const tmFrame = smb.tmFrame;
    const bip = charResult.bipInxInfo;
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

  function startRenderLoop() {
    if (animFrameId) return;
    function loop() {
      animFrameId = requestAnimationFrame(loop);
      if (!renderer || !scene || !camera || !canvas) return;
      const host = canvas.parentElement;
      if (!host) return;

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
              const next = animState.onAnimationEnd();
              if (next) {
                animFrame = next.startFrame * 160;
              }
            }
          }
          const skelFrames = evalSkeleton(charResult.animSmb, animFrame, false);
          applyToBones(charResult.bones, skelFrames, tmp, posV, quatQ, sclV);
          charResult.skeleton.update();
        }
      }

      const rect = host.getBoundingClientRect();
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
  function startBgm() {}

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
    renderList();
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
      opts?.onCreate(name, selectedJobId, selectedHead);
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
      if (createEl.style.display !== 'none') {
        exitCreateMode(); // 鍐呴儴宸?renderList()
      } else {
        renderList();
      }
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

