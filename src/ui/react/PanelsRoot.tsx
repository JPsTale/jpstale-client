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
import SplitDialog from './SplitDialog.js';
import WorldMapPanel, { type WorldMapPanelOptions } from './WorldMapPanel.js';
import BuffStrip from './BuffStrip.js';
import PartyHud from './PartyHud.js';
import TargetInfoPanel from './TargetInfoPanel.js';
import CraftPanel from './CraftPanel.js';
import { tryDropHeldToGround } from './heldDrop.js';

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

function renderPanel(panel: OpenPanel, worldMapOptions: WorldMapPanelOptions) {
  if (panel === 'worldmap') {
    return <WorldMapPanel key="worldmap" {...worldMapOptions} />;
  }
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
  if (panel === 'craft') {
    // key 带 entityId：换一个 NPC 开窗时**重挂**组件，免得上一家的标签/材料留在界面上
    const entityId = getGameSnapshot().craft?.entityId ?? 0;
    return <CraftPanel key={`craft-${entityId}`} />;
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
export default function PanelsRoot(props: { systemMenuSettings?: SystemMenuSettings; worldMapOptions?: WorldMapPanelOptions }) {
  const { openPanels, systemMenuOpen } = useSyncExternalStore(subscribeGame, getGameSnapshot);


  // 「手持道具时点游戏画面 → 丢到地面」注册在**全局**（不随面板开关，`PanelsRoot` 常驻 World）。
  // 从 HUD 药水槽拿起药水时背包是关着的 —— 挂在面板里就收不到点击（用户 2026-09-14 实测）。
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (tryDropHeldToGround(e)) { e.stopPropagation(); e.preventDefault(); }
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, []);

  return (
    <>
      {/* 游戏内聊天窗（常驻 World，折叠态缺省展开由 store 控制） */}
      <ChatWindow />
      {/* 左上角 buff 图标条（常驻 World，与面板开关无关 —— 打怪时也看得见剩余时间） */}
      <BuffStrip />
      {/* 左侧队伍成员组件（头像/血条/buff；未组队且无邀请时不渲染，见 PartyHud） */}
      <PartyHud />
      {/* 右上角目标信息窗（选中目标的 3D 头像/血条/社交按钮；未选中不渲染） */}
      <TargetInfoPanel />
      {openPanels.map((p) => renderPanel(p, props.worldMapOptions ?? {}))}
      {/* 手持物品光标（常驻，与面板开关无关） */}
      <HeldCursor />
      {/* 物品信息框（常驻：面板关着 / 悬停 HUD 药水槽时也要显示） */}
      <ItemInfoLayer />
      {/* 拆分堆叠弹框（常驻：药水槽在 HUD 上，背包关着也可能触发） */}
      <SplitDialog />
      {systemMenuOpen && props.systemMenuSettings && (
        <SystemMenu settings={props.systemMenuSettings} />
      )}
    </>
  );
}