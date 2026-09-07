import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSyncExternalStore } from 'react';
import { getGameSnapshot, subscribeGame } from '../../app/gameStore.js';
import { CLASS_DIR, SKILLS, CLASS_TIERS, SKILLS_PER_PAGE, skillIconUrl, weaponIconUrl, type SkillDef } from '../../game/skillData.js';
import { transparentBmp } from '../../game/transparentBmp.js';
import { t } from '../../i18n/index.js';

// 学习等级 / 熟练度：服务端原版技能表同步前，用角色等级推断占位。
// PT 掌握规则 ≈ 每超 reqLv 10 级可练高 1 级；熟练度（mastery）暂为 0，待服务端推送。
function learnedLevel(charLevel: number, reqLv: number): number {
  if (charLevel < reqLv) return 0;
  return Math.min(20, Math.floor((charLevel - reqLv) / 10) + 1);
}

// —— 假数据（DEMO）：服务端技能表接入前，按技能分类规则生成 MP/SP/效果/下一级效果 ——
function demoMp(skill: SkillDef): number {
  return Math.round((skill.reqLv * 1.5 + skillReqWeight(skill) * 6) / 5) * 5;
}
function demoSp(skill: SkillDef): number {
  return skillReqWeight(skill) > 0 ? Math.round(skill.reqLv * 0.8 / 5) * 5 : 60;
}
function skillReqWeight(skill: SkillDef): number {
  // 每超 reqLv 基准等级，粗略算技能档位
  return Math.max(0, Math.floor((skill.reqLv - 10) / 10));
}
/** 假数据效果值：lv=0 表示未学习（显示基础值），lv≥1 按等级缩放 */
function demoEffect(skill: SkillDef, tierWeight: number, lv: number): string {
  const base = 40 + skill.reqLv * 3 + tierWeight * 15;
  const mult = lv > 0 ? 1 + (lv - 1) * 0.08 : 1;
  switch (skill.type) {
    case 'Passive':
      return `Permanently increases the stat by ${Math.round(base * mult / 4)}%`;
    case 'Buff':
      return `Duration ${Math.round((15 + skill.reqLv * 0.2) * (lv > 0 ? 1 + (lv-1)*0.03 : 1))}s · effect +${Math.round(base * mult / 3)}%`;
    case 'Summon':
      return `Companion ${Math.round(base * mult * 2)} HP · attack ${Math.round(base * mult)}`;
    case 'Single Target':
    case 'Target Area':
    case 'Area Attack':
    case 'Active':
      return `Deals ${Math.round(base * mult)}~${Math.round(base * mult * 1.4)} damage`;
    default:
      return `Effect ${Math.round(base * mult)}`;
  }
}
function demoNextEffect(skill: SkillDef, tierWeight: number, curLv: number): string {
  return demoEffect(skill, tierWeight, curLv + 1);
}

// 武器图标说明（DB skillinfo.itemallowedtype 对齐原版 UseSkillItemInfo）
const WEAPON_NAMES: Record<number, string> = {
  1: 'Axe', 2: 'Staff', 3: 'Hammer', 4: 'Shield', 5: 'Pole/Spear',
  6: 'Sword', 7: 'Claw', 8: 'Shooter', 9: 'Throwing', 10: 'Dagger', 11: 'Twin Blade',
};

// 技能图标：黑色背景透明化后本身即六边形，无需外部遮罩。
function useSkillIconSrc(classDir: string, iconFile: string): string {
  const url = skillIconUrl(classDir, iconFile);
  const [src, setSrc] = useState(url);
  useEffect(() => {
    let alive = true;
    transparentBmp(url).then((processed) => {
      if (alive) setSrc(processed ?? url);
    });
    return () => {
      alive = false;
    };
  }, [url]);
  return src;
}

// 技能面板（原版布局，仅客户端）：
// 单列 5 排（T1-T5），每排上方为职业名分栏标题（.jp-sec 式），下方 4 个技能横排。
// 技能格：六边形图标（黑色背景已透明化）+ 底部水平熟练度条 + 悬停信息框（portal 跟随鼠标，脱离面板）。
export default function SkillPanel() {
  const { character } = useSyncExternalStore(subscribeGame, getGameSnapshot);
  const [tip, setTip] = useState<{ skill: SkillDef; lv: number; x: number; y: number } | null>(null);

  const classDir = character ? CLASS_DIR[character.job] ?? 'fighter' : 'fighter';
  const skills = character ? SKILLS[classDir] ?? [] : [];
  const tiers = character ? CLASS_TIERS[classDir] ?? [] : [];

  const rows = useMemo(
    () => Array.from({ length: 5 }, (_, i) => ({
      tierName: tiers[i] ?? `T${i + 1}`,
      base: i * SKILLS_PER_PAGE,
      skills: skills.slice(i * SKILLS_PER_PAGE, (i + 1) * SKILLS_PER_PAGE),
    })),
    [tiers, skills],
  );

  const c = character;
  if (!c) return <div className="jp-nodata">{t('panel.noData')}</div>;

  return (
    <div className="jp-skillpanel">
      {rows.map((row) => (
        <div key={row.tierName} className="jp-skill-group">
          <div className="jp-sec jp-skill-tier">{row.tierName}</div>
          <div className="jp-skill-row-skills">
            {row.skills.map((s, i) => (
              <SkillCell key={row.base + i} skill={s} classDir={classDir} charLevel={c.level} onTip={setTip} />
            ))}
          </div>
        </div>
      ))}
      <div className="jp-skill-pts">
        <div className="jp-skill-pt">
          <span>{t('skills.pt')}</span>
          <b>{c.skillPoint}</b>
        </div>
        <div className="jp-skill-pt">
          <span>{t('skills.ptSpecial')}</span>
          <b>{c.specialSkillPoint}</b>
        </div>
      </div>
      {tip && createPortal(<SkillTip skill={tip.skill} lv={tip.lv} x={tip.x} y={tip.y} />, document.body)}
    </div>
  );
}

function SkillCell(props: {
  skill: SkillDef;
  classDir: string;
  charLevel: number;
  onTip: (tip: { skill: SkillDef; lv: number; x: number; y: number } | null) => void;
}) {
  const { skill, classDir, charLevel, onTip } = props;
  const lv = learnedLevel(charLevel, skill.reqLv);
  const learned = lv > 0;
  const masteryPct = 0; // 熟练度占位：服务端推送后替换
  const iconSrc = useSkillIconSrc(classDir, skill.iconFile);
  return (
    <div
      className={learned ? 'jp-skill-cell' : 'jp-skill-cell jp-skill-cell--locked'}
      onMouseEnter={(e) => onTip({ skill, lv, x: e.clientX, y: e.clientY })}
      onMouseMove={(e) => onTip({ skill, lv, x: e.clientX, y: e.clientY })}
      onMouseLeave={() => onTip(null)}
    >
      <div className="jp-skill-iconbox">
        <img className={learned ? 'jp-skill-icon' : 'jp-skill-icon jp-skill-icon--locked'} src={iconSrc} alt={skill.name} />
        <span className="jp-skill-lv">{learned ? `Lv.${lv}` : '—'}</span>
      </div>
      <div className="jp-skill-mastery">
        <div className="jp-skill-mastery-bar" style={{ width: `${masteryPct}%` }} />
      </div>
    </div>
  );
}

function SkillTip(props: { skill: SkillDef; lv: number; x: number; y: number }) {
  const { skill, lv, x, y } = props;
  const masteryPct = 0;
  const tw = skillReqWeight(skill);
  const mp = demoMp(skill);
  const sp = demoSp(skill);
  const weapons = skill.weapon ?? [];
  const curEffect = demoEffect(skill, tw, lv);
  const nextEffect = demoNextEffect(skill, tw, lv);
  const style = {
    left: x + 18,
    top: y + 14,
    maxWidth: 'min(340px, calc(100vw - 40px))',
  };
  return (
    <div className="jp-skill-tip" style={style}>
      <div className="jp-skill-tip-name">{skill.name}</div>
      <div className="jp-skill-tip-row">{t('skills.reqLevel')}: <b>{skill.reqLv}</b></div>
      <div className="jp-skill-tip-row">{t('skills.skillType')}: {skill.type}</div>
      {skill.alt && <div className="jp-skill-tip-row jp-skill-tip-alt">({skill.alt})</div>}
      <div className="jp-skill-tip-row">{t('skills.consume')}: MP {mp} / SP {sp}</div>
      {weapons.length > 0 && (
        <div className="jp-skill-tip-row jp-skill-tip-weapon">
          {t('skills.weapon')}:
          <span className="jp-skill-tip-wicons">
            {weapons.map((w) => (
              <img key={w} className="jp-skill-tip-wicon" src={weaponIconUrl(w)} alt={WEAPON_NAMES[w] ?? String(w)} title={WEAPON_NAMES[w] ?? String(w)} />
            ))}
          </span>
        </div>
      )}
      <div className="jp-skill-tip-desc">{skill.desc}</div>
      {lv > 0 && <div className="jp-skill-tip-row jp-skill-tip-cur">Lv {lv}: {curEffect}</div>}
      <div className="jp-skill-tip-row jp-skill-tip-next">Lv {Math.max(1, lv + 1)}: {nextEffect}</div>
      <div className="jp-skill-tip-row">{t('skills.mastery')}: <b>{masteryPct}%</b></div>
      <div className="jp-skill-tip-demo">{t('skills.demo')}</div>
    </div>
  );
}