import { useEffect, useRef, useState } from 'react';
import { targetWindowState } from '../targetWindow.js';
import { useUiImageUrl } from './useUiImage.js';
import { sendPartyInvite, sendTradeRequest } from '../../net/bridge.js';
import { t } from '../../i18n/index.js';

/**
 * **目标信息窗**（右上角，原版 DrawEachPlayer 对应的 DOM 侧）。
 *
 * 版式照原版（用户 2026-09-25 按截图定稿）：**一个纯方形框 = 头像本体**——
 *   · 名字（`Lv.X 名字`）**叠在框内顶部**（不独占一行）；
 *   · 怪物血条**贴在框内底边**（原版 `DrawStateBar` 在 `MidY-(h>>1)+h+2`，即框底）；
 *   · 框内 3D 头像由 WorldView scissor 直渲（面板只负责量孔矩形与画叠层）。
 * 社交按钮行只对**玩家目标**出现，在框**下方**（原版 cw-1.tga 菜单盒的位置）——
 * 次序与图标照原版：交易 icon-c5 / 组队 icon-c1 / 好友 icon-c2 / 部族 icon_clan：
 *   · 交易 → `C2S_TradeRequest{target_name}`（服务端 401 handler 待交易系统落地，发包即按钮行为）；
 *   · 组队 → `C2S_PartyInvite`（已通）；
 *   · 好友 → **禁用态**（好友系统未实现——协议落地后接）；
 *   · 部族 → **禁用态**（公会邀请协议未落地——公会系统在建，落地后接 `C2S_Clan*`）。
 * NPC 的显示名走 `npc.<nameKey>` 本地化（与名牌同源）；翻译缺失时回退原 key（显式，不编名）。
 */

const HP_BASE = '/res/image/energy_red.tga';
const HP_FILL = '/res/image/energy_blue.tga';

// 原版目标窗按钮贴图（`playmain.cpp:1965-1975` 的四枚；`_` 后缀 = 悬停态）
const BTN_TRADE = '/res/image/party/icon-c5.bmp';
const BTN_TRADE_H = '/res/image/party/icon-c5_.bmp';
const BTN_PARTY = '/res/image/party/icon-c1.bmp';
const BTN_PARTY_H = '/res/image/party/icon-c1_.bmp';
const BTN_FRIEND = '/res/image/party/icon-c2.bmp';
const BTN_FRIEND_H = '/res/image/party/icon-c2_.bmp';
const BTN_CLAN = '/res/image/party/icon_clan.bmp';
const BTN_CLAN_H = '/res/image/party/icon_clan_.bmp';

function npcDisplayName(nameKey: string): string {
  if (!nameKey) return '';
  const full = `npc.${nameKey}`;
  const tr = t(full);
  return tr === full ? nameKey : tr;
}

/** 原版式 20×20 图标按钮：普通/悬停双贴图（`_` 后缀），`disabled` = 置灰 + tooltip、点了不发包 */
function IconBtn(props: {
  icon: string; iconHover: string; title: string; disabled?: boolean;
  onClick?: () => void;
}) {
  const { icon, iconHover, title, disabled, onClick } = props;
  const base = useUiImageUrl(icon);
  const hover = useUiImageUrl(iconHover);
  const [hot, setHot] = useState(false);
  return (
    <button
      className={`jpt-action-btn${disabled ? ' jpt-action-btn-off' : ''}`}
      title={title}
      disabled={disabled}
      onPointerEnter={() => setHot(true)}
      onPointerLeave={() => setHot(false)}
      onClick={() => { if (!disabled && onClick) onClick(); }}
    >
      <img src={((hot && hover) ? hover : base) ?? undefined} alt={title} draggable={false} />
    </button>
  );
}

export default function TargetInfoPanel() {
  const [, tick] = useState(0);
  const holeRef = useRef<HTMLDivElement | null>(null);
  const hpBase = useUiImageUrl(HP_BASE);
  const hpFill = useUiImageUrl(HP_FILL);
  // targetWindowState 是可变共享对象（不走 React 状态）→ 150ms 轮询重渲染（与 BuffStrip 同节奏）
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 150);
    return () => window.clearInterval(id);
  }, []);

  // 孔矩形发布：每次渲染都量（面板出现/消失、窗口 resize、布局抖动全覆盖，成本可忽略）
  useEffect(() => {
    const publish = () => {
      const el = holeRef.current;
      if (!el) {
        targetWindowState.hole = null;
        return;
      }
      const r = el.getBoundingClientRect();
      targetWindowState.hole = { x: r.left, y: r.top, w: r.width, h: r.height };
    };
    publish();
    window.addEventListener('resize', publish);
    return () => {
      window.removeEventListener('resize', publish);
      targetWindowState.hole = null;
    };
  });

  const info = targetWindowState.info;
  if (!info) return null;
  const name = info.kind === 'npc' ? npcDisplayName(info.name) : info.name;
  const showHp = info.maxHp > 0;
  const pct = showHp ? Math.max(0, Math.min(100, (info.hp / info.maxHp) * 100)) : 0;

  return (
    <div className={`jpt${info.dead ? ' jpt-dead' : ''}`} data-layer="target-window">
      {/* 纯方形框：整个 div 是 3D 头像孔，名字/血条都是**框内叠层**（原版版式） */}
      <div className="jpt-hole" ref={holeRef}>
        <div className="jpt-name">
          {info.level > 0 && <span className="jpt-level">Lv.{info.level} </span>}
          <span className="jpt-name-text">{name}</span>
        </div>
        {showHp && (
          <div className="jpt-hpbar">
            <img className="jpt-hp-base" src={hpBase ?? undefined} alt="" draggable={false} />
            <img className="jpt-hp-fill" src={hpFill ?? undefined} alt="" draggable={false} style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      {info.kind === 'player' && (
        <div className="jpt-actions">
          {/* 次序与原版一致：交易 / 组队 / 好友 / 部族（Winmain.cpp:2907-2950） */}
          <IconBtn icon={BTN_TRADE} iconHover={BTN_TRADE_H}
                   title={t('target.button.trade')}
                   onClick={() => sendTradeRequest(name)} />
          <IconBtn icon={BTN_PARTY} iconHover={BTN_PARTY_H}
                   title={t('target.button.party')}
                   onClick={() => sendPartyInvite(info.id)} />
          <IconBtn icon={BTN_FRIEND} iconHover={BTN_FRIEND_H}
                   title={t('target.button.friendDisabled')} disabled />
          <IconBtn icon={BTN_CLAN} iconHover={BTN_CLAN_H}
                   title={t('target.button.clanDisabled')} disabled />
        </div>
      )}
    </div>
  );
}
