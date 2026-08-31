import * as THREE from 'three';
import { t } from '../i18n/index.js';
import { loadCharacterModel } from '../render/char-loader.js';
import { evalSkeleton, applyToBones } from '../char/animation.js';
import { createAnimStateMachine } from '../char/anim-state-machine.js';
import type { MotionInfo } from '../char/char-format.js';
import type { CharLoadResult } from '../render/char-loader.js';

export interface CharacterInfo { characterId: number; name: string; classId: number; level: number; }

export interface CharSelect {
  show(characters: CharacterInfo[], opts: {
    onSelect: (characterId: number) => void;
    onCreate: (name: string, classId: number, head: number) => void;
    onLogout: () => void;
  }): void;
  hide(): void;
  destroy(): void;
}

const JOBS_TEMPCRON = [1, 2, 3, 4, 5] as const;
const JOBS_MORYON = [6, 7, 8, 9, 10] as const;
const JOB_NAMES_TEMPCRON = ['fighter', 'mechanician', 'archer', 'pikeman', 'assassin'] as const;
const JOB_NAMES_MORYON = ['knight', 'atalanta', 'priestess', 'magician', 'shaman'] as const;

export function createCharSelect(container: HTMLElement): CharSelect {
  const el = document.createElement('div');
  el.className = 'panel char-select';
  el.style.cssText = 'display:none;position:absolute;inset:0;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:rgba(0,0,0,0.85);color:#fff;font-size:14px;overflow-y:auto';
  container.appendChild(el);

  let characters: CharacterInfo[] = [];
  let opts: { onSelect: (id: number) => void; onCreate: (name: string, classId: number, head: number) => void; onLogout: () => void } | null = null;
  let wizardStep = 0;
  let selectedRace: 'tempscron' | 'moryon' | null = null;
  let selectedJobId = 0;
  let selectedFace = 0;
  let canvas: HTMLCanvasElement | null = null;
  let renderer: THREE.WebGLRenderer | null = null;
  let scene: THREE.Scene | null = null;
  let camera: THREE.PerspectiveCamera | null = null;
  let charResult: CharLoadResult | null = null;
  let animFrame = 0;
  let currentFrameStep = 80;
  let animSmb: CharLoadResult['animSmb'] | null = null;
  let skeleton: THREE.Skeleton | null = null;
  let bones: THREE.Bone[] = [];
  let bipInxMotions: MotionInfo[] = [];
  let stateMachine: ReturnType<typeof createAnimStateMachine> | null = null;
  let rafId = 0;
  let loading = false;
  const tmpMat4 = new THREE.Matrix4();
  const posV = new THREE.Vector3();
  const quatQ = new THREE.Quaternion();
  const sclV = new THREE.Vector3();

  function ensure3D() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:300px;height:400px;background:#111;border-radius:4px';
    canvas.width = 300;
    canvas.height = 400;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(300, 400);
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x222233);
    camera = new THREE.PerspectiveCamera(50, 300 / 400, 0.1, 10000);
    camera.position.set(0, 150, 400);
    const ambientLight = new THREE.AmbientLight(0x666688, 1.2);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(100, 200, 100);
    scene.add(dirLight);
  }

  function animatePreview() {
    rafId = requestAnimationFrame(animatePreview);
    if (!renderer || !scene || !camera || !skeleton || bones.length === 0 || !animSmb) return;
    animFrame += currentFrameStep;
    const motion = stateMachine?.getCurrentMotion();
    if (motion) {
      if (animFrame >= motion.endFrame * 160) {
        if (motion.repeat) {
          const len = (motion.endFrame - motion.startFrame) * 160;
          animFrame = motion.startFrame * 160 + ((animFrame - motion.startFrame * 160) % len);
        } else {
          stateMachine?.onAnimationEnd();
          const next = stateMachine?.getCurrentMotion();
          if (next) animFrame = next.startFrame * 160;
        }
      }
    }
    const skelFrames = evalSkeleton(animSmb, animFrame, false);
    applyToBones(bones, skelFrames, tmpMat4, posV, quatQ, sclV);
    skeleton.update();
    renderer.render(scene, camera);
  }

  async function loadPreview(jobId: number, faceNum: number) {
    if (loading) return;
    loading = true;
    if (scene && charResult) {
      scene.remove(charResult.bodyGroup);
      scene.remove(charResult.headGroup);
    }
    try {
      const result = await loadCharacterModel(jobId, faceNum);
      charResult = result;
      scene!.add(result.bodyGroup);
      scene!.add(result.headGroup);
      skeleton = result.skeleton;
      bones = result.bones;
      animSmb = result.animSmb;
      bipInxMotions = result.bipInxInfo.motions;
      stateMachine = createAnimStateMachine({
        getMotions: () => bipInxMotions,
        getClassId: () => jobId,
        onMotionChange: (m: MotionInfo) => { animFrame = m.startFrame * 160; },
      });
      stateMachine.triggerIdle();
      animFrame = 0;
      if (!rafId) animatePreview();
    } catch (e) {
      console.warn('CharSelect: loadPreview failed', e);
    }
    loading = false;
  }

  function renderList() {
    el.innerHTML = '';
    el.style.display = 'flex';
    const title = document.createElement('h2');
    title.textContent = t('gui.charSel.title');
    el.appendChild(title);

    const cardList = document.createElement('div');
    cardList.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;justify-content:center;max-width:600px';
    for (const c of characters) {
      const card = document.createElement('div');
      card.style.cssText = 'padding:12px 16px;background:#222;border-radius:4px;cursor:pointer;min-width:160px;text-align:center';
      card.innerHTML = `<div style="font-weight:bold">${c.name}</div><div style="color:#aaa">${t('job.' + jobKeyById(c.classId))} ${t('gui.charSel.level', { level: c.level })}</div>`;
      card.onclick = () => opts?.onSelect(c.characterId);
      cardList.appendChild(card);
    }
    el.appendChild(cardList);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:12px;margin-top:12px';
    const createBtn = document.createElement('button');
    createBtn.textContent = t('gui.charSel.create');
    createBtn.style.cssText = 'padding:8px 20px;font-size:14px;cursor:pointer';
    createBtn.onclick = () => { wizardStep = 0; selectedRace = null; selectedJobId = 0; selectedFace = 0; renderWizard(); };
    btnRow.appendChild(createBtn);
    const logoutBtn = document.createElement('button');
    logoutBtn.textContent = t('gui.charSel.logout');
    logoutBtn.style.cssText = 'padding:8px 20px;font-size:14px;cursor:pointer';
    logoutBtn.onclick = () => opts?.onLogout();
    btnRow.appendChild(logoutBtn);
    el.appendChild(btnRow);
  }

  function renderWizard() {
    el.innerHTML = '';
    el.style.display = 'flex';
    ensure3D();
    if (wizardStep < 3 && canvas) canvas.remove();

    if (wizardStep === 0) renderStepRace();
    else if (wizardStep === 1) renderStepJob();
    else if (wizardStep === 2) renderStepFace();
    else renderStepName();
  }

  function renderStepRace() {
    const title = document.createElement('h2');
    title.textContent = t('gui.charCreate.race');
    el.appendChild(title);
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:12px';
    for (const race of ['tempscron', 'moryon'] as const) {
      const btn = document.createElement('button');
      btn.textContent = t('race.' + race);
      btn.style.cssText = 'padding:12px 24px;font-size:16px;cursor:pointer';
      btn.onclick = () => { selectedRace = race; wizardStep = 1; renderWizard(); };
      btnRow.appendChild(btn);
    }
    el.appendChild(btnRow);
    addBackBtn();
  }

  function renderStepJob() {
    const title = document.createElement('h2');
    title.textContent = t('gui.charCreate.job');
    el.appendChild(title);
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;justify-content:center;max-width:500px';
    const jobIds = selectedRace === 'tempscron' ? JOBS_TEMPCRON : JOBS_MORYON;
    const jobNames = selectedRace === 'tempscron' ? JOB_NAMES_TEMPCRON : JOB_NAMES_MORYON;
    for (let i = 0; i < jobIds.length; i++) {
      const btn = document.createElement('button');
      btn.textContent = t('job.' + jobNames[i]);
      btn.style.cssText = 'padding:10px 20px;font-size:14px;cursor:pointer;min-width:100px';
      btn.onclick = () => { selectedJobId = jobIds[i]; wizardStep = 2; renderWizard(); };
      btnRow.appendChild(btn);
    }
    el.appendChild(btnRow);
    addBackBtn();
  }

  function renderStepFace() {
    const title = document.createElement('h2');
    title.textContent = t('gui.charCreate.face');
    el.appendChild(title);
    const content = document.createElement('div');
    content.style.cssText = 'display:flex;gap:12px;align-items:flex-start';
    const faceCol = document.createElement('div');
    faceCol.style.cssText = 'display:flex;flex-direction:column;gap:8px';
    for (let i = 0; i < 3; i++) {
      const btn = document.createElement('button');
      btn.textContent = `${t('gui.charCreate.face')} ${i + 1}`;
      btn.style.cssText = 'padding:8px 16px;font-size:14px;cursor:pointer';
      if (i === selectedFace) btn.style.background = '#444';
      btn.onclick = () => { selectedFace = i; if (canvas) content.appendChild(canvas); loadPreview(selectedJobId, i); renderWizard(); };
      faceCol.appendChild(btn);
    }
    content.appendChild(faceCol);
    if (canvas) {
      content.appendChild(canvas);
      loadPreview(selectedJobId, selectedFace);
    }
    el.appendChild(content);
    addBackBtn(() => { if (canvas) canvas.remove(); });
  }

  function renderStepName() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    if (canvas) canvas.remove();
    const title = document.createElement('h2');
    title.textContent = t('gui.charCreate.name');
    el.appendChild(title);
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 8;
    input.placeholder = '角色名 (≤8字符)';
    input.style.cssText = 'padding:6px 12px;width:240px;font-size:14px';
    el.appendChild(input);
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:12px;margin-top:8px';
    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = t('gui.charCreate.create');
    confirmBtn.style.cssText = 'padding:8px 24px;font-size:14px;cursor:pointer';
    confirmBtn.onclick = () => {
      const name = input.value.trim();
      if (!name || name.length === 0) return;
      if (!/^[a-zA-Z0-9_]+$/.test(name)) return;
      opts?.onCreate(name, selectedJobId, selectedFace);
    };
    btnRow.appendChild(confirmBtn);
    el.appendChild(btnRow);
    addBackBtn();
    input.focus();
  }

  function addBackBtn(onExtra?: () => void) {
    const btn = document.createElement('button');
    btn.textContent = t('gui.charCreate.back');
    btn.style.cssText = 'padding:6px 16px;font-size:13px;cursor:pointer;margin-top:8px';
    btn.onclick = () => { onExtra?.(); wizardStep--; renderWizard(); };
    el.appendChild(btn);
  }

  function jobKeyById(id: number): string {
    const allTempscron = [...JOBS_TEMPCRON];
    const allMoryon = [...JOBS_MORYON];
    const idxT = allTempscron.indexOf(id as any);
    if (idxT >= 0) return JOB_NAMES_TEMPCRON[idxT];
    const idxM = allMoryon.indexOf(id as any);
    if (idxM >= 0) return JOB_NAMES_MORYON[idxM];
    return 'fighter';
  }

  return {
    show(chars, o) {
      characters = chars;
      opts = o;
      renderList();
    },
    hide() {
      el.style.display = 'none';
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      if (canvas) canvas.remove();
    },
    destroy() {
      if (rafId) cancelAnimationFrame(rafId);
      if (renderer) renderer.dispose();
      if (canvas) canvas.remove();
      el.remove();
    },
  };
}
