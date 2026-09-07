import { useSyncExternalStore } from 'react';
import { getGameSnapshot, subscribeGame } from '../../app/gameStore.js';
import { sendAllocateStat } from '../../net/bridge.js';
import { t } from '../../i18n/index.js';

// 职业 id → i18n key（与原 canvas 角色面板映射一致：1 武士 … 10 萨满）
const JOB_KEYS: Record<number, string> = {
  1: 'job.fighter', 2: 'job.mechanician', 3: 'job.archer', 4: 'job.pikeman',
  5: 'job.atalanta', 6: 'job.knight', 7: 'job.magician', 8: 'job.priestess',
  9: 'job.assassin', 10: 'job.shaman',
};

// 正式角色面板（Phase 2）：现代左侧详情栏（可拖动）。
// 数据只来自 gameStore（S2C_CharacterStatus 经 bridge 写入）；加点走 bridge 发 C2S，
// 服务端回推完整状态后本面板自动刷新 —— 与 canvas 版同样的权威闭环。
export default function CharStatusPanel() {
  const { character } = useSyncExternalStore(subscribeGame, getGameSnapshot);

  if (!character) return <div className="jp-nodata">{t('panel.noData')}</div>;
  const c = character;

  const statRows: Array<{ stat: string; label: string; value: number }> = [
    { stat: 'strength', label: t('panel.strength'), value: c.strength },
    { stat: 'spirit', label: t('panel.spirit'), value: c.spirit },
    { stat: 'talent', label: t('panel.talent'), value: c.talent },
    { stat: 'agility', label: t('panel.agility'), value: c.agility },
    { stat: 'health', label: t('panel.health'), value: c.health },
  ];

  const vitals: Array<{ key: 'hp' | 'mp' | 'sp'; cur: number; max: number }> = [
    { key: 'hp', cur: c.hp, max: c.maxHp },
    { key: 'mp', cur: c.mp, max: c.maxMp },
    { key: 'sp', cur: c.sp, max: c.maxSp },
  ];

  const combat: Array<[string, string | number]> = [
    [t('panel.attack'), `${c.attackMin}~${c.attackMax}`],
    [t('stats.hit'), c.attackRating],
    [t('panel.defense'), c.defense],
    [t('panel.absorption'), c.absorption],
    [t('panel.crit'), c.critical],
    [t('panel.block'), c.block],
    [t('panel.avoid'), c.avoid],
    [t('stats.attackSpeed'), c.attackSpeed],
    [t('stats.range'), c.shootingRange],
    [t('panel.move'), c.moveSpeed],
  ];

  const resist: Array<[string, number]> = [
    [t('stats.bio'), c.resBionic],
    [t('stats.poison'), c.resPoison],
    [t('stats.fire'), c.resFire],
    [t('stats.lightning'), c.resLightning],
    [t('stats.ice'), c.resIce],
  ];

  return (
    <div className="jp-charpanel">
      <div className="jp-char-head">
        <span className="jp-job">{t(JOB_KEYS[c.job] ?? 'job.fighter')}</span>
        <span className="jp-name">{c.name}</span>
        <span className="jp-clan">{t('panel.noClan')}</span>
      </div>
      <div className="jp-char-sub">
        <span>{t('panel.lv', { level: c.level })}</span>
        <span>{t('stats.exp')} {c.exp}/{c.nextExp}</span>
      </div>

      <div className="jp-vitals">
        {vitals.map((v) => (
          <div key={v.key} className="jp-vital">
            <span>{t(`panel.${v.key}`)}</span>
            <b>{v.cur}/{v.max}</b>
          </div>
        ))}
      </div>

      <div className="jp-sec">{t('panel.group.base')}</div>
      <div className="jp-alloc">
        {statRows.map((s) => (
          <div key={s.stat} className="jp-alloc-row">
            <span className="jp-alloc-label">{s.label}</span>
            <b className="jp-alloc-value">{s.value}</b>
            <button
              type="button"
              className="jp-plus"
              disabled={c.statePoint <= 0}
              onClick={() => sendAllocateStat(s.stat)}
              aria-label={`${s.label} +1`}
            >
              +
            </button>
          </div>
        ))}
        <div className="jp-alloc-rem">
          <span>{t('stats.statePoint')}</span>
          <b>{c.statePoint}</b>
        </div>
      </div>

      <div className="jp-sec">{t('panel.group.combat')}</div>
      <div className="jp-grid2">
        {combat.map(([label, value]) => (
          <div key={label} className="jp-field">
            <span>{label}</span>
            <b>{value}</b>
          </div>
        ))}
      </div>

      <div className="jp-sec">{t('panel.group.resist')}</div>
      <div className="jp-vitals">
        {resist.map(([label, value]) => (
          <div key={label} className="jp-vital">
            <span>{label}</span>
            <b>{value}</b>
          </div>
        ))}
      </div>
    </div>
  );
}