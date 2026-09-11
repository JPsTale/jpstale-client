/**
 * 音效子系统 —— WebAudio 引擎。
 *
 * 数据来源：scripts/extract-sfx.ts 从 ex-machina effectsnd.{cpp,h} 提取
 *   （ex-machina 是 JPT 源码重构版，音效表属数据语义，与原版一致）
 *
 * 复刻的原版语义：
 *   距离衰减  GetDistVolume  : vol = 400 - min(400, d²/1100)，d 为世界单位
 *   音量映射  PlayWav2       : SetVolume((vol-400)*10)，DirectSound 百分贝 → 线性增益
 *   变调      PlayWav2       : SetFrequency(feq*10)，Feq 2205 为基准（标称 22050Hz）
 *   选曲      CharPlaySound  : (声音码, 动作态) 命中后随机取一个变体
 *   归类      FindMotionState: 文件名前缀 → 动作态（构建期预扫描，见 sfx-folders.json）
 *
 * 有意偏离（原版缺陷/不可行）：
 *   - 原版每个文件只有一个静态 buffer，重触发即 SetCurrentPosition(0)（无法叠加）。
 *     这里允许叠加，另加"并发上限 + 每文件冷却"；原版靠音量 0 也不停播，
 *     这里超过衰减距离直接不播（省声道）。
 *   - 原版无并发上限（有多少播多少）；WebAudio 声道有限，故设 MAX_VOICES。
 */
import { audioPrefs, saveAudioPrefs } from './prefs';
import { encodeAssetPath } from '../core/texture';
import rawTables from './data/sfx-tables.json';
import rawFolders from './data/sfx-folders.json';

/* ─────────── 数据表 ─────────── */

interface SfxTables {
  motion: Array<{ prefix: string; state: string }>;
  weapon: Array<{ prefix: string; code: number }>;
  generic: string[];
  charFolders: Array<{ dir: string; code: number | string; symbol: string }>;
  skillSounds: Array<{ file: string; code: number | string; symbol: string }>;
  weaponSounds: Record<string, string[]>;
}

const tables = rawTables as unknown as SfxTables;
/** 目录 → 动作态 → 文件名（构建期扫描，等价原版 InitSoundEffect 的 FindFirstFile） */
const folderManifest = rawFolders as unknown as Record<string, Record<string, string[]>>;

/** 角色动作态（原版 CHRMOTION_STATE_*；disappear/change 同归 WARP） */
export type MotionState =
  | 'CHRMOTION_STATE_ATTACK'
  | 'CHRMOTION_STATE_DAMAGE'
  | 'CHRMOTION_STATE_DEAD'
  | 'CHRMOTION_STATE_STAND'
  | 'CHRMOTION_STATE_WALK'
  | 'CHRMOTION_STATE_SKILL'
  | 'CHRMOTION_STATE_HAMMER'
  | 'CHRMOTION_STATE_WARP';

/** 声音码 → 目录列表（原版 snFindEffects，同码可指向多个目录，如 HEAVYGOBLIN 双登记） */
const charDirsByCode = new Map<number, string[]>();
for (const e of tables.charFolders) {
  if (typeof e.code !== 'number') continue;
  const list = charDirsByCode.get(e.code);
  if (list) list.push(e.dir);
  else charDirsByCode.set(e.code, [e.dir]);
}

/** 技能音效码 → 文件列表 */
const skillByCode = new Map<number, string[]>();
for (const e of tables.skillSounds) {
  if (typeof e.code !== 'number') continue;
  const list = skillByCode.get(e.code);
  if (list) list.push(e.file);
  else skillByCode.set(e.code, [e.file]);
}

/** 武器码 → 文件列表 */
const weaponByCode = new Map<number, string[]>();
for (const [code, files] of Object.entries(tables.weaponSounds)) {
  weaponByCode.set(Number(code), files);
}

/* ─────────── 常量 ─────────── */

const RES_BASE = '/res/';
/** 音效通道上限（与 map-audio 的 EFFECT_VOLUME 对齐） */
const SFX_VOLUME = 0.85;
/** 并发声道上限；priority 音（自机攻击/UI）不受限 */
const MAX_VOICES = 24;
/** 同文件最小重触发间隔，避免一帧内叠放多次 */
const SAME_FILE_COOLDOWN_MS = 30;
/** 原版 SetFrequency(feq * FRQ_MULT)，FRQ_MULT = 10 */
const FREQ_UNIT = 10;
/** 原版 SetVolume((vol + VOL_SHIFT) * VOL_MULT)，VOL_MULT = 10（百分贝单位） */
const VOL_MULT = 10;
/** 原版默认 Feq = 2205 → 22050Hz；作为播放速率基准 */
const FREQ_BASE = 2205;
/** 超过最大衰减距离（d² /1100 > 400 → d > 663）直接不播 */
const DIST_SILENT = 400;

/* ─────────── 运行时 ─────────── */

let ctx: AudioContext | null = null;
let bus: GainNode | null = null;
let unlocked = false;
let hidden = false;

const decoded = new Map<string, AudioBuffer>();
const decoding = new Map<string, Promise<AudioBuffer | null>>();
const lastPlayed = new Map<string, number>();
const live: Array<{ src: AudioBufferSourceNode; gain: GainNode; priority: boolean }> = [];

export interface ListenerPos { x: number; y: number; z: number }
let listener: ListenerPos = { x: 0, y: 0, z: 0 };

/* ─────────── 音量与衰减（复刻 GetDistVolume / PlayWav2） ─────────── */

/** 原版音量码 → 线性增益：SetVolume((vol-400)*10) 为百分贝，DirectSound 0dB=满幅 */
function gainFromVol(vol: number): number {
  return 10 ** (((vol - 400) * VOL_MULT) / 2000);
}

/** 原版 GetDistVolume：返回 0..400 的音量码 */
function distVol(pos: ListenerPos): number {
  const dx = pos.x - listener.x;
  const dy = pos.y - listener.y;
  const dz = pos.z - listener.z;
  let v = (dx * dx + dy * dy + dz * dz) / 1100;
  if (v > DIST_SILENT) return -1; // 超出衰减距离，原版仍以极低音量播放，这里省声道
  if (v < 0) v = 0;
  return 400 - v;
}

function channelGain(): number {
  return audioPrefs.sfxOn ? SFX_VOLUME * audioPrefs.sfxLevel : 0;
}

/* ─────────── AudioContext 生命周期 ─────────── */

function ensureCtx(): AudioContext | null {
  if (ctx) return ctx;
  if (typeof AudioContext === 'undefined') return null;
  ctx = new AudioContext();
  bus = ctx.createGain();
  bus.gain.value = 1;
  bus.connect(ctx.destination);
  return ctx;
}

function unlock(): void {
  if (unlocked) return;
  const c = ensureCtx();
  if (!c) return;
  unlocked = true;
  if (c.state === 'suspended') void c.resume();
}

// 浏览器要求用户手势后才允许出声（与 core/sound.ts、maps/map-audio.ts 同策略）
document.addEventListener('pointerdown', unlock, { capture: true });
document.addEventListener('keydown', unlock, { capture: true });

document.addEventListener('visibilitychange', () => {
  hidden = document.visibilityState === 'hidden';
  if (!ctx) return;
  if (hidden) void ctx.suspend();
  else if (unlocked) void ctx.resume();
});

/* ─────────── 解码 ─────────── */

async function loadBuffer(path: string): Promise<AudioBuffer | null> {
  const hit = decoded.get(path);
  if (hit) return hit;
  const inflight = decoding.get(path);
  if (inflight) return inflight;
  const job = (async (): Promise<AudioBuffer | null> => {
    try {
      const c = ensureCtx();
      if (!c) return null;
      const resp = await fetch(encodeAssetPath(RES_BASE + path));
      if (!resp.ok) return null;
      const buf = await c.decodeAudioData(await resp.arrayBuffer());
      decoded.set(path, buf);
      return buf;
    } catch {
      return null;
    } finally {
      decoding.delete(path);
    }
  })();
  decoding.set(path, job);
  return job;
}

/* ─────────── 播放 ─────────── */

interface PlayOpts {
  /** 世界坐标；给出则按距离衰减，缺省为界面音（满音量） */
  pos?: ListenerPos;
  /** 播放速率倍率，对应原版 Feq；缺省 1（= 2205） */
  pitch?: number;
  /** 高优先级：并发满时仍播放（自机攻击/受击、界面音） */
  priority?: boolean;
}

function start(path: string, opts: PlayOpts = {}): void {
  if (!audioPrefs.sfxOn || !unlocked || hidden || !ctx || !bus) return;

  const now = performance.now();
  const last = lastPlayed.get(path);
  if (last !== undefined && now - last < SAME_FILE_COOLDOWN_MS) return;

  let vol = 400;
  if (opts.pos) {
    vol = distVol(opts.pos);
    if (vol < 0) return;
  }
  const gain = gainFromVol(vol) * channelGain();
  if (gain <= 0) return;

  if (!opts.priority && live.length >= MAX_VOICES) return;

  lastPlayed.set(path, now);
  void (async () => {
    const buf = await loadBuffer(path);
    if (!buf || !ctx || !bus) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = ((opts.pitch ?? 1) * FREQ_BASE * FREQ_UNIT) / buf.sampleRate;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g);
    g.connect(bus);
    const voice = { src, gain: g, priority: !!opts.priority };
    live.push(voice);
    src.onended = () => {
      const i = live.indexOf(voice);
      if (i >= 0) live.splice(i, 1);
      try { g.disconnect(); } catch { /* ignore */ }
    };
    src.start();
  })();
}

/** 从候选里随机取一个（原版 rand() % CodeBuffCnt） */
function pick(files: string[] | undefined): string | null {
  if (!files || !files.length) return null;
  return files[Math.floor(Math.random() * files.length)] ?? null;
}

/** 目录 basename → 目录路径。服务端目前不下发 dwCharSoundCode（proto 无该字段），
 *  故怪物/玩家音效按目录名解析；snFindEffects 的数字码路径仍保留（playCharSound）。 */
const dirByBase = new Map<string, string>();
for (const dir of Object.keys(folderManifest)) {
  const base = dir.slice(dir.lastIndexOf('/') + 1);
  if (!dirByBase.has(base)) dirByBase.set(base, dir);
}

/** 由模型路径 / 名称 / 职业目录名解析音效目录（取 basename、去扩展名、小写） */
function resolveDir(key: string): string | null {
  const norm = key.replace(/\\/g, '/').toLowerCase();
  const base = norm.slice(norm.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
  return dirByBase.get(base) ?? null;
}

/** 职业 id → 音效目录名（与原版 snFindEffects 的职业项一致；job 11 无音效目录） */
const JOB_SOUND_DIR: Record<number, string> = {
  1: 'fighter', 2: 'mechanician', 3: 'archer', 4: 'pikeman', 5: 'atalanta',
  6: 'knight', 7: 'magician', 8: 'priestess', 9: 'assassin', 10: 'shaman',
};

/** 在指定音效目录下按动作态取一个文件播放 */
function playDir(dir: string | null, motion: MotionState, pos: ListenerPos): void {
  if (!dir) return;
  const bucket = folderManifest[dir]?.[motion];
  const file = pick(bucket?.map((f) => `${dir}/${f}`));
  if (file) start(file, { pos });
}

/* ─────────── 武器音效码（复刻 WeaponPlaySound） ─────────── */

export type HandType = '1H' | '2H' | 'UNDEFINED';

/**
 * 武器类型 + 单双手 → 原版武器音效码（1-18）。
 * 依据 ex-machina WeaponPlaySound 的 switch(sinITEM_MASK2)：
 *   sinWA1→1/2、sinWS2→3/4（低位 ≤ sin03 为短剑→15）、sinWP1→5/6、
 *   sinWC1→7、sinWS1→8、sinWM1→9/10（法师/祭司 职业 7/8 → 17/18）、
 *   sinWH1→9/10、sinWT1→11、空手兜底 14。
 * 我方武器语义类型（char/weapon-type.ts）到上述分支的对应：
 *   AXE→斧 / SWORD→剑 / JAVELIN→矛 / CLAW→爪 / BOW|CROSSBOW→弓 /
 *   HAMMER|SCYTHE→钝器 / DAGGER→短剑 / STAFF→法杖（归 casting）
 */
export function weaponSoundCode(
  weaponType: string | null,
  hand: HandType,
  isCaster = false,
): number {
  const two = hand !== '1H';
  switch (weaponType) {
    case 'AXE': return two ? 2 : 1;
    case 'SWORD': return two ? 4 : 3;
    case 'JAVELIN': return two ? 6 : 5;
    case 'CLAW': return 7;
    case 'BOW':
    case 'CROSSBOW': return 8;
    case 'DAGGER': return 15;
    case 'HAMMER':
    case 'SCYTHE':
      return isCaster ? (two ? 18 : 17) : (two ? 10 : 9);
    case 'STAFF': return two ? 18 : 17;
    default: return 14; // 空手 punch hit
  }
}

/** 未命中音效码（原版 AttackCritcal < 0 分支） */
export function weaponMissCode(hand: HandType): number {
  return hand === '1H' ? 12 : 13;
}

/** 暴击音效码（原版 dwCode = 16，命中后追加一枚） */
export const CRITICAL_SOUND_CODE = 16;

/* ─────────── 界面音效 ─────────── */

/**
 * 界面音效。经典版所有按钮音为根目录 wav/Button.wav（HoLogin 直引）；
 * 游戏内菜单套件是 wav/effects/menu/*（原版客户端存在该目录，但调度代码在
 * 已遗失的反编译部分，故按文件名语义选曲，见下）。
 */
export type UiSound = 'click' | 'cancel' | 'open' | 'levelup';

const UI_SOUNDS: Record<UiSound, string> = {
  click: 'wav/effects/menu/button01.wav',
  cancel: 'wav/effects/menu/cancel01.wav',
  open: 'wav/effects/menu/turning01.wav',   // 语义推断：翻页/展开
  levelup: 'wav/effects/menu/level up.wav',
};

/* ─────────── 界面点击音 ─────────── */

// 游戏内 React 面板（.jp-overlay 内的按钮）统一按键音。
// 登录/选服/选人屏由 core/sound.ts 自行处理（其 uiSfxOn 门控），两者选择器不重叠。
// 画布 HUD 按钮非 DOM，需在 Hud.ts 显式调用 playUi。
document.addEventListener('click', (e) => {
  const t = e.target;
  if (!(t instanceof Element)) return;
  if (t.closest('.jp-overlay button, .jp-overlay [role="button"]')) {
    start(UI_SOUNDS.click, { priority: true });
  }
}, { capture: true });

/* ─────────── 诊断查询面（只解析不播放，供资产检查器） ─────────── */

/** 只读查询：给定条件下实际会播哪些文件。不影响播放状态。 */
export const sfxBank = {
  /** 武器码 → 候选文件 */
  weaponFiles(code: number): string[] { return weaponByCode.get(code) ?? []; },
  /** 武器码 → 原版前缀短语（如 "one hand swing axe"） */
  weaponPrefix(code: number): string | null {
    return tables.weapon.find((w) => w.code === code)?.prefix ?? null;
  },
  /** 全部武器码表 */
  weaponTable(): Array<{ prefix: string; code: number }> { return tables.weapon; },
  /** 技能音效码 → 候选文件 */
  skillFiles(code: number): string[] { return skillByCode.get(code) ?? []; },
  /** 技能音效码总数 */
  skillCodeCount(): number { return skillByCode.size; },
  /** 按目录名（怪物名/模型路径/职业目录名）+ 动作态 → 候选文件 */
  charFiles(key: string, motion: MotionState): string[] {
    const dir = resolveDir(key);
    if (!dir) return [];
    const bucket = folderManifest[dir]?.[motion];
    return bucket ? bucket.map((f) => `${dir}/${f}`) : [];
  },
  /** 职业 id + 动作态 → 候选文件 */
  playerFiles(job: number, motion: MotionState): string[] {
    return sfxBank.charFiles(JOB_SOUND_DIR[job] ?? '', motion);
  },
  /** 该目录名在音效库里是否存在 */
  hasDir(key: string): boolean { return resolveDir(key) !== null; },
  /** 通用音效表（原版 esSoundWav） */
  genericFiles(): string[] { return tables.generic; },
  /** 界面音效 → 文件 */
  uiFile(kind: UiSound): string { return UI_SOUNDS[kind]; },
  /** 全部动作态（原版 snFindEffectsMotion 的映射结果） */
  motionStates(): string[] { return [...new Set(tables.motion.map((m) => m.state))]; },
};

/* ─────────── 对外 API ─────────── */

export const sfx = {
  /** 每帧更新听者位置（喂自机世界坐标） */
  update(pos: ListenerPos): void {
    listener = pos;
  },

  /** 直接按资产相对路径播放（path 形如 wav/effects/menu/button01.wav） */
  play(path: string, opts?: PlayOpts): void {
    start(path, opts);
  },

  /** 界面音效（界面音一律高优先级、满音量、不受距离影响） */
  playUi(kind: UiSound): void {
    start(UI_SOUNDS[kind], { priority: true });
  },

  /**
   * 角色动作音（怪物/NPC/玩家）：复刻 CharPlaySound 的数字码路径。
   * 命中 (声音码, 动作态) 后随机取一个变体。
   */
  playCharSound(charSoundCode: number, motion: MotionState, pos: ListenerPos): void {
    const dirs = charDirsByCode.get(charSoundCode);
    if (!dirs) return;
    const files: string[] = [];
    for (const d of dirs) {
      const bucket = folderManifest[d]?.[motion];
      if (bucket) files.push(...bucket.map((f) => `${d}/${f}`));
    }
    const file = pick(files);
    if (file) start(file, { pos });
  },

  /** 按目录名播角色音：怪物用怪物名或模型资产路径（modelFile），NPC 同理 */
  playSoundByName(key: string, motion: MotionState, pos: ListenerPos): void {
    playDir(resolveDir(key), motion, pos);
  },

  /** 玩家（自机/远端）受击、死亡音：按职业 id 定位 wav/effects/player/<class> */
  playPlayerSound(job: number, motion: MotionState, pos: ListenerPos): void {
    playDir(resolveDir(JOB_SOUND_DIR[job] ?? ''), motion, pos);
  },

  /** 武器挥击音（普攻起手） */
  playWeaponAttack(code: number, opts?: PlayOpts): void {
    const file = pick(weaponByCode.get(code));
    if (file) start(file, opts);
  },

  /** 武器未命中音 */
  playWeaponMiss(hand: HandType, opts?: PlayOpts): void {
    const file = pick(weaponByCode.get(weaponMissCode(hand)));
    if (file) start(file, opts);
  },

  /** 暴击音（暴击命中时追加播放） */
  playCritical(opts?: PlayOpts): void {
    const file = pick(weaponByCode.get(CRITICAL_SOUND_CODE));
    if (file) start(file, opts);
  },

  /** 技能音效（SKILL_SOUND_* 码） */
  playSkill(code: number, opts?: PlayOpts): void {
    const file = pick(skillByCode.get(code));
    if (file) start(file, opts);
  },

  /** 通用音效（原版 esPlaySound(Num) 索引进 esSoundWav[]） */
  playGeneric(index: number, opts?: PlayOpts): void {
    const file = tables.generic[index];
    if (file) start(file, opts);
  },

  /** 升级音（原版 skILL_SOUND_LEARN 亦用于升级提示） */
  playLevelUp(): void {
    start(UI_SOUNDS.levelup, { priority: true });
  },

  /* ── 设置（系统设置面板） ── */
  setOn(on: boolean): void {
    audioPrefs.sfxOn = on;
    saveAudioPrefs();
    if (!on) for (const v of [...live]) { try { v.src.stop(); } catch { /* ignore */ } }
  },
  get on(): boolean { return audioPrefs.sfxOn; },
  setLevel(v: number): void {
    audioPrefs.sfxLevel = Math.min(1, Math.max(0, v));
    saveAudioPrefs();
  },
  get level(): number { return audioPrefs.sfxLevel; },

  /** 诊断：已解码文件数 / 当前活跃声道数 */
  stats(): { decoded: number; voices: number } {
    return { decoded: decoded.size, voices: live.length };
  },
};
