import { useSyncExternalStore } from 'react';
import { getGameSnapshot, subscribeGame } from '../../app/gameStore.js';
import { CLASS_DIR, SKILLS, CLASS_TIERS, SKILLS_PER_PAGE, skillIconUrl, type SkillDef } from '../../game/skillData.js';
import { t } from '../../i18n/index.js';

// 学习等级 / 熟练度：服务端原版技能表同步前，用角色等级推断占位。
// PT 掌握规则 ≈ 每超 reqLv 10 级可练高 1 级；熟练度（mastery）暂为 0，待服务端推送。
function learnedLevel(charLevel: number, reqLv: number): number {
  if (charLevel < reqLv) return 0;
  return Math.min(20, Math.floor((charLevel - reqLv) / 10) + 1);
}

// 技能面板（原版布局，仅客户端）：
// 左列 T1-T4 四行，每行「职业名 + 4 技能」；右侧 T5 一行（未来 T6 接其下），右下角技能点。
// 已学=彩色、未学=灰色；图标六边形遮罩；每格右侧竖条为熟练度进度。
export default function SkillPanel() {
  const { character } = useSyncExternalStore(subscribeGame, getGameSnapshot);

  if (!character) return <div className="jp-nodata">{t('panel.noData')}</div>;
  const c = character;
  const classDir = CLASS_DIR[c.job] ?? 'fighter';
  const skills = SKILLS[classDir] ?? [];
  const tiers = CLASS_TIERS[classDir] ?? [];

  const leftRows = [0, 1, 2, 3].map((t) => ({
    tierName: tiers[t] ?? `T${t + 1}`,
    base: t * SKILLS_PER_PAGE,
    skills: skills.slice(t * SKILLS_PER_PAGE, (t + 1) * SKILLS_PER_PAGE),
  }));
  const t5 = {
    tierName: tiers[4] ?? 'T5',
    base: 4 * SKILLS_PER_PAGE,
    skills: skills.slice(4 * SKILLS_PER_PAGE, 5 * SKILLS_PER_PAGE),
  };

  return (
    <div className="jp-skillpanel">
      <div className="jp-skill-col">
        {leftRows.map((row) => (
          <SkillRow key={row.tierName} tierName={row.tierName} skills={row.skills} base={row.base} classDir={classDir} charLevel={c.level} />
        ))}
      </div>
      <div className="jp-skill-side">
        <SkillRow tierName={t5.tierName} skills={t5.skills} base={t5.base} classDir={classDir} charLevel={c.level} />
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
      </div>
    </div>
  );
}

function SkillRow(props: { tierName: string; skills: SkillDef[]; base: number; classDir: string; charLevel: number }) {
  return (
    <div className="jp-skill-row">
      <div className="jp-tier-name">{props.tierName}</div>
      {props.skills.map((s, i) => (
        <SkillCell key={props.base + i} skill={s} classDir={props.classDir} charLevel={props.charLevel} />
      ))}
    </div>
  );
}

function SkillCell(props: { skill: SkillDef; classDir: string; charLevel: number }) {
  const { skill, classDir, charLevel } = props;
  const lv = learnedLevel(charLevel, skill.reqLv);
  const learned = lv > 0;
  const masteryPct = 0; // 熟练度占位：服务端推送后替换
  return (
    <div className={learned ? 'jp-skill-cell' : 'jp-skill-cell jp-skill-cell--locked'} title={`${skill.name} · 熟练度 ${masteryPct}%`}>
      <div className="jp-skill-iconbox">
        <div className={learned ? 'jp-hex jp-hex--learned' : 'jp-hex'}>
          <img className="jp-hex-img" src={skillIconUrl(classDir, skill.iconFile)} alt={skill.name} />
        </div>
        <div className="jp-skill-fill">
          <div className="jp-skill-fill-bar" style={{ height: `${masteryPct}%` }} />
        </div>
        <span className="jp-skill-lv">{learned ? `Lv.${lv}` : '—'}</span>
      </div>
      <div className="jp-skill-name">{skill.name}</div>
    </div>
  );
}