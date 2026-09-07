import { useSyncExternalStore, useState } from 'react';
import { getGameSnapshot, subscribeGame } from '../../app/gameStore.js';
import { sendAllocateStat } from '../../net/bridge.js';
import { t } from '../../i18n/index.js';

// 职业 id → i18n key（与原 canvas 角色面板映射一致：1 武士 … 10 萨满）
const JOB_KEYS: Record<number, string> = {
  1: 'job.fighter', 2: 'job.mechanician', 3: 'job.archer', 4: 'job.pikeman',
  5: 'job.atalanta', 6: 'job.knight', 7: 'job.magician', 8: 'job.priestess',
  9: 'job.assassin', 10: 'job.shaman',
};

// 属性步长档位（每格"步长切换"选择，+/- 双钮按当前步长分配/撤回）
const ALLOC_STEPS = [1, 10, 100];

// 正式角色面板（Phase 2）：现代左侧详情栏（可拖动）。
// 数据只来自 gameStore（S2C_CharacterStatus 经 bridge 写入）；加点/撤回走 bridge 发 C2S，
// 服务端回推完整状态后本面板自动刷新 —— 权威闭环。
// 大数缩写（经验/金币等累计值）：不是文件大小式的千位进位，
// 而是"档位滞后"的 K/M/G —— ≥1e6 显示为 ×1000 的 K、≥1e9 显示为 ×1e6 的 M、≥1e12 封顶 G。
// 例：1,000,000→1,000K；1,000,000,000→1000M；1.7e12→1,706G。头部整除、无小数、千分位。
function fmtBig(n: number): string {
  const abs = Math.abs(n);
  let head: number;
  let unit: string;
  if (abs >= 1e12) {
    head = abs / 1e9; unit = 'G';
  } else if (abs >= 1e9) {
    head = abs / 1e6; unit = 'M';
  } else if (abs >= 1e6) {
    head = abs / 1e3; unit = 'K';
  } else {
    return Math.floor(abs).toLocaleString('en-US');
  }
  return Math.floor(head).toLocaleString('en-US') + unit;
}

export default function CharStatusPanel() {
  const { character } = useSyncExternalStore(subscribeGame, getGameSnapshot);
  const [step, setStep] = useState(1);

  if (!character) return <div className="jp-nodata">{t('panel.noData')}</div>;
  const c = character;

  const statRows: Array<{ stat: string; label: string; value: number }> = [
    { stat: 'strength', label: t('panel.strength'), value: c.strength },
    { stat: 'spirit', label: t('panel.spirit'), value: c.spirit },
    { stat: 'talent', label: t('panel.talent'), value: c.talent },
    { stat: 'agility', label: t('panel.agility'), value: c.agility },
    { stat: 'health', label: t('panel.health'), value: c.health },
  ];

  const vitals: Array<{ key: 'hp' | 'mp' | 'sp'; cur: number; max: number; regen: number }> = [
    { key: 'hp', cur: c.hp, max: c.maxHp, regen: c.regenHp },
    { key: 'mp', cur: c.mp, max: c.maxMp, regen: c.regenMp },
    { key: 'sp', cur: c.sp, max: c.maxSp, regen: c.regenStm },
  ];

  // 生命/魔法/耐力：像战斗属性一样两列卡片，右侧显示每秒恢复值（1 位小数）
  const vitalCells: Array<{ key: string; label: string; value: string }> = vitals.flatMap((v) => [
    { key: `${v.key}-v`, label: t(`panel.${v.key}`), value: `${v.cur}/${v.max}` },
    { key: `${v.key}-r`, label: t('stats.regen'), value: `+${v.regen.toFixed(1)}/s` },
  ]);

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
        <span>{t('stats.expLeft')} {fmtBig(c.nextExp - c.exp)}</span>
      </div>

      <div className="jp-grid2">
        {vitalCells.map((v) => (
          <div key={v.key} className="jp-field">
            <span>{v.label}</span>
            <b>{v.value}</b>
          </div>
        ))}
      </div>

      <div className="jp-sec">{t('panel.group.base')}</div>
      <div className="jp-allocs">
        {statRows.map((s) => (
          <div key={s.stat} className="jp-stat-row">
            <span className="jp-stat-label">{s.label}</span>
            <b className="jp-stat-value">{s.value}</b>
            <div className="jp-spin">
              <button
                type="button"
                className="jp-spin-up"
                disabled={c.statePoint < step}
                onClick={() => sendAllocateStat(s.stat, step)}
                aria-label={`${s.label} +${step}`}
              >
                +
              </button>
              <button
                type="button"
                className="jp-spin-down"
                disabled={s.value <= 1}
                onClick={() => sendAllocateStat(s.stat, -step)}
                aria-label={`${s.label} -${step}`}
              >
                −
              </button>
            </div>
          </div>
        ))}
        <div className="jp-stat-row">
          <span className="jp-stat-label jp-rem-label">{t('stats.statePoint')}</span>
          <b className="jp-stat-value jp-rem-value">{c.statePoint}</b>
          <button type="button" className="jp-undo-btn" onClick={() => sendAllocateStat('undo')}>
            ↺
          </button>
        </div>
        <div className="jp-step-row">
          {ALLOC_STEPS.map((n) => (
            <button
              key={n}
              type="button"
              className={step === n ? 'jp-step-btn jp-step-btn--on' : 'jp-step-btn'}
              onClick={() => setStep(n)}
            >
              ×{n}
            </button>
          ))}
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
      <div className="jp-grid2">
        {resist.map(([label, value]) => (
          <div key={label} className="jp-field">
            <span>{label}</span>
            <b>{value}</b>
          </div>
        ))}
      </div>
    </div>
  );
}