import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  getGameSnapshot, subscribeGame, clearPartyInvite,
  type PartyMemberView, type PartyBuffEntry,
} from '../../app/gameStore.js';
import { itemDefByCode, itemIconUrl } from '../../game/data/itemDefs.js';
import { useItemImg } from './ItemPanel.js';
import { loadUiImage } from '../../render/ui-texture.js';
import { sendPartyAccept, sendPartyAction, sendPartyLeave } from '../../net/bridge.js';
import { t } from '../../i18n/index.js';

/**
 * 屏幕左侧的**队伍成员组件**（Wartale 式版式，用户 2026-09-24 定 = 决策 D7）：
 * 每行 = 左侧头像、头像右侧血条、血条上方"等级+名字"、血条下方 buff 图标行。
 *
 * 数据双轨（EU CPartyWindow 同构）：静态身份来自 `S2C_PartyUpdate`（成员变动才整表重建），
 * 动态数值来自 500ms 的 `S2C_PartyPlayUpdate`（**不含自己**——自己的血/蓝/等级用本地权威值覆盖）。
 * 服务端权威口径与自机 BuffStrip 相同：客户端只按 `remaining_ms` 倒计时，归零不画。
 *
 * 显式未知（AGENTS #12）：刚进队还没收到增量包的成员 `at === 0` ⇒ 血条画空、等级不显示，
 * 悬停提示"等待队伍数据"——**不编任何默认值**。
 */

// PartyAction 枚举值（与服务端 org.jpstale.server.common.enums.party.PartyAction 一致）
const ACT_KICK = 2;
const ACT_DELEGATE = 3;
const ACT_DISBAND = 4;
const ACT_CHANGE_MODE = 6;

/** 与服务端 INVITE_TTL_MS 同长：弹窗 60 秒无人应答自动消失 */
const INVITE_TTL_MS = 60_000;

const PORTRAIT = '/res/image/party/party_man_0.bmp';
const PORTRAIT_LEADER = '/res/image/party/party_man_jang.bmp';
const HP_BASE = '/res/image/party/smallenergy_red.bmp';
const HP_FILL = '/res/image/party/smallenergy_blue.bmp';

/** /res 贴图 → dataURL（loadUiImage 内部有缓存与并发合并，多行同图只加载一次） */
function useUiImageUrl(path: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    loadUiImage(path).then((img) => {
      if (alive) setUrl(img ? img.src : null);
    });
    return () => { alive = false; };
  }, [path]);
  return url;
}

export default function PartyHud() {
  const snap = useSyncExternalStore(subscribeGame, getGameSnapshot);
  const { party, partyInvite, character, player } = snap;
  const selfId = character?.playerId ?? null;
  const [collapsed, setCollapsed] = useState(false);
  const [menuFor, setMenuFor] = useState<number | null>(null);

  // 邀请弹窗 60 秒超时（与服务端 INVITE_TTL_MS 同长）
  useEffect(() => {
    if (!partyInvite) return;
    const id = window.setTimeout(() => clearPartyInvite(), INVITE_TTL_MS);
    return () => window.clearTimeout(id);
  }, [partyInvite]);

  if (!party && !partyInvite) return null;

  const amLeader = !!(party && selfId != null
    && party.members.some((m) => m.id === selfId && m.leader));

  return (
    <div className="jp-party" data-layer="party">
      {party && (
        <>
          <div className="jp-party-head">
            <button
              className="jp-party-toggle"
              onClick={() => setCollapsed((v) => !v)}
              title={collapsed ? t('party.expand') : t('party.collapse')}
            >{collapsed ? '▸' : '▾'}</button>
            <span className="jp-party-mode">
              {t(party.mode === 1 ? 'party.mode.hunt' : 'party.mode.normal')}
            </span>
          </div>
          {!collapsed && party.members.map((m) => (
            <MemberRow
              key={m.id}
              m={resolveMember(m, selfId, player)}
              self={m.id === selfId}
              amLeader={amLeader}
              menuOpen={menuFor === m.id}
              onMenu={(open) => setMenuFor(open ? m.id : null)}
              onMenuClose={() => setMenuFor((cur) => (cur === m.id ? null : cur))}
            />
          ))}
        </>
      )}
      {partyInvite && (
        <div className="jp-party-invite">
          <div className="jp-party-invite-text">
            {t('party.invite.title', { name: partyInvite.inviterName })}
          </div>
          <div className="jp-party-invite-buttons">
            <button
              className="jp-party-invite-ok"
              onClick={() => { sendPartyAccept(partyInvite.inviterId); clearPartyInvite(); }}
            >{t('party.invite.accept')}</button>
            <button
              className="jp-party-invite-no"
              onClick={() => clearPartyInvite()}
            >{t('party.invite.decline')}</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** 自己这一行用本地权威数值覆盖（服务端增量包不含自己） */
function resolveMember(
  m: PartyMemberView,
  selfId: number | null,
  player: { level: number; hp: number; maxHp: number; mp: number; maxMp: number } | null,
): PartyMemberView {
  if (selfId == null || m.id !== selfId || !player) return m;
  return { ...m, level: player.level, hp: player.hp, maxHp: player.maxHp, mp: player.mp, maxMp: player.maxMp, at: m.at || 1 };
}

function MemberRow(props: {
  m: PartyMemberView;
  self: boolean;
  amLeader: boolean;
  menuOpen: boolean;
  onMenu: (open: boolean) => void;
  onMenuClose: () => void;
}) {
  const { m, self, amLeader, menuOpen, onMenu, onMenuClose } = props;
  // hooks 全部在分支之前调用（React 规则）
  const base = useUiImageUrl(PORTRAIT);
  const leaderImg = useUiImageUrl(PORTRAIT_LEADER);
  const hpBase = useUiImageUrl(HP_BASE);
  const hpFill = useUiImageUrl(HP_FILL);

  const dead = m.at > 0 && m.maxHp > 0 && m.hp <= 0;
  const unknown = m.at === 0; // 还没收到动态数据：显式未知
  const hpPct = unknown || m.maxHp <= 0 ? 0 : Math.max(0, Math.min(100, (m.hp / m.maxHp) * 100));
  const portrait = (m.leader && leaderImg) ? leaderImg : base;

  return (
    <div
      className={`jp-party-row${self ? ' jp-party-row-self' : ''}${dead ? ' jp-party-row-dead' : ''}`}
      onContextMenu={(e) => { e.preventDefault(); onMenu(true); }}
      onMouseLeave={onMenuClose}
    >
      <img className="jp-party-portrait" src={portrait ?? undefined} alt={m.name} draggable={false} />
      <div className="jp-party-main">
        <div className="jp-party-line1">
          {!unknown && <span className="jp-party-level">{m.level}</span>}
          <span className="jp-party-name">{m.name}</span>
        </div>
        <div className="jp-party-hpbar" title={unknown ? t('party.waiting') : undefined}>
          <img className="jp-party-hp-base" src={hpBase ?? undefined} alt="" draggable={false} />
          {!unknown && (
            <img
              className="jp-party-hp-fill" src={hpFill ?? undefined} alt="" draggable={false}
              style={{ width: `${hpPct}%` }}
            />
          )}
        </div>
        <div className="jp-party-buffs">
          {m.buffs.map((b, i) => <PartyBuffIcon key={`${b.itemCode}-${i}`} b={b} />)}
        </div>
      </div>
      {menuOpen && (
        <div className="jp-party-menu">
          {self ? (
            <>
              <MenuItem label={t('party.menu.leave')} onClick={() => { sendPartyLeave(); onMenuClose(); }} />
              {amLeader && (
                <>
                  <MenuItem label={t('party.menu.changeMode')} onClick={() => { sendPartyAction(ACT_CHANGE_MODE); onMenuClose(); }} />
                  <MenuItem label={t('party.menu.disband')} onClick={() => { sendPartyAction(ACT_DISBAND); onMenuClose(); }} />
                </>
              )}
            </>
          ) : amLeader ? (
            <>
              <MenuItem label={t('party.menu.delegate')} onClick={() => { sendPartyAction(ACT_DELEGATE, m.id); onMenuClose(); }} />
              <MenuItem label={t('party.menu.kick')} onClick={() => { sendPartyAction(ACT_KICK, m.id); onMenuClose(); }} />
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

function MenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="jp-party-menu-item" onClick={onClick}>{label}</button>
  );
}

/** 队友 buff 小图标：与自机 BuffStrip 同一图标链路（itemDefByCode → 物品图标），缩到 20px、无圆环。 */
function PartyBuffIcon({ b }: { b: PartyBuffEntry }) {
  const def = itemDefByCode(b.itemCode);
  const src = useItemImg(def ? itemIconUrl(def) : null);
  // 剩余秒（本地倒数；<=0 的条目按服务端口径已到期，下一张 500ms 包会把它带走，这里直接不画）
  const remainSec = Math.max(0, Math.ceil((b.at + b.remainingMs - Date.now()) / 1000));
  if (remainSec <= 0) return null;
  const tip = `${def?.name ?? `#${b.itemCode}`} · ${t('buff.remaining', { s: remainSec })}`;
  return (
    <img
      className="jp-party-buff" src={src ?? undefined} alt={def?.name ?? ''} title={tip}
      draggable={false}
    />
  );
}
