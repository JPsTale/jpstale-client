import { useSyncExternalStore } from 'react';
import { getGameSnapshot, subscribeGame } from '../../app/gameStore.js';
import { t } from '../../i18n/index.js';
import PanelShell from './PanelShell.js';
import CharStatusPanel from './CharStatusPanel.js';
import SkillPanel from './SkillPanel.js';

// 面板根：只做一件事——根据 store.openPanel 渲染唯一面板（互斥由单值保证）。
export default function PanelsRoot() {
  const { openPanel } = useSyncExternalStore(subscribeGame, getGameSnapshot);
  if (openPanel === null) return null;
  if (openPanel === 'charStatus') {
    return (
      <PanelShell key="charStatus" panel="charStatus" title={t('panel.title')} align="left">
        <CharStatusPanel />
      </PanelShell>
    );
  }
  if (openPanel === 'skills') {
    return (
      <PanelShell key="skills" panel="skills" title={t('panel.skills')} align="left" width="auto">
        <SkillPanel />
      </PanelShell>
    );
  }
  return null;
}