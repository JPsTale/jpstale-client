import { useRef, useState, useSyncExternalStore, type DragEvent } from 'react';
import { getGameSnapshot, setSkillBarSlot, subscribeGame } from '../../app/gameStore.js';
import { CLASS_DIR, SKILLS, SKILLS_PER_PAGE, SKILL_PAGES, skillIconUrl } from '../../game/skillData.js';
import { sendUseSkill } from '../../net/bridge.js';
import { t } from '../../i18n/index.js';

const BAR_SLOTS = 12;

// 技能面板（仅客户端）：5 页（T1-T5）×4 技能，图标可拖入下方 F1-F12 快捷栏。
// 释放走 sendUseSkill → C2S_UseSkill（服务端当前占位普攻）；拖入格会话内留存。
export default function SkillPanel() {
  const { character, skillBar } = useSyncExternalStore(subscribeGame, getGameSnapshot);
  const [page, setPage] = useState(0);
  // HTML5 drop 后会紧跟触发 click；300ms 内吞掉，避免「拖完顺手放技能」
  const lastDropAt = useRef(0);

  if (!character) return <div className="jp-nodata">{t('panel.noData')}</div>;
  const classDir = CLASS_DIR[character.job] ?? 'fighter';
  const skills = SKILLS[classDir] ?? [];

  const pageSkills = skills.slice(page * SKILLS_PER_PAGE, (page + 1) * SKILLS_PER_PAGE);

  function handleDrop(e: DragEvent<HTMLElement>, slot: number) {
    e.preventDefault();
    const idx = e.dataTransfer.getData('text/skill-index');
    if (idx === '') return;
    const n = Number(idx);
    if (Number.isNaN(n) || n < 0 || n >= skills.length) return;
    setSkillBarSlot(slot, n);
    lastDropAt.current = Date.now();
  }

  function handleSlotClick(slot: number) {
    if (Date.now() - lastDropAt.current < 300) return;
    const idx = skillBar[slot];
    if (idx !== null && idx !== undefined) sendUseSkill(idx);
  }

  return (
    <div className="jp-skillpanel">
      <div className="jp-skill-tabs">
        {Array.from({ length: SKILL_PAGES }, (_, i) => {
          const first = skills[i * SKILLS_PER_PAGE];
          return (
            <button
              key={i}
              type="button"
              className={i === page ? 'jp-skill-tab jp-skill-tab--on' : 'jp-skill-tab'}
              onClick={() => setPage(i)}
            >
              T{i + 1}
              {first ? <span className="jp-skill-tab-lv">Lv.{first.reqLv}</span> : null}
            </button>
          );
        })}
      </div>

      <div className="jp-skill-grid">
        {pageSkills.map((s, pi) => {
          const index = page * SKILLS_PER_PAGE + pi;
          return (
            <div
              key={index}
              className="jp-skill-cell"
              draggable
              onDragStart={(e) => e.dataTransfer.setData('text/skill-index', String(index))}
              title={s.name}
            >
              <img className="jp-skill-icon" src={skillIconUrl(classDir, s.iconFile)} alt={s.name} draggable={false} />
              <div className="jp-skill-name">{s.name}</div>
              <div className="jp-skill-lv">Lv.{s.reqLv}</div>
            </div>
          );
        })}
      </div>

      <div className="jp-skill-hint">{t('skills.barHint')}</div>

      <div className="jp-skillbar">
        {Array.from({ length: BAR_SLOTS }, (_, slot) => {
          const idx = skillBar[slot];
          const skill = idx !== null && idx !== undefined ? skills[idx] : null;
          return (
            <div
              key={slot}
              className={skill ? 'jp-skillbar-slot jp-skillbar-slot--filled' : 'jp-skillbar-slot'}
              onClick={() => handleSlotClick(slot)}
              onContextMenu={(e) => {
                e.preventDefault();
                setSkillBarSlot(slot, null);
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => handleDrop(e, slot)}
              title={skill ? `${skill.name} (F${slot + 1})` : `F${slot + 1}`}
            >
              <span className="jp-skillbar-key">F{slot + 1}</span>
              {skill ? (
                <img className="jp-skillbar-icon" src={skillIconUrl(classDir, skill.iconFile)} alt={skill.name} />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}