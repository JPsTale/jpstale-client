import { decodeTextureAsync } from '../core/texture.js';
import type { GameClock } from './GameClock.js';
import { t } from '../i18n/index.js';
import { getGameSnapshot, subscribeGame, type FistBinding } from '../app/gameStore.js';

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
  /** 用户动作回调（走跑按钮 / 系统按钮 / 角色状态按钮 / 技能面板按钮等） */
  onAction?: (action: 'toggleRun' | 'system' | 'status' | 'skills') => void
}

const W = 1280
const H = 720

interface Tex { el: HTMLImageElement; w: number; h: number }

// 需要做黑色透明化的纹理（按钮/图标类，黑色=背景）
const TRANSPARENT_KEYS = new Set([
  'b0','b1','b2','b3','b4','b5','walk','cam1','cam2','mapOn','sun','moon','gageL','gageR','fist',
  'i0','i1','i2','i3','i4','i5','iWalk','iRun','iCamHand','iCamFix','iCamAuto','iMapOn','iMapOff',
  'fistL','fistR',
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

  // 点击拦截：不对 HUD 底部整带设一个 pointer-events:auto 大坝（会吞掉玩家在空白
  // 区的移动点击），而是仅在真正的交互控件矩形上覆盖小的 pointer-events:auto 层。
  // 因此点 HUD 时世界画布收不到事件（不误触移动），点按钮旁的底带空白处则正常穿透移动。
  // 各矩形为内容坐标（800×600），fitCanvas 换算为物理坐标。坐标与 draw() 中按钮一致。
  const INTERACT_RECTS = [
    { x: 569, y: 555, w: 26, h: 26 }, // 走跑
    { x: 599, y: 565, w: 24, h: 25 }, // cam
    { x: 623, y: 565, w: 24, h: 25 }, // map
    { x: 648, y: 560, w: 25, h: 27 }, // b0
    { x: 673, y: 560, w: 25, h: 27 }, // b1
    { x: 698, y: 560, w: 25, h: 27 }, // b2
    { x: 723, y: 560, w: 25, h: 27 }, // b3
    { x: 748, y: 560, w: 25, h: 27 }, // b4
    { x: 773, y: 560, w: 25, h: 27 }, // b5
  ];
  const barriers = INTERACT_RECTS.map(() => {
    const el = document.createElement('div');
    el.style.position = 'fixed';
    el.style.zIndex = '56';
    el.style.display = 'none';
    el.style.pointerEvents = 'auto';
    container.appendChild(el);
    return el;
  });

  const ctx = canvas.getContext('2d')!;
  let currentState: HudState | null = null;
  const textures: Partial<Record<string, Tex>> = {};
  let rafId = 0;

  // 左/右拳当前装备的技能（HUD 拳位图标显示；null=普攻拳）
  const fistSlots: { left: FistBinding | null; right: FistBinding | null } = { left: null, right: null };

  // 把某拳位绑定异步加载成纹理（key fistL/fistR），成功后重绘。
  // binding=null（普攻）→ 用默认 fist 纹理（skill_normal），加载失败也回退默认。
  async function loadFistIcon(slot: 'left' | 'right', binding: FistBinding | null): Promise<void> {
    const key = slot === 'left' ? 'fistL' : 'fistR';
    if (!binding || !binding.iconFile || binding.iconFile === 'skill_normal') {
      delete textures[key];
      return;
    }
    const file = binding.iconFile.replace(/\.bmp$/i, '').split(' ').map(encodeURIComponent).join('%20');
    const rel = `skill/${binding.classDir}/button/${file}.bmp`;
    const tex = await loadTex(rel, key);
    if (tex) textures[key] = tex;
    else delete textures[key];
  }

  // 同步拳位绑定（equipFist/快捷键变化时刷新图标）；重载时回调触发重绘
  function syncFists(): void {
    const snap = getGameSnapshot();
    const needL = snap.fistBindings.left;
    const needR = snap.fistBindings.right;
    const lChanged = (fistSlots.left?.classDir !== needL?.classDir) || (fistSlots.left?.iconFile !== needL?.iconFile);
    const rChanged = (fistSlots.right?.classDir !== needR?.classDir) || (fistSlots.right?.iconFile !== needR?.iconFile);
    if (!lChanged && !rChanged) return;
    fistSlots.left = needL;
    fistSlots.right = needR;
    if (lChanged) void loadFistIcon('left', needL);
    if (rChanged) void loadFistIcon('right', needR);
  }
  // 订阅：装备/快捷键切换拳位 → 同步图标（世界内才重绘，无世界时也加载缓存无妨）
  const unsubFist = subscribeGame(syncFists);

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
    const wpx = W * scale;
    const hpx = H * scale;
    canvas.style.width = `${wpx}px`;
    canvas.style.height = `${hpx}px`;
    canvas.style.left = `${(window.innerWidth - wpx) / 2}px`;
    canvas.style.top = `${window.innerHeight - hpx}px`;
    // 拦截小层对齐各交互控件矩形（内容坐标 → 画布坐标：+240,+120，再按 scale）
    barriers.forEach((barrier, i) => {
      const r = INTERACT_RECTS[i];
      barrier.style.left = `${(window.innerWidth - wpx) / 2 + (r.x + 240) * scale}px`;
      barrier.style.top = `${window.innerHeight - hpx + (r.y + 120) * scale}px`;
      barrier.style.width = `${r.w * scale}px`;
      barrier.style.height = `${r.h * scale}px`;
    });
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

  let onAction: ((action: 'toggleRun' | 'system' | 'status' | 'skills') => void) | undefined;

  // 走跑按钮点击：下降沿触发（ptrDown false→true 只触发一次，按住不重复）
  let prevPtrDown = false;
  function checkButtonClick(): void {
    const justPressed = ptrDown && !prevPtrDown;
    prevPtrDown = ptrDown;
    if (!currentState || !justPressed) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || ptrX < rect.left || ptrX > rect.right || ptrY < rect.top || ptrY > rect.bottom) return;
    const s = rect.width / W;
    const mx = (ptrX - rect.left) / s - 240;
    const my = (ptrY - rect.top) / s - 120;
    if (mx >= 569 && mx < 595 && my >= 555 && my < 581) {
      onAction?.('toggleRun');
    }
    // 6 功能按钮（b0..b5）：b0=角色状态、b2=技能面板、b5=系统；其余面板未实现
    for (let bt = 0; bt < 6; bt++) {
      if (mx >= 648 + bt * 25 && mx < 648 + bt * 25 + 25 && my >= 560 && my < 587) {
        if (bt === 0) onAction?.('status');
        if (bt === 2) onAction?.('skills');
        if (bt === 5) onAction?.('system');
        break;
      }
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

    // 原版渲染顺序（sinMain sinDraw）：技能面板/拳位图标(cSkill.Draw)先画，
    // 主 HUD 菜单背景(cInterFace.Draw 的 MatMenu=menu1/menu2)后画。
    // menu-1/menu-2 的拳位是"圆形镂空"(圆内 alpha=0)，后画的主 HUD 会把拳位图标的
    // 方形黑底圆外部分盖住 → 呈现"圆形槽内技能图标"，而非方形黑底。
    // 故拳头/拳位技能图标必须先于 menu 背景绘制。
    drawTex(textures['fistL'] ? 'fistL' : 'fist', 349, 541, 49, 46);
    drawTex(textures['fistR'] ? 'fistR' : 'fist', 403, 541, 49, 46);

    // Menu背景 (原版 (288,472) 256x128 + (544,536) 256x64)
    drawTex('menu1', 288, 472, 256, 128);
    drawTex('menu2', 544, 536, 256, 64);

    // 右侧inter延伸条：本客户端资源 inter_01/02/03.bmp 为纯黑占位，无内容可画，跳过

    // 条填充 (bottom-up)
    drawBar('life', 319, 500, 16, 94, currentState.hp, currentState.maxHp);
    drawBar('mana', 465, 500, 16, 94, currentState.mp, currentState.maxMp);
    drawBar('stm', 303, 518, 8, 76, currentState.stm, currentState.maxStm);

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
      barriers.forEach((b) => { b.style.display = 'block'; });
    },
    hide() {
      canvas.style.display = 'none';
      barriers.forEach((b) => { b.style.display = 'none'; });
      currentState = null;
    },
    dispose() {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', fitCanvas);
      unsubFist();
      canvas.remove();
      barriers.forEach((b) => b.remove());
    },
    setRunFlag,
    get onAction() { return onAction; },
    set onAction(fn) { onAction = fn; },
  };
}
