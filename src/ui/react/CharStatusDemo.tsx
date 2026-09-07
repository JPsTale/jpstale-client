import { useSyncExternalStore } from 'react';
import { getGameSnapshot, subscribeGame } from '../../app/gameStore.js';
import { t } from '../../i18n/index.js';

// Phase 1 演示面板：从 store 读 S2C_CharacterStatus 数据渲染。
// 正式 CharStatusPanel（Phase 2）将替代 canvas CharacterPanel，本页仅作基建验收。
export default function CharStatusDemo() {
  const { character } = useSyncExternalStore(subscribeGame, getGameSnapshot);

  if (!character) return <div className="jp-nodata">{t('panel.noData')}</div>;
  const c = character;

  const bars = [
    { key: 'hp' as const, cur: c.hp, max: c.maxHp, cls: 'jp-bar-hp' },
    { key: 'mp' as const, cur: c.mp, max: c.maxMp, cls: 'jp-bar-mp' },
    { key: 'sp' as const, cur: c.sp, max: c.maxSp, cls: 'jp-bar-sp' },
  ];

  const fields: Array<[string, string | number]> = [
    [t('panel.strength'), c.strength],
    [t('panel.spirit'), c.spirit],
    [t('panel.talent'), c.talent],
    [t('panel.agility'), c.agility],
    [t('panel.health'), c.health],
    [t('panel.attack'), `${c.attackMin}~${c.attackMax}`],
    [t('panel.defense'), c.defense],
    [t('panel.absorption'), c.absorption],
    [t('panel.crit'), c.critical],
    [t('panel.block'), c.block],
    [t('panel.avoid'), c.avoid],
    [t('panel.move'), `${c.walkSpeed} / ${c.runSpeed}`],
  ];

  return (
    <div>
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}
      >
        <span className="jp-name">{c.name}</span>
        <span className="jp-lv">{t('panel.lv', { level: c.level })}</span>
      </div>
      {bars.map((b) => (
        <div key={b.key} className="jp-hud-row">
          <span className="jp-hud-label">{t(`panel.${b.key}`)}</span>
          <div className="jp-bar">
            <i className={b.cls} style={{ width: `${b.max ? Math.min(100, (b.cur / b.max) * 100) : 0}%` }} />
          </div>
          <span className="jp-lv">{b.cur}/{b.max}</span>
        </div>
      ))}
      <div className="jp-grid">
        {fields.map(([label, value]) => (
          <div key={label} className="jp-field">
            <span>{label}</span>
            <b>{value}</b>
          </div>
        ))}
      </div>
    </div>
  );
}