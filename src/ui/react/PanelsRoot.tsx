import { useEffect, useState, useSyncExternalStore } from 'react';
import { getGameSnapshot, heldItemOf, subscribeGame, type OpenPanel } from '../../app/gameStore.js';
import { t } from '../../i18n/index.js';
import { isInputBlocked, subscribeInputGate } from '../../app/inputGate.js';
import PanelShell from './PanelShell.js';
import CharStatusPanel from './CharStatusPanel.js';
import SkillPanel from './SkillPanel.js';
import ItemPanel, { HeldIcon } from './ItemPanel.js';
import ShopPanel from './ShopPanel.js';
import { ItemInfoLayer } from './ItemInfo.js';
import SystemMenu, { type SystemMenuSettings } from './SystemMenu.js';
import ChatWindow from './ChatWindow.js';

/**
 * 拿起中的物品跟随光标 —— **全局**渲染，不随背包面板开关。
 *
 * 为什么不能挂在面板里：药水槽在底部 HUD 上（原版位置），而背包面板会盖住那块区域，
 * 所以"从背包拿起药水 → 点 HUD 药水槽放进"必须**先关面板**；`heldUid` 本来就跨开关存活，
 * 但图标原来只在面板里画 → 关掉面板就看不见手里拿着东西了。
 *
 * "手上有没有东西"由 `heldItemOf` 一处判定（背包拿起 / 本地抽离两种来源），
 * 面板、HUD、世界三边共用同一份，不在这里另写条件。
 */
function HeldCursor() {
  const snap = useSyncExternalStore(subscribeGame, getGameSnapshot);
  // 加载页期间不画持物（遮罩 z-index 已高过它，这里再显式挡一道：别把"盖住"当正确性）
  const blocked = useSyncExternalStore(subscribeInputGate, isInputBlocked);
  const held = blocked ? null : heldItemOf(snap);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const heldUid = held?.uid ?? null;
  // 持有期间全窗口跟踪鼠标（拿起瞬间即用指针位置，无残留/无需先滑动）
  useEffect(() => {
    if (heldUid == null) { setPos(null); return; }
    const mv = (e: PointerEvent) => setPos({ x: e.clientX, y: e.clientY });
    window.addEventListener('pointermove', mv);
    return () => window.removeEventListener('pointermove', mv);
  }, [heldUid]);
  return held ? <HeldIcon held={held} pos={pos} /> : null;
}

function renderPanel(panel: OpenPanel) {
  if (panel === 'charStatus') {
    return (
      <PanelShell key="charStatus" panel="charStatus" title={t('panel.title')} align="left">
        <CharStatusPanel />
      </PanelShell>
    );
  }
  if (panel === 'skills') {
    return (
      <PanelShell key="skills" panel="skills" title={t('panel.skills')} align="left" width="auto">
        <SkillPanel />
      </PanelShell>
    );
  }
  if (panel === 'shop') {
    return (
      <PanelShell key="shop" panel="shop" title={t('panel.shop')} align="left" width="auto">
        <ShopPanel />
      </PanelShell>
    );
  }
  if (panel === 'inventory') {
    return (
      <PanelShell key="inventory" panel="inventory" title={t('panel.inventory')} align="left" width="auto">
        <ItemPanel />
      </PanelShell>
    );
  }
  return null;
}

// 面板根：渲染所有打开中的面板 + 系统菜单（模态，独占打开）。
export default function PanelsRoot(props: { systemMenuSettings?: SystemMenuSettings }) {
  const { openPanels, systemMenuOpen } = useSyncExternalStore(subscribeGame, getGameSnapshot);
  return (
    <>
      {/* 游戏内聊天窗（常驻 World，折叠态缺省展开由 store 控制） */}
      <ChatWindow />
      {openPanels.map(renderPanel)}
      {/* 手持物品光标（常驻，与面板开关无关） */}
      <HeldCursor />
      {/* 物品信息框（常驻：面板关着 / 悬停 HUD 药水槽时也要显示） */}
      <ItemInfoLayer />
      {systemMenuOpen && props.systemMenuSettings && (
        <SystemMenu settings={props.systemMenuSettings} />
      )}
    </>
  );
}