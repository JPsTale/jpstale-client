/**
 * 原版鼠标光标 —— **一套，全局共用**。
 *
 * 为什么单独成模块：世界内（canvas）与 UI 面板必须用同一套原版光标。
 * 之前只在 `renderer.domElement` 上设 cursor，鼠标一滑到 UI（背包/聊天/HUD）就变回系统默认
 * （用户 2026-09-13 实测）。现在统一设到**根元素** `document.documentElement`，
 * 再配一条 CSS 让 UI 元素 `cursor: inherit`（见 index.html），于是：
 *   - 世界内：按目标切换（攻击/拾取/对话/默认），先设根元素、再让 canvas 继承同一值；
 *   - UI：跟随根元素 → 也是原版光标（不再是系统箭头）；
 *   - 输入框：CSS 里特意排除 input/textarea，保留文本光标（否则没法定位插入点）。
 *
 * 资产：`image/sinimage/cursor/*.tga`。浏览器不能把 TGA 当 cursor，故运行时用
 * `decodeTextureAsync` 解码后转成 PNG data URL（与贴图同一条解码链，唯一实现）。
 */
import { cachedFetch } from '../core/asset-cache.js';
import { decodeTextureAsync } from '../core/texture.js';

export type CursorMode = 'default' | 'pickup' | 'attack' | 'talk';

const CURSOR_ROOT = '/res/image/sinimage/cursor/';
/** 文件名 → dataURL 的缓存；值为 '' 表示"正在加载"（防并发重复请求） */
const urlCache = new Map<string, string>();
let lastUrl: string | null = null;
let modeNow: CursorMode = 'default';
let mouseDownNow = false;
let installed = false;

function fileOf(mode: CursorMode, mouseDown: boolean): string {
  switch (mode) {
    case 'pickup': return mouseDown ? 'getitem_cursor2.tga' : 'getitem_cursor1.tga';
    case 'attack': return 'attack_cursor.tga';
    case 'talk': return 'talk_cursor.tga';
    default: return 'defaultcursor.tga';
  }
}

async function toDataUrl(file: string): Promise<string | null> {
  try {
    const buf = await cachedFetch(CURSOR_ROOT + file);
    const dec = await decodeTextureAsync(buf);
    if (!dec) {
      console.warn('[cursor] 解码失败 ' + file);
      return null;
    }
    const c = document.createElement('canvas');
    c.width = dec.width;
    c.height = dec.height;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(dec.width, dec.height);
    img.data.set(dec.pixels);
    ctx.putImageData(img, 0, 0);
    return c.toDataURL('image/png');
  } catch (e) {
    console.warn('[cursor] 加载失败 ' + file, e);
    return null;
  }
}

/** 把 dataURL 写到根元素（UI 与 canvas 都继承它）。相同 URL 不重复写，避免每帧触发布局。 */
function apply(url: string): void {
  if (!url || url === lastUrl) return;
  lastUrl = url;
  // 热点 (3,3)：与原先 canvas 上的设置保持一致（原版光标的小箭头尖在左上）
  document.documentElement.style.cursor = `url("${url}") 3 3, auto`;
}

/** 切换光标（世界内按 hover 目标调用；UI 上由 onMouseLeave 恢复 'default'）。 */
export function setCursorMode(mode: CursorMode, mouseDown = false): void {
  modeNow = mode;
  mouseDownNow = mouseDown;
  const file = fileOf(mode, mouseDown);
  const cached = urlCache.get(file);
  if (cached !== undefined) {
    if (cached) apply(cached);
    return;
  }
  urlCache.set(file, '');   // 占位防并发重复请求
  void toDataUrl(file).then((u) => {
    const url = u || '';
    urlCache.set(file, url);
    // 加载完成时若模式已变，丢弃这次结果（否则会把过期的图标盖上去）
    if (url && modeNow === mode && mouseDownNow === mouseDown) apply(url);
  });
}

/** 当前模式（供"按下/抬起时刷新拾取图标"这类调用方判断）。 */
export function getCursorMode(): CursorMode {
  return modeNow;
}

/**
 * 启动即调用一次：登录/选角界面也用原版光标。
 * 只调一次（重复调用无副作用，install 标志防重复挂载）。
 */
export function initCursor(): void {
  installed = true;
  setCursorMode('default', false);
}

export function isCursorInstalled(): boolean {
  return installed;
}
