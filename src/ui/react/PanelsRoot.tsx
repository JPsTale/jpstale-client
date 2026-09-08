import { useSyncExternalStore } from 'react';
import { getGameSnapshot, subscribeGame, type OpenPanel } from '../../app/gameStore.js';
import { t } from '../../i18n/index.js';
import PanelShell from './PanelShell.js';
import CharStatusPanel from './CharStatusPanel.js';
import SkillPanel from './SkillPanel.js';
import ItemPanel from './ItemPanel.js';

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

// 面板根：渲染所有打开中的面板（多面板并存；互斥不再需要——面板可自由拖动）。
export default function PanelsRoot() {
  const { openPanels } = useSyncExternalStore(subscribeGame, getGameSnapshot);
  return <>{openPanels.map(renderPanel)}</>;
}