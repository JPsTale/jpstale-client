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

interface Line { label?: string; value: string; red?: boolean; section?: boolean; }

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
          className={`jp-item-info-line${ln.section ? ' jp-item-info-sec' : ''}${ln.red ? ' jp-item-info-red' : ''}`}
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
  const isWeapon = cls === 4 || cls === 6;
  const isArmor = cls === 8;
  // —— 基础能力（武器：攻击/命中；防具：防御/吸收/格挡等）——
  if (isWeapon) {
    if (it.damageMin > 0 || it.damageMax > 0) {
      out.push({ label: t('itemtip.atk'), value: `${it.damageMin} ~ ${it.damageMax}` });
    }
    if (it.attackRating > 0) out.push({ label: t('itemtip.hit'), value: String(it.attackRating) });
  } else if (isArmor) {
    if (it.defence > 0) out.push({ label: t('itemtip.def'), value: String(it.defence) });
  }
  if (cls === 8) {
    if (it.absorb > 0) out.push({ label: t('itemtip.absorb'), value: (it.absorb / 10).toFixed(1) });
    if (it.blockRating > 0) out.push({ label: t('itemtip.block'), value: (it.blockRating / 10).toFixed(1) });
    if (it.speed > 0) out.push({ label: t('itemtip.speed'), value: (it.speed / 10).toFixed(1) });
  }
  // 通用属性加成
  const resVals: [string, number][] = [
    [t('itemtip.resBionic'), it.resBionic],
    [t('itemtip.resPoison'), it.resPoison],
    [t('itemtip.resFire'), it.resFire],
    [t('itemtip.resLightning'), it.resLightning],
    [t('itemtip.resIce'), it.resIce],
  ];
  const resAny = resVals.some(([, v]) => v !== 0);
  if (resAny) {
    out.push({ section: true, value: '' });
    for (const [label, v] of resVals) {
      if (v !== 0) out.push({ label, value: String(v) });
    }
  }
  const bonus: [string, number][] = [
    [t('itemtip.incLife'), it.increaseLife],
    [t('itemtip.incMana'), it.increaseMana],
    [t('itemtip.incStm'), it.increaseStamina],
  ];
  const anyBonus = bonus.some(([, v]) => v !== 0);
  if (anyBonus) {
    for (const [label, v] of bonus) if (v !== 0) out.push({ label, value: String(v) });
  }
  // —— 需求（不足行红字）——
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
  const reqAny = req.some(([, v]) => v > 0);
  if (reqAny) {
    out.push({ section: true, value: t('itemtip.require') });
    for (const [label, need, have] of req) {
      if (need > 0) out.push({ label, value: String(need), red: have < need });
    }
  }
  // —— 耐久 / 价格 ——
  if (it.durabilityMax > 0) out.push({ label: t('itemtip.durability'), value: `${it.durability}/${it.durabilityMax}` });
  if (it.price > 0) out.push({ label: t('itemtip.price'), value: String(it.price) });
  return out;
}

interface GameCharacterLike {
  level?: number;
  strength?: number;
  spirit?: number;
  talent?: number;
  agility?: number;
  health?: number;
}
