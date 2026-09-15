/**
 * 界面层的**激活栈** —— "谁被激活谁在最上"的**唯一实现**。
 *
 * ## 用法：声明即参与（**不要手动注册**）
 *
 * 给窗口元素加 data 属性即可，插入 DOM 就自动登记、移除就自动注销（`MutationObserver` 发现）：
 *
 * ```html
 * <div data-layer="panel:shop">…</div>                    <!-- 一扇窗（自己就是独立宿主） -->
 * <div data-layer="chat" data-layer-host="panels">…</div> <!-- 归属名为 panels 的宿主容器 -->
 * <div id="jp-react-panels" data-layer-host-container="panels">…</div>  <!-- 宿主容器 -->
 * ```
 *
 * - `data-layer`                    = 层名（同名多实例会被分别登记、按元素匹配注销）
 * - `data-layer-host="X"`           = 它归属哪个宿主容器（省略 = 独立，不需要容器合成）
 * - `data-layer-host-container="X"` = 声明"我是宿主 X 的容器"
 *
 * 为什么改成声明式（用户 2026-09-16）：**"所有 UI 面板应该都是这同一套逻辑吧？难道每次都要你
 * 手动加？"** —— 之前每加一扇窗都要手写 `registerLayer(...)`，于是我漏掉了 NPC 商店、拆分弹框、
 * 死亡面板，而且漏了没有任何提示（AGENTS #12：降级必须可见）。现在"参不参与排序、叫什么名字"
 * 写在元素自己身上：**新窗口只要带上 data 属性就自动进来**，不需要记得改这个文件。
 *
 * ## 三条不变量（都是踩坑换来的）
 *
 * 1. **登记的是"窗口"本身，不是它的全屏包裹层**。历史上世界地图自带一层 `.jp-wm` 全屏包裹
 *    （包裹层自己成了层叠上下文，把窗口 `.jp-wm-win` 永远关在里面，浮不到面板上面）——
 *    那套已经在 2026-09-16 并进 `PanelShell`（地图现在是普通面板），这条不变量仍适用于
 *    任何"容器 + 窗口"的结构。
 * 2. **宿主容器的 z-index = 组内当前最高层的值**（没有层时退回基准）：容器必须自己持有 z-index
 *    才能让整组压住世界层，但那又会让它成为层叠上下文 —— 合成值同时满足这两件事。
 * 3. **只写 `z-index`**，不碰 `display`/`pointer-events`。层栈只管"谁在上"。
 *    想临时提高优先级用内联 `zIndex` 覆盖即可，别写 `!important`（会把层栈整条链打断）。
 *
 * ## 刻意不参与的（不要给它们加 data-layer）
 *
 * 加载页（z 1400，必须永远压住一切）、开发工具（DevLog/Perf，100000）、常驻装饰
 * （持物图标 1300 / 悬停信息 1350 / 世界内小地图 60）。
 */

interface LayerEntry { el: HTMLElement; seq: number }

const layers = new Map<HTMLElement, LayerEntry>();
/** 宿主容器：key → 元素（它的 z-index 由组内最高层合成） */
const hosts = new Map<string, HTMLElement>();
let seq = 0;

/** 基准 z-index：高于世界层/常驻装饰（≤60），低于刻意固定的那几层（≥1150，见文件头） */
const BASE_Z = 100;

/** 层名 / 宿主 key 都从 data 属性读 */
const layerNameOf = (el: HTMLElement): string => el.dataset.layer ?? '';
const hostKeyOf = (el: HTMLElement): string => el.dataset.layerHost ?? '';

/** 组内最高层 → 容器 z-index；空容器退回基准（免得占着位置压住世界） */
function syncHosts(): void {
  for (const [key, hostEl] of hosts) {
    let top = 0;
    for (const entry of layers.values()) {
      const owner = hostKeyOf(entry.el);
      // 归属判定：显式 `data-layer-host` 或 `<prefix>:` 前缀族（如 panel: 覆盖 panel:shop）
      const byPrefix = owner === '' ? layerNameOf(entry.el).split(':')[0] + ':' : '';
      if (owner !== key && byPrefix !== key + ':' && byPrefix !== key) continue;
      top = Math.max(top, entry.seq);
    }
    hostEl.style.zIndex = String(BASE_Z + (top || 0));
  }
}

/**
 * **激活后重排成 1..N**（保持原有先后）—— 用户 2026-09-16 提的做法：
 * "每次激活后，给当前参与排序的面板重新赋值：A:101 B:102 C:103，激活 A 后 B→101、C→102、A→103"。
 *
 * 这比"每次 +1、涨到阈值再压缩"干净得多，理由：
 *   · z-index 永远是**最小的连续整数**，不存在"会不会涨到 9999+/溢出"这个问题本身；
 *   · 与 `BASE_Z=100` 的相邻层（世界 50 / 常驻装饰 1150+）永远留足余量，不必算概率；
 *   · 重排只是"把当前先后顺序重新编号"，**顺序不变、语义不变**，不会绕回任何特殊值；
 *   · 开销 O(层数)，而窗口数是个位数 —— 一次激活写 5~10 个 style，可忽略。
 */
function renumber(): void {
  const ordered = [...layers.values()].sort((a, b) => a.seq - b.seq);
  seq = 0;
  for (const entry of ordered) {
    entry.seq = ++seq;
    entry.el.style.zIndex = String(BASE_Z + entry.seq);
  }
  syncHosts();
}

function register(el: HTMLElement): void {
  if (!layerNameOf(el) || layers.has(el)) return;
  const entry: LayerEntry = { el, seq: ++seq };
  layers.set(el, entry);
  el.style.zIndex = String(BASE_Z + entry.seq);
  if (el.dataset.layerBound !== '1') {
    el.dataset.layerBound = '1';
    // 点它就激活它（捕获阶段：窗口内任何位置都算）
    el.addEventListener('pointerdown', () => bringToFrontElement(el), true);
  }
  renumber();
}

function unregister(el: HTMLElement): void {
  if (layers.delete(el)) syncHosts();
}

/** 扫描一棵子树：登记所有 `data-layer`，收集所有 `data-layer-host-container` */
function scan(node: Node): void {
  if (!(node instanceof HTMLElement)) return;
  if (node.dataset.layer) register(node);
  if (node.dataset.layerHostContainer) hosts.set(node.dataset.layerHostContainer, node);
  for (const el of node.querySelectorAll<HTMLElement>('[data-layer]')) register(el);
  for (const el of node.querySelectorAll<HTMLElement>('[data-layer-host-container]')) {
    hosts.set(el.dataset.layerHostContainer!, el);
  }
}

function unscan(node: Node): void {
  if (!(node instanceof HTMLElement)) return;
  if (node.dataset.layer) unregister(node);
  for (const el of node.querySelectorAll<HTMLElement>('[data-layer]')) unregister(el);
  if (node.dataset.layerHostContainer) hosts.delete(node.dataset.layerHostContainer);
}

/**
 * 安装：扫描一次 + 开始监听。**整个应用只调一次**（`main.ts` 挂载时）。
 * ⚠ 必须在 UI 容器（`#app`）上监听：监听 `document.body` 会连 Vite/DevTools 注入的节点
 * 一起扫，既浪费又可能误判。
 */
const observing = new WeakSet<HTMLElement>();
export function installLayerStack(root: HTMLElement): void {
  if (observing.has(root)) return;   // 同一个 root 只装一次（不同页面可各装各的）
  observing.add(root);
  new MutationObserver((records) => {
    for (const r of records) {
      for (const n of r.addedNodes) scan(n);
      for (const n of r.removedNodes) unscan(n);
    }
    syncHosts();
  }).observe(root, { childList: true, subtree: true });
  scan(root);   // 必须先装监听再扫：扫描期间新增的节点也能被发现
  syncHosts();
}

/**
 * 手动登记一个元素（`data-layer` 必须已设）。只给"不在被监听 root 里"的场景用
 * （自检临时造的节点）——**正常 UI 不该调它**，靠 `data-layer` 声明即可。
 */
export function registerElement(el: HTMLElement): void { register(el); }

/** 把某个元素提到最上（点击自动触发；也可代码调用） */
export function bringToFrontElement(el: HTMLElement): void {
  const entry = layers.get(el);
  if (!entry) return;
  entry.seq = ++seq;      // 先给它最大序号（= 置顶），再由 renumber 把整体压回 1..N
  renumber();
}

/** 按名字提到最上（同名多实例都会被提到新序号，保持它们之间的相对先后） */
export function bringToFront(name: string): void {
  for (const [el, entry] of layers) {
    if (layerNameOf(el) !== name) continue;
    entry.seq = ++seq;    // 同名多实例：都提到最大序号，保持它们之间的相对先后
  }
  renumber();
}

/** 该名字当前的 z-index（自检用；没有则 0） */
export function layerZIndex(name: string): number {
  let best = 0;
  for (const [el, entry] of layers) {
    if (layerNameOf(el) !== name) continue;
    best = Math.max(best, BASE_Z + entry.seq);
  }
  return best;
}

/** 它此刻是不是最上面的那个（ESC 之类的"栈顶响应"用它） */
export function isTopLayer(name: string): boolean {
  let mine = 0, top = 0;
  for (const [el, entry] of layers) {
    if (layerNameOf(el) === name) mine = Math.max(mine, entry.seq);
    top = Math.max(top, entry.seq);
  }
  return mine > 0 && mine === top;
}

/** 当前登记在案的层（自检用：一眼看清"哪些窗口参与了排序"） */
export function listLayers(): { name: string; z: number }[] {
  return [...layers].map(([el, e]) => ({ name: layerNameOf(el), z: BASE_Z + e.seq }))
    .sort((a, b) => a.z - b.z);
}
