import * as THREE from 'three';
import { t } from '../i18n/index.js';
import { CharLoadResult } from '../render/char-loader.js';
import { loadCharacterModelLite } from '../render/lite-loader.js';
import { createAnimStateMachine, AnimStateMachine } from '../char/anim-state-machine.js';
import { createAnimPlayer, buildMotionList as buildMotionListShared, type AnimPlayer } from '../char/anim-player.js';
import { loadCharTextures } from '../render/char-texture-loader.js';
import { createCameraControls } from './camera-controls.js';
import type { MotionInfo } from '../char/char-format.js';
import { resolveCostumeBody } from '../render/costume-body-map.js';
import { sheatheBone } from '../render/weapon-loader.js';
// 整套装备（主手 + 副手 + 发光 + 姿态）的装配器 —— 与自机/远端**同一实现**
import { WeaponRig } from '../render/weapon-rig.js';
import { getWeaponTypeFromIdCode } from '../char/weapon-type.js';
import { reportFallback } from '../char/fallback-log.js';

export interface CharacterAppearance {
  classId: number;
  head: number;
  rank: number;
  bodyModel?: string;
  bodyModelIdcode: number;
  weaponDorp?: string;
  weaponIdcode: number;
  weaponPos: number;
  offHandDorp?: string;
  offHandIdcode?: number;
  offHandKind?: number; // 0=无 1=盾 2=匕首
  offHandPos?: number;
  sizeLevel: number;
  /**
   * **发光输入**（原版 `sinSetCharItem` 里用到的那两列）—— 锻造/合成呼吸发光用，见 `game/agingBlink.ts`：
   * `weaponKindCode` = `ItemKindCode`（1=合成物 2=锻造物）、`weaponAgingLevel` = `ItemAgingNum[0]`；
   * `offHand*` 指副手那件（盾）。
   *
   * ⚠ **可选，且不在 `appearanceModelKey` 里**：发光不换网格 —— 若进了指纹，"锻造 +1"会被判成
   *   模型变了，当前动画会被从头重播。
   * ⚠ **服务端目前不下发这四个字段**（`AppearanceService.derive` 只推导模型相关列）⇒ **远端玩家不发光**；
   *   自机由 main.ts 从背包里的装备物品补齐。服务端补上这四个字段后，客户端这一层一行都不用改。
   */
  weaponKindCode?: number;
  weaponAgingLevel?: number;
  offHandKindCode?: number;
  offHandAgingLevel?: number;
}

// 浠?idCode 璁＄畻閾犵敳缂栧彿锛堝榻?pviewer armorNumFromIdCode锛夛細(idcode >> 8) & 0xff, >25 鏃?-=17
export function armorNumFromIdCode(idCode: number): number {
  let n = (idCode >> 8) & 0xff;
  if (n > 25) n -= 17;
  return n;
}

/**
 * 外观里**决定 3D 模型长相**的那些字段拼成的指纹 —— 判断"角色模型是否真的变了"的**唯一判据**。
 *
 * 用途（用户 2026-09-16）：服务端在每次物品操作后都可能推 `S2C_AppearanceUpdate`，
 * 而客户端**只有指纹变了**才该重建模型 / 重选动画 —— 否则"整理一下背包"或"换枚戒指"
 * 都会把当前动画从头播一遍。
 *
 * ⚠ **不是"只判武器"**：任意一项变了都算"模型变了" ——
 *   · 武器位 `weaponDorp/Idcode/Pos`（换武器 / 换挂点）
 *   · 副手 `offHandDorp/Idcode/Kind/Pos`（盾 / 匕首）
 *   · 躯干甲 `bodyModel/bodyModelIdcode`（**盔甲 / 袍子换的就是它**）
 *   · 头与转职阶级 `head/rank`（**换头 / 换头饰档位换的是它**）
 * 反过来，背包 / 仓库 / 药水槽 / 戒指 / 项链 / 耳环 **不在外观里**
 * （服务端 `AppearanceService.derive` 也不看它们）⇒ 指纹不变、什么都不做。
 *
 * 加字段前先问一句：**这一项会换网格吗？** 会就加进来，不会就别加
 * （否则又变成"随便动一下就重播"）。
 */
export function appearanceModelKey(a: CharacterAppearance | undefined): string {
  if (!a) return '';
  return [
    a.classId, a.head, a.rank,
    a.bodyModel ?? '', a.bodyModelIdcode ?? 0,
    a.weaponDorp ?? '', a.weaponIdcode ?? 0, a.weaponPos ?? 0,
    a.offHandDorp ?? '', a.offHandIdcode ?? 0, a.offHandKind ?? 0, a.offHandPos ?? 0,
  ].join('|');
}

// 地图 id → i18n 名称；无翻译时回退英文 "Map {id}"
export function mapNameById(mapId: number): string {
  const key = `map.${mapId}`;
  const name = t(key);
  return name === key ? `Map ${mapId}` : name;
}

export interface CharacterInfo { characterId: number; name: string; classId: number; level: number; mapId?: number; appearance?: CharacterAppearance; }

export interface CharSelect {
  show(characters: CharacterInfo[], opts: {
    onSelect: (characterId: number) => void;
    onCreate: (name: string, classId: number, head: number) => void;
    onLogout: () => void;
    onBackToServers: () => void;
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
  let opts: { onSelect: (id: number) => void; onCreate: (name: string, classId: number, head: number) => void; onLogout: () => void; onBackToServers: () => void } | null = null;

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
  /** 每帧推进/求值/施加骨骼 —— **与游戏内同一个实现**（char/anim-player.ts） */
  let animPlayer: AnimPlayer | null = null;
  let animFrameId = 0;
  let loadGeneration = 0; // prevents stale async loads from adding models
  let motionList: MotionInfo[] = []; // TmFrame 偏移后的动画列表（调试列表用）

  // BGM
  let bgm: HTMLAudioElement | null = null;

  // 角色纹理加载（共享实现：render/char-texture-loader.ts）

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
      card.innerHTML = `<div style="font-weight:bold">${c.name}</div><div style="color:#aaa">${t('job.' + jobKeyById(c.classId))} ${t('gui.charSel.level', { level: c.level })}</div>${c.mapId != null ? `<div style="color:#7a9ec4">${t('gui.charSel.location', { map: mapNameById(c.mapId) })}</div>` : ''}`;
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

    const backToServersBtn = document.createElement('button');
    backToServersBtn.textContent = t('gui.charSel.backToServers');
    backToServersBtn.style.cssText = 'padding:10px;background:transparent;color:#fff;border:1px solid #555;cursor:pointer;font-size:14px;';
    backToServersBtn.onclick = () => opts?.onBackToServers();

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
    btnRow.append(enterBtn, createBtn, backToServersBtn, logoutBtn);
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
    // 指纹里必须带上**副手**与**发光输入**：只差一面盾、或只差锻造等级的两个角色，
    // 否则会被判成"同一个外观"而不重载 ⇒ 盾/发光停在上一件（用户 2026-09-23 报的选角页缺盾）。
    const appSig = appearance
      ? `${appearance.bodyModel ?? ''}|${appearance.bodyModelIdcode}`
        + `|${appearance.weaponDorp ?? ''}|${appearance.weaponIdcode}|${appearance.weaponPos}`
        + `|${appearance.offHandDorp ?? ''}|${appearance.offHandIdcode ?? 0}|${appearance.offHandKind ?? 0}`
        + `|${appearance.weaponKindCode ?? 0}|${appearance.weaponAgingLevel ?? 0}`
        + `|${appearance.offHandKindCode ?? 0}|${appearance.offHandAgingLevel ?? 0}`
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
      // 用 **lite 包**（骨架 + 单条 STAND，每组 ~300KB）而不是完整动画包（14~33MB）：
      // 选角页只需要"站着的小人"，而它的查询条件（村庄/收械 + 空手）与 lite 包的提取规则
      // 是同一条 —— 所以只会命中 lite 里保留的那条（见 render/lite-loader.ts 的"契约"）。
      // 加载未完成期间这里一声不响：调用方 await 它，之后才把模型加进场景
      //（用户要求"没下载好就不显示角色"），右边"进入游戏"按钮不受影响。
      const result = await loadCharacterModelLite(jobId, head, armorNum, bodyInxOverride);
      if (gen !== loadGeneration) return; // stale load, discard
      charResult = result;
      // 每帧的帧推进/求值/施加：**与游戏内同一个实现**
      animPlayer = createAnimPlayer(result.animSmb, result.bones, result.skeleton);
      // Hide meshes until textures load (prevent grey flash)
      result.bodyGroup.visible = false;
      result.headGroup.visible = false;
      skeletonGroup!.add(result.skeletonGroup);
      skeletonGroup!.add(result.bodyGroup);
      skeletonGroup!.add(result.headGroup);
      // Load textures
      await loadCharTextures([...result.bodyTextures, ...result.headTextures]);
      if (gen !== loadGeneration) return;
      result.bodyGroup.visible = true;
      result.headGroup.visible = true; // stale after texture load
      // ⚠ 武器码必须在**挂载之前**写：`WeaponMount` 要用它决定**收械槽与镜像份**
      // （刺客匕首的双腰挂就是 `mirrorLeftBone(idcode)` 决定的 —— 它曾经因为这里顺序不对
      //  + 选角页自己一套实现而只挂了一边，用户 2026-09-15 实测）。
      // 这三个是**共享变量**（状态机与预览都读），只在"确认这次加载仍有效"之后写。
      currentWeaponIdcode = appearance?.weaponIdcode && appearance.weaponIdcode > 0 ? appearance.weaponIdcode : null;
      currentWeaponType = currentWeaponIdcode ? getWeaponTypeFromIdCode(currentWeaponIdcode) : null;
      console.log('[CharSelect] 武器：idcode=' + (currentWeaponIdcode ?? 'null')
        + ' type=' + (currentWeaponType ?? 'null') + ' → 收械槽骨 ' + sheatheBone(currentWeaponIdcode ?? 0)
        + '（idcode 缺失时会退成默认背挂点）');
      // 整套装备（主手含镜像份 + 副手）—— 一次交给共享装配器：
      // 它内部按顺序做"加载 → **发光先于挂载** → 找骨（找不到不挂、不回退、上报）"，
      // 并且**每次 await 之后**校验 `isAlive`（代际号）——过期的那次一个场景对象都不碰。
      const rigReport = await previewRig.loadAndMount(skeletonGroup!, appearance, 'combat', {
        anisotropy: previewAniso(),
        isAlive: () => gen === loadGeneration,
        label: '选角预览',
        jobId,
      });
      if (rigReport.cancelled || gen !== loadGeneration) return;
      animState = createAnimStateMachine({
        getMotions: () => motionList,
        getClassId: () => jobId,
        getWeaponIdCode: () => currentWeaponIdcode,
        getWeaponType: () => currentWeaponType,
        getFieldState: () => 1, // 角色选择界面等同安全区：空手 idle + 武器收鞘姿态
        onStanceChange: (stance) => { applyWeaponStance(stance); },
        onMotionChange: (motion: MotionInfo) => {
          // 1 tick = 160 帧；.inx startFrame/endFrame 单位是 tick（已 TmFrame 偏移）
          animPlayer?.setFrame(motion.startFrame * 160);
        },
      });
      buildMotionList();
      // ⚠ **装配完必须主动断言一次姿态**：只靠 `onStanceChange` 事件是不够的 ——
      // 事件可能在武器挂载完成前就发过（那一次会被丢弃，而这之后不会再有第二次），
      // 于是武器一直留在战斗挂点上（用户 2026-09-15 实测：选角页弓留在手里 / 匕首只挂一边）。
      // 状态机的 `getStance()` 是"它现在认为的姿态"，装配完读一次就能对齐。
      if (!animState.triggerIdle()) {
        reportFallback('anim', `选角预览 job=${jobId} 没有可用站姿条目 → 停在绑定姿势`);
      }
      applyWeaponStance(animState.getStance() ?? 'sheathed');
    } catch (err) {
      console.warn('CharSelect: loadPreview failed', err);
      currentPreviewJobId = null;
      currentPreviewHead = -1;
      currentPreviewAppearance = '';
    }
  }

  /**
   * 预览的整套装备 = **共享的 `WeaponRig`**（自机 / 远端 / 选角预览同一实现）。
   *
   * ⚠ 选角页曾经自己实现一套挂载（`weaponGroup` + 手写 `findBone` 搬运），于是少了两件事：
   * 镜像份（刺客匕首只挂一边，用户 2026-09-15）与副手（带盾的角色看不到盾，用户 2026-09-23）。
   * 现在只保留"加载 → 交 rig"，连"发光先于挂载""找不到骨不回退"都由 rig 统一保证。
   * `currentWeaponIdcode/Type` 仍在这里维护：动画状态机的 getter 读它们（与 rig 无关）。
   */
  const previewRig = new WeaponRig();
  let currentWeaponIdcode: number | null = null;
  let currentWeaponType: string | null = null;

  /** 姿态（持械 ↔ 收械）——由状态机的 `onStanceChange` 触发，装配完还会**主动断言**一次 */
  function applyWeaponStance(stance: 'combat' | 'sheathed'): void {
    if (!skeletonGroup) return;
    previewRig.setStance(skeletonGroup, stance);   // 主手（含镜像份）+ 副手成对搬
  }

  /** 预览用各向异性（与纹理加载同一级别） */
  function previewAniso(): number {
    return renderer ? renderer.capabilities.getMaxAnisotropy() : 1;
  }

  function clearCharModel() {
    if (charResult && skeletonGroup) {
      skeletonGroup.remove(charResult.skeletonGroup);
      skeletonGroup.remove(charResult.bodyGroup);
      skeletonGroup.remove(charResult.headGroup);
    }
    // 两件（含镜像份与发光）由装配器自己摘干净 —— 换角色时不会留下上一件的武器/盾
    previewRig.dispose();
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

  /**
   * 动作列表 = **游戏内同一个构造器**（`char/anim-player.buildMotionList`），
   * 只多一层 `only` 过滤：
   * lite 骨架包只带**一条**条目的关键帧（见 `CharLoadResult.liteInxIndices` / lite-loader 头部"契约"），
   * 不过滤的话匹配器可能选中同条件的另一个变体（如 `stand_unarmed~2`），那条在 lite 里没有关键帧 →
   * 求值回退成绑定姿态，表现为"角色站着不动"且不报错（用户 2026-09-14 实测）。
   */
  function buildMotionList() {
    if (!charResult) return;
    motionList = buildMotionListShared(charResult.animSmb, charResult.bipInxInfo, charResult.liteInxIndices);
  }

  function startRenderLoop() {
    if (animFrameId) return;
    let lastMs = 0;
    function loop() {
      animFrameId = requestAnimationFrame(loop);
      if (!renderer || !scene || !camera || !canvas) return;
      const host = canvas.parentElement;
      if (!host) return;

      // 动画 delta-time（与帧率解耦）：原 80/帧@60fps = 4800 单位/秒
      const nowMs = performance.now();
      const adt = lastMs ? Math.min((nowMs - lastMs) / 1000, 0.1) : 1 / 60;
      lastMs = nowMs;

      if (charResult && animState && animPlayer) {
        const motion = animState.getCurrentMotion();
        if (motion) {
          // 帧推进 + 求值 + 施加 + 更新矩阵：**与游戏内同一个实现**（char/anim-player.ts）。
          // ⚠ 这里曾经自己写一套：`evalSkeleton`（每帧新建工作区）且不调 updateBoneWorlds，
          // 于是姿态比游戏内晚一帧（用户 2026-09-15："不要自己搞一套动画"）。
          const step = animPlayer.advance(motion, adt);
          if (step.ended) {
            const next = animState.onAnimationEnd();
            if (next) animPlayer.setFrame(next.startFrame * 160);
          }
          animPlayer.apply(motion.animSmb);
        }
      }
      // 锻造/合成呼吸发光（原版逐帧 `SetRenderBlinkColor`）——同一份实现、同一个单调时钟
      previewRig.updateBlink(nowMs);

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

