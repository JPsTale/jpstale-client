import { createRoot } from 'react-dom/client';
import { AppScreen, getScreen } from '../../app/State.js';
import { openPanel, togglePanel, closeAllPanels, type OpenPanel } from '../../app/gameStore.js';
import PanelsRoot from './PanelsRoot.js';
import type { SystemMenuSettings } from './SystemMenu.js';
import './panels.css';

export interface ReactPanels {
  show(panel: OpenPanel): void;
  hide(): void;
  toggle(panel: OpenPanel): void;
  /** 系统菜单设置（键位对象 + 画质 setter + 大退/小退回调；由 main.ts 注入） */
  setSystemMenuSettings(settings: SystemMenuSettings): void;
  dispose(): void;
}

// 挂载 React 面板层到 #app 容器。show/hide/toggle 走 gameStore.openPanels 集合，
// 面板各自独立开关、可多面板并存（自由拖动，无需互斥）。
export function createReactPanels(container: HTMLElement): ReactPanels {
  const host = document.createElement('div');
  host.id = 'jp-react-panels';
  container.appendChild(host);
  let systemMenuSettings: SystemMenuSettings | undefined;
  const root = createRoot(host);
  const rerender = () => root.render(<PanelsRoot systemMenuSettings={systemMenuSettings} />);
  rerender();
  return {
    show: (panel) => openPanel(panel),
    hide: () => closeAllPanels(),
    // 游戏内专用：登录/选角等界面不响应面板切换
    toggle: (panel) => {
      if (getScreen() !== AppScreen.WORLD) return;
      togglePanel(panel);
    },
    setSystemMenuSettings: (settings) => {
      systemMenuSettings = settings;
      rerender();
    },
    dispose: () => {
      root.unmount();
      host.remove();
    },
  };
}