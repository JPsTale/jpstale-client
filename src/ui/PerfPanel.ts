/**
 * 性能剖析面板（**Ctrl+Shift+P** 开关）。
 *
 * 与游戏内日志面板（Ctrl+Shift+L）同构：纯 DOM 覆盖层、不依赖 React、不进主循环。
 * 数据全部来自 `app/profiler.ts`（唯一采样点），这里只负责排版与刷新。
 *
 * 面板分两块：
 *  1. **帧时间轴**（canvas）：横轴每帧一根柱，柱高 = 该帧总时长，按阶段自下而上堆叠
 *     （再往上是"未插桩的 JS"与"非 JS"）。掉帧的尖刺、以及尖刺与"怪物数"折线的关系一眼可见
 *     —— 这正是"怪物一多就卡"要看的证据。
 *  2. **文本报告**：最近若干帧的平均/峰值表 + 场景计数器 + 「导出 JSON」（逐帧明细，用于离线排查）。
 *
 * 刷新率 250ms：面板若跟着每帧刷新，它自己就会变成开销的一部分，测量结果不可信。
 * 表格与图例取自 `summarizeRecent()`（最近 N 帧）而不是 `report()`（1s 滚动窗口）——
 * 这样**和时间轴右侧的柱子同源**，读起来对得上，也不会每刷新一次就跳。
 */

import { buildExport, formatReport, frameHistory, summarizeRecent, slowFrames, type FrameHistory, type PerfReport } from '../app/profiler.js';
import { cacheStats, kindUsage } from '../core/asset-manager.js';

const REFRESH_MS = 250;
/** 时间轴纵轴按这个帧数聚合表格与图例（≈4s @60fps；掉帧时对应更长的时间） */
const SUMMARY_FRAMES = 240;
/** 时间轴画布高度（CSS px）；柱子按实际可用宽度铺满，不缩放 */
const TL_H = 116;
const PLOT_PAD_TOP = 13;

/**
 * 阶段配色（按首次出现顺序取色）。**必须够 16 个**：主循环有 16 个阶段，色板只有 10 个时
 * 会循环复用 —— 实测"怪物"与"3D提交"撞成同一种粉色，图例里两段同色等于没有图例。
 */
const PALETTE = [
  '#4ea1ff', '#ff8f4e', '#7bd88f', '#e06c9f', '#c9a227',
  '#8f7bff', '#4ecdc4', '#ff6b6b', '#9fb0c4', '#5f9ea0',
  '#d4a373', '#a3d977', '#c77dff', '#ffd166', '#6cb2eb', '#f4978e',
];
const COLOR_UNINSTRUMENTED = '#3a4a5c';
const COLOR_NON_JS = '#242c36';

let panel: HTMLDivElement | null = null;
let bodyEl: HTMLPreElement | null = null;
let titleEl: HTMLSpanElement | null = null;
let canvas: HTMLCanvasElement | null = null;
let cvCtx: CanvasRenderingContext2D | null = null;
let detailEl: HTMLDivElement | null = null;
let legendEl: HTMLDivElement | null = null;
let hist: FrameHistory | null = null;
let timer: number | null = null;
let keyHandler: ((e: KeyboardEvent) => void) | null = null;
let visible = false;
let installed = false;
/** 纵轴定标用的排序缓冲（模块级复用，避免每次刷新都分配） */
let peakBuf = new Float32Array(4096);

function drawTimeline(): void {
  if (!cvCtx || !canvas) return;
  const h = frameHistory();
  hist = h;
  const W = canvas.clientWidth;
  if (W <= 0) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pw = Math.max(1, Math.floor(W * dpr)), ph = Math.max(1, Math.floor(TL_H * dpr));
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw; canvas.height = ph;
    canvas.style.height = TL_H + 'px';
  }
  const ctx = cvCtx;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0b0f14';
  ctx.fillRect(0, 0, W, TL_H);

  const plotTop = PLOT_PAD_TOP;
  const plotH = TL_H - plotTop;
  if (h.count === 0) {
    ctx.fillStyle = '#5c6b7d';
    ctx.font = '11px ui-monospace,Consolas,monospace';
    ctx.fillText('（还没有帧数据）', 6, TL_H / 2);
    return;
  }

  // 显示最近 N 帧（1px 一帧，无间隙：相邻柱挨着才看得清单帧）
  const shown = Math.min(h.count, Math.floor(W));
  const from = h.count - shown;

  // 纵轴定标用 **p99 而不是 max**：一个 100ms 的尖刺会把纵轴拉长一倍，把正常帧全压扁
  // （实测踩过：全部柱子只剩三分之一高，看不出 25ms 与 40ms 的差别）。超视野的柱子裁到顶
  // 并用红帽标出，峰值另在右上角写明 —— 既不丢信息，又看得清常态差异。
  if (peakBuf.length < shown) peakBuf = new Float32Array(Math.max(shown, 4096));
  let entMax = 0, absMax = 0;
  for (let i = from; i < h.count; i++) {
    peakBuf[i - from] = h.frameMs[i];
    if (h.entities[i] > entMax) entMax = h.entities[i];
    if (h.frameMs[i] > absMax) absMax = h.frameMs[i];
  }
  const sorted = peakBuf.subarray(0, shown);
  sorted.sort();
  const p99 = sorted[Math.min(shown - 1, Math.floor(shown * 0.99))];
  const peak = Math.max(33.4, p99) * 1.05;
  const yOf = (ms: number) => plotTop + plotH - (ms / peak) * plotH;

  // 60fps / 30fps 参考线
  const drawRef = (ms: number, label: string, color: string) => {
    const y = yOf(ms);
    if (y < plotTop || y > TL_H) return;
    ctx.strokeStyle = color;
    ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.font = '9px ui-monospace,Consolas,monospace';
    ctx.fillText(label, 3, y - 2);
  };
  drawRef(16.67, '60fps 16.7ms', 'rgba(123,216,143,0.55)');
  drawRef(33.33, '30fps 33.3ms', 'rgba(201,162,39,0.55)');

  // 每帧一根柱：自下而上 阶段 → 未插桩JS → 非JS
  for (let i = from; i < h.count; i++) {
    const x = Math.round((i - from) * (W / shown));
    const w = Math.max(1, Math.round((i - from + 1) * (W / shown)) - x);
    const clipped = h.frameMs[i] > peak;
    let y = TL_H;
    let sum = 0;
    const row = i * h.stride;
    for (let s = 0; s < h.stageCount; s++) {
      const ms = h.stageMs[row + s];
      if (ms <= 0) continue;
      sum += ms;
      const hh = (ms / peak) * plotH;
      ctx.fillStyle = PALETTE[s % PALETTE.length];
      ctx.fillRect(x, Math.max(plotTop, y - hh), w, Math.min(hh, y - plotTop));
      y -= hh;
      if (y <= plotTop) break;
    }
    if (y > plotTop) {
      const un = h.jsMs[i] - sum;
      if (un > 0) {
        const hh = (un / peak) * plotH;
        ctx.fillStyle = COLOR_UNINSTRUMENTED;
        ctx.fillRect(x, Math.max(plotTop, y - hh), w, Math.min(hh, y - plotTop));
        y -= hh;
      }
    }
    if (y > plotTop) {
      const other = h.frameMs[i] - h.jsMs[i];
      if (other > 0) {
        const hh = (other / peak) * plotH;
        ctx.fillStyle = COLOR_NON_JS;
        ctx.fillRect(x, Math.max(plotTop, y - hh), w, Math.min(hh, y - plotTop));
      }
    }
    // 超出纵轴的帧：柱顶压一道红帽（等价于"这一帧比视野还慢"）
    if (clipped) { ctx.fillStyle = '#ff5252'; ctx.fillRect(x, plotTop, w, 2); }
  }

  // 右上角：定标与真实峰值（红了就说明有帧超出视野）
  ctx.fillStyle = '#7286a0';
  ctx.font = '9px ui-monospace,Consolas,monospace';
  ctx.fillText(`纵轴 0~${peak.toFixed(0)}ms(p99)  峰值 ${absMax.toFixed(0)}ms`, W - 150, plotTop + 9);

  // 怪物数折线（归一化到自身峰值，叠在柱子上方；用来把掉帧与实体数对上）
  if (entMax > 0) {
    ctx.strokeStyle = '#ffb347';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = from; i < h.count; i++) {
      const x = (i - from) * (W / shown) + 0.5;
      const y = plotTop + plotH - (h.entities[i] / entMax) * plotH;
      if (i === from) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = '#ffb347';
    ctx.fillText(`怪物 ${entMax.toFixed(0)}`, W - 62, plotTop + 20);
  }
}

/** 图例：取汇总里最贵的 6 段（与表格同源，颜色与时间轴一致） */
function renderLegend(sum: PerfReport): void {
  if (!legendEl || !hist) return;
  const idxOf = new Map(hist.stageNames.map((n, i) => [n, i]));
  const top = sum.sections.slice(0, 6).map((s) => s.name).reverse();
  legendEl.textContent = '';
  for (const name of top) {
    const i = idxOf.get(name);
    if (i === undefined) continue;
    const dot = document.createElement('span');
    dot.style.cssText = `display:inline-block;width:7px;height:7px;border-radius:1px;margin:0 3px 0 6px;background:${PALETTE[i % PALETTE.length]};`;
    legendEl.append(dot, document.createTextNode(name));
  }
}

/** 鼠标指向某帧 → 在时间轴下方显示该帧明细（不弹浮层，避免与游戏内光标逻辑纠缠） */
function onTimelineMove(e: PointerEvent): void {
  if (!detailEl || !canvas || !hist || hist.count === 0) return;
  const rect = canvas.getBoundingClientRect();
  const W = canvas.clientWidth;
  const shown = Math.min(hist.count, Math.floor(W));
  const x = e.clientX - rect.left;
  const slot = Math.floor((x / W) * shown);
  if (slot < 0 || slot >= shown) return;
  const i = hist.count - shown + slot;
  const parts: { name: string; ms: number }[] = [];
  for (let s = 0; s < hist.stageCount; s++) {
    const ms = hist.stageMs[i * hist.stride + s];
    if (ms >= 0.05) parts.push({ name: hist.stageNames[s], ms });
  }
  parts.sort((a, b) => b.ms - a.ms);
  detailEl.textContent =
    `第 ${hist.firstSeq + i} 帧  共 ${hist.frameMs[i].toFixed(1)}ms`
    + `（JS ${hist.jsMs[i].toFixed(1)} / 非JS ${Math.max(0, hist.frameMs[i] - hist.jsMs[i]).toFixed(1)}）`
    + `  怪物 ${hist.entities[i].toFixed(0)}`
    + (parts.length ? '  ｜ ' + parts.slice(0, 5).map((p) => `${p.name} ${p.ms.toFixed(1)}`).join(' · ') : '');
}

/** 导出用的环境信息：剖析器自己是零 DOM 的，视口/DPR/UA 只有这里能拿到 */
function exportMeta(): Record<string, unknown> {
  return {
    url: location.href,
    userAgent: navigator.userAgent,
    devicePixelRatio: window.devicePixelRatio,
    viewport: [window.innerWidth, window.innerHeight],
    screen: [screen.width, screen.height],
  };
}

/** 导出并下载为文件（用户不熟 devtools，所以走"点了就落在下载目录"，再把路径告诉我） */
function exportJson(): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const name = `perf-${stamp}.json`;
  const text = JSON.stringify(buildExport(exportMeta()));
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
  return `${name}（${(text.length / 1024).toFixed(0)}KB，已放到浏览器下载目录）`;
}

/**
 * 资产一块（下载 / 解析 / 缓存 / 堆）。
 *
 * 为什么放进性能面板：这几轮把资产层收成了 AssetManager（唯一入口 + 按 kind 统计 + LRU），
 * 而"贴图下载占多少、解析了多少次、缓存吃多少内存"恰恰是**帧时间之外最常要看的东西**
 * （很多"卡一下"不是每帧开销，而是资产在加载）。数据源就是 AssetManager 自己的账，
 * 不再需要外面写探针脚本去读。
 */
function assetSection(): string {
  const st = cacheStats();
  const mb = (b: number) => (b / 1048576).toFixed(1);
  const kinds = kindUsage().filter((k) => k.usage.bytes > 0 || k.usage.parsed > 0);
  const lines: string[] = [];
  const heap = st.heapUsedBytes !== null ? `  JS堆 ${mb(st.heapUsedBytes)}MB` : '';
  lines.push(`缓存 ${st.entries}/${st.maxEntries} 条  ${mb(st.cachedBytes)}/${mb(st.byteLimit)}MB${heap}`);
  for (const k of kinds) {
    const name = k.kind.length >= 13 ? k.kind : k.kind + ' '.repeat(13 - k.kind.length);
    lines.push(`  ${name} 下载${padL(mb(k.usage.bytes) + 'MB', 8)}  命中${padL(String(k.usage.hits), 5)}  解析${padL(String(k.usage.parsed), 5)}`);
  }
  return lines.join('\n');
}

/** 最慢的几帧 + 那帧贵在哪（掉帧现场不用再手动扫时间轴） */
function slowSection(): string {
  const frames = slowFrames(5);
  if (!frames.length) return '';
  const lines = ['最慢的 5 帧（窗口内）'];
  for (const f of frames) {
    lines.push(`  #${padL(String(f.seq), 5)}  ${padL(f.frameMs.toFixed(1) + 'ms', 9)} JS ${padL(f.jsMs.toFixed(1), 6)}  怪 ${padL(String(f.entities), 4)}  `
      + f.top.map((t) => `${t.name} ${t.ms.toFixed(1)}`).join(' · '));
  }
  return lines.join('\n');
}

function padL(s: string, w: number): string {
  return s.length >= w ? s : ' '.repeat(w - s.length) + s;
}

function refresh(): void {
  if (!panel || panel.style.display === 'none') return;
  drawTimeline();
  const sum = summarizeRecent(SUMMARY_FRAMES);
  renderLegend(sum);
  if (bodyEl) {
    bodyEl.textContent = formatReport(sum)
      + '\n\n资产（本次会话）\n' + assetSection()
      + '\n\n' + slowSection();
  }
}

function buildPanel(): void {
  panel = document.createElement('div');
  panel.style.cssText = [
    'position:fixed', 'right:8px', 'top:8px', 'width:480px',
    'z-index:100000', 'display:none', 'flex-direction:column',
    'background:rgba(8,12,18,.92)', 'border:1px solid #39465a', 'border-radius:6px',
    'font:12px/1.45 ui-monospace,Consolas,monospace', 'color:#dce6f2',
  ].join(';');

  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 8px;border-bottom:1px solid #39465a;';
  titleEl = document.createElement('span');
  titleEl.textContent = '性能剖析';
  titleEl.title = '快捷键 Ctrl+Shift+P 开关';
  titleEl.style.cssText = 'flex:1;color:#9fb0c4;';
  const mkBtn = (label: string, hint: string, fn: () => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = hint;
    b.style.cssText = 'cursor:pointer;background:#22303f;color:#cfe0f0;border:1px solid #39465a;border-radius:3px;padding:1px 7px;';
    b.onclick = fn;
    return b;
  };
  const btnExport = mkBtn('导出文件', '下载含逐帧明细的 JSON 到浏览器下载目录', () => {
    if (titleEl) titleEl.textContent = '已导出 ' + exportJson();
  });
  // 下载在部分环境下不可用（沙箱/权限），剪贴板是可靠兜底：逐帧明细是排查的全部依据
  const btnCopyJson = mkBtn('复制JSON', '把完整逐帧明细（含各阶段时间序列）复制到剪贴板', () => {
    const text = JSON.stringify(buildExport(exportMeta()));
    void navigator.clipboard.writeText(text).then(
      () => { if (titleEl) titleEl.textContent = `已复制完整 JSON（${(text.length / 1024).toFixed(0)}KB）`; },
      (e) => { if (titleEl) titleEl.textContent = '复制失败：' + String(e); },
    );
  });
  const btnCopy = mkBtn('复制摘要', '复制窗口汇总表（小，可直接贴出来）', () => {
    const text = bodyEl?.textContent ?? '';
    // 失败必须可见（否则"复制了但没生效"无从判断）
    void navigator.clipboard.writeText(text).then(
      () => { if (titleEl) titleEl.textContent = '摘要已复制 ✓'; },
      (e) => { if (titleEl) titleEl.textContent = '复制失败：' + String(e); },
    );
  });
  bar.append(titleEl, btnExport, btnCopyJson, btnCopy);

  const wrap = document.createElement('div');
  wrap.style.cssText = 'padding:6px 8px 0;';
  canvas = document.createElement('canvas');
  canvas.style.cssText = 'display:block;width:100%;height:' + TL_H + 'px;background:#0b0f14;border:1px solid #22303f;border-radius:3px;';
  cvCtx = canvas.getContext('2d');
  canvas.addEventListener('pointermove', onTimelineMove);
  canvas.addEventListener('pointerleave', () => { if (detailEl) detailEl.textContent = '把鼠标移到柱子上可看那一帧的明细'; });
  legendEl = document.createElement('div');
  legendEl.style.cssText = 'padding:3px 0 0;color:#9fb0c4;font-size:11px;';
  detailEl = document.createElement('div');
  detailEl.style.cssText = 'padding:2px 0 5px;color:#dce6f2;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
  detailEl.textContent = '把鼠标移到柱子上可看那一帧的明细';
  wrap.append(canvas, legendEl, detailEl);

  bodyEl = document.createElement('pre');
  bodyEl.style.cssText = 'margin:0;padding:6px 8px;user-select:text;white-space:pre;overflow:auto;max-height:34vh;border-top:1px solid #22303f;';

  panel.append(bar, wrap, bodyEl);
  document.body.appendChild(panel);
}

function toggle(): void {
  if (!panel) buildPanel();
  visible = !visible;
  panel!.style.display = visible ? 'flex' : 'none';
  if (visible) {
    refresh();
    timer = window.setInterval(refresh, REFRESH_MS);
  } else if (timer !== null) {
    window.clearInterval(timer);
    timer = null;
  }
}

/**
 * 卸载（**HMR 必须调**）：Vite 热替换本模块时旧实例的 `window` 监听器不会自动消失，
 * 于是每热更新一次就多一个"快捷键 → 就多开一个面板"（实测：屏幕上出现两个面板，
 * 而 `__pt.perf.toggle()` 只能管到新实例的那一个）。
 */
function destroy(): void {
  if (timer !== null) { window.clearInterval(timer); timer = null; }
  if (keyHandler) { window.removeEventListener('keydown', keyHandler); keyHandler = null; }
  panel?.remove();
  panel = null; bodyEl = null; titleEl = null; canvas = null; cvCtx = null;
  detailEl = null; legendEl = null; hist = null;
  visible = false; installed = false;
}

if (import.meta.hot) import.meta.hot.dispose(destroy);

/** 挂载：绑定快捷键。重复调用无副作用。 */
export function installPerfPanel(): void {
  if (installed) return;
  installed = true;
  keyHandler = (e: KeyboardEvent) => {
    // Ctrl+Shift+P（避开 F1-F12 / WASD / 数字键 / Tab / 空格，也不与日志面板的 Ctrl+Shift+L 冲突）
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyP') {
      e.preventDefault();
      toggle();
    }
  };
  window.addEventListener('keydown', keyHandler);
}

export function togglePerfPanel(): void {
  toggle();
}
