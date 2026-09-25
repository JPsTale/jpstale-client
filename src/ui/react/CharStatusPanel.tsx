import { useSyncExternalStore, useState } from 'react';
import { getClanIcon, subscribeClanIcons } from '../clan-icon-cache.js';
import { getGameSnapshot, subscribeGame } from '../../app/gameStore.js';
import { sendAllocateStat } from '../../net/bridge.js';
import { t, tList } from '../../i18n/index.js';

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

export default function CharStatusPanel() {
  const { character } = useSyncExternalStore(subscribeGame, getGameSnapshot);
  const [step, setStep] = useState(1);

  if (!character) return <div className="jp-nodata">{t('panel.noData')}</div>;
  const c = character;
  // 职业名按**转职阶级**取 `itemtip.jobTier.<job>[rank]`（每职业 5 阶，zh/en 都有；
  // 服务端 JobService 按 20/40/60 推进 rank，随 S2C_CharacterStatus.rank 下发）。
  // rank=0 取到 [0] = 1 转名，与原 job.* 同值；数组缺失（键异常）时退 job.* 并仍显示。
  const jobTierNames = tList(`itemtip.jobTier.${c.job}`);
  const jobName = jobTierNames[c.rank ?? 0] ?? t(JOB_KEYS[c.job] ?? 'job.fighter');
  // 本级经验进度：本级已获得 = exp - levelExp，本级升级所需 = nextExp - levelExp（经验是累计值，必须减起点）。
  // 数据异常（exp 低于本级起点，常见于直接设等级的测试角色）时钳到 0，不显示负数。
  const levelSpan = Math.max(0, c.nextExp - c.levelExp);
  const expInLevel = Math.max(0, c.exp - c.levelExp);
  const levelExpPct = levelSpan > 0
    ? Math.max(0, Math.min(100, (expInLevel / levelSpan) * 100))
    : 0;

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

  // 战斗属性按**两栏语义**分组（用户 2026-09-14 定）：
  //   左列 = 影响"我打出去"的 —— 攻击力 / 攻击速度 / 攻击范围 / 必杀率 / 移动速度
  //          （移速决定能不能接近目标、追不追得上，属进攻节奏）
  //   右列 = 影响"我挨打时"的 —— 命中 / 躲闪 / 防御 / 格挡率 / 回避
  //          （命中是"能不能打中**别人**"的对拼值，与回避是一组对抗关系，故同列）
  // ⚠ 顺序即显示顺序：**前 COMBAT_COLUMN 项进左列，其余进右列**（靠 CSS `.jp-cols2`
  //   的两列容器实现）。两栏各 5 项，改数量时同步改下面的 COMBAT_COLUMN。
  //
  // `percent` 标记的项是**百分数**（值本身即 0~100 的百分数，追加 `%` 即可）：
  //   - 必杀 `c.critical`：服务端 `calculateCriticalRate` 返回 int（5 = 5%，上限 70）；
  //   - 格挡 `c.block`：服务端 `calculateBlockRate` 上限 50，`nextInt(100) < blockRate` 直接比大小。
  // ⚠ **躲闪/防御不是百分数**（用户 2026-09-14 纠正）：
  //   - 躲闪（`c.defense`）= 明文减伤值；
  //   - 防御（`c.absorption`）= 明文减伤（怪攻 3 − 吸收 1 = 2）；**怪物**的吸收才是百分比减伤。
  const combat: Array<{ label: string; value: number | string; percent?: boolean }> = [
    // ── 左列：攻击侧 ──
    { label: t('panel.attack'), value: `${c.attackMin}~${c.attackMax}` },
    { label: t('stats.attackSpeed'), value: c.attackSpeed },
    { label: t('stats.range'), value: c.shootingRange },
    { label: t('panel.crit'), value: c.critical, percent: true },
    { label: t('panel.move'), value: c.moveSpeed },
    // ── 右列：挨打侧 ──
    { label: t('stats.hit'), value: c.attackRating },
    { label: t('panel.defense'), value: c.defense },
    { label: t('panel.absorption'), value: c.absorption },
    { label: t('panel.block'), value: c.block, percent: true },
    { label: t('panel.avoid'), value: c.avoid },
  ];
  /** 左列卡片数（= 攻击侧项数）；右列 = 其余。与 `panels.css` 的 `.jp-cols2` 两列容器配套 */
  const COMBAT_COLUMN = 5;

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
        <span className="jp-job">{jobName}</span>
        <span className="jp-name">{c.name}</span>
        <span className="jp-clan">
          {c.clanMark !== '' && <ClanIconImg markId={c.clanMark} />}
          {c.clanName !== '' ? c.clanName : t('panel.noClan')}
        </span>
      </div>
      <div className="jp-char-sub">
        <span>{t('panel.lv', { level: c.level })}</span>
        {/* 本级经验 = 两个数字 + 一个百分比（用户 2026-09-12 明确要求）：
            前一个 = 当前等级已获得经验，后一个 = 本级升级所需总经验，比例即两者之比。
            经验是累计值，所以两个数都要减掉本级起点 expForLevel(level)（= levelExp）。 */}
        <span>{t('stats.expProgress', {
          cur: expInLevel.toLocaleString('en-US'),
          need: levelSpan.toLocaleString('en-US'),
          pct: levelExpPct.toFixed(2),
        })}</span>
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
      <div className="jp-cols2">
        {[combat.slice(0, COMBAT_COLUMN), combat.slice(COMBAT_COLUMN)].map((col, ci) => (
          <div key={ci}>
            {col.map((row) => (
              <div key={row.label} className="jp-field">
                <span>{row.label}</span>
                <b>{row.value}{row.percent ? '%' : ''}</b>
              </div>
            ))}
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

/** 公会图标（16×16；共享缓存 `ui/clan-icon-cache.ts`，加载完成即重渲染）。资产缺 = 不渲染，不顶替。 */
let clanIconVersion = 0;
const bumpVersion = () => { clanIconVersion++; };
const getVersion = () => clanIconVersion;

function ClanIconImg({ markId }: { markId: string }) {
  useSyncExternalStore((cb) => subscribeClanIcons(() => { bumpVersion(); cb(); }), getVersion);
  const { icon } = getClanIcon(markId);
  if (!icon) return null;   // 还在加载 或 资产缺 —— 两种都不画
  return <img className="jp-clan-icon" src={icon.el.src} width={16} height={16} alt="" />;
}
