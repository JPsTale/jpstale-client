import { useState } from 'react';
import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { subscribeGame, getGameSnapshot, type GameItem } from '../../app/gameStore.js';
import { itemDefById } from '../../game/data/itemDefs.js';
import { getWeaponTypeFromIdCode } from '../../char/weapon-type.js';
import { t } from '../../i18n/index.js';

/**
 * 原版风格物品信息框（两列：左标签 / 右数值；需求不满足行红字）。
 * 版式依据 NewSourcePT cITEM::ShowItemInfo（szInfoBuff/szInfoBuff2 双缓冲 + RedLine 语义），
 * 逐物品种类对齐。当前覆盖装备类；药水/强化/职业特效行按批次补齐。
 */
export interface ItemHover { it: GameItem; x: number; y: number; }

export function useItemHover() {
  const [hover, setHover] = useState<ItemHover | null>(null);
  const show = (it: GameItem, e: { clientX: number; clientY: number }) =>
    setHover({ it, x: e.clientX + 16, y: e.clientY + 10 });
  const hide = () => setHover(null);
  return { hover, show, hide };
}

interface Line { label?: string; value: string; red?: boolean; dim?: boolean; section?: boolean; center?: boolean; }

export function ItemInfo({ hover }: { hover: ItemHover | null }) {
  const snap = useSyncExternalStore(subscribeGame, getGameSnapshot);
  if (!hover) return null;
  const { it } = hover;
  const def = itemDefById(it.itemlistId);
  const rawName = def?.name ?? `#${it.itemlistId}`;
  // 锻造（原版 sinItem.cpp:530）：Aging 物品名前缀 "+N"；武器名行居中、右上角武器类型小图标
  const name = (it.agingLevel > 0 ? `+${it.agingLevel} ` : '') + rawName;
  const cls = def?.class ?? 0;
  const ch = snap.character;
  const lines = buildLines(it, cls, ch);
  const weaponIcon = weaponTypeChar(it.itemCode);
  // 摆放：随光标，简单防越界
  const style: React.CSSProperties = {
    left: Math.min(hover.x, window.innerWidth - 260),
    top: Math.min(hover.y, window.innerHeight - 60 - lines.length * 17),
  };
  return createPortal(
    <div className="jp-item-info" style={style}>
      <div className="jp-item-info-name">
        <span>{name}</span>
        {weaponIcon ? <span className="jp-item-info-wtype" title={weaponTypeName(it.itemCode)}>{weaponIcon}</span> : null}
      </div>
      {lines.map((ln, i) => (
        <div
          key={i}
          className={`jp-item-info-line${ln.section ? ' jp-item-info-sec' : ''}${ln.red ? ' jp-item-info-red' : ''}${ln.dim ? ' jp-item-info-dim' : ''}${ln.center ? ' jp-item-info-center' : ''}`}
        >
          {ln.label !== undefined && <span className="jp-item-info-l">{ln.label}</span>}
          <span className="jp-item-info-v">{ln.value}</span>
        </div>
      ))}
    </div>,
    document.body,
  );
}

/** 武器类型小图标（原版 lpShowWeaponClass：名字行右上 18×16 图标）→ 用字符徽标呈现 */
function weaponTypeChar(code: number): string | null {
  const map: Record<string, string> = {
    SWORD: '剑', AXE: '斧', HAMMER: '锤', SPEAR: '枪', STAFF: '杖',
    BOW: '弓', CROSSBOW: '弩', DAGGER: '匕', SHIELD: '盾', MACE: '锤',
  };
  const type = getWeaponTypeFromIdCode(code);
  return type ? (map[type] ?? type.charAt(0)) : null;
}

function weaponTypeName(code: number): string {
  const t1 = getWeaponTypeFromIdCode(code);
  return t1 ? t(`itemtip.wtype.${t1}`) : '';
}

function buildLines(it: GameItem, cls: number, ch: GameCharacterLike | null): Line[] {
  const out: Line[] = [];
  const isWeapon = cls === 2 || cls === 4 || cls === 6;   // 盾/单手/双手
  const isGear = cls === 8 || cls === 16 || cls === 32 || cls === 2048
    || cls === 192 || cls === 512 || cls === 256;          // 甲/靴/手/腕/戒/链/宝石
  // —— 基础能力（顺序按用户样品：攻→命→防→吸→速→必杀→格挡→射程→攻速）——
  if (isWeapon) {
    if (it.damageMin > 0 || it.damageMax > 0) {
      out.push({ label: t('itemtip.atk'), value: `${it.damageMin}-${it.damageMax}` });
    }
    if (it.attackRating > 0) out.push({ label: t('itemtip.hit'), value: String(it.attackRating) });
  }
  if (isWeapon || isGear) {
    if (it.defence > 0) out.push({ label: t('itemtip.def'), value: String(it.defence) });
    if (it.absorb > 0) out.push({ label: t('itemtip.absorb'), value: (it.absorb / 10).toFixed(1) });
    if (it.speed > 0) out.push({ label: t('itemtip.speed'), value: (it.speed / 10).toFixed(1) });
    if (it.critical > 0) out.push({ label: t('itemtip.crit'), value: `${it.critical}%` });
    if (it.blockRating > 0) out.push({ label: t('itemtip.block'), value: `${Math.round(it.blockRating / 10)}%` });
    if (it.range > 0) out.push({ label: t('itemtip.range'), value: String(it.range) });
    if (it.attackSpeed > 0) out.push({ label: t('itemtip.attackSpeed'), value: String(it.attackSpeed) });
  }
  // 8 系抗性（逐条非 0）
  const resVals: [string, number][] = [
    [t('itemtip.resBionic'), it.resBionic],
    [t('itemtip.resEarth'), it.resEarth],
    [t('itemtip.resFire'), it.resFire],
    [t('itemtip.resIce'), it.resIce],
    [t('itemtip.resLightning'), it.resLightning],
    [t('itemtip.resPoison'), it.resPoison],
    [t('itemtip.resWater'), it.resWater],
    [t('itemtip.resWind'), it.resWind],
  ];
  if (resVals.some(([, v]) => v !== 0)) {
    out.push({ section: true, value: '' });
    for (const [label, v] of resVals) if (v !== 0) out.push({ label, value: String(v) });
  }
  // —— 耐久度（属性区最后）——
  if (it.durabilityMax > 0) out.push({ label: t('itemtip.durability'), value: `${it.durability}/${it.durabilityMax}` });
  // —— 需求（满足暗黄 / 不满足红；置于属性区之后）——
  const lv = ch?.level ?? 0;
  const st = ch?.strength ?? 0, sp = ch?.spirit ?? 0, ta = ch?.talent ?? 0;
  const ag = ch?.agility ?? 0, hp = ch?.health ?? 0;
  const req: [string, number, number][] = [
    [t('itemtip.reqLv'), it.reqLevel, lv],
    [t('itemtip.reqStr'), it.reqStrength, st],
    [t('itemtip.reqSpirit'), it.reqSpirit, sp],
    [t('itemtip.reqTalent'), it.reqTalent, ta],
    [t('itemtip.reqAgility'), it.reqAgility, ag],
    [t('itemtip.reqHealth'), it.reqHealth, hp],
  ];
  if (req.some(([, v]) => v > 0)) {
    out.push({ section: true, value: '' });
    for (const [label, need, have] of req) {
      if (need > 0) out.push({ label, value: String(need), dim: have >= need, red: have < need });
    }
  }
  // —— 职业特效（sITEM_SPECIAL；居中金/黄；数据 userdb.item.spec_*）——
  if (it.jobCodeMask !== 0 && hasSpec(it)) {
    out.push({ section: true, value: '' });
    const job = jobName(it.jobCodeMask);
    if (job) out.push({ center: true, value: t('itemtip.specHeader', { job }) });
    if (it.specAbsorb > 0) out.push({ center: true, label: t('itemtip.absorb'), value: (it.specAbsorb / 10).toFixed(1) });
    if (it.specLevAttackRating > 0) out.push({ center: true, label: t('itemtip.hit'), value: `Lv/${it.specLevAttackRating}` });
    if (it.specLevDamageMax > 0) out.push({ center: true, label: t('itemtip.atk'), value: `Lv/${it.specLevDamageMax}` });
    if (it.specAttackSpeed > 0) out.push({ center: true, label: t('itemtip.attackSpeed'), value: String(it.specAttackSpeed) });
    if (it.specCritical > 0) out.push({ center: true, label: t('itemtip.crit'), value: `${it.specCritical}%` });
    if (it.specDefence > 0) out.push({ center: true, label: t('itemtip.def'), value: String(it.specDefence) });
    if (it.specBlockRating > 0) out.push({ center: true, label: t('itemtip.block'), value: `${Math.round(it.specBlockRating / 10)}%` });
    if (it.specSpeed > 0) out.push({ center: true, label: t('itemtip.speed'), value: (it.specSpeed / 10).toFixed(1) });
    if (it.specShootingRange > 0) out.push({ center: true, label: t('itemtip.range'), value: String(it.specShootingRange) });
    if (it.specMagicMastery > 0) out.push({ center: true, label: t('itemtip.magicMastery'), value: (it.specMagicMastery / 10).toFixed(1) });
    const specRes: [string, number][] = [
      [t('itemtip.resBionic'), it.specResBionic],
      [t('itemtip.resEarth'), it.specResEarth],
      [t('itemtip.resFire'), it.specResFire],
      [t('itemtip.resIce'), it.specResIce],
      [t('itemtip.resLightning'), it.specResLighting],
      [t('itemtip.resPoison'), it.specResPoison],
      [t('itemtip.resWater'), it.specResWater],
      [t('itemtip.resWind'), it.specResWind],
    ];
    for (const [label, v] of specRes) if (v !== 0) out.push({ center: true, label, value: String(v) });
    const specLevRes: [string, number][] = [
      [t('itemtip.resBionic'), it.specLevResBionic],
      [t('itemtip.resEarth'), it.specLevResEarth],
      [t('itemtip.resFire'), it.specLevResFire],
      [t('itemtip.resIce'), it.specLevResIce],
      [t('itemtip.resLightning'), it.specLevResLighting],
      [t('itemtip.resPoison'), it.specLevResPoison],
      [t('itemtip.resWater'), it.specLevResWater],
      [t('itemtip.resWind'), it.specLevResWind],
    ];
    for (const [label, v] of specLevRes) if (v !== 0) out.push({ center: true, label, value: `Lv/${v}` });
    if (it.specLevLife > 0) out.push({ center: true, label: t('itemtip.incLife'), value: `Lv/${it.specLevLife}` });
    if (it.specLevMana > 0) out.push({ center: true, label: t('itemtip.incMana'), value: `Lv/${it.specLevMana}` });
    if (it.specPerLifeRegen > 0) out.push({ center: true, label: t('itemtip.regenLife'), value: (it.specPerLifeRegen / 100).toFixed(2) });
    if (it.specPerManaRegen > 0) out.push({ center: true, label: t('itemtip.regenMana'), value: (it.specPerManaRegen / 100).toFixed(2) });
    if (it.specPerStaminaRegen > 0) out.push({ center: true, label: t('itemtip.regenStm'), value: (it.specPerStaminaRegen / 100).toFixed(2) });
  }
  return out;
}

function hasSpec(it: GameItem): boolean {
  return it.specAbsorb > 0 || it.specDefence > 0 || it.specSpeed > 0
    || it.specBlockRating > 0 || it.specAttackSpeed > 0 || it.specCritical > 0
    || it.specShootingRange > 0 || it.specMagicMastery > 0
    || it.specResBionic > 0 || it.specResEarth > 0 || it.specResFire > 0
    || it.specResIce > 0 || it.specResLighting > 0 || it.specResPoison > 0
    || it.specResWater > 0 || it.specResWind > 0
    || it.specLevMana > 0 || it.specLevLife > 0
    || it.specLevAttackRating > 0 || it.specLevDamageMax > 0
    || it.specLevResBionic > 0 || it.specLevResEarth > 0 || it.specLevResFire > 0
    || it.specLevResIce > 0 || it.specLevResLighting > 0 || it.specLevResPoison > 0
    || it.specLevResWater > 0 || it.specLevResWind > 0
    || it.specPerManaRegen > 0 || it.specPerLifeRegen > 0 || it.specPerStaminaRegen > 0;
}

/** job_code_mask → 职业显示名（位 → JobDataBase 中文表；取最大位）。 */
function jobName(mask: number): string {
  if (!mask) return '';
  for (let i = 31; i >= 0; i--) {
    const bit = (1 << i) >>> 0;
    if ((mask & bit) === 0) continue;
    const name = t(`itemtip.job.${bit}`);
    if (name !== `itemtip.job.${bit}`) return name; // t 兜底返回 key 本身
  }
  return '';
}

interface GameCharacterLike {
  level?: number;
  strength?: number;
  spirit?: number;
  talent?: number;
  agility?: number;
  health?: number;
}
