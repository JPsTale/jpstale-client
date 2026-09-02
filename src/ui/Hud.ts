import { decodeTextureAsync } from '../core/texture.js';
import type { GameClock } from './GameClock.js';

export interface HudState {
  hp: number; maxHp: number
  mp: number; maxMp: number
  stm: number; maxStm: number
  exp: number; maxExp: number
  level: number
  playerName: string
  gameClock?: GameClock
}

export interface Hud {
  show(state: HudState): void
  hide(): void
  dispose(): void
}

const W = 1280
const H = 720

interface Tex { el: HTMLImageElement; w: number; h: number }

// 需要做黑色透明化的纹理（按钮/图标类，黑色=背景）
const TRANSPARENT_KEYS = new Set(['b0','b1','b2','b3','b4','b5','walk','cam1','cam2','mapOn','sun','moon','gageL','gageR','fist'])

const TEXTURES: Record<string, string> = {
  menu1: 'inter/menu-1.tga',
  menu2: 'inter/menu-2.tga',
  life: 'inter/bar_life.bmp',
  mana: 'inter/bar_mana.bmp',
  stm: 'inter/bar_stamina.bmp',
  exp: 'inter/sinGage/bar_exp.bmp',
  potionBack: 'inven/potionback.bmp',
  fist: 'skill/skill_normal.bmp',
  b0: 'inter/bstatus.bmp', b1: 'inter/binventory.bmp', b2: 'inter/bskill.bmp',
  b3: 'inter/bparty.bmp', b4: 'inter/bquest.bmp', b5: 'inter/bsystem.bmp',
  walk: 'inter/Button/walk.bmp',
  cam1: 'inter/Button/autocameraimage.bmp',
  cam2: 'inter/Button/pixcameraimage.bmp',
  mapOn: 'inter/Button/maponimage.bmp',
  sun: 'inter/Flash/sun.bmp',
  moon: 'inter/Flash/moon.bmp',
  barTime: 'inter/sinGage/bar_time.bmp',
  gageL: 'skill/p-skill.bmp',
  gageR: 'skill/p-skill2.bmp',
  inter1: 'inter/inter_01.bmp', inter2: 'inter/inter_02.bmp', inter3: 'inter/inter_03.bmp',
};

async function loadTex(rel: string, key: string): Promise<Tex | null> {
  const url = '/res/image/sinimage/' + rel;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const buf = await resp.arrayBuffer();
    const decoded = await decodeTextureAsync(buf);
    if (!decoded) return null;
    // 仅对按钮/图标类纹理做黑色透明化，TGA/背景类不做
    if (TRANSPARENT_KEYS.has(key)) {
      for (let i = 0; i < decoded.pixels.length; i += 4) {
        if (decoded.pixels[i] === 0 && decoded.pixels[i+1] === 0 && decoded.pixels[i+2] === 0) {
          decoded.pixels[i+3] = 0;
        }
      }
    }
    const c = document.createElement('canvas');
    c.width = decoded.width;
    c.height = decoded.height;
    const cx = c.getContext('2d')!;
    cx.putImageData(new ImageData(new Uint8ClampedArray(decoded.pixels), decoded.width, decoded.height), 0, 0);
    const el = new Image();
    el.src = c.toDataURL();
    await new Promise<void>(r => { el.onload = () => r(); el.onerror = () => r(); });
    return { el, w: decoded.width, h: decoded.height };
  } catch { return null; }
}

export function createHud(container: HTMLElement): Hud {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  canvas.style.position = 'fixed';
  canvas.style.inset = '0';
  canvas.style.zIndex = '55';
  canvas.style.pointerEvents = 'none';
  container.appendChild(canvas);

  const ctx = canvas.getContext('2d')!;
  let currentState: HudState | null = null;
  const textures: Partial<Record<string, Tex>> = {};
  let rafId = 0;

  function fitCanvas() {
    const scale = Math.min(window.innerWidth / W, window.innerHeight / H);
    canvas.style.width = `${W * scale}px`;
    canvas.style.height = `${H * scale}px`;
    canvas.style.left = `${(window.innerWidth - W * scale) / 2}px`;
    canvas.style.top = `${(window.innerHeight - H * scale) / 2}px`;
  }

  function drawTex(name: string, x: number, y: number, w: number, h: number) {
    const t = textures[name];
    if (!t?.el) return;
    ctx.drawImage(t.el, x, y, w, h);
  }

  function drawBar(name: string, x: number, y: number, w: number, h: number, value: number, max: number) {
    const t = textures[name];
    if (!t?.el) return;
    const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
    const fillH = Math.max(1, Math.round(t.h * ratio));
    const sy = t.h - fillH;
    const dh = h * ratio;
    ctx.drawImage(t.el, 0, sy, t.w, fillH, x, y + h - dh, w, dh);
  }

  function draw() {
    if (!currentState) return;
    ctx.clearRect(0, 0, W, H);

    // 原版渲染顺序：Menu背景 → inter条 → 条 → 按钮
    // Menu背景 (原版 (288,472) 256x128 + (544,536) 256x64)
    drawTex('menu1', 288, 472, 256, 128);
    drawTex('menu2', 544, 536, 256, 64);

    // 右侧inter装饰条
    drawTex('inter1', 800, 720 - 64, 66, 64);
    drawTex('inter2', 866, 720 - 64, 64, 64);
    drawTex('inter3', 930, 720 - 64, 40, 64);

    // 条填充 (bottom-up)
    drawBar('life', 319, 500, 16, 94, currentState.hp, currentState.maxHp);
    drawBar('mana', 465, 500, 16, 94, currentState.mp, currentState.maxMp);
    drawBar('stm', 303, 518, 8, 76, currentState.stm, currentState.maxStm);

    // 默认拳头图标 (技能条区域，49x46，居中于gage区域)
    // 左拳: gage区域 x=338,w=16 → 中心346，拳头49宽 → x=346-24=322
    // 右拳: gage区域 x=446,w=16 → 中心454，拳头49宽 → x=454-24=430
    drawTex('fist', 322, 556, 49, 46);
    drawTex('fist', 430, 556, 49, 46);

    // EXP条
    drawBar('exp', 485, 508, 6, 86, currentState.exp, currentState.maxExp);

    // 日月时钟
    const clock = currentState.gameClock;
    const hour = clock ? clock.getHour() : 12;
    const min = clock ? clock.getMin() : 0;
    const isDay = hour >= 4 && hour < 22;
    
    drawTex(isDay ? 'sun' : 'moon', isDay ? 363 : 426, 589, 13, 13);
    
    const barTex = textures['barTime'];
    if (barTex?.el) {
      let fill: number;
      if (isDay) {
        fill = Math.floor(50 * ((hour - 4) * 60 + min) / (19 * 60));
      } else {
        fill = Math.floor(50 * ((hour + 1) * 60 + min) / (5 * 60));
      }
      fill = Math.max(0, Math.min(50, fill));
      ctx.drawImage(barTex.el, 0, 0, fill, 5, 375, 593, fill, 5);
    }

    // 药水槽背景 (原版 (495,565) 77x25)
    drawTex('potionBack', 495, 565, 77, 25);

    // 功能按钮
    drawTex('walk', 575, 565, 24, 25);
    drawTex('cam1', 599, 565, 24, 25);
    drawTex('mapOn', 623, 565, 24, 25);

    for (let t = 0; t < 6; t++) {
      drawTex('b' + t, 648 + t * 25, 560, 25, 27);
    }
  }

  function loop() {
    draw();
    rafId = requestAnimationFrame(loop);
  }

  async function loadAllTextures() {
    const keys = Object.keys(TEXTURES);
    const loaded = await Promise.all(keys.map(k => loadTex(TEXTURES[k], k)));
    keys.forEach((k, i) => { if (loaded[i]) textures[k] = loaded[i]!; });
  }

  window.addEventListener('resize', fitCanvas);
  fitCanvas();
  loadAllTextures().then(loop);

  return {
    show(state: HudState) {
      currentState = state;
      canvas.style.display = 'block';
    },
    hide() {
      canvas.style.display = 'none';
      currentState = null;
    },
    dispose() {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', fitCanvas);
      canvas.remove();
    }
  };
}
