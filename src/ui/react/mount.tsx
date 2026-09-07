import { createRoot } from 'react-dom/client';
import { AppScreen, getScreen } from '../../app/State.js';
import { openPanel, togglePanel, closeAllPanels, type OpenPanel } from '../../app/gameStore.js';
import PanelsRoot from './PanelsRoot.js';
import './panels.css';

export interface ReactPanels {
  show(panel: OpenPanel): void;
  hide(): void;
  toggle(panel: OpenPanel): void;
  dispose(): void;
}

// 挂载 React 面板层到 #app 容器。show/hide/toggle 走 gameStore.openPanels 集合，
// 面板各自独立开关、可多面板并存（自由拖动，无需互斥）。
export function createReactPanels(container: HTMLElement): ReactPanels {
  const host = document.createElement('div');
  host.id = 'jp-react-panels';
  container.appendChild(host);
  const root = createRoot(host);
  root.render(<PanelsRoot />);
  return {
    show: (panel) => openPanel(panel),
    hide: () => closeAllPanels(),
    // 游戏内专用：登录/选角等界面不响应面板切换
    toggle: (panel) => {
      if (getScreen() !== AppScreen.WORLD) return;
      togglePanel(panel);
    },
    dispose: () => {
      root.unmount();
      host.remove();
    },
  };
}