import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSyncExternalStore } from 'react';
import { getGameSnapshot, subscribeGame } from '../../app/gameStore.js';
import { CLASS_DIR, SKILLS, CLASS_TIERS, SKILLS_PER_PAGE, skillIconUrl, skillNameKey, weaponIconUrl, WEAPON_NAMES, normalAttackIconUrl, type SkillDef } from '../../game/skillData.js';
import { transparentBmp } from '../../game/transparentBmp.js';
import { t } from '../../i18n/index.js';
import { skillLevelOf, skillMasteryOf } from '../../game/skillLevel.js';
import { skillMpCost, skillSpCost } from '../../game/skillCost.js';
import { skillCdProgress } from '../../game/skillCooldown.js';
import { skillName, skillDesc } from '../../game/skillText.js';
import { skillIdByIcon, skillRowBySkillId, type SkillIdentityRow } from '../../game/skillIdentity.js';
import { learnGate, type LearnGate } from '../../game/skillLearn.js';
import { bindQuickKey, equipFistSkill, sendLearnSkill, sendResetSkillPoints } from '../../net/bridge.js';
import { UNBOUND, fistSlotOfSkill, quickKeyOfSkill, type FistSlot } from '../../game/skillBinding.js';

// 技能等级/熟练度 = **服务端 `S2C_SkillList`**（唯一实现在 `game/skillLevel.ts`）；
// 面板里"这一格是哪个技能"= `iconFile → skillId → 生成物整行`（唯一实现在 `game/skillIdentity.ts`）。
// 服务端的表还没到时等级是 `null` ⇒ 一律按**未学**显示、不可绑（AGENTS #12：不拿角色等级猜一个等级）。
//
// 绑定（拳位 / F1~F8）= **服务端 `S2C_SkillBindings`**（按角色存在 props，唯一解释处 `game/skillBinding.ts`）：
// 面板**只发包**（`equipFistSkill` / `bindQuickKey`），**不做乐观更新**，界面等回推；
// 绑定表没到（`null`）时面板**不可绑**并说明（不拿本地残留顶上）。

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
// —— WEAPON_NAMES 定义在 skillData（技能面板与职业实验室共用同一份）。

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

interface TipData { skill: SkillDef; skillId: number | null; lv: number; mastery: number; x: number; y: number; displayName: string }

// 可绑拳规则（useCode）：左键绑左拳需 LEFT/ALL；右键绑右拳需 RIGHT/ALL。
// 取值来自**生成物那一行**（= 服务端同一张表；与客户端 `skillData.useCode` 由 `verify-skill-usecode` 钉死一致）。
function canBindLeft(useCode: string): boolean {
  return useCode === 'LEFT' || useCode === 'ALL';
}
function canBindRight(useCode: string): boolean {
  return useCode === 'RIGHT' || useCode === 'ALL';
}

// 技能面板：
// - 顶部普攻格（拳头）：左键绑左拳 / 右键绑右拳 → 恢复普通攻击
// - 技能格：左键绑左拳、右键绑右拳（仅已学 + useCode 允许）；被动不可绑
// - 技能格底部 `+ 学习`：**真加点**（发 `C2S_LearnSkill`，等级/点数等 `S2C_SkillList` 回推）——
//   判定见 `game/skillLearn.ts`；权威在服务端（被拒回 `skill.op.*`）
// - 按住鼠标（左/右）在技能格上按 F1~F8 → 记录快捷绑定到对应拳；同 F 键覆盖旧绑定
// - 已绑定状态角标：L=左拳、R=右拳、F1~F8 小标
// - 面板底部两池剩余点（`skills.pt` / `skills.ptSpecial`）—— 唯一的点数显示处
export default function SkillPanel() {
  const snap = useSyncExternalStore(subscribeGame, getGameSnapshot);
  const { character, skillBindings, skillList } = snap;
  const [tip, setTip] = useState<TipData | null>(null);
  // 竖条（熟练度/CD）自己的 hover 提示 —— 与技能信息窗是**两个** tip：鼠标从格子滑到竖条上时
  // 格子那边会 onMouseLeave（信息窗关掉），这里接着显示"熟练度 N%"。
  const [barTip, setBarTip] = useState<BarTipData | null>(null);
  // CD 条的**重绘节流**：面板开着时每 150ms 检查一次，**只有真有 CD 在跑**才 setState
  // （否则 React 面板会一直空转重绘；HUD 是 canvas 每帧重画，不需要这个）。

  // 当前按住的鼠标键（用于 F1-F8 录制判定目标拳）
  const pressedBtn = useRef<'left' | 'right' | null>(null);
  // 当前鼠标悬停的技能格 → 其录 F 键回调（原版 SkillButtonIndex 语义：悬停格上按 F 录制）。
  // 只要 key（F 键号 1..8）：录的是**哪个技能**由悬停那一格自己带着（身份 = 该格的 skillId）。
  const hoverRecord = useRef<((key: number) => void) | null>(null);

  // F1-F8 录制：键盘事件需在 window 层捕获（技能格非焦点元素，onKeyDown 收不到）。
  // 语义 = 原版 cSKILL::KeyDown：鼠标悬停技能格 + 正按住鼠标键 → 记 ShortKey + MousePosi。
  // 用捕获阶段注册：录制命中时 stopImmediatePropagation，阻止 main 的 keyBinding(bubble)
  // 把同一 F 键当作"游戏内快捷切拳"处理；未命中录制则放行给 keyBinding 切拳。
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const m = /^F([1-8])$/.exec(e.key);
      if (!m) return;
      // 必须正按着某只鼠标（源码 `sinSkill.cpp:1447/1460` 的 `LDownButtonIndex/RDownButtonIndex` 条件）
      const rec = hoverRecord.current;
      if (!pressedBtn.current || !rec) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      rec(Number(m[1]));
    }
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  // 职业目录：**查不到就是查不到**（不再 `?? 'fighter'` 把别的职业的技能树端出来 —— AGENTS #12）
  const classDir: string | null = character ? CLASS_DIR[character.job] ?? null : null;
  const skills = classDir ? SKILLS[classDir] ?? [] : [];
  const tiers = classDir ? CLASS_TIERS[classDir] ?? [] : [];

  // 每格的身份：`iconFile → skillId → 生成物整行`（查不到 → null，该格按未学/不可绑处理，查表内部已上报）。
  const cells = useMemo(
    () => skills.map((s) => {
      const skillId = skillIdByIcon(s.iconFile);
      return { skill: s, skillId, row: skillId != null ? skillRowBySkillId(skillId) : null };
    }),
    [skills],
  );

  // CD 条的重绘驱动：**用 rAF、不用定时器** —— 150ms 轮询会让面板的 CD 条比 HUD 的弧慢半拍
  // （用户 2026-09-24 实测"CD 不同步"）。rAF 与 HUD 的 canvas 重画同帧率 ⇒ 两条一起动；
  // 且**只有真有 CD 在跑**时才 setState（否则面板空转重绘）。
  const [cdTick, setCdTick] = useState(0);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      if (cells.some((x) => x.skillId != null && skillCdProgress(x.skillId) < 1)) {
        setCdTick((t) => t + 1);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [cells]);

  const rows = useMemo(
    () => Array.from({ length: 5 }, (_, i) => ({
      tierName: tiers[i] ?? `T${i + 1}`,
      base: i * SKILLS_PER_PAGE,
      cells: cells.slice(i * SKILLS_PER_PAGE, (i + 1) * SKILLS_PER_PAGE),
    })),
    [tiers, cells],
  );
  // 剩余点**每帧现读**（不进上面的 memo）：`skillList` 是 store 里的可变值，memo 的依赖里没有它，
  // 放进去就会把上一次收到的点数一直显示（改一点静默失效，正是 AGENTS #24 那类坑）。

  const c = character;
  if (!c) return <div className="jp-nodata">{t('panel.noData')}</div>;
  if (classDir == null) return <div className="jp-nodata">{t('skills.noClass')}</div>;

  // 绑定技能到拳（0 = 恢复普通攻击）。**只发包**，界面等 `S2C_SkillBindings` 回推。
  function bind(target: FistSlot, skillId: number): void {
    equipFistSkill(target, skillId);
  }

  // 某技能当前绑在哪只拳上（唯一实现 `game/skillBinding.ts`：身份是 skillId）
  function fistOf(skillId: number | null): FistSlot | 'both' | null {
    return skillId == null ? null : fistSlotOfSkill(skillBindings, skillId);
  }

  // 某技能绑的 F 键（1-8）；没绑 / 表没到 → null
  function quickKeyOf(skillId: number | null): number | null {
    return skillId == null ? null : quickKeyOfSkill(skillBindings, skillId);
  }

  // 绑定表没到 ⇒ 本面板不可绑 / 不可录 F 键（AGENTS #12：不拿本地残留或默认值顶上）
  const bindingsReady = skillBindings != null;

  return (
    <div
      className="jp-skillpanel"
      onPointerDown={(e) => { pressedBtn.current = e.button === 2 ? 'right' : e.button === 0 ? 'left' : null; }}
      onPointerUp={() => { pressedBtn.current = null; }}
      onPointerLeave={() => { pressedBtn.current = null; }}
    >
      {/* 顶部提示行：操作说明 */}

      {/* 技能表没到 ⇒ 加点一律不可按（AGENTS #12：不拿角色等级或 0 点顶上），这里说明原因 */}
      {skillList == null && <div className="jp-skill-warn">{t('skills.learnNoList')}</div>}
      {/* 绑定表没到 ⇒ 绑定一律不可按（不拿本地残留顶上；上面技能格也据此不可绑） */}
      {!bindingsReady && <div className="jp-skill-warn">{t('skills.bindNoList')}</div>}

      {/* 普攻格行：恢复普通攻击。⚠ **不提供 F 键录制**：协议里 `skill_id = 0` 就是「未绑」，
          没有"F 键绑普通攻击"这个值（原版有 `ShortKey_NormalAttack` 这个独立字段，我们没做 —— 见审计附录） */}
      <div className="jp-skill-group">
        <div className="jp-sec jp-skill-tier">{t('skills.normalAttack')}</div>
        <div className="jp-skill-row-skills">
          <NormalAttackCell
            fistOf={() => fistOf(UNBOUND)}
            quickKey={() => quickKeyOf(UNBOUND)}
            allowed={bindingsReady}
            onEquip={(target) => bind(target, UNBOUND)}
            bindState={pressedBtn}
            onHover={() => { hoverRecord.current = null; }}
            onHoverLeave={() => { hoverRecord.current = null; }}
          />
        </div>
      </div>

      {rows.map((row) => {
        return (
        <div key={row.tierName} className="jp-skill-group">
          <div className="jp-sec jp-skill-tier">{row.tierName}</div>
          <div className="jp-skill-row-skills">
            {row.cells.map((cell, i) => {
              const s = cell.skill;
              const lvl = cell.skillId != null ? skillLevelOf(cell.skillId) : null;
              const mast = cell.skillId != null ? skillMasteryOf(cell.skillId) : 0;
              return (
                // 每个技能格 = [格子][熟练度条][CD 条] —— 两条竖条在**格子外侧**紧贴右边
                // （用户 2026-09-24 定版：不要放进格子内部，会盖住 L/R 与 F 键角标）
                <div className="jp-skill-cellwrap" key={row.base + i}>
                <SkillCell
                  key={row.base + i}
                  skill={s}
                  row={cell.row}
                  gate={learnGate(s.iconFile)}
                  level={cell.skillId != null ? skillLevelOf(cell.skillId) : null}
                  mastery={cell.skillId != null ? skillMasteryOf(cell.skillId) : 0}
                  classDir={classDir}
                  fist={() => fistOf(cell.skillId)}
                  quickKey={() => quickKeyOf(cell.skillId)}
                  allowed={bindingsReady}
                  onLearn={(id) => sendLearnSkill(id)}
                  onEquip={(target) => { if (cell.skillId != null) bind(target, cell.skillId); }}
                  onRecord={(key) => { if (cell.skillId != null) bindQuickKey(key - 1, cell.skillId); }}
                  bindState={pressedBtn}
                  onTip={setTip}
                  onHover={() => {
                    hoverRecord.current = cell.skillId == null ? null
                      : (key) => bindQuickKey(key - 1, cell.skillId!);
                  }}
                  onHoverLeave={() => { hoverRecord.current = null; }}
                />
                <SkillBars learned={(lvl ?? 0) > 0} mastery={mast} skillId={cell.skillId}
                           element0={cell.row?.element0 ?? 0} cdTick={cdTick}
                           passive={cell.row?.useCode === 'NOT'}
                           onTip={setBarTip} />
                </div>
              );
            })}
          </div>
        </div>
        );
      })}
      {/* 技能点：优先 `S2C_SkillList` 的两个池（与学/洗点同一次推送），没到则用 `S2C_CharacterStatus` 的同源值 */}
      <div className="jp-skill-pts">
        <div className="jp-skill-pt">
          <span>{t('skills.pt')}</span>
          <b>{skillList ? skillList.skillPoint : c.skillPoint}</b>
        </div>
        <div className="jp-skill-pt">
          <span>{t('skills.ptSpecial')}</span>
          <b>{skillList ? skillList.specialSkillPoint : c.specialSkillPoint}</b>
        </div>
        {/* 洗点：服务端守卫（会话内一次）说了算，面板只发包不做乐观更新；
            被拒回 skill.op.resetUsed，经 S2C_Error → lastErrorKey 就地显示 */}
        <button type="button" className="jp-skill-reset" onClick={() => sendResetSkillPoints()}>
          {t('skills.reset')}
        </button>
      </div>
      {skillList?.lastErrorKey && <div className="jp-skill-err">{t(skillList.lastErrorKey)}</div>}
      {tip && createPortal(<SkillTip skill={tip.skill} skillId={tip.skillId} lv={tip.lv} mastery={tip.mastery} x={tip.x} y={tip.y} displayName={tip.displayName} />, document.body)}
      {barTip && createPortal(<BarTip {...barTip} />, document.body)}
    </div>
  );
}

// —— 通用格子交互（普攻格/技能格共用）：左/右键绑定（+ 技能格的 F1-F8 录制） ——
interface CellBinding {
  /** 装到某只拳（`skillId` 由各格自己带；普攻格带 `UNBOUND` = 恢复普通攻击） */
  onEquip(target: FistSlot): void;
  /** 录制 F 键快捷绑定（按下鼠标左/右键时同时按 F1~F8）；`recordable=false` 的格子**不接这条路** */
  onRecord(key: number): void;
  /** 当前按住的鼠标键（原版 `LDownButtonIndex`/`RDownButtonIndex`：录 F 键时也要按着鼠标） */
  bindState: React.MutableRefObject<FistSlot | null>;
  /** 该技能绑的 F 键号（1-8），无则 null */
  quickKey?: number | null;
  /** 该技能绑在哪只拳（角标显示），无则 null */
  fist?: FistSlot | null;
  /** 这一格能不能录 F 键（普攻格**不能**：协议里 `skill_id = 0` 就是「未绑」，没有"F 键绑普攻"这个值） */
  recordable?: boolean;
}

/** 是否允许点击绑定（技能格 override：learned + useCode；普攻恒可） */
function useEquipAction(cb: CellBinding, allowed: boolean, useCode?: string): {
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
      const target: FistSlot = e.button === 0 ? 'left' : 'right';
      if (e.button === 0 && !bindLeft) return;
      if (e.button === 2 && !bindRight) return;
      cb.onEquip(target);
    },
    onContextMenu: (e) => e.preventDefault(),
    onKeyDown: cb.recordable === false ? undefined : (e: React.KeyboardEvent) => {
      // F1-F8 录制：需正按住某鼠标键（未按鼠标 ⇒ 不录，与源码的 `LDownButtonIndex/RDownButtonIndex` 同）
      const m = /^F([1-8])$/.exec(e.key);
      if (!m) return;
      if (!cb.bindState.current) return;
      e.preventDefault();
      e.stopPropagation();
      cb.onRecord(Number(m[1]));
    },
  };
}

function NormalAttackCell(props: {
  /** 未绑的拳位就是普攻（`UNBOUND` = 0，两侧都用它当身份） */
  fistOf(): FistSlot | 'both' | null;
  quickKey(): number | null;
  allowed: boolean;
  onEquip(target: FistSlot): void;
  bindState: React.MutableRefObject<FistSlot | null>;
  onHover(): void;
  onHoverLeave(): void;
}) {
  const { fistOf, quickKey, allowed, onEquip, bindState, onHover, onHoverLeave } = props;
  const url = normalAttackIconUrl();
  const iconSrc = useSkillIconSrc(url);
  const fist = fistOf();
  const qkey = quickKey();
  // ⚠ `recordable: false`：普攻格**不录 F 键**（见 CellBinding.recordable 注释）
  const actions = useEquipAction({ onEquip, bindState, onRecord: () => {}, recordable: false }, allowed);

  return (
    <div
      className="jp-skill-cell"
      // ⛔ 同样不设原生 `title`（普攻格与技能格同属这个面板 —— 用户 2026-09-24 要的是
      //   面板内也不再放操作说明行（用户 2026-09-24："纯多余"）。
      aria-label={`${t('skills.normalAttack')} —— ${t('skills.normalAttackTip')}`}
      {...actions}
      onMouseEnter={onHover}
      onMouseLeave={onHoverLeave}
    >
      <div className="jp-skill-iconbox">
        <img className="jp-skill-icon" src={iconSrc} alt={t('skills.normalAttack')} />
        {(fist === 'left' || fist === 'both') && <span className="jp-skill-fistbadge jp-skill-fistbadge--left">L</span>}
        {(fist === 'right' || fist === 'both') && <span className="jp-skill-fistbadge jp-skill-fistbadge--right">R</span>}
        {qkey && <span className="jp-skill-keybadge">F{qkey}</span>}
      </div>
    </div>
  );
}

/**
 * 技能格**右侧的两条竖条**（在格子**之外**、与图标**等高**；用户 2026-09-24 定版）：
 *   · 左 = **熟练度**（绿）：`mastery / 100` %，从下往上填（`mastery` 是**服务端派生的
 *     `UseSkillMastery`**，元素技能它本身就发 10000 ⇒ 满格，不需要在 UI 再特判）；
 *   · 右 = **CD**（金）：`skillCdProgress` 0..1，从下往上填（满 = 可出手）。
 * 配色取**原版贴图实测**：熟练度 `Gage-2.bmp` = `rgb(175,255,114)`（框 `Gage-3.bmp` 深绿 `rgb(23,138,0)`）、
 * CD `Gage.bmp` = `rgb(255,223,58)`；粉 = `Gage-5.bmp` `rgb(255,0,110)`、灰 = `Gage-4.bmp` `rgb(123,123,123)`。
 * 只借颜色与语义 —— **不套原版位图**（面板是我们重做的 UI）。
 * ⚠ 高度**只到图标底**（`44px`），不跟到格子底 —— 格子底下还有 `+ 学习` 按钮（临时的），
 *   竖条伸过去会像在给那个按钮画进度（用户 2026-09-24）。
 * ⚠ CD 值是**客户端本地计时**（服务端尚未实现 CD，见 `game/skillCooldown.ts`）；`cdTick` 是重绘节流。
 */
function SkillBars(props: { learned: boolean; mastery: number; skillId: number | null;
                            element0: number; cdTick: number; passive: boolean;
                            onTip: (tip: BarTipData | null) => void }) {
  const { learned, mastery, skillId, element0, cdTick, passive, onTip } = props;
  void cdTick;   // 只用于触发重绘（值本身不参与计算）
  // **被动技能：两条都灰**（用户 2026-09-25）。依据 = 原版对被动**不画**计量条：
  // `sinSkill.cpp:823` 画 gage 的条件是 `Flag && (USECODE != SIN_SKILL_USE_NOT || Element[0])`，
  // 而被动（`useCode = NOT`）既不能施放（无 CD 可言）也不会随施放涨熟练度 ⇒ 两个数都没有语义。
  // ⚠ `Element[0]` 那一支是给**可施放的高阶技能**留的；我们的 5 转被动是人工裁定成 `element0=1` 的，
  // 不该因此画成粉色实条（那是"满熟练度"的意思，对一个被动是假信息）。
  // **粉色条 = `Element[0] != 0`** —— 源码唯一的触发条件（`sinSkill.cpp:839` 画 `Gage-5.bmp`）。
  //   该值取自生成物 `skills[].element0`（口径/provenance 见生成物 `elementNote`）：**高转职段**为 1
  //   （英文/中文定义表一致；5 转那 40 行三份表都没有定义，按用户在原版里看到的粉色 gage 记为 1）。
  //   ⚠ 同一行源码还规定这类技能**熟练度恒满**（`:2064`）—— 服务端下发的就是 10000 ⇒ 这里自然满格。
  const elite = element0 !== 0 && !passive;
  const masteryPct = Math.max(0, Math.min(100, mastery / 100));
  const cdPct = skillId != null ? skillCdProgress(skillId) * 100 : 100;
  // 未学 / 被动 ⇒ 灰（两条一起灰：熟练度与 CD 在被动上都没有语义）
  const greyed = !learned || passive;
  const masteryCls = greyed ? 'jp-skill-bar--grey' : elite ? 'jp-skill-bar--elite' : 'jp-skill-bar--mastery';
  const showMasteryTip = (e: React.MouseEvent): void => {
    onTip({ x: e.clientX, y: e.clientY, pct: masteryPct, known: learned && !passive });
  };
  return (
    <div className="jp-skill-bars">
      {/* `onMouseMove` 而不是只 `onMouseEnter`：条很窄，用户会沿着它滑（tooltip 要跟手） */}
      <div className={`jp-skill-bar ${masteryCls}`}
           aria-label={`${t('skills.mastery')} ${masteryPct.toFixed(0)}%`}
           onMouseMove={showMasteryTip}
           onMouseLeave={() => onTip(null)}>
        <div className="jp-skill-bar-fill" style={{ height: `${masteryPct}%` }} />
      </div>
      {/* 未学 ⇒ 两条都灰（原版 `UseSkillFlag`/`Point == 0` 画灰版；配色取 `Gage-4.bmp` 实测 rgb(123,123,123)） */}
      <div className={`jp-skill-bar ${greyed ? 'jp-skill-bar--grey' : 'jp-skill-bar--cd'}`} aria-label={t('skills.cd')}>
        <div className="jp-skill-bar-fill" style={{ height: `${cdPct}%` }} />
      </div>
    </div>
  );
}

/** 竖条的 hover 提示（**自绘**，不用原生 `title` —— 面板里禁用，见 SkillCell 的注释）。 */
interface BarTipData { x: number; y: number; pct: number; known: boolean }

function BarTip(props: BarTipData) {
  const { x, y, pct, known } = props;
  return (
    <div className="jp-skill-bartip" style={{ left: x + 14, top: y + 10 }}>
      {t('skills.mastery')} {known ? `${pct.toFixed(0)}%` : '—'}
    </div>
  );
}

function SkillCell(props: {
  skill: SkillDef;
  /** 生成物整行（身份/useCode 的唯一来源）；`null` = 该图标查不到身份 ⇒ 恒不可绑 */
  row: SkillIdentityRow | null;
  /** 加点预判（唯一实现 `game/skillLearn.ts`；权威仍在服务端） */
  gate: LearnGate;
  /** 服务端下发的等级：`null` = 表还没到（按未学显示）、0 = 明确未学 */
  level: number | null;
  /** 服务端下发的熟练度 0..10000 */
  mastery: number;
  classDir: string;
  fist(): FistSlot | 'both' | null;
  quickKey(): number | null;
  /** 绑定表到了没（没到 ⇒ 不许绑、不许录 F 键） */
  allowed: boolean;
  onLearn(skillId: number): void;
  onEquip(target: FistSlot): void;
  onRecord(key: number): void;
  bindState: React.MutableRefObject<FistSlot | null>;
  onTip: (tip: TipData | null) => void;
  onHover(): void;
  onHoverLeave(): void;
}) {
  const { skill, row, gate, level, mastery, classDir, fist, quickKey, allowed, onLearn, onEquip, onRecord, bindState, onTip, onHover, onHoverLeave } = props;
  // 等级只认服务端：表没到（null）与"没学"（0）都按未学显示，不拿角色等级推一个出来。
  const lv = level ?? 0;
  const learned = lv > 0;
  const iconSrc = useSkillIconSrc(skillIconUrl(classDir, skill.iconFile));
  const useCode = row?.useCode ?? 'NOT';
  const canBind = allowed && learned && row != null && useCode !== 'NOT';
  const canL = canBindLeft(useCode);
  const canR = canBindRight(useCode);
  const onFist = learned ? fist() : null;
  const qkey = learned ? quickKey() : null;
  const actions = useEquipAction({ onEquip, onRecord, bindState }, canBind, useCode);

  // 显示名：**原版语言文件**优先（用户 2026-09-24 要求），查不到（中文表缺刺客/萨满）再退
  // 本地 i18n 词条 → wartale 名。`skillName` 内部已对"语言表缺这一条"上报留痕。
  const displayName = (row?.skillId != null ? skillName(row.skillId) : null)
    ?? (t(skillNameKey(classDir, skill.iconFile)) || skill.name);
  // ⛔ **不设原生 `title`**（2026-09-24 用户实测"会有两层 hover，白色的很恶心"）：
  //   原生 tooltip 由浏览器画（不可样式化、位置不跟鼠标、与自定义面板重叠）。
  //   ⚠ 它原本承载的"已装备哪只拳 / 哪个 F 键"**不再另写文字** —— 格子上本来就有角标
  //   （`jp-skill-fistbadge` 的 L/R、`jp-skill-keybadge` 的 F{n}）；用户 2026-09-24 明确
  //   "那种文字没有任何价值"（重复信息）。操作提示常驻面板顶部，无障碍名走 `aria-label`。

  return (
    <div
      className={learned ? 'jp-skill-cell' : 'jp-skill-cell jp-skill-cell--locked'}
      {...actions}
      onMouseEnter={(e) => {
        onHover();
        learned && onTip({ skill, skillId: row?.skillId ?? null, lv, mastery, x: e.clientX, y: e.clientY, displayName });
      }}
      onMouseMove={(e) => learned && onTip({ skill, skillId: row?.skillId ?? null, lv, mastery, x: e.clientX, y: e.clientY, displayName })}
      onMouseLeave={() => { onHoverLeave(); onTip(null); }}
    >
      <div className="jp-skill-iconbox">
        <img className={learned ? 'jp-skill-icon' : 'jp-skill-icon jp-skill-icon--locked'} src={iconSrc} alt={displayName} />
        <span className="jp-skill-lv">{learned ? `Lv.${lv}` : '—'}</span>
        {learned && canL && onFist === null && !canR && (
          <span className="jp-skill-fistonly">L</span>
        )}
        {/* 角标：`both` = 两只拳上是同一个 id（原版不可能；服务端已禁止新写入）⇒ **两个都画**，
            不隐藏、也不替用户挑一只（用户 2026-09-24 报过"绑右键却显示 L"）。 */}
        {(onFist === 'left' || onFist === 'both') && (
          <span className="jp-skill-fistbadge jp-skill-fistbadge--left">L</span>
        )}
        {(onFist === 'right' || onFist === 'both') && (
          <span className="jp-skill-fistbadge jp-skill-fistbadge--right">R</span>
        )}
        {qkey && <span className="jp-skill-keybadge">F{qkey}</span>}
      </div>
      {/* 真加点（服务端权威）：只发包，**不做乐观更新** —— 等级与点数都等 `S2C_SkillList` 回推
          （与属性加点 `CharStatusPanel` 同一套写法）。失败原因走 `S2C_Error.key = skill.op.*` 的文案链路。 */}
      <button
        type="button"
        className="jp-skill-learn"
        disabled={!gate.canLearn}
        // 同样不设原生 title：这个按钮就在技能格上，悬停它会弹一个白框压住我们的面板（同一天实测）
        aria-label={`${displayName} +1`}
        onPointerDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onClick={(e) => { e.stopPropagation(); if (gate.skillId != null) onLearn(gate.skillId); }}
      >+ {t('skills.learn')}</button>
    </div>
  );
}

function SkillTip(props: { skill: SkillDef; skillId: number | null; lv: number; mastery: number;
                          x: number; y: number; displayName: string }) {
  const { skill, skillId, lv, mastery, x, y, displayName } = props;
  // **原版文本**（`game/skillText.ts` 按 UI 语言取语言文件；缺则回退并上报）
  const origName = skillId != null ? skillName(skillId) : null;
  const origDesc = skillId != null ? skillDesc(skillId) : null;
  const masteryPct = Math.max(0, Math.min(100, mastery / 100)); // 服务端熟练度 0..10000
  const tw = skillReqWeight(skill);
  // **真实消耗**（生成物同源；`demoMp/demoSp` 是旧占位，只在身份表查不到时才回退显示占位值）
  // 等级：已学用当前等级；未学显示"学 1 级"的消耗（面板下一行就是 Lv 1 的效果）。
  const point = lv > 0 ? lv : 1;
  const mpReal = skillId != null ? skillMpCost(skillId, point) : null;
  const spReal = skillId != null ? skillSpCost(skillId, point) : null;
  const mp = mpReal ?? demoMp(skill);
  const sp = spReal ?? demoSp(skill);
  const mpIsReal = mpReal != null;
  const spIsReal = spReal != null;
  // 学下一级的条件（服务端算好下发：等级门槛 + 金币）；无价目表的槽（5 转）不下发 ⇒ 不显示
  const learn = skillId != null ? getGameSnapshot().skillList?.learnInfo?.[skillId] : undefined;
  const weapons = skill.weapon ?? [];
  // **真实伤害描述**：服务端按该技能自己的模型给出加成百分比（见 `SkillGameService`/SkillCastService）；
  // 0/0 = 该技能不是"攻击力×百分比"模型 ⇒ 回退 demo 文案（仍由页脚"演示数据"标记，不冒充真值）。
  const dmgText = (lo: number, hi: number): string | null => {
    if (lo <= 0 && hi <= 0) return null;
    const pct = lo === hi ? `${lo}` : `${lo}~${hi}`;
    return t('skills.dmgPct', { pct });
  };
  const curDamage = learn ? dmgText(learn.powerPctMin, learn.powerPctMax) : null;
  const nextDamage = learn ? dmgText(learn.nextPowerPctMin, learn.nextPowerPctMax) : null;
  const curEffect = curDamage ?? demoEffect(skill, tw, lv);
  const nextEffect = nextDamage ?? demoNextEffect(skill, tw, lv);
  const style = {
    left: x + 18,
    top: y + 14,
    maxWidth: 'min(340px, calc(100vw - 40px))',
  };
  return (
    <div className="jp-skill-tip" style={style}>
      {/* 标题 = **原版格式** `名 LV:n`（`sinSkill.cpp:2158`：`wsprintf(szSkillInfoBuff, "%s LV:%d
", SkillName, Point)`） */}
      <div className="jp-skill-tip-name">{origName ?? displayName}{lv > 0 ? ` LV:${lv}` : ''}</div>
      {/* 未学：原版走 `RequirLevel`（`%s (等级要求:%d)`）—— 名字 + 入门等级 */}
      {lv <= 0 && (
        <div className="jp-skill-tip-row jp-skill-tip-req">
          {t('skills.reqLevelEntry', { level: skill.reqLv })}
        </div>
      )}
      <div className="jp-skill-tip-row">{t('skills.skillType')}: {skill.type}</div>
      <div className="jp-skill-tip-row">{t('skills.consume')}: MP {mp}{mpIsReal ? '' : '?'} / SP {sp}{spIsReal ? '' : '?'}</div>
      {weapons.length > 0 && (
        <div className="jp-skill-tip-row jp-skill-tip-weapon">
          {/* 原版标签逐字：`UseItemGroupName` = "对应的装备" / "Compatible Item Group" */}
          {t('skills.itemGroup')}:
          <span className="jp-skill-tip-wicons">
            {weapons.map((w) => (
              <img key={w} className="jp-skill-tip-wicon" src={weaponIconUrl(w)} alt={WEAPON_NAMES[w] ?? String(w)} title={WEAPON_NAMES[w] ?? String(w)} />
            ))}
          </span>
        </div>
      )}
      {/* 描述：**原版语言文件**优先（中文 GBK 表已抽好）；查不到才用 wartale 的 desc */}
      <div className="jp-skill-tip-desc">{origDesc ?? skill.desc}</div>
      {lv > 0 && <div className="jp-skill-tip-row jp-skill-tip-cur">Lv {lv}: {curEffect}</div>}
      {learn && (
        <div className="jp-skill-tip-row jp-skill-tip-learn">
          {t('skills.nextReq')}: {t('skills.reqLevelNext', { level: learn.nextReqLevel })}
          {' · '}{t('skills.gold')} {learn.nextGold.toLocaleString('en-US')}
        </div>
      )}
      <div className="jp-skill-tip-row jp-skill-tip-next">Lv {Math.max(1, lv + 1)}: {nextEffect}</div>
      {/* 熟练度只对**可施放**的技能有意义（被动不施放 ⇒ 永远不涨）⇒ 被动那一格不显示这一行 */}
      {skillId != null && skillRowBySkillId(skillId)?.useCode !== 'NOT' && (
        <div className="jp-skill-tip-row">{t('skills.mastery')}: <b>{masteryPct}%</b></div>
      )}
      {(!curDamage || !nextDamage) && <div className="jp-skill-tip-demo">{t('skills.demo')}</div>}
    </div>
  );
}
