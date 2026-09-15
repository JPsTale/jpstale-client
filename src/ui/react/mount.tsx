import { createRoot } from 'react-dom/client';
import { AppScreen, getScreen } from '../../app/State.js';
import { openPanel, togglePanel, closeAllPanels, getGameSnapshot, type OpenPanel } from '../../app/gameStore.js';
import PanelsRoot from './PanelsRoot.js';
import type { SystemMenuSettings } from './SystemMenu.js';
import type { WorldMapPanelOptions } from './WorldMapPanel.js';
import './panels.css';

export interface ReactPanels {
  show(panel: OpenPanel): void;
  hide(): void;
  toggle(panel: OpenPanel): void;
  /** 系统菜单设置（键位对象 + 画质 setter + 大退/小退回调；由 main.ts 注入） */
  setSystemMenuSettings(settings: SystemMenuSettings): void;
  /** 世界地图的数据源（玩家位置/实体；由 main.ts 注入 —— 地图内容在 React 里挂载） */
  setWorldMapOptions(opts: WorldMapPanelOptions): void;
  dispose(): void;
}

// 挂载 React 面板层到 #app 容器。show/hide/toggle 走 gameStore.openPanels 集合，
// 面板各自独立开关、可多面板并存（自由拖动，无需互斥）。
export function createReactPanels(container: HTMLElement): ReactPanels {
  const host = document.createElement('div');
  host.id = 'jp-react-panels';
  host.dataset.layerHostContainer = 'panels';
  container.appendChild(host);
  // 容器是**面板层的宿主**（`setLayerHostContainer`）：它自己拿一个合并后的 z-index，
  // 内部每个面板再各自入栈（`panel:bag` / `panel:charstatus`…，见 PanelShell）。
  //
  // 两条都是真事故换来的：
  //  · 容器整层升降（`bringToFront('panels')`）→ "关掉角色面板会把背包一起顶起来"（用户 2026-09-15）。
  //  · 容器 `z-index:auto` → 整层掉到 `#world-root{z-index:50}` 下面，**所有面板点不到**
  //    （用户 2026-09-16 实测；`elementsFromPoint` 首层是 `CANVAS z=auto`，父级 `#world-root z=50`）。
  // 现在：容器 z-index = 当前最高层的值（空容器退回基准），既是层叠上下文、又不与地图窗口比较大小。
  // 装的是：各面板（`panel:` 前缀族）、系统菜单、聊天窗
  let systemMenuSettings: SystemMenuSettings | undefined;
  let worldMapOptions: WorldMapPanelOptions = {};
  const root = createRoot(host);
  const rerender = () => root.render(
    <PanelsRoot systemMenuSettings={systemMenuSettings} worldMapOptions={worldMapOptions} />,
  );
  rerender();
  /**
   * 游戏画面是否**真的**在显示 —— 面板开关的守卫用它，而不是 `getScreen()`。
   *
   * 为什么换掉（2026-09-16 用户实测："快捷键/HUD 那几个按钮点了没反应"）：
   * `getScreen()` 是**模块级可变状态**，会被 HMR 重载、断线回选角、重连等路径改写；
   * 一旦它和"屏幕上真的是哪一屏"脱钩，`toggle` 就会**静默 return** —— 玩家看到的是
   * "按了没反应"，而代码里既没有报错也没有日志（AGENTS #19 同一类：静默失效最难查）。
   * 现在改成看**实际可见性**（世界画布既存在又有尺寸），并在拦住时留下日志。
   */
  function worldVisible(): boolean {
    const root = document.getElementById('world-root');
    if (!root || root.style.display === 'none') return false;
    const cv = root.querySelector('canvas') as HTMLCanvasElement | null;   // 第一个 canvas = 世界画面
    if (!cv) return false;
    const r = cv.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  return {
    show: (panel) => openPanel(panel),
    hide: () => closeAllPanels(),
    // 游戏内专用：登录/选角等界面不响应面板切换
    toggle: (panel) => {
      // 两个判据取**或**：任一成立就认"在游戏里"。
      //  · `getScreen()===WORLD` 是主判据，但它可能被 HMR/断线路径改坏；
      //  · `worldVisible()` 看实际画面，作为兜底（headless 自检里没有真实布局，靠主判据）；
      // 两者同时为假才拒绝 —— 宁可多放行（面板打开无害），也别静默吞掉玩家操作。
      if (getScreen() !== AppScreen.WORLD && !worldVisible()) {
        console.warn(`[ui] 忽略面板切换 ${panel}：不在游戏内（screen=${getScreen()}，画面可见=${worldVisible()}）`);
        return;
      }
      const before = getGameSnapshot().openPanels.length;
      togglePanel(panel);
      console.log(`[ui] 面板切换 ${panel}: openPanels ${before} → ${getGameSnapshot().openPanels.length}`);
    },
    setSystemMenuSettings: (settings) => {
      systemMenuSettings = settings;
      rerender();
    },
    setWorldMapOptions: (opts) => {
      worldMapOptions = opts;
      rerender();
    },
    dispose: () => {
      root.unmount();       // 各面板的层由 PanelShell/SystemMenu 的 useEffect 清理
      host.remove();
    },
  };
}