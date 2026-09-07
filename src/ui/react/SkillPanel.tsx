import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSyncExternalStore } from 'react';
import { getGameSnapshot, subscribeGame, equipFist, setQuickBinding, type FistBinding } from '../../app/gameStore.js';
import { CLASS_DIR, SKILLS, CLASS_TIERS, SKILLS_PER_PAGE, skillIconUrl, weaponIconUrl, normalAttackIconUrl, type SkillDef } from '../../game/skillData.js';
import { transparentBmp } from '../../game/transparentBmp.js';
import { SKILL_DEBUG, subscribeSkillDbg, getSkillDbgSnapshot, dbgLevel, setDbgLevel, dbgWeaponIndex, setDbgWeapon, resetDbgLevels, DBG_WEAPONS } from '../../game/skillDbg.js';
import { t } from '../../i18n/index.js';

// 学习等级 / 熟练度：服务端原版技能表同步前，用角色等级推断占位。
// PT 掌握规则 ≈ 每超 reqLv 10 级可练高 1 级；熟练度（mastery）暂为 0，待服务端推送。
function learnedLevel(charLevel: number, reqLv: number): number {
  if (charLevel < reqLv) return 0;
  return Math.min(20, Math.floor((charLevel - reqLv) / 10) + 1);
}

/** 技能当前等级：调试模式下手动等级(0~10)优先，否则按角色等级自动推断。 */
function effectiveLevel(charLevel: number, reqLv: number, iconFile: string): number {
  const dbg = dbgLevel(iconFile);
  if (SKILL_DEBUG && dbg != null) return dbg;
  return learnedLevel(charLevel, reqLv);
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
function useSkillIconSrc(url: string): string {
  const [src, setSrc] = useState(url);
  useEffect(() => {
    let alive = true;
    transparentBmp(url).then((processed) => {
      if (alive) setSrc(processed ?? url);
    });
    return () => { alive = false; };
  }, [url]);
  return src;
}

interface TipData { skill: SkillDef; lv: number; x: number; y: number }

// 可绑拳规则（useCode）：左键绑左拳需 LEFT/ALL；右键绑右拳需 RIGHT/ALL。
function canBindLeft(useCode: SkillDef['useCode']): boolean {
  return useCode === 'LEFT' || useCode === 'ALL';
}
function canBindRight(useCode: SkillDef['useCode']): boolean {
  return useCode === 'RIGHT' || useCode === 'ALL';
}

// 技能面板：
// - 顶部普攻格（拳头）：左键绑左拳 / 右键绑右拳 → 恢复普通攻击
// - 技能格：左键绑左拳、右键绑右拳（仅已学 + useCode 允许）；被动不可绑
// - 按住鼠标（左/右）在技能格上按 F1~F8 → 记录快捷绑定到对应拳；同 F 键覆盖旧绑定
// - 已绑定状态角标：L=左拳、R=右拳、F1~F8 小标
export default function SkillPanel() {
  const snap = useSyncExternalStore(subscribeGame, getGameSnapshot);
  const dbgSnap = useSyncExternalStore(subscribeSkillDbg, getSkillDbgSnapshot);
  const { character, fistBindings, quickBindings } = snap;
  const [tip, setTip] = useState<TipData | null>(null);
  // 当前按住的鼠标键（用于 F1-F8 录制判定目标拳）
  const pressedBtn = useRef<'left' | 'right' | null>(null);

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
  void dbgSnap; // skillDbg 订阅：调试等级/武器变化触发本面板重渲染

  // 绑定技能到拳；bind=null 表示普通攻击
  function bind(target: 'left' | 'right', bind: FistBinding | null): void {
    equipFist(target, bind);
  }

  // 某技能当前是否绑在某拳
  function fistOf(classDir: string, iconFile: string): 'left' | 'right' | null {
    const norm = iconFile.replace(/\.bmp$/i, '');
    if (fistBindings.left && fistBindings.left.classDir === classDir && fistBindings.left.iconFile === norm) return 'left';
    if (fistBindings.right && fistBindings.right.classDir === classDir && fistBindings.right.iconFile === norm) return 'right';
    return null;
  }

  // 某技能绑定的 F 键（返回 1-8）
  function quickKeyOf(classDir: string, iconFile: string): number | null {
    const norm = iconFile.replace(/\.bmp$/i, '');
    for (let i = 0; i < 8; i++) {
      const q = quickBindings[i];
      if (q && q.classDir === classDir && q.iconFile === norm) return i + 1;
    }
    return null;
  }

  return (
    <div
      className="jp-skillpanel"
      onPointerDown={(e) => { pressedBtn.current = e.button === 2 ? 'right' : e.button === 0 ? 'left' : null; }}
      onPointerUp={() => { pressedBtn.current = null; }}
      onPointerLeave={() => { pressedBtn.current = null; }}
    >
      {/* 顶部提示行：操作说明 */}
      <div className="jp-skill-hint">{t('skills.equipHint')}</div>

      {/* 调试工具条：武器切换 + 重置等级（SKILL_DEBUG 关闭即整体移除） */}
      {SKILL_DEBUG && (
        <div className="jp-skill-dbgbar">
          <label className="jp-skill-dbgbar-label">
            {t('skills.dbgWeapon')}
            <select
              className="jp-skill-dbgbar-select"
              value={dbgWeaponIndex()}
              onChange={(e) => setDbgWeapon(Number(e.target.value))}
            >
              {DBG_WEAPONS.map((w, i) => (
                <option key={w.dorp || 'none'} value={i}>{w.label}</option>
              ))}
            </select>
          </label>
          <button type="button" className="jp-skill-dbgbar-btn" onClick={() => resetDbgLevels()}>
            {t('skills.dbgReset')}
          </button>
        </div>
      )}

      {/* 普攻格行：恢复普通攻击 */}
      <div className="jp-skill-group">
        <div className="jp-sec jp-skill-tier">{t('skills.normalAttack')}</div>
        <div className="jp-skill-row-skills">
          <NormalAttackCell
            classDir={classDir}
            fistBindings={fistBindings}
            onEquip={(target) => bind(target, null)}
            onRecord={(target, key) => setQuickBinding(key - 1, { classDir, iconFile: 'skill_normal', target })}
            bindState={pressedBtn}
            quickKeyOf={(iconFile) => quickKeyOf(classDir, iconFile)}
          />
        </div>
      </div>

      {rows.map((row) => (
        <div key={row.tierName} className="jp-skill-group">
          <div className="jp-sec jp-skill-tier">{row.tierName}</div>
          <div className="jp-skill-row-skills">
            {row.skills.map((s, i) => (
              <SkillCell
                key={row.base + i}
                skill={s}
                classDir={classDir}
                lv={effectiveLevel(c.level, s.reqLv, s.iconFile)}
                dbgLv={dbgLevel(s.iconFile)}
                fistOf={() => fistOf(classDir, s.iconFile)}
                quickKey={() => quickKeyOf(classDir, s.iconFile)}
                onEquip={(target) => bind(target, { classDir, iconFile: s.iconFile.replace(/\.bmp$/i, '') })}
                onRecord={(target, key) => setQuickBinding(key - 1, { classDir, iconFile: s.iconFile.replace(/\.bmp$/i, ''), target })}
                onChangeLevel={(v) => setDbgLevel(s.iconFile, v)}
                bindState={pressedBtn}
                onTip={setTip}
              />
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

// —— 通用格子交互（普攻格/技能格共用）：左/右键绑定 + F1-F8 录制 ——
interface CellBinding {
  onEquip(target: 'left' | 'right'): void;
  /** 录制 F 键快捷绑定（按下鼠标左/右键时同时按 F1~F8） */
  onRecord(target: 'left' | 'right', key: number): void;
  /** 当前按住的鼠标键 */
  bindState: React.MutableRefObject<'left' | 'right' | null>;
  /** 该技能绑定的 F 键号（1-8），无则 null */
  quickKey?: number | null;
  /** 绑定的拳（角标显示），无则 null */
  fist?: 'left' | 'right' | null;
}

/** 是否允许点击绑定（技能格 override：learned + useCode；普攻恒可） */
function useEquipAction(cb: CellBinding, allowed: boolean, useCode?: SkillDef['useCode']): {
  onPointerDown?: (e: React.PointerEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
} {
  if (!allowed) {
    return { onContextMenu: (e) => e.preventDefault() };
  }
  const bindLeft = useCode ? canBindLeft(useCode) : true;
  const bindRight = useCode ? canBindRight(useCode) : true;

  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0 && e.button !== 2) return;
      const target = e.button === 0 ? 'left' : 'right';
      if (e.button === 0 && !bindLeft) return;
      if (e.button === 2 && !bindRight) return;
      cb.onEquip(target);
    },
    onContextMenu: (e) => e.preventDefault(),
    onKeyDown: (e: React.KeyboardEvent) => {
      // F1-F8 录制：需正按住某鼠标键（记录 target 拳）
      const m = /^F([1-8])$/.exec(e.key);
      if (!m) return;
      const target = cb.bindState.current;
      if (!target) return;
      e.preventDefault();
      e.stopPropagation();
      cb.onRecord(target, Number(m[1]));
    },
  };
}

function NormalAttackCell(props: {
  classDir: string;
  fistBindings: { left: FistBinding | null; right: FistBinding | null };
  onEquip(target: 'left' | 'right'): void;
  onRecord(target: 'left' | 'right', key: number): void;
  bindState: React.MutableRefObject<'left' | 'right' | null>;
  quickKeyOf(iconFile: string): number | null;
}) {
  const { classDir, fistBindings, onEquip, onRecord, bindState, quickKeyOf } = props;
  const iconFile = 'skill_normal';
  const url = normalAttackIconUrl();
  const iconSrc = useSkillIconSrc(url);
  const fist = fistOfBinding(fistBindings, classDir, iconFile);
  const quickKey = quickKeyOf(iconFile);
  const actions = useEquipAction({ onEquip, onRecord, bindState }, true);

  return (
    <div
      className="jp-skill-cell"
      title={t('skills.normalAttackTip')}
      {...actions}
    >
      <div className="jp-skill-iconbox">
        <img className="jp-skill-icon" src={iconSrc} alt={t('skills.normalAttack')} />
        {fist && <span className={`jp-skill-fistbadge jp-skill-fistbadge--${fist}`}>{fist === 'left' ? 'L' : 'R'}</span>}
        {quickKey && <span className="jp-skill-keybadge">F{quickKey}</span>}
      </div>
      <div className="jp-skill-mastery"><div className="jp-skill-mastery-bar" style={{ width: '0%' }} /></div>
    </div>
  );
}

function fistOfBinding(fb: { left: FistBinding | null; right: FistBinding | null }, classDir: string, iconFile: string): 'left' | 'right' | null {
  const norm = iconFile.replace(/\.bmp$/i, '');
  if (fb.left && fb.left.classDir === classDir && fb.left.iconFile === norm) return 'left';
  if (fb.right && fb.right.classDir === classDir && fb.right.iconFile === norm) return 'right';
  return null;
}

function SkillCell(props: {
  skill: SkillDef;
  classDir: string;
  lv: number;               // 有效技能等级（0=未学习；调试可手动覆盖）
  dbgLv: number | null;     // 调试手动等级（null=未手动设置）
  fistOf(): 'left' | 'right' | null;
  quickKey(): number | null;
  onEquip(target: 'left' | 'right'): void;
  onRecord(target: 'left' | 'right', key: number): void;
  onChangeLevel(lv: number | null): void;
  bindState: React.MutableRefObject<'left' | 'right' | null>;
  onTip: (tip: TipData | null) => void;
}) {
  const { skill, classDir, lv, dbgLv, fistOf, quickKey, onEquip, onRecord, onChangeLevel, bindState, onTip } = props;
  const learned = lv > 0;
  const masteryPct = 0; // 熟练度占位：服务端推送后替换
  const iconSrc = useSkillIconSrc(skillIconUrl(classDir, skill.iconFile));
  const useCode = skill.useCode;
  const canBind = learned && useCode !== 'NOT';
  const canL = canBindLeft(useCode);
  const canR = canBindRight(useCode);
  const fist = learned ? fistOf() : null;
  const qkey = learned ? quickKey() : null;
  const actions = useEquipAction({ onEquip, onRecord, bindState }, canBind, useCode);

  // 说明标题
  let title = skill.name;
  if (learned) {
    if (fist === 'left') title += `\n[${t('skills.equipLeft')}]`;
    else if (fist === 'right') title += `\n[${t('skills.equipRight')}]`;
    if (qkey) title += `\n[${t('skills.quickKey')} F${qkey}]`;
    title += `\n${t('skills.equipHint')}`;
  }

  return (
    <div
      className={learned ? 'jp-skill-cell' : 'jp-skill-cell jp-skill-cell--locked'}
      title={title}
      {...actions}
      onMouseEnter={(e) => learned && onTip({ skill, lv, x: e.clientX, y: e.clientY })}
      onMouseMove={(e) => learned && onTip({ skill, lv, x: e.clientX, y: e.clientY })}
      onMouseLeave={() => onTip(null)}
    >
      <div className="jp-skill-iconbox">
        <img className={learned ? 'jp-skill-icon' : 'jp-skill-icon jp-skill-icon--locked'} src={iconSrc} alt={skill.name} />
        <span className="jp-skill-lv">{learned ? `Lv.${lv}` : '—'}</span>
        {learned && canL && fist === null && !canR && (
          <span className="jp-skill-fistonly">L</span>
        )}
        {fist && <span className={`jp-skill-fistbadge jp-skill-fistbadge--${fist}`}>{fist === 'left' ? 'L' : 'R'}</span>}
        {qkey && <span className="jp-skill-keybadge">F{qkey}</span>}
      </div>
      <div className="jp-skill-mastery">
        <div className="jp-skill-mastery-bar" style={{ width: `${masteryPct}%` }} />
      </div>
      {/* 调试：技能等级微调（0=未学，1~10 级）。▲▼ 停更于图标下沿。 */}
      {SKILL_DEBUG && (
        <div className="jp-skill-lvdbg">
          <button
            type="button"
            className="jp-skill-lvdbg-btn"
            onClick={(e) => { e.stopPropagation(); const base = dbgLv ?? 0; onChangeLevel(base <= 0 ? 0 : base - 1); }}
            title={t('skills.lvDown')}
          >−</button>
          <span
            className={`jp-skill-lvdbg-val${dbgLv != null ? ' jp-skill-lvdbg-val--set' : ''}`}
            onClick={(e) => { e.stopPropagation(); onChangeLevel(null); }}
            title={dbgLv != null ? t('skills.lvReset') : t('skills.lvAuto')}
          >
            {dbgLv != null ? String(dbgLv) : '·'}
          </span>
          <button
            type="button"
            className="jp-skill-lvdbg-btn"
            onClick={(e) => { e.stopPropagation(); const base = dbgLv ?? 0; onChangeLevel(base >= 10 ? 10 : base + 1); }}
            title={t('skills.lvUp')}
          >+</button>
        </div>
      )}
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
