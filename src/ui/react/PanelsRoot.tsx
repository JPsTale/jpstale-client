import { useSyncExternalStore } from 'react';
import { getGameSnapshot, subscribeGame, type OpenPanel } from '../../app/gameStore.js';
import { t } from '../../i18n/index.js';
import PanelShell from './PanelShell.js';
import CharStatusPanel from './CharStatusPanel.js';
import SkillPanel from './SkillPanel.js';
import ItemPanel from './ItemPanel.js';
import SystemMenu, { type SystemMenuSettings } from './SystemMenu.js';

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
      {openPanels.map(renderPanel)}
      {systemMenuOpen && props.systemMenuSettings && (
        <SystemMenu settings={props.systemMenuSettings} />
      )}
    </>
  );
}