/**
 * Char Demo — 加载角色模型并播放动画状态机切换
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadCharacterModel, JOB_DATA } from '../render/char-loader.js';
import { evalSkeleton, applyToBones } from './animation.js';
import { createAnimStateMachine } from './anim-state-machine.js';
import { motionStateName } from './char-format.js';
import { decodeTextureAsync } from '../core/texture.js';
import type { MotionInfo } from './char-format.js';

const app = document.getElementById('app') as HTMLElement;
const ui = document.getElementById('ui') as HTMLElement;
const logEl = document.getElementById('log') as HTMLElement;

function log(msg: string): void {
  logEl.textContent += msg + '\n';
  logEl.scrollTop = logEl.scrollHeight;
  console.log('[char-demo]', msg);
}

// ===== Scene =====

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x222233);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10000);
camera.position.set(0, 150, 400);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(app.clientWidth, app.clientHeight);
app.appendChild(renderer.domElement);

function resize(): void {
  camera.aspect = app.clientWidth / app.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(app.clientWidth, app.clientHeight);
}
window.addEventListener('resize', resize);
resize();

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 80, 0);

// ===== Lighting =====

const ambientLight = new THREE.AmbientLight(0x666688, 1.2);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(100, 200, 100);
scene.add(dirLight);

// ===== Texture Loading =====

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
  } catch {
    return null;
  }
}

async function loadTextures(
  texturesToLoad: { url: string; mat: THREE.MeshPhongMaterial; nodeName: string }[],
): Promise<void> {
  const tasks = texturesToLoad.map(async (t) => {
    const texPath = t.url.replace(/\\/g, '/').toLowerCase();
    const url = '/res/' + texPath;
    const tex = await fetchAndDecodeTexture(url);
    if (tex) {
      t.mat.map = tex;
      t.mat.color.set(0xffffff);
      t.mat.alphaTest = 0.5;
      t.mat.transparent = true;
      t.mat.needsUpdate = true;
    }
  });
  await Promise.allSettled(tasks);
}

// ===== State =====

let charGroup: THREE.Group | null = null;
let skeleton: THREE.Skeleton | null = null;
let bones: THREE.Bone[] = [];
let animSmb: Awaited<ReturnType<typeof loadCharacterModel>>['animSmb'] | null = null;
let bipInxMotions: MotionInfo[] = [];
let animFrame = 0;
let currentFrameStep = 80;

const tmpMat4 = new THREE.Matrix4();
const posV = new THREE.Vector3();
const quatQ = new THREE.Quaternion();
const sclV = new THREE.Vector3();

let stateMachine: ReturnType<typeof createAnimStateMachine> | null = null;

// ===== Animation Loop =====

function onMotionChange(motion: MotionInfo): void {
  animFrame = motion.startFrame * 160;
  currentFrameStep = 80;
  log('→ ' + motionStateName(motion.state) + ' [' + motion.startFrame + ',' + motion.endFrame + '] r=' + motion.repeat);
}

let frameCount = 0;
function animate(): void {
  requestAnimationFrame(animate);
  controls.update();

  if (skeleton && bones.length > 0 && animSmb) {
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

    // 每60帧输出诊断
    frameCount++;
    if (frameCount % 60 === 0) {
      const b0 = bones[0];
      console.log('[char-demo] frame=' + animFrame + ' bone0.pos=(' +
        b0.position.x.toFixed(1) + ',' + b0.position.y.toFixed(1) + ',' + b0.position.z.toFixed(1) + ') ' +
        'state=' + (stateMachine?.getCurrentState()?.toString(16) || 'null'));
    }
  }

  renderer.render(scene, camera);
}

// ===== UI =====

function createButton(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.onclick = onClick;
  ui.appendChild(btn);
  return btn;
}

function setupUI(): void {
  ui.innerHTML = '';

  createButton('Idle', () => {
    const ok = stateMachine?.triggerIdle();
    log('Idle: ' + (ok ? 'OK' : 'FAIL'));
  });
  createButton('Walk', () => {
    const ok = stateMachine?.triggerWalk();
    log('Walk: ' + (ok ? 'OK' : 'FAIL'));
  });
  createButton('Run', () => {
    const ok = stateMachine?.triggerRun();
    log('Run: ' + (ok ? 'OK' : 'FAIL'));
  });
  createButton('Attack', () => {
    const ok = stateMachine?.triggerAttack();
    log('Attack: ' + (ok ? 'OK' : 'FAIL'));
  });
  createButton('Skill', () => {
    const ok = stateMachine?.triggerSkill();
    log('Skill: ' + (ok ? 'OK' : 'FAIL'));
  });
  createButton('Taunt', () => {
    const ok = stateMachine?.triggerTaunt();
    log('Taunt: ' + (ok ? 'OK' : 'FAIL'));
  });
  createButton('Yahoo', () => {
    const ok = stateMachine?.triggerYahoo();
    log('Yahoo: ' + (ok ? 'OK' : 'FAIL'));
  });

  // Job selector
  const select = document.createElement('select');
  select.style.cssText = 'padding:4px;background:rgba(0,0,0,0.75);color:#cfc;border:1px solid #486;font:12px monospace;';
  for (const [id] of Object.entries(JOB_DATA)) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = `Job ${id}`;
    select.appendChild(opt);
  }
  select.onchange = () => {
    const jobId = parseInt(select.value);
    loadChar(jobId);
  };
  ui.appendChild(select);
}

// ===== Load Character =====

async function loadChar(jobId: number): Promise<void> {
  log('加载职业 ' + jobId + '...');

  if (charGroup) {
    scene.remove(charGroup);
    charGroup = null;
  }

  try {
    const result = await loadCharacterModel(jobId, 0, 0, 1);
    charGroup = new THREE.Group();
    charGroup.add(result.bodyGroup);
    charGroup.add(result.headGroup);
    scene.add(charGroup);
    if (result.skeletonGroup) scene.add(result.skeletonGroup);

    skeleton = result.skeleton;
    bones = result.bones;
    animSmb = result.animSmb;
    bipInxMotions = result.bipInxInfo.motions;

    // 诊断：输出 motions 按 state 分组
    const stateGroups = new Map<number, number>();
    for (const m of bipInxMotions) {
      stateGroups.set(m.state, (stateGroups.get(m.state) || 0) + 1);
    }
    const stateSummary = [...stateGroups.entries()]
      .map(([s, c]) => '0x' + s.toString(16) + '(' + c + ')')
      .join(' ');
    log('motions=' + bipInxMotions.length + ': ' + stateSummary);

    // 诊断：输出每个 motion 的 state/startFrame/endFrame/repeat
    const activeMotions = bipInxMotions.filter(m => m.startFrame !== 0 || m.endFrame !== 0);
    log('有效 motions (非零帧): ' + activeMotions.length);
    for (const m of activeMotions.slice(0, 20)) {
      log('  state=0x' + m.state.toString(16) + ' frame=[' + m.startFrame + ',' + m.endFrame + '] r=' + m.repeat + ' job=0x' + m.dwJobCodeBit.toString(16));
    }

    // 诊断：SMB 数据
    const smbObjs = result.animSmb.objects;
    const objsWithAnim = smbObjs.filter(o => o.tmRot.length > 0 || o.tmPos.length > 0);
    log('SMB objects=' + smbObjs.length + ', 有动画=' + objsWithAnim.length);
    if (objsWithAnim.length > 0) {
      const sample = objsWithAnim[0];
      log('  示例 "' + sample.nodeName + '": tmRot=' + sample.tmRot.length + ' tmPos=' + sample.tmPos.length + ' tmPrevRot=' + sample.tmPrevRot.length + ' tmRotFrame=' + sample.tmRotFrame.filter(f => f.posCnt > 0).length);
    }

    // 加载纹理
    const allTextures = [...result.bodyTextures, ...result.headTextures];
    await loadTextures(allTextures);
    log('纹理: ' + allTextures.length + ' 个');

    stateMachine = createAnimStateMachine({
      getMotions: () => bipInxMotions,
      getClassId: () => jobId,
      onMotionChange,
      log,
    });

    const idleOk = stateMachine.triggerIdle();
    log('triggerIdle: ' + (idleOk ? 'OK' : 'FAIL'));
    log('当前 motion: ' + (stateMachine.getCurrentMotion() ? '有' : '无'));
    log('加载完成 (bones=' + bones.length + ')');
  } catch (e) {
    log('加载失败: ' + (e as Error).message);
    console.error(e);
  }
}

// ===== Boot =====

setupUI();
animate();
loadChar(6); // 默认加载 Knight
