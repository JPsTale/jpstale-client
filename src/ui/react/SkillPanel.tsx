import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSyncExternalStore } from 'react';
import { getGameSnapshot, subscribeGame } from '../../app/gameStore.js';
import { CLASS_DIR, SKILLS, CLASS_TIERS, SKILLS_PER_PAGE, skillIconUrl, weaponIconUrl, type SkillDef } from '../../game/skillData.js';
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
function demoNextEffect(skill: SkillDef, tierWeight: number): string {
  const base = 40 + skill.reqLv * 3 + tierWeight * 15;
  const nxt = Math.round(base * (skill.reqLv > 40 ? 1.25 : 1.35));
  switch (skill.type) {
    case 'Passive':
      return `Increases the stat by ${Math.round(base / 4) + 1}% at next level`;
    case 'Buff':
      return `Duration +1s · effect +${Math.round(base / 3) + 3}% at next level`;
    case 'Summon':
      return `Companion ${Math.round(base * 2) + 40} HP · attack ${nxt} at next level`;
    case 'Single Target':
    case 'Target Area':
    case 'Area Attack':
    case 'Active':
      return `Deals ${nxt}~${Math.round(nxt * 1.4)} damage at next level`;
    default:
      return `Effect ${nxt} at next level`;
  }
}

// 武器图标说明（DB skillinfo.itemallowedtype 对齐原版 UseSkillItemInfo）
const WEAPON_NAMES: Record<number, string> = {
  1: 'Axe', 2: 'Staff', 3: 'Hammer', 4: 'Shield', 5: 'Pole/Spear',
  6: 'Sword', 7: 'Claw', 8: 'Shooter', 9: 'Throwing', 10: 'Dagger', 11: 'Twin Blade',
};

// 技能面板（原版布局，仅客户端）：
// 单列 5 排（T1-T5），每排「职业名 + 4 个技能」横排；技能格只显示图标。
// 悬停信息框用 portal 挂到 document.body，position:fixed 跟随鼠标，
// 完全脱离面板容器，不会被面板宽度/高度/overflow 裁剪。
export default function SkillPanel() {
  const { character } = useSyncExternalStore(subscribeGame, getGameSnapshot);
  const [tip, setTip] = useState<{ skill: SkillDef; x: number; y: number } | null>(null);

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
        <SkillRow key={row.tierName} tierName={row.tierName} skills={row.skills} base={row.base} classDir={classDir} charLevel={c.level} onTip={setTip} />
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
      {tip && createPortal(<SkillTip skill={tip.skill} x={tip.x} y={tip.y} />, document.body)}
    </div>
  );
}

function SkillRow(props: {
  tierName: string;
  skills: SkillDef[];
  base: number;
  classDir: string;
  charLevel: number;
  onTip: (tip: { skill: SkillDef; x: number; y: number } | null) => void;
}) {
  return (
    <div className="jp-skill-row">
      <div className="jp-tier-name">{props.tierName}</div>
      <div className="jp-skill-row-skills">
        {props.skills.map((s, i) => (
          <SkillCell key={props.base + i} skill={s} classDir={props.classDir} charLevel={props.charLevel} onTip={props.onTip} />
        ))}
      </div>
    </div>
  );
}

function SkillCell(props: {
  skill: SkillDef;
  classDir: string;
  charLevel: number;
  onTip: (tip: { skill: SkillDef; x: number; y: number } | null) => void;
}) {
  const { skill, classDir, charLevel, onTip } = props;
  const lv = learnedLevel(charLevel, skill.reqLv);
  const learned = lv > 0;
  const masteryPct = 0; // 熟练度占位：服务端推送后替换
  return (
    <div
      className={learned ? 'jp-skill-cell' : 'jp-skill-cell jp-skill-cell--locked'}
      onMouseEnter={(e) => onTip({ skill, x: e.clientX, y: e.clientY })}
      onMouseMove={(e) => onTip({ skill, x: e.clientX, y: e.clientY })}
      onMouseLeave={() => onTip(null)}
    >
      <div className="jp-skill-iconbox">
        <div className={learned ? 'jp-hex jp-hex--learned' : 'jp-hex'}>
          <img className="jp-hex-img" src={skillIconUrl(classDir, skill.iconFile)} alt={skill.name} />
        </div>
        <div className="jp-skill-fill">
          <div className="jp-skill-fill-bar" style={{ height: `${masteryPct}%` }} />
        </div>
        <span className="jp-skill-lv">{learned ? `Lv.${lv}` : '—'}</span>
      </div>
    </div>
  );
}

function SkillTip(props: { skill: SkillDef; x: number; y: number }) {
  const { skill, x, y } = props;
  const masteryPct = 0;
  const tw = skillReqWeight(skill);
  const mp = demoMp(skill);
  const sp = demoSp(skill);
  const weapons = skill.weapon ?? [];
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
      <div className="jp-skill-tip-row jp-skill-tip-next">{t('skills.nextEffect')}: {demoNextEffect(skill, tw)}</div>
      <div className="jp-skill-tip-row">{t('skills.mastery')}: <b>{masteryPct}%</b></div>
      <div className="jp-skill-tip-demo">{t('skills.demo')}</div>
    </div>
  );
}