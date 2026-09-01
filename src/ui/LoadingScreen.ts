/**
 * 启动加载页：显式进度条，登录前预加载模型/地图完成后隐藏。
 */
export interface LoadingScreen {
  show(): void;
  setProgress(loaded: number, total: number, label: string): void;
  hide(): void;
}

export function createLoadingScreen(container: HTMLElement): LoadingScreen {
  const root = document.createElement('div');
  root.id = 'loading-screen';
  root.style.cssText = 'display:none;position:fixed;inset:0;background:#0a0a1a;color:#e0d8c8;font-family:monospace;z-index:200;flex-direction:column;align-items:center;justify-content:center;gap:16px;';
  const title = document.createElement('div');
  title.textContent = '加载中...';
  title.style.cssText = 'font-size:20px;letter-spacing:2px;';
  const barWrap = document.createElement('div');
  barWrap.style.cssText = 'width:320px;height:14px;background:#222;border:1px solid #555;border-radius:3px;overflow:hidden;';
  const bar = document.createElement('div');
  bar.style.cssText = 'height:100%;width:0%;background:#4a7c59;transition:width 0.15s;';
  barWrap.appendChild(bar);
  const label = document.createElement('div');
  label.style.cssText = 'font-size:12px;opacity:0.7;';
  root.append(title, barWrap, label);
  container.appendChild(root);

  return {
    show() { root.style.display = 'flex'; },
    setProgress(loaded, total, txt) {
      const pct = total > 0 ? Math.min(100, Math.round(loaded / total * 100)) : 0;
      bar.style.width = pct + '%';
      label.textContent = `${txt} (${loaded}/${total})`;
    },
    hide() { root.style.display = 'none'; },
  };
}
