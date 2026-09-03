import { decodeTextureAsync } from '../core/texture.js';
import type { GameClock } from './GameClock.js';
import { t } from '../i18n/index.js';

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
  /** 同步走/跑状态到 tooltip 展示 */
  setRunFlag(run: boolean): void
  /** 用户动作回调（走跑按钮等） */
  onAction?: (action: 'toggleRun') => void
}

const W = 1280
const H = 720

interface Tex { el: HTMLImageElement; w: number; h: number }

// 需要做黑色透明化的纹理（按钮/图标类，黑色=背景）
const TRANSPARENT_KEYS = new Set([
  'b0','b1','b2','b3','b4','b5','walk','cam1','cam2','mapOn','sun','moon','gageL','gageR','fist',
  'i0','i1','i2','i3','i4','i5','iWalk','iRun','iCamHand','iCamFix','iCamAuto','iMapOn','iMapOff',
])

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
  i0: 'inter/buttoninfo/statusinfo.bmp', i1: 'inter/buttoninfo/inveninfo.bmp',
  i2: 'inter/buttoninfo/skillinfo.bmp', i3: 'inter/buttoninfo/partyinfo.bmp',
  i4: 'inter/buttoninfo/questinfo.bmp', i5: 'inter/buttoninfo/systeminfo.bmp',
  iWalk: 'inter/buttoninfo/walk.bmp', iRun: 'inter/buttoninfo/run.bmp',
  iCamHand: 'inter/buttoninfo/camera_hand.bmp', iCamFix: 'inter/buttoninfo/camera_fix.bmp',
  iCamAuto: 'inter/buttoninfo/camera_auto.bmp',
  iMapOn: 'inter/buttoninfo/mapon.bmp', iMapOff: 'inter/buttoninfo/mapoff.bmp',
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

  // 指针（悬停/按下；HUD canvas 为 pointer-events:none，事件走 window 只读检测，不拦截世界点击）
  let ptrX = -1, ptrY = -1, ptrDown = false;
  // 功能/交互小状态（暂为 tooltip 用；后续动作接线后由行为更新）
  const uiState = { runFlag: true, camFlag: 2, mapOnFlag: true };
  window.addEventListener('pointermove', (e) => { ptrX = e.clientX; ptrY = e.clientY; });
  window.addEventListener('pointerdown', (e) => { if (e.button === 0) ptrDown = true; });
  window.addEventListener('pointerup', (e) => { if (e.button === 0) ptrDown = false; });

  function fitCanvas() {
    // 等比缩放，锚定窗口底边：HUD 始终贴底，只允许顶部留空，
    // 避免窗口变窄/变矮时画布垂直居中造成“越缩离底越远”。
    const scale = Math.min(window.innerWidth / W, window.innerHeight / H);
    canvas.style.width = `${W * scale}px`;
    canvas.style.height = `${H * scale}px`;
    canvas.style.left = `${(window.innerWidth - W * scale) / 2}px`;
    canvas.style.top = `${window.innerHeight - H * scale}px`;
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

  // 悬停反馈：把指针换算到内容(800×600)坐标后画 tooltip 泡泡/条数值（都在内容坐标）
  function drawHoverFx() {
    if (!currentState) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || ptrX < rect.left || ptrX > rect.right || ptrY < rect.top || ptrY > rect.bottom) return;
    const s = rect.width / W;
    const mx = (ptrX - rect.left) / s - 240;
    const my = (ptrY - rect.top) / s - 120;
    const hit = (x0: number, y0: number, x1: number, y1: number) => mx >= x0 && mx < x1 && my >= y0 && my < y1;

    // 小按钮 tooltip（原版 y536；map 泡泡与状态相反）
    if (!ptrDown) {
      if (hit(569, 555, 595, 581)) {
        drawTex(uiState.runFlag ? 'iRun' : 'iWalk', 575 + 12 - 38, 536, 77, 27);
      } else if (hit(595, 555, 621, 581)) {
        if (uiState.camFlag === 1) drawTex('iCamAuto', 575 + 26 + 13 - 38, 536, 77, 27);
        else drawTex(uiState.camFlag === 2 ? 'iCamFix' : 'iCamHand', 575 + 24 + 12 - 38, 536, 77, 27);
      } else if (hit(621, 555, 647, 581)) {
        drawTex(uiState.mapOnFlag ? 'iMapOff' : 'iMapOn', 575 + 48 + 12 - 38, 536, 77, 27);
      }
    }
    // 6 功能按钮 hover 泡泡（595+t*25,533）；按下时原版换 pressed sprite（缺资源）暂只隐泡泡
    for (let bt = 0; bt < 6; bt++) {
      if (hit(648 + bt * 25, 560, 648 + bt * 25 + 25, 587)) {
        if (!ptrDown) drawTex('i' + bt, 595 + bt * 25, 533, 77, 27);
        break;
      }
    }
    // HP/MP/STM 悬停数值（原版 ShowParaState 条右侧白字，无贴图）
    ctx.font = 'bold 12px "Microsoft YaHei", "Segoe UI", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 2;
    if (hit(315, 500, 337, 594)) ctx.fillText(t('hud.life', { cur: Math.round(currentState.hp), max: Math.round(currentState.maxHp) }), 343, 500);
    if (hit(463, 498, 483, 595)) ctx.fillText(t('hud.mana', { cur: Math.round(currentState.mp), max: Math.round(currentState.maxMp) }), 490, 498);
    if (hit(300, 513, 313, 595)) ctx.fillText(t('hud.stm', { cur: Math.round(currentState.stm), max: Math.round(currentState.maxStm) }), 320, 513);
    ctx.shadowBlur = 0;
  }

  function setRunFlag(run: boolean): void {
    uiState.runFlag = run;
  }

  let onAction: ((action: 'toggleRun') => void) | undefined;

  // 走跑按钮点击：内容坐标 (569,555,595,581) 内左键按下 → 上报动作（复用 pointerdown 记录）
  function checkButtonClick(): void {
    if (!currentState || !ptrDown) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || ptrX < rect.left || ptrX > rect.right || ptrY < rect.top || ptrY > rect.bottom) return;
    const s = rect.width / W;
    const mx = (ptrX - rect.left) / s - 240;
    const my = (ptrY - rect.top) / s - 120;
    if (mx >= 569 && mx < 595 && my >= 555 && my < 581) {
      onAction?.('toggleRun');
    }
  }

  function draw() {
    if (!currentState) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // 内容按原版 800×600 坐标绘制。1280×720 画布内平移：
    // 视觉中心 = HP/MP 条与左右技能图标的中点 x≈400（非整条背景中心）。
    // offX: 400 → 画布中心 640 => 240；offY: 600 底贴 720 → 120
    ctx.save();
    ctx.translate(240, 120);

    // 原版渲染顺序：Menu背景 → inter条 → 条 → 按钮
    // Menu背景 (原版 (288,472) 256x128 + (544,536) 256x64)
    drawTex('menu1', 288, 472, 256, 128);
    drawTex('menu2', 544, 536, 256, 64);

    // 右侧inter延伸条：本客户端资源 inter_01/02/03.bmp 为纯黑占位，无内容可画，跳过

    // 条填充 (bottom-up)
    drawBar('life', 319, 500, 16, 94, currentState.hp, currentState.maxHp);
    drawBar('mana', 465, 500, 16, 94, currentState.mp, currentState.maxMp);
    drawBar('stm', 303, 518, 8, 76, currentState.stm, currentState.maxStm);

    // 默认拳头图标 (原版 sinSkill.cpp sLeftRightSkill)
    // 左拳 (349,541) 49x46  右拳 (403,541) 49x46
    drawTex('fist', 349, 541, 49, 46);
    drawTex('fist', 403, 541, 49, 46);

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

    drawHoverFx();

    ctx.restore();
  }

  function loop() {
    draw();
    checkButtonClick();
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
    },
    setRunFlag,
    onAction: undefined, // main.ts 赋值
  };
}
