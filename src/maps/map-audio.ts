/**
 * 地图音效 —— 忠实移植原版 PT（EU 客户端 / 经典 ex-machina）：
 *   1) 每图 BGM   ：EU MapGame.cpp 的 SetBackgroundMusicID → game/sounds/music/*.wav，
 *                   固定一轨不分昼夜；个别图 TRIGGERED(-1) 不播。
 *   2) 环境音(全局)：经典 playmain.cpp 按地图类型 + 游戏小时选 wav/Ambient/*.wav，
 *                   森林分昼夜：白天(4..22) forest-day、夜(23..3) forest-night。
 *   3) 3D 对象声源：EU AddSound(x,y,z,round,code) 数据(全部移植) → wav/Ambient/*.wav，
 *                   音量忠实原版 GetDistVolume2：vol = 400 - (d²-round²)/1100，≤0 静音。
 *   坐标：原版字段坐标为 raw(整数) 单位，特 3D 场景世界域 = raw/256、z 取反（同 fields.json 约定）。
 *   Web 限制：浏览器要求用户手势后才能出声，首次 pointerdown/keydown 解锁后开播。
 *   全部用 <audio>（无需 WebAudio Context）：BGM/环境音 loop + 单元素交叉淡入，对象声源按距离调 volume。
 *   注明：EU 对象声源表 = 经典 szAmbientSound2，仅索引 0 由 stone-mill 换成 ship_swaing_l(船声)。
 */

import type { Vector3 } from 'three';

/* ─────────── 目录 ─────────── */
const MUSIC_DIR = '/res/game/sounds/music/';
const AMBIENT_DIR = '/res/wav/ambient/';
const MUSIC_VOLUME = 0.55;
const AMBIENT_VOLUME = 0.48;
const EFFECT_VOLUME = 0.85;

/* ─────────── 每图 BGM（EU MapGame.cpp SetBackgroundMusicID → Musics.h BGMList）─────────── */
// BGMID（BACKGROUNDMUSICID_* 枚举值）→ 音乐文件（eura.wav/battle.wav 未随资产发布 → null 容错）
const BGM_FILE: Record<number, string | null> = {
  0: 'desert.wav', 1: 'navisko.wav', 2: 'ricarten.wav', 3: null, 4: 'forest.wav',
  5: 'dungeon.wav', 6: 'phillai.wav', 7: 'bellatra_123.wav', 8: 'bellatra_456.wav',
  9: 'bellatra_78.wav', 10: 'desert.wav', 11: 'ice.wav', 12: 'atlantis.wav',
  13: 'login_aor_old.wav', 14: 'characterselect.wav', 15: 'eura.wav',
  16: 'mysteryforest.wav', 17: 'mysterydesert.wav', 18: 'battle.wav', 19: 'christmas.wav',
  20: 'questarena.wav', 21: 'blesscastle.wav', 22: 'furyarena.wav', 23: 'secretlab.wav',
  24: 'heartoffire.wav',
};
// mapId → BGMID（-1 = TRIGGERED，不播）
const MAP_BGM: Record<number, number> = {
  0: 4, 1: 4, 2: 4, 3: 2, 4: 10, 5: 10, 6: 10, 7: 10, 8: 10, 9: 1,
  10: 10, 11: 10, 12: 10, 13: 5, 14: 5, 15: 5, 16: 4, 17: 4, 18: 4, 19: 4,
  20: 4, 21: 6, 22: 5, 23: 5, 24: 5, 25: 5, 26: 5, 27: -1, 28: -1, 29: 11,
  30: -1, 31: 11, 32: 20, 33: 21, 34: 11, 35: 11, 36: 5, 37: 10, 38: 10, 39: 4,
  40: 5, 41: 5, 42: 5, 43: 5, 44: 5, 45: 12, 46: 16, 47: 16, 48: 16, 49: 18,
  50: 17, 51: 17, 52: 17, 53: 5, 54: 5, 55: 5, 56: 5, 57: 5, 58: 5, 59: 5,
  60: 22, 61: 23, 62: 5, 63: 24, 64: 2, 65: 2, 66: 2,
};

/* ─────────── 环境音（wav/Ambient/*，EU 表 = 经典 szAmbientSound 全集）─────────── */
type AmbientKind = 'town' | 'forest' | 'ruin' | 'desert' | 'dungeon' | 'temple'
  | 'cave' | 'darksanc' | 'iron' | 'ice';

const AMBIENT_FILE: Record<AmbientKind, string> = {
  town: 'tempskron-town.wav',
  forest: 'forest-day.wav', // 昼夜在运行时按小时切换文件
  ruin: 'ruin wind.wav',
  desert: 'desert wind.wav',
  dungeon: 'dungeon.wav',
  temple: 'temple_amb.wav',
  cave: 'cave_amb.wav',
  darksanc: 'darksanc_amb.wav',
  iron: 'iron_amb.wav',
  ice: 'icewind.wav',
};
const FOREST_NIGHT_FILE = 'forest-night.wav';

const MAP_AMBIENT: Record<number, AmbientKind> = {
  // 城镇
  3: 'town', 21: 'town', 45: 'town', 64: 'town', 65: 'town',
  // 森林（含日/夜）
  0: 'forest', 1: 'forest', 2: 'forest', 17: 'forest', 18: 'forest',
  19: 'forest', 20: 'forest', 39: 'forest', 46: 'forest', 47: 'forest', 48: 'forest',
  // 废墟/荒地（EU MAPTYPE_Wasteland）
  4: 'ruin', 5: 'ruin', 6: 'ruin', 7: 'ruin', 8: 'ruin', 9: 'ruin', 30: 'ruin', 37: 'ruin', 38: 'ruin',
  // 沙漠
  10: 'desert', 11: 'desert', 12: 'desert', 50: 'desert', 51: 'desert', 52: 'desert',
  // 神殿（诅咒神殿/被遗忘神殿/赐福城堡）
  22: 'temple', 23: 'temple', 42: 'temple', 33: 'temple', 53: 'temple', 54: 'temple',
  // 洞穴
  24: 'cave', 25: 'cave', 36: 'cave',
  // 暗圣所/秘密实验室
  26: 'darksanc', 61: 'darksanc',
  // 铁/冰
  27: 'iron', 28: 'iron',
  29: 'ice', 31: 'ice', 34: 'ice', 35: 'ice', 44: 'ice',
  // 其余地牢
  13: 'dungeon', 14: 'dungeon', 15: 'dungeon', 16: 'dungeon', 32: 'dungeon',
  40: 'dungeon', 41: 'dungeon', 43: 'dungeon', 49: 'dungeon', 55: 'dungeon',
  56: 'dungeon', 57: 'dungeon', 58: 'dungeon', 59: 'dungeon', 60: 'dungeon',
  62: 'dungeon', 63: 'dungeon', 66: 'dungeon',
};

/* ─────────── 3D 对象声源：code → 文件（EU 表；索引 0 = 船声）─────────── */
const OBJECT_SOUND_FILE: Record<number, string> = {
  0: 'ship_swaing_l.wav',  1: 'dungeon_pumping_b.wav', 2: 'dungeon_pumping_l.wav',
  3: 'dungeon_spin_b.wav', 4: 'lake 1.wav', 5: 'mystic 1.wav', 6: 'mystic 2.wav',
  7: 'ship_swaing_l.wav',  8: 'stream.wav', 9: 'town_bell 1.wav', 10: 'town_bell 2.wav',
  11: 'town_spin_b.wav',  12: 'town_spin_l.wav', 13: 'waterfall.wav',
  14: 'stone-mill2.wav', 15: 'watermill 1.wav', 16: 'windmill 1.wav', 17: 'windmill 2.wav',
  18: 'windmill 3.wav',  19: 'windmill 4.wav', 20: 'owl 1.wav',
  21: 'dungeon_big-bolt 1.wav', 22: 'dungeon_stonepole.wav', 23: 'zombiemill 1.wav',
  24: 'dungeon_weight.wav', 25: 'dungeon_device_side.wav', 26: 'dungeon_device_axe.wav',
  27: 'dungeon_cage 1.wav',
};

/** 场景声源摆放（EU MapGame.cpp AddSound 全量移植；坐标 = raw 字段单位，z 与 MapGame 同号） */
type StationRaw = [number, number, number, number, number]; // [x, y, z, round, code]
const MAP_STATIONS: Record<number, StationRaw[]> = {
  0: [[-13819, 226, -8950, 100, 15], [-13457, 409, -10276, 150, 0]],
  1: [[-3775, 171, -14447, 160, 14]],
  3: [[-1006, 170, -17835, 80, 27], [2632, 321, -17285, 80, 27]],
  7: [[16503, 1117, -13707, 150, 0]],
  13: [[-15385, 100, -24949, 128, 0]],
  17: [[-1448, 827, 34188, 160, 7], [618, 531, 35981, 160, 7], [2282, 537, 32355, 160, 20],
    [2597, 793, 30745, 0, 20], [2562, 641, 32726, 0, 20], [3789, 770, 30062, 0, 20],
    [3698, 909, 34179, 60, 14]],
  18: [[-3573, 861, 42603, 0, 15]],
  19: [[-266, 862, 57971, 100, 13], [-5014, 629, 56702, 100, 13], [2153, 772, 53576, 80, 13],
    [-395, 542, 56521, 80, 13], [-3329, 522, 56469, 20, 15], [-39, 604, 54080, 10, 6]],
  20: [[2849, 577, 67330, 30, 18], [317, 653, 64957, 10, 19], [-1166, 779, 63268, 40, 18],
    [-181, 864, 62576, 10, 18], [190, 686, 61850, 10, 18], [-1070, 671, 61561, 10, 18],
    [1815, 562, 65414, 100, 8], [1800, 603, 61149, 100, 8]],
  21: [[3557, 613, 75558, 20, 9], [2256, 745, 78247, 50, 6], [2066, 463, 73782, 0, 5],
    [3032, 554, 73674, 10, 4], [2246, 554, 76792, 0, 14], [2531, 544, 74955, 30, 12],
    [2034, 544, 74921, 30, 12], [934, 542, 73886, 0, 17], [3851, 492, 74639, 0, 17],
    [3326, 666, 76387, 0, 17], [2227, 543, 74647, 120, 0]],
  22: [[-10857, 343, -42634, 10, 24], [-11299, 689, -44077, 10, 24], [-12995, 689, -44112, 10, 24],
    [-11698, 343, -43240, 10, 24], [-13472, 343, -42494, 10, 24], [-13447, 343, -40892, 10, 24],
    [-9956, 343, -40637, 10, 24], [-9957, 443, -43232, 10, 24], [-14113, 443, -42715, 10, 24],
    [-14245, 343, -40555, 10, 24], [-12071, 339, -39504, 10, 24], [-10236, 443, -44024, 0, 23],
    [-12637, 339, -38716, 0, 23], [-12231, 94, -41732, 10, 27]],
  23: [[-3660, 730, -36915, 40, 23], [-2166, 732, -36125, 0, 24], [-5150, 732, -36123, 0, 24],
    [-6175, 762, -41850, 0, 24], [-1239, 762, -41850, 0, 24], [-1251, 794, -38207, 0, 24],
    [-2424, 732, -38229, 0, 7], [-3611, 885, -39760, 0, 7], [-4798, 732, -38212, 0, 7]],
  35: [[-38893, 830, -45337, 120, 0]],
  42: [[-3648, 3, -50013, 0, 7], [-4349, 454, -47777, 0, 7], [-5130, 454, -47587, 0, 7],
    [-2183, 172, -47864, 0, 7], [-1785, 167, -48077, 0, 7], [-3725, 116, -46758, 0, 7],
    [-3632, 3, -47999, 0, 7], [-627, 229, -45987, 0, 7], [-1896, 116, -45010, 0, 7],
    [-5077, 116, -45555, 0, 7], [-5289, 116, -46422, 0, 7]],
};

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
  if (out && !out.paused) {
    const t0 = performance.now();
    const fade = (): void => {
      const k = 1 - Math.min(1, (performance.now() - t0) / 500);
      const v = k * MUSIC_VOLUME;
      try { out.volume = v; } catch { }
      if (k > 0) requestAnimationFrame(fade);
      else { out.pause(); out.volume = MUSIC_VOLUME; }
    };
    fade();
  }
  bgmEl = next;
  if (!file) next.pause();
  else {
    next.src = urlOf(MUSIC_DIR, file);
    next.volume = MUSIC_VOLUME;
    if (unlocked && active) next.play().catch(() => { });
    else next.load();
  }
}

/* ─────────── 环境音切换（交叉淡入；按小时选森林昼/夜）─────────── */
function setAmbient(kind: AmbientKind | null, hour: number): void {
  const night = hour < 4 || hour >= 23;
  const file = kind === 'forest'
    ? (night ? FOREST_NIGHT_FILE : AMBIENT_FILE.forest)
    : kind ? AMBIENT_FILE[kind] : null;
  if (ambKind === kind && ambNight === night) return;
  ambKind = kind; ambNight = night;

  if (!amb) amb = [makeLoop(), makeLoop()];
  const [a, b] = amb;
  const out = ambEl;                 // 当前在播元素（若存在）
  const next = out === a ? b : a;    // 空槽
  if (out && !out.paused) {
    const t0 = performance.now();
    const fade = (): void => {
      const k = 1 - Math.min(1, (performance.now() - t0) / 500);
      try { out.volume = k * AMBIENT_VOLUME; } catch { }
      if (k > 0) requestAnimationFrame(fade);
      else out.pause();
    };
    fade();
  }
  ambEl = next;
  if (!file) next.pause();
  else {
    next.src = urlOf(AMBIENT_DIR, file);
    next.volume = AMBIENT_VOLUME;
    if (unlocked && active) next.play().catch(() => { });
    else next.load();
  }
}

/* ─────────── 每帧：按距离更新对象声源音量（原版 GetDistVolume2）─────────── */
function updateStations(playerWorld: Vector3): void {
  if (!active || !unlocked) return;
  const px = playerWorld.x * 256;
  const py = playerWorld.y * 256;
  const pz = playerWorld.z * 256;
  for (const s of stations) {
    const dx = px - s.x, dy = py - s.y, dz = pz - s.z;
    // vol = 400 - (d²-round²)/1100，clamp [0,400]
    let vol = 400 - ((dx * dx + dy * dy + dz * dz - s.round * s.round) / 1100);
    if (vol < 0) vol = 0;
    else if (vol > 400) vol = 400;
    const g = (vol / 400) * EFFECT_VOLUME;
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

  // BGM
  const bgmId = MAP_BGM[mapId] ?? -1;
  setBgm(bgmId);
  const bgmFile = bgmId >= 0 ? BGM_FILE[bgmId] : null;
  if (bgmId >= 0 && !bgmFile) {
    console.warn(`[mapAudio] 地图 ${mapId} BGM 文件缺失（bgmid=${bgmId}）`);
  }

  // 环境音
  const kind = MAP_AMBIENT[mapId] ?? null;
  setAmbient(kind, gameHour);

  // 对象声源（只建当前资源存在、且该图有定义的点）
  const defs = MAP_STATIONS[mapId] ?? [];
  const ok = [];
  for (const [x, y, z, round, code] of defs) {
    const file = OBJECT_SOUND_FILE[code];
    if (!file) continue;
    const el = makeLoop();
    el.src = urlOf(AMBIENT_DIR, file);
    el.volume = 0;
    if (unlocked && active) el.load();
    stations.push({ el, file, x, y, z, round });
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
  /** 当前声源列表（调试可视化用；坐标 world 域） */
  stations() {
    return stations.map(s => ({ x: s.x / 256, y: s.y / 256, z: -s.z / 256, round: s.round / 256, file: s.file }));
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