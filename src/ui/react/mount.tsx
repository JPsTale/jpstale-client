import { createRoot } from 'react-dom/client';
import { AppScreen, getScreen } from '../../app/State.js';
import { getGameSnapshot, setOpenPanel, type OpenPanel } from '../../app/gameStore.js';
import PanelsRoot from './PanelsRoot.js';
import './panels.css';

export interface ReactPanels {
  show(panel: Exclude<OpenPanel, null>): void;
  hide(): void;
  toggle(panel: Exclude<OpenPanel, null>): void;
  dispose(): void;
}

// 挂载 React 面板层到 #app 容器。show/hide/toggle 走 gameStore.openPanel，
// 使面板互斥与关闭语义与游戏状态机同源。
export function createReactPanels(container: HTMLElement): ReactPanels {
  const host = document.createElement('div');
  host.id = 'jp-react-panels';
  container.appendChild(host);
  const root = createRoot(host);
  root.render(<PanelsRoot />);
  return {
    show: (panel) => setOpenPanel(panel),
    hide: () => setOpenPanel(null),
    // 游戏内专用：登录/选角等界面不响应面板切换
    toggle: (panel) => {
      if (getScreen() !== AppScreen.WORLD) return;
      setOpenPanel(getGameSnapshot().openPanel === panel ? null : panel);
    },
    dispose: () => {
      root.unmount();
      host.remove();
    },
  };
}