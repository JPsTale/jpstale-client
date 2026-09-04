/**
 * 界面音效 —— 移植自 EU 客户端（game.exe/game.dll 字符串直引）：
 *   登录/选服 BGM：game/sounds/music/login_aor_old.wav（已试听定稿）
 *   选人 BGM    ：game/sounds/music/characterselect.wav
 *   按钮点击    ：wav/button.wav；返回按钮：wav/buttonback.wav
 *
 * Web 限制：浏览器要求用户手势后才允许出声。音乐在首次进入登录/选服时尝试自动播放，
 * 若被拦截则挂起，待用户第一次 pointerdown/keydown（解锁）后再续播。
 * BGM 用 <audio loop> 流式播放（大 wav 由 devAssets 提供 Range），点击音效按 URL 缓存复用。
 */
export type UiScreenKind = 'login' | 'charSelect' | 'none';

const MUSIC_DIR = '/res/game/sounds/music/';
const LOGIN_MUSIC = 'login_aor_old.wav';
export const MUSIC_CHAR_SELECT = MUSIC_DIR + 'characterselect.wav';

const SFX_CLICK = '/res/wav/button.wav';
const SFX_BACK = '/res/wav/buttonback.wav';

const MUSIC_VOLUME = 0.5;
const SFX_VOLUME = 0.8;

let kind: UiScreenKind = 'none';
let music: HTMLAudioElement | null = null;
let curUrl = '';
let unlocked = false;

function getMusic(): HTMLAudioElement {
  if (!music) {
    music = new Audio();
    music.loop = true;
    music.preload = 'auto';
    music.volume = MUSIC_VOLUME;
  }
  return music;
}

function kindUrl(k: UiScreenKind): string {
  if (k === 'login') return MUSIC_DIR + LOGIN_MUSIC;
  if (k === 'charSelect') return MUSIC_CHAR_SELECT;
  return '';
}

function applyMusic(): void {
  const url = kindUrl(kind);
  const m = getMusic();
  if (url === curUrl) {
    if (url && unlocked && m.paused) m.play().catch(() => { });
    return;
  }
  curUrl = url;
  if (!url) {
    m.pause();
    m.removeAttribute('src');
    m.load();
    return;
  }
  m.src = url;
  if (unlocked) m.play().catch(() => { });
}

function unlock(): void {
  unlocked = true;
  const m = getMusic();
  if (curUrl && m.paused) m.play().catch(() => { });
}

const sfxCache = new Map<string, HTMLAudioElement>();
function playSfx(url: string): void {
  let a = sfxCache.get(url);
  if (!a) {
    a = new Audio(url);
    a.preload = 'auto';
    a.volume = SFX_VOLUME;
    sfxCache.set(url, a);
  }
  a.currentTime = 0;
  const p = a.play();
  if (p) p.catch(() => { });
}

// 首次手势解锁（BGM 自动播放被拦截时兜底续播）
document.addEventListener('pointerdown', unlock, { capture: true, once: false });
document.addEventListener('keydown', unlock, { capture: true, once: false });

// 登录/选服/选人界面的可点击元素统一按键音（进游戏后由 setScreen('none') 静音关闭）
let uiSfxOn = false;
function isClickableTarget(t: Element): boolean {
  if (t.closest('button, a, select, [role="button"], input[type="button"], input[type="submit"]')) return true;
  let n: Element | null = t;
  for (let i = 0; n && i < 8; i++) {
    if (n instanceof HTMLElement && getComputedStyle(n).cursor === 'pointer') return true;
    n = n.parentElement;
  }
  return false;
}
document.addEventListener('click', (e) => {
  if (!uiSfxOn) return;
  const t = e.target as Element | null;
  if (!t || !(t instanceof Element)) return;
  if (isClickableTarget(t)) playSfx(SFX_CLICK);
}, { capture: true });

export const sound = {
  /** 界面切换：登录/选服共用登录曲，选人独立曲目，其余静音 */
  setScreen(k: UiScreenKind) {
    kind = k;
    uiSfxOn = k === 'login' || k === 'charSelect';
    applyMusic();
  },
  /** 预留：返回/取消按钮专用音效 */
  back() { playSfx(SFX_BACK); },
};
