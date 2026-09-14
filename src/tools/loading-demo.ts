/**
 * 加载页进度条调试页 —— 开发时打开 `http://localhost:5173/loading-demo.html`。
 *
 * 为什么需要它（用户 2026-09-14："非要登录、进入游戏才能看到一瞬间"）：进度条只在**进图**那一瞬间可见，
 * 而它的位置/尺寸要靠像素级微调，每改一次都要登录+进图看一眼，根本没法调。
 *
 * ★ 它**复用真实的 `createLoadingScreen`**，只从外部改 `[data-role="progress"]` 那一层的样式 ——
 *   所以这里看到的效果与游戏里**是同一份实现**（不是另画一个"看着像"的进度条，那样调完还得猜是否一致）。
 *   调好后把面板底部打出来的 CSS 抄进 `ui/LoadingScreen.ts` 的 `boxFill` 即可。
 *
 * 坐标换算依据：`box.png` 里"小框"的内沿（实测，见 LoadingScreen 里 boxFill 的注释）
 *   与框自身的定位常量（`left:50%/margin-left:-227px`、`top:calc(100% - 147px)`）。
 */
import { createLoadingScreen, PROGRESS_FILL } from '../ui/LoadingScreen.js';
import { clearAssetCache } from '../core/asset-cache.js';

const stage = document.getElementById('stage')!;
// manualProgressText：右下角那行字节文本由本页自己填（这里没有真实下载，默认逻辑会把它清空）
const screen = createLoadingScreen(stage, { manualProgressText: true });
screen.show('正在进入 纳维斯克城');

const root = stage.querySelector<HTMLElement>('#loading-screen')!;
const fill = root.querySelector<HTMLElement>('[data-role="progress"]')!;
/** 右下角那行"已下载 / 总量 · 速度"（游戏里由 assetProgress 驱动，这里模拟） */
const bytesEl = root.querySelector<HTMLElement>('[data-role="bytes"]')!;
/** 模拟的下载总量（MB）：用来算出"随进度变化"的已下载量 */
const SIM_TOTAL_MB = 32;

/** box.png 里小框的内沿（相对 455×90 的图；实测值） */
const INNER = { left: 94, top: 1, right: 355, bottom: 30 };
/** 框在 LoadingScreen 里的定位常量 */
const BOX = { halfW: 227, topOffset: 147 };

/**
 * 当前参数 —— **初值直接取自实现的 `PROGRESS_FILL`**（单一来源）。
 * ⚠ 这里曾经自己写了一份默认值，于是"在调试页调好的效果"与"刷新后看到的"不相等：
 *   调完的值只进了实现、调试页刷新又回到自己那份旧默认值（用户 2026-09-14 报的现象）。
 *   现在从实现读 ⇒ 你把调好的值给我、我改进 `PROGRESS_FILL`、你刷新看到的就是新值。
 */
// 显式类型：`PROGRESS_FILL` 用了 `as const`，字段是字面量类型（`4` / `"#48e70d"`），
// 直接展开会让 st 继承那些窄类型而无法再赋值 —— 这里要的是"可调的当前值"。
const st: {
  pct: number; top: number; bottom: number; left: number; right: number;
  color: string; alpha: number; radius: number; showBytes: boolean; speedKBs: number;
} = {
  pct: 62,
  ...PROGRESS_FILL.inset,
  color: PROGRESS_FILL.color,
  alpha: PROGRESS_FILL.alpha,
  radius: PROGRESS_FILL.radius,
  showBytes: true,
  speedKBs: 399,   // 填 0 → 显示 `-- KB/s`（走缓存那种情况）
};

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const cssEl = document.createElement('pre');
const pctLabel = document.createElement('span');

function apply(): void {
  const left = INNER.left + st.left;
  const top = INNER.top + st.top;
  const maxW = INNER.right - INNER.left - st.left - st.right;
  const h = INNER.bottom - INNER.top - st.top - st.bottom;
  fill.style.left = `calc(50% - ${BOX.halfW - left}px)`;
  fill.style.top = `calc(100% - ${BOX.topOffset - top}px)`;
  fill.style.height = h + 'px';
  fill.style.maxWidth = maxW + 'px';
  fill.style.width = Math.round(maxW * st.pct / 100) + 'px';
  fill.style.background = rgba(st.color, st.alpha);
  fill.style.borderRadius = st.radius + 'px';
  pctLabel.textContent = st.pct + '%  (宽 ' + Math.round(maxW * st.pct / 100) + 'px)';
  // 右下角那行：游戏里是"已加载 @ 速度"（真实数据）。这里按进度模拟出同样的格式，
  // 便于看清它随进度变化的样子与位置（速度用固定值，本地没法模拟真实速率）。
  if (st.showBytes) {
    const loaded = SIM_TOTAL_MB * st.pct / 100;
    const speed = st.speedKBs > 0 ? `${Math.round(st.speedKBs)}KB/s` : '-- KB/s';
    bytesEl.textContent = `${loaded.toFixed(1)} MB @ ${speed}`;
  } else {
    bytesEl.textContent = '';
  }
  cssEl.textContent = [
    `left: calc(50% - ${BOX.halfW - left}px);   // → 距框左 ${left}px`,
    `top: calc(100% - ${BOX.topOffset - top}px);   // → 距框顶 ${top}px`,
    `height: ${h}px;   max-width: ${maxW}px;   width = ${maxW} * pct;`,
    `background: ${rgba(st.color, st.alpha)};`,
    `border-radius: ${st.radius}px;`,
    `余量 → 上 ${st.top}  下 ${st.bottom}  左 ${st.left}  右 ${st.right}`,
  ].join('\n');
}

// ─────────── 控制面板 ───────────
const panel = document.createElement('div');
panel.id = 'panel';

function row(labelText: string, control: HTMLElement): void {
  const l = document.createElement('label');
  const s = document.createElement('span');
  s.textContent = labelText;
  l.append(s, control);
  panel.append(l);
}

function num(get: () => number, set: (v: number) => void): HTMLInputElement {
  const i = document.createElement('input');
  i.type = 'number';
  i.value = String(get());
  i.addEventListener('input', () => { set(Number(i.value) || 0); apply(); });
  return i;
}

const h = document.createElement('h3');
h.textContent = '加载页进度条 · 实时调试';
panel.append(h);

const pctRange = document.createElement('input');
pctRange.type = 'range';
pctRange.min = '0';
pctRange.max = '100';
pctRange.value = String(st.pct);
pctRange.addEventListener('input', () => { st.pct = Number(pctRange.value); apply(); });
const pctRow = document.createElement('label');
const pctText = document.createElement('span');
pctText.textContent = '进度';
pctRow.append(pctText, pctRange, pctLabel);
panel.append(pctRow);

// 「自动播放」：让进度自己涨（1%/60ms，满则回 0）—— 真实加载时进度是动的，
// 静态摆一个 62% 看不出"涨过去"的观感（用户 2026-09-14："别搞一个纯静态的"）。
let autoTimer = 0;
const autoChk = document.createElement('input');
autoChk.type = 'checkbox';
autoChk.addEventListener('change', () => {
  if (autoChk.checked) {
    autoTimer = window.setInterval(() => {
      st.pct = st.pct >= 100 ? 0 : st.pct + 1;
      pctRange.value = String(st.pct);
      apply();
    }, 60);
  } else if (autoTimer) {
    window.clearInterval(autoTimer);
    autoTimer = 0;
  }
});
row('自动播放', autoChk);

/** ±5% 步进（拖滑块不容易停在整值上） */
function mkStep(delta: number): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = (delta > 0 ? '+' : '') + delta + '%';
  b.onclick = () => {
    st.pct = Math.max(0, Math.min(100, st.pct + delta));
    pctRange.value = String(st.pct);
    apply();
  };
  return b;
}
const stepWrap = document.createElement('span');
stepWrap.style.cssText = 'display:flex;gap:4px;';
stepWrap.append(mkStep(-5), mkStep(5));
row('步进', stepWrap);

/** 右下角那行"已下载 / 总量 · 速度"是否显示（便于对比有无它的观感） */
const bytesChk = document.createElement('input');
bytesChk.type = 'checkbox';
bytesChk.checked = st.showBytes;
bytesChk.addEventListener('change', () => { st.showBytes = bytesChk.checked; apply(); });
row('显示下载行', bytesChk);

/**
 * 模拟速度（KB/s）：填 0 就显示 `-- KB/s`（游戏里"走缓存、没有网络活动"就是这种形态）——
 * 用来确认那一段的排版在两种状态下都不难看。
 */
const speedIn = document.createElement('input');
speedIn.type = 'number';
speedIn.value = String(st.speedKBs);
speedIn.addEventListener('input', () => { st.speedKBs = Number(speedIn.value) || 0; apply(); });
row('速度 KB/s', speedIn);

const sep1 = document.createElement('div');
sep1.className = 'sep';
panel.append(sep1);
row('上余量', num(() => st.top, (v) => { st.top = v; }));
row('下余量', num(() => st.bottom, (v) => { st.bottom = v; }));
row('左余量', num(() => st.left, (v) => { st.left = v; }));
row('右余量', num(() => st.right, (v) => { st.right = v; }));

const sep2 = document.createElement('div');
sep2.className = 'sep';
panel.append(sep2);

const colorIn = document.createElement('input');
colorIn.type = 'color';
colorIn.value = st.color;
colorIn.addEventListener('input', () => { st.color = colorIn.value; apply(); });
row('颜色', colorIn);

const alphaIn = document.createElement('input');
alphaIn.type = 'range';
alphaIn.min = '0';
alphaIn.max = '1';
alphaIn.step = '0.01';
alphaIn.value = String(st.alpha);
alphaIn.addEventListener('input', () => { st.alpha = Number(alphaIn.value); apply(); });
row('不透明度', alphaIn);

row('圆角', num(() => st.radius, (v) => { st.radius = v; }));

const sep3 = document.createElement('div');
sep3.className = 'sep';
panel.append(sep3);

const btn = document.createElement('button');
btn.textContent = '复制参数';
btn.onclick = () => {
  const text = cssEl.textContent ?? '';
  void navigator.clipboard.writeText(text).then(
    () => { btn.textContent = '已复制 ✓'; setTimeout(() => { btn.textContent = '复制参数'; }, 1200); },
    () => { btn.textContent = '复制失败'; },
  );
};
panel.append(btn, cssEl);

/**
 * 清空资产缓存（内存 + **IndexedDB**）—— 想在真实游戏里看到"进度在涨"必须先清它：
 * 资产的三级缓存是 内存 → IndexedDB → 网络，而 **DevTools 的 "Disable cache" 只作用于 HTTP 缓存**，
 * 管不到我们的 IndexedDB，于是不清的话进游戏全是缓存命中、根本看不到下载。
 */
const btnClear = document.createElement('button');
btnClear.textContent = '清空资产缓存';
btnClear.style.marginTop = '6px';
btnClear.onclick = () => {
  void clearAssetCache().then(
    () => {
      btnClear.textContent = '已清空 ✓ 现在去进游戏';
      setTimeout(() => { btnClear.textContent = '清空资产缓存'; }, 2500);
    },
    () => { btnClear.textContent = '清空失败'; },
  );
};
panel.append(btnClear);

const hint = document.createElement('div');
hint.className = 'hint';
hint.textContent = '小框内沿（实测）: 左 94 / 上 1 / 右 355 / 下 30。改完把上面那几行发给 AI 即可。';
panel.append(hint);

document.body.append(panel);
apply();
