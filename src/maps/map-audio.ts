/**
 * 地图音效 —— 忠实移植原版 PT（EU 客户端 / 经典 ex-machina）：
 *   数据源 = sounds.json：1) 音乐文件清单(bgm/ambient/objectSounds) 2) 每图 bgm/ambient/场地声源。
 *   1) 每图 BGM   ：EU MapGame.cpp 的 SetBackgroundMusicID → game/sounds/music/*.wav，
 *                   固定一轨不分昼夜；个别图 TRIGGERED(-1) 不播。
 *   2) 环境音(全局)：经典 playmain.cpp 按地图类型 + 游戏小时选 wav/Ambient/*.wav，
 *                   森林分昼夜：白天(4..22) forest-day、夜(23..3) forest-night。
 *   3) 3D 对象声源：EU AddSound(x,y,z,round,code) 数据(全部移植) → wav/Ambient/*.wav，
 *                   音量忠实原版 GetDistVolume2：vol = 400 - (d²-round²)/1100，≤0 静音；
 *                   坐标 = 世界域(raw/256)、z 取反（GL 正北为正），与地图坐标同域。
 *   Web 限制：浏览器要求用户手势后才能出声，首次 pointerdown/keydown 解锁后开播。
 *   全部用 <audio>（无需 WebAudio Context）：BGM/环境音 loop + 单元素交叉淡入，对象声源按距离调 volume。
 *   注明：EU 对象声源表 = 经典 szAmbientSound2，仅索引 0 由 stone-mill 换成 ship_swaing_l(船声)。
 */

import type { Vector3 } from 'three';
import soundConfig from './sounds.json';

/** 3D 声源点：[x, y, z, round, code]，z 为 GL 约定（正北为正），世界域 */
export type SoundPoint = [number, number, number, number, number]
export type AmbientKind = 'town' | 'forest' | 'ruin' | 'desert' | 'dungeon'
  | 'temple' | 'cave' | 'darksanc' | 'iron' | 'ice';
export interface MapSoundCfg {
  id: number
  bgm: number
  ambient: AmbientKind | null
  sounds: SoundPoint[]
}

const cfg = soundConfig as unknown as {
  bgm: Record<string, string | null>
  ambients: Record<AmbientKind, { file: string; night: string | null }>
  objectSounds: Record<string, string>
  maps: MapSoundCfg[]
};

/** BGMID → 音乐文件（eura.wav/battle.wav 未随资产发布 → null 容错） */
const BGM_FILE = cfg.bgm as Record<number, string | null>;
/** ambient kind → 文件（forest 分昼夜） */
const AMBIENT_FILE = cfg.ambients;
/** 对象声源 code → 文件（EU 表；索引 0 = 船声） */
const OBJECT_SOUND_FILE = cfg.objectSounds as Record<number, string>;

/* ─────────── 每图配置索引 ─────────── */
const MAP_CFG = new Map<number, MapSoundCfg>();
for (const m of cfg.maps) MAP_CFG.set(m.id, m);

function mapCfg(mapId: number): MapSoundCfg | null {
  return MAP_CFG.get(mapId) ?? null;
}

/* ─────────── 目录 ─────────── */
const MUSIC_DIR = '/res/game/sounds/music/';
const AMBIENT_DIR = '/res/wav/ambient/';
const MUSIC_VOLUME = 0.55;      // 各通道上限（基线音量）
const AMBIENT_VOLUME = 0.48;
const EFFECT_VOLUME = 0.85;

/* ─────────── 用户音频偏好（系统设置面板 ⇄ localStorage，0..1 为滑块倍率）─────────── */
let bgmOn = true, ambOn = true, effOn = true;
let bgmLevel = 1, ambLevel = 1, effLevel = 1;

const PREFS_KEY = 'pt.audio.prefs';
function loadPrefs(): void {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    if (typeof p.bgmOn === 'boolean') bgmOn = p.bgmOn;
    if (typeof p.ambOn === 'boolean') ambOn = p.ambOn;
    if (typeof p.effOn === 'boolean') effOn = p.effOn;
    if (typeof p.bgmLevel === 'number') bgmLevel = Math.min(1, Math.max(0, p.bgmLevel));
    if (typeof p.ambLevel === 'number') ambLevel = Math.min(1, Math.max(0, p.ambLevel));
    if (typeof p.effLevel === 'number') effLevel = Math.min(1, Math.max(0, p.effLevel));
  } catch { /* ignore */ }
}
function savePrefs(): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ bgmOn, ambOn, effOn, bgmLevel, ambLevel, effLevel }));
  } catch { /* ignore */ }
}
loadPrefs();

function bgmTarget(): number { return bgmOn ? MUSIC_VOLUME * bgmLevel : 0; }
function ambTarget(): number { return ambOn ? AMBIENT_VOLUME * ambLevel : 0; }
function effTarget(): number { return effOn ? EFFECT_VOLUME * effLevel : 0; }

/* ─────────── 运行时状态 ─────────── */
let unlocked = false;      // 首次用户手势后放行
let active = false;        // 世界屏显示中
let currentMapId = -1;
let gameHour = 12;         // 0-23（game time，昼夜选曲/环境音用）

// BGM：交叉淡入对；环境音同理
let bgm: [HTMLAudioElement, HTMLAudioElement] | null = null;
let amb: [HTMLAudioElement, HTMLAudioElement] | null = null;
let bgmEl: HTMLAudioElement | null = null;   // 当前承载有效源的 BGM 元素
let ambEl: HTMLAudioElement | null = null;   // 同上（环境音）
let bgmKind = -1;          // 当前 BGMID
let ambKind: AmbientKind | null = null;
let ambNight = false;


interface StationAudio { el: HTMLAudioElement; file: string; x: number; y: number; z: number; round: number }
let stations: StationAudio[] = [];

function makeLoop(): HTMLAudioElement {
  const a = new Audio();
  a.loop = true;
  a.preload = 'auto';
  return a;
}

function urlOf(base: string, file: string): string {
  return base + encodeURI(file);
}

/* ─────────── BGM 切换（交叉淡入）─────────── */
function setBgm(bgmId: number): void {
  const file = bgmId >= 0 ? (BGM_FILE[bgmId] ?? null) : null;
  if (bgmId === bgmKind) return;
  bgmKind = bgmId;
  if (!bgm) bgm = [makeLoop(), makeLoop()];
  const [a, b] = bgm;
  const out = bgmEl;                 // 当前在播元素（若存在）
  const next = out === a ? b : a;    // 空槽：换到另一个
  // 同文件（如 0↔10 都是 desert.wav）：续播当前即可，避免重载
  if (file && out && out.src && out.src.endsWith(encodeURI(file))) return;
  // 淡出旧、换源淡入新
  const outVol = out ? out.volume : 0;
  if (out && !out.paused) {
    const t0 = performance.now();
    const fade = (): void => {
      const k = 1 - Math.min(1, (performance.now() - t0) / 500);
      const v = k * outVol;
      try { out.volume = v; } catch { }
      if (k > 0) requestAnimationFrame(fade);
      else { out.pause(); out.volume = outVol; }
    };
    fade();
  }
  bgmEl = next;
  if (!file) next.pause();
  else {
    next.src = urlOf(MUSIC_DIR, file);
    next.volume = bgmTarget();
    if (unlocked && active) next.play().catch(() => { });
    else next.load();
  }
}

/* ─────────── 环境音切换（交叉淡入；按小时选森林昼/夜）─────────── */
function setAmbient(kind: AmbientKind | null, hour: number): void {
  const night = hour < 4 || hour >= 23;
  const adef = kind ? AMBIENT_FILE[kind] : null;
  const file = adef ? (night && adef.night ? adef.night : adef.file) : null;
  if (ambKind === kind && ambNight === night) return;
  ambKind = kind; ambNight = night;

  if (!amb) amb = [makeLoop(), makeLoop()];
  const [a, b] = amb;
  const out = ambEl;                 // 当前在播元素（若存在）
  const next = out === a ? b : a;    // 空槽
  const outVol = out ? out.volume : 0;
  if (out && !out.paused) {
    const t0 = performance.now();
    const fade = (): void => {
      const k = 1 - Math.min(1, (performance.now() - t0) / 500);
      try { out.volume = k * outVol; } catch { }
      if (k > 0) requestAnimationFrame(fade);
      else out.pause();
    };
    fade();
  }
  ambEl = next;
  if (!file) next.pause();
  else {
    next.src = urlOf(AMBIENT_DIR, file);
    next.volume = ambTarget();
    if (unlocked && active) next.play().catch(() => { });
    else next.load();
  }
}

/* ─────────── 每帧：按距离更新对象声源音量（原版 GetDistVolume2；坐标均为世界域）─────────── */
function updateStations(playerWorld: Vector3): void {
  if (!active || !unlocked) return;
  const px = playerWorld.x;
  const py = playerWorld.y;
  const pz = playerWorld.z;
  for (const s of stations) {
    const dx = px - s.x, dy = py - s.y, dz = pz - s.z;
    // vol = 400 - (d²-round²)/1100，clamp [0,400]
    let vol = 400 - ((dx * dx + dy * dy + dz * dz - s.round * s.round) / 1100);
    if (vol < 0) vol = 0;
    else if (vol > 400) vol = 400;
    const g = (vol / 400) * effTarget();
    try { s.el.volume = g; } catch { }
    if (vol > 0.5 && s.el.paused) s.el.play().catch(() => { });
    else if (vol <= 0.5 && !s.el.paused) s.el.pause();
  }
}

/* ─────────── 切图 ─────────── */
function setupMap(mapId: number): void {
  // 释放旧对象声源
  for (const s of stations) s.el.pause();
  stations = [];

  const c = mapCfg(mapId);
  const bgmId = c?.bgm ?? -1;
  setBgm(bgmId);
  const bgmFile = bgmId >= 0 ? BGM_FILE[bgmId] : null;
  if (bgmId >= 0 && !bgmFile) {
    console.warn(`[mapAudio] 地图 ${mapId} BGM 文件缺失（bgmid=${bgmId}）`);
  }

  // 环境音
  const kind = c?.ambient ?? null;
  setAmbient(kind, gameHour);

  // 对象声源（只建当前资源存在、且该图有定义的点）
  const defs = c?.sounds ?? [];
  const ok = [];
  for (const [x, y, z, round, code] of defs) {
    const file = OBJECT_SOUND_FILE[code];
    if (!file) continue;
    const el = makeLoop();
    el.src = urlOf(AMBIENT_DIR, file);
    el.volume = 0;
    if (unlocked && active) el.load();
    stations.push({ el, file, x, y, z, round }); // z 已为 GL 约定（sounds.json 内取反）
    ok.push(file);
  }

  console.log(`[mapAudio] 地图 ${mapId}：BGM=${bgmFile ?? '无'} 环境音=${kind ?? '无'} 声源=${stations.length}个(${[...new Set(ok)].slice(0, 5).join(',')}…)`);
}

/* ─────────── 解锁 & 恢复/挂起 ─────────── */
function onUnlock(): void {
  unlocked = true;
  if (!active) return;
  if (bgmEl && bgmKind >= 0 && BGM_FILE[bgmKind] && bgmEl.src) bgmEl.play().catch(() => { });
  if (ambEl && ambEl.src) ambEl.play().catch(() => { });
  // 对象声源继续 play 由 updateStations 驱动（距 >0 自动恢复）
}

export const mapAudio = {
  /** 当前声源列表（调试可视化用；坐标 world 域，z 已为 GL 约定） */
  stations() {
    return stations.map(s => ({ x: s.x, y: s.y, z: s.z, round: s.round, file: s.file }));
  },
  /** 进图/换图 */
  enterMap(mapId: number): void {
    if (currentMapId === mapId && bgm) return;
    currentMapId = mapId;
    active = true;
    setupMap(mapId);
  },

  /** 游戏时间（小时 0-23）驱动森林环境音昼夜切换 */
  setGameTime(hour: number): void {
    if (hour === gameHour) return;
    gameHour = hour;
    if (amb && ambKind === 'forest') setAmbient('forest', hour);
  },

  /** 世界屏展示后恢复播放 */
  resume(): void {
    active = true;
    onUnlock();
  },

  /** 世界屏隐藏时静默（隐藏时恢复音量，暂停播放） */
  suspend(): void {
    active = false;
    if (bgm) for (const m of bgm) m.pause();
    if (amb) for (const m of amb) m.pause();
    for (const s of stations) s.el.pause();
  },

  /** 每帧调用：更新 3D 声源音量（喂角色世界坐标） */
  updateAt(playerWorld: Vector3): void {
    updateStations(playerWorld);
  },

  /* ─────────── 音频控制（系统设置面板）─────────── */
  /** BGM 开关（设置后立即生效 + 持久化） */
  setBgmOn(on: boolean): void {
    bgmOn = on; savePrefs();
    if (!bgmEl) return;
    bgmEl.volume = bgmTarget();
    if (on && unlocked && active) bgmEl.play().catch(() => { });
    else if (!on && bgmEl.src) bgmEl.pause();
  },
  get bgmOn(): boolean { return bgmOn; },
  /** BGM 音量 0..1 */
  setBgmLevel(v: number): void {
    bgmLevel = v; savePrefs();
    if (bgmEl) bgmEl.volume = bgmTarget();
  },
  get bgmLevel(): number { return bgmLevel; },

  /** 环境音开关（设置后立即生效 + 持久化） */
  setAmbOn(on: boolean): void {
    ambOn = on; savePrefs();
    if (!ambEl) return;
    ambEl.volume = ambTarget();
    if (on && unlocked && active) ambEl.play().catch(() => { });
    else if (!on && ambEl.src) ambEl.pause();
  },
  get ambOn(): boolean { return ambOn; },
  /** 环境音音量 0..1 */
  setAmbLevel(v: number): void {
    ambLevel = v; savePrefs();
    if (ambEl) ambEl.volume = ambTarget();
  },
  get ambLevel(): number { return ambLevel; },

  /** 场景音效开关（更新由逐帧 updateStations 驱动） */
  setEffOn(on: boolean): void {
    effOn = on; savePrefs();
    for (const s of stations) s.el.volume = 0;
  },
  get effOn(): boolean { return effOn; },
  /** 场景音效音量 0..1 */
  setEffLevel(v: number): void {
    effLevel = v; savePrefs();
  },
  get effLevel(): number { return effLevel; },

  dispose(): void {
    if (bgm) for (const m of bgm) { m.pause(); m.src = ''; }
    if (amb) for (const m of amb) { m.pause(); m.src = ''; }
    for (const s of stations) s.el.pause();
    stations = [];
    bgm = amb = null;
    bgmEl = ambEl = null;
    bgmKind = -1;
    ambKind = null;
    ambNight = false;
    currentMapId = -1;
    active = false;
  },
};

// 首次用户手势解锁（与 core/sound.ts 相同策略）
document.addEventListener('pointerdown', onUnlock, { capture: true, once: false });
document.addEventListener('keydown', onUnlock, { capture: true, once: false });