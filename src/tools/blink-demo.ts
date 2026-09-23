/**
 * 锻造/合成呼吸发光调试页 —— `npm run dev` 后开 `http://localhost:5173/blink-demo.html`。
 *
 * 为什么需要它：这个效果**只在装备了 +4 以上的武器/盾时才出现**，而要看到它得先登录、进游戏、
 * 再把一件武器锻到 +4 —— 每改一次参数都要走一遍，根本没法调（与 `loading-demo` 同一个理由）。
 *
 * ★ 它**复用真实实现**（`loadWeaponModel` + `loadCharTextures` + `render/blink-fx.BlinkFx`），
 *   不另画一套"看着像"的发光 —— 这里调好的东西就是游戏里跑的同一份代码（AGENTS #15）。
 * ★ 波形用 `game/agingBlink.blinkWave` + `BlinkFx.update(performance.now())`，
 *   与 `WorldView.renderLoop` 里的调用方式一致（那边传的是世界内毫秒时钟 `rafMs`）。
 *
 * 三件展品（都带真实 dorpItem）：
 *   ① 长剑 WA101 —— 默认未锻造（不发光），可用面板点成任意等级；
 *   ② 法杖 WM101 —— 默认 +12（有第二通道叠加贴图 mixs_05 + UV 滚动）；
 *   ③ 盾   DS101 —— 默认"合成行 0"（mixm_05 + SCROLL4），验证合成分支走的是同一套。
 *
 * 面板上的每一个值都能对上源码：行号 → `agingBlink.agingRowOf/craftRowOf`，
 * 叠加贴图 → `mixOverlayTexture`，滚动量 → `overlayScrollU`（原版 NSP `smRend3d.cpp:2859/2974`）。
 */
import * as THREE from 'three';
import { loadWeaponModel, weaponSizeMax } from '../render/weapon-loader.js';
import { loadCharTextures } from '../render/char-texture-loader.js';
import { BlinkFx } from '../render/blink-fx.js';
import { agingRowOf, craftRowOf, blinkWave, mixOverlayTexture, overlayScrollU, BLINK_PERIOD_MS, type BlinkRow } from '../game/agingBlink.js';
import { fallbacks, clearFallbacks } from '../char/fallback-log.js';

const stage = document.getElementById('stage')!;
const info = document.getElementById('info')!;
const controls = document.getElementById('controls')!;

// ── 场景（深底 + 一盏主光：加色发光在暗底上看得最清楚） ──
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setSize(stage.clientWidth, stage.clientHeight);
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0d12);
scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const key = new THREE.DirectionalLight(0xffffff, 1.6);
key.position.set(2.5, 4, 3);
scene.add(key);
const rim = new THREE.DirectionalLight(0x8899ff, 0.5);
rim.position.set(-3, 1.5, -2);
scene.add(rim);

const camera = new THREE.PerspectiveCamera(38, stage.clientWidth / stage.clientHeight, 0.1, 500);
camera.position.set(0, 1.4, 9);
camera.lookAt(0, 0.9, 0);
// 地面参考线：能看出武器是"立着还是躺着"，也方便判断叠加贴图的滚动方向
const grid = new THREE.GridHelper(20, 20, 0x2a3444, 0x1a2028);
scene.add(grid);

/** 一件展品：模型 + 发光效果 + 当前行 */
interface Exhibit {
  label: string;
  dorp: string;
  group: THREE.Group | null;
  fx: BlinkFx | null;
  row: BlinkRow | null;
  /** 实测模型尺寸（组局部单位 = .smd 原始单位，见 load() 里的换算说明） */
  rawSize: number;
  /** 面板里这个下拉可选的"等级"（数值含义见 agingRowOf/craftRowOf） */
  choices: Array<{ text: string; make: () => BlinkRow | null }>;
}
const exhibits: Exhibit[] = [];

/** 面板可选的行（覆盖原版三种情形：未锻造 / 锻造各段 / 合成） */
const ROW_CHOICES: Array<{ text: string; make: () => BlinkRow | null }> = [
  { text: '未锻造（不发光）', make: () => null },
  { text: '锻造 +3（仍不发光）', make: () => agingRowOf(3) },
  { text: '锻造 +4（纯呼吸光）', make: () => agingRowOf(4) },
  { text: '锻造 +7（+mixs_01 / SCROLL5）', make: () => agingRowOf(7) },
  { text: '锻造 +12（+mixs_05 / SCROLL8）', make: () => agingRowOf(12) },
  { text: '锻造 +16（+mixs_05 / SCROLL9）', make: () => agingRowOf(16) },
  { text: '锻造 +20（+mixm_01 / SCROLL10）', make: () => agingRowOf(20) },
  { text: '合成 agingNum=0（+mixm_05 / SCROLL4）', make: () => craftRowOf(0) },
  { text: '合成 agingNum=6（+mixm_01 / SCROLL4）', make: () => craftRowOf(6) },
];

const DEFS: Array<{ label: string; dorp: string; initial: number }> = [
  { label: '长剑 WA101', dorp: 'WA101', initial: 0 },
  { label: '法杖 WM101', dorp: 'WM101', initial: 4 },
  { label: '盾 DS101', dorp: 'DS101', initial: 7 },
];

/** 冻结相位（便于截图/对比）：null = 正常随 rAF 走 */
let frozenMs: number | null = null;

function refreshInfo(): void {
  const now = frozenMs ?? performance.now();
  const wave = blinkWave(now);
  const lines: string[] = [];
  lines.push(`t = ${Math.floor(now)} ms　波形 = ${wave.toFixed(4)}（周期 ${BLINK_PERIOD_MS}ms，峰 511/512）`);
  lines.push(`相位冻结：${frozenMs === null ? '否' : Math.floor(frozenMs) + 'ms'}`);
  lines.push('');
  for (const e of exhibits) {
    const row = e.row;
    if (!row) { lines.push(`${e.label}：不发光`); continue; }
    const tex = mixOverlayTexture(row.texMixCode);
    const u = overlayScrollU(row.texScroll, now);
    lines.push(`${e.label}：模型尺寸 ${e.rawSize.toFixed(0)}　`
      + `RGB(${row.r},${row.g},${row.b}) 自发光 ×${wave.toFixed(3)}`
      + `　第二通道=${tex ?? '（无）'}　U偏移=${u === null ? '未实现' : u.toFixed(4)}`);
  }
  const fb = fallbacks();
  if (fb.length) {
    lines.push('');
    lines.push('降级上报：' + fb.map((f) => `${f.kind}×${f.count}(${f.detail})`).join('；'));
  }
  info.textContent = lines.join('\n');
}

function buildControls(): void {
  for (const [i, e] of exhibits.entries()) {
    const row = document.createElement('div');
    row.className = 'row';
    const lab = document.createElement('label');
    lab.textContent = e.label;
    const sel = document.createElement('select');
    e.choices.forEach((c, ci) => {
      const opt = document.createElement('option');
      opt.value = String(ci);
      opt.textContent = c.text;
      if (ci === DEFS[i]!.initial) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', () => {
      const c = e.choices[Number(sel.value)]!;
      e.row = c.make();
      e.fx?.setRow(e.row);
      refreshInfo();
    });
    row.append(lab, sel);
    controls.appendChild(row);
  }

  const freezeRow = document.createElement('div');
  freezeRow.className = 'row';
  const freezeBtn = document.createElement('button');
  freezeBtn.textContent = '冻结相位';
  freezeBtn.addEventListener('click', () => {
    if (frozenMs === null) { frozenMs = performance.now(); freezeBtn.textContent = '恢复'; }
    else { frozenMs = null; freezeBtn.textContent = '冻结相位'; }
  });
  const peakBtn = document.createElement('button');
  peakBtn.textContent = '对准峰值(0ms)';
  peakBtn.addEventListener('click', () => { frozenMs = 0; freezeBtn.textContent = '恢复'; refreshInfo(); });
  const valleyBtn = document.createElement('button');
  valleyBtn.textContent = '对准谷值(512ms)';
  valleyBtn.addEventListener('click', () => { frozenMs = 512; freezeBtn.textContent = '恢复'; refreshInfo(); });
  const clearBtn = document.createElement('button');
  clearBtn.textContent = '清降级清单';
  clearBtn.addEventListener('click', () => { clearFallbacks(); refreshInfo(); });
  freezeRow.append(freezeBtn, peakBtn, valleyBtn, clearBtn);
  controls.appendChild(freezeRow);
}

async function load(): Promise<void> {
  const sizes: number[] = [];
  for (const def of DEFS) {
    const ex: Exhibit = {
      label: def.label, dorp: def.dorp, group: null, fx: null, rawSize: 0,
      row: ROW_CHOICES[def.initial]!.make(), choices: ROW_CHOICES,
    };
    exhibits.push(ex);
    try {
      const wres = await loadWeaponModel(def.dorp);
      await loadCharTextures(wres.texturesToLoad);
      ex.group = wres.group;
      // ⚠ **不加任何缩放**：与游戏一致（`WorldView.mountSelfWeapon` 直接把武器组 add 到骨骼上，
      //   缩放由骨架自带）。`weaponSizeMax` 量的是**组局部**尺寸，正好用来定间距与取景。
      ex.rawSize = weaponSizeMax(ex.group);
      scene.add(ex.group);
      sizes.push(ex.rawSize);
      // ★ 与 WorldView 同一条调用：建立发光效果
      ex.fx = BlinkFx.create(ex.group, ex.row, renderer.capabilities.getMaxAnisotropy());
    } catch (err) {
      console.error('[blink-demo] 加载失败 ' + def.dorp, err);
    }
  }
  // 按**实测尺寸**摆位与取景（模型原始单位：实测法杖 19 / 盾 16，量级与角色网格同源）
  const S = Math.max(1, ...sizes);
  for (const [i, e] of exhibits.entries()) {
    if (!e.group) continue;
    e.group.position.set((i - (exhibits.length - 1) / 2) * S * 0.9, S * 0.5, 0);
    e.group.rotation.y = -0.6;         // 四分之三视角：看得到刀身 + 侧面
    e.group.rotation.z = 0.12;
  }
  // 取景：相机纯平移（不改朝向）⇒ 三件整体偏画面左侧（右侧留给面板）
  camera.position.set(S * 0.5, S * 0.62, S * 2.4);
  camera.lookAt(S * 0.5, S * 0.5, 0);
  buildControls();
  refreshInfo();
}

// ── 主循环：与 WorldView.renderLoop 同一套调用（每帧 BlinkFx.update(now)） ──
function frame(): void {
  requestAnimationFrame(frame);
  const now = frozenMs ?? performance.now();
  for (const e of exhibits) e.fx?.update(now);
  renderer.render(scene, camera);
  refreshInfo();
}

function resize(): void {
  const w = stage.clientWidth, h = stage.clientHeight;
  if (w <= 0 || h <= 0) return;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}
window.addEventListener('resize', resize);
resize();

// 诊断入口（与 `window.__lab` 同类约定）：控制台里能查/能改
(window as unknown as { __blink: unknown }).__blink = {
  exhibits,
  rows: ROW_CHOICES,
  setRow: (i: number, choice: number): void => {
    const e = exhibits[i];
    if (!e) return;
    e.row = ROW_CHOICES[choice]!.make();
    e.fx?.setRow(e.row);
    refreshInfo();
  },
  freeze: (ms: number | null): void => { frozenMs = ms; refreshInfo(); },
  fallbacks,
};

void load().then(() => frame());
