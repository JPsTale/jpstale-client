/**
 * 游戏内日志面板（**Ctrl+Shift+L** 开关）。
 *
 * 为什么需要它：客户端**全局屏蔽了浏览器右键菜单**（右键要用来"使用道具/技能"，用户 2026-09-13 定），
 * 于是"右键 → 检查"这条看日志的路没了。浏览器快捷键（F12 / Ctrl+Shift+I）仍然可用，
 * 但游戏内也需要一个**不依赖 devtools** 的日志入口 —— 排查问题时经常要看
 * `[bag:put]` / `[fallback]` / `[potion]` 这类我们自己的诊断输出。
 *
 * 做法：包裹 `console.log/warn/error`（**仍然转发给原函数**，devtools 里照旧可见），
 * 把最近 N 条渲染进一个纯 DOM 覆盖层（不依赖 React 挂载顺序）。面板可滚动、可清空。
 */

const MAX_LINES = 400;

interface Entry { level: 'log' | 'warn' | 'error'; text: string }

let entries: Entry[] = [];
let panel: HTMLDivElement | null = null;
let listEl: HTMLDivElement | null = null;
let installed = false;
let visible = false;

function fmt(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
}

function render(): void {
  if (!listEl) return;
  const atBottom = listEl.scrollTop + listEl.clientHeight >= listEl.scrollHeight - 8;
  listEl.textContent = '';
  const frag = document.createDocumentFragment();
  for (const e of entries) {
    const line = document.createElement('div');
    line.textContent = e.text;
    line.style.cssText = 'white-space:pre-wrap;word-break:break-all;padding:1px 0;' +
      (e.level === 'error' ? 'color:#ff8b7b;' : e.level === 'warn' ? 'color:#ffd479;' : 'color:#cdd6e0;');
    frag.appendChild(line);
  }
  listEl.appendChild(frag);
  if (atBottom) listEl.scrollTop = listEl.scrollHeight;
}

function push(level: Entry['level'], args: unknown[]): void {
  const t = new Date();
  const hh = String(t.getHours()).padStart(2, '0');
  const mm = String(t.getMinutes()).padStart(2, '0');
  const ss = String(t.getSeconds()).padStart(2, '0');
  entries.push({ level, text: `[${hh}:${mm}:${ss}] ${fmt(args)}` });
  if (entries.length > MAX_LINES) entries = entries.slice(-MAX_LINES);
  if (visible) render();
}

function buildPanel(): void {
  panel = document.createElement('div');
  panel.style.cssText = [
    'position:fixed', 'right:8px', 'bottom:8px', 'width:46vw', 'max-width:720px', 'height:38vh',
    'z-index:100000', 'display:none', 'flex-direction:column',
    'background:rgba(8,12,18,.92)', 'border:1px solid #39465a', 'border-radius:6px',
    'font:12px/1.5 ui-monospace,Consolas,monospace', 'color:#dce6f2',
  ].join(';');

  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 8px;border-bottom:1px solid #39465a;';
  const title = document.createElement('span');
  title.textContent = '游戏内日志（Ctrl+Shift+L 开关）';
  title.style.cssText = 'flex:1;color:#9fb0c4;';
  const btnClear = document.createElement('button');
  btnClear.textContent = '清空';
  btnClear.style.cssText = 'cursor:pointer;background:#22303f;color:#cfe0f0;border:1px solid #39465a;border-radius:3px;padding:1px 8px;';
  btnClear.onclick = () => { entries = []; render(); };
  bar.append(title, btnClear);

  listEl = document.createElement('div');
  listEl.style.cssText = 'flex:1;overflow:auto;padding:4px 8px;user-select:text;';

  panel.append(bar, listEl);
  document.body.appendChild(panel);
}

function toggle(): void {
  if (!panel) buildPanel();
  visible = !visible;
  panel!.style.display = visible ? 'flex' : 'none';
  if (visible) render();
}

/** 挂载：包裹 console + 绑定快捷键。重复调用无副作用。 */
export function installDevLogPanel(): void {
  if (installed) return;
  installed = true;

  const orig = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };
  console.log = (...a: unknown[]) => { push('log', a); orig.log(...a); };
  console.warn = (...a: unknown[]) => { push('warn', a); orig.warn(...a); };
  console.error = (...a: unknown[]) => { push('error', a); orig.error(...a); };

  window.addEventListener('keydown', (e) => {
    // 用 Ctrl+Shift+L（避开已占用的 F1-F12 / WASD / 数字键 / Tab / 空格 等）
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyL') {
      e.preventDefault();
      toggle();
    }
  });
}

export function isDevLogVisible(): boolean {
  return visible;
}
