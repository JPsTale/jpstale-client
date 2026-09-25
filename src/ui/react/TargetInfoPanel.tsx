import { useEffect, useRef, useState } from 'react';
import { targetWindowState } from '../targetWindow.js';
import { useUiImageUrl } from './useUiImage.js';
import { sendPartyInvite, sendTradeRequest, sendClanInvite } from '../../net/bridge.js';
import { t, tOr } from '../../i18n/index.js';

/**
 * **目标信息窗**（右上角，原版 DrawEachPlayer 对应的 DOM 侧）。
 *
 * 版式（用户 2026-09-25 两轮定稿）：**一个纯方形框 = 头像本体**——
 *   · 名字（`Lv.X 名字`）**叠在框内顶部**（不独占一行）；
 *   · 血条在**框下方**（不在框内），画法与怪物名牌血条**同一套**
 *     （圆槽 + hsl(120×比例) 红绿渐变填充 + 玻璃高光，对应 WorldView.drawBar；
 *     energy_red/blue.tga 贴图条方案已废弃——细成一条白线看不清是什么）；
 *   · 框内 3D 头像由 WorldView scissor 直渲（面板只负责量孔矩形与画叠层）。
 * 社交按钮只对**玩家目标**出现，几何照原版（`playmain.cpp:3642-3652` 实测）：托盘 `cw-1.tga`
 * 画成 **100×50**、水平居中、**顶边压住头像框底 6px**；按钮 20×20、间距 25、距托盘左缘 14px。
 * **平时 3 枚**（交易/组队/好友）；第 4 枚"部族"原版只在"自己是族长 && 对方无公会"时出现
 * （`EachTradeButtonMode`）——公会系统落地后按同条件启用。悬停贴图方向：`_` 后缀=常态、
 * 无后缀=悬停（`lpDDS_ParTradeButton[cnt][0]=icon-c5_` 常态 / `[1]=icon-c5` 悬停，:1505-1515）。
 *   · 交易 → `C2S_TradeRequest{target_name}`（服务端 401 handler 待交易系统落地，发包即按钮行为）；
 *   · 组队 → `C2S_PartyInvite`（已通）；
 *   · 好友 → **禁用态**（好友系统未实现——原版本就是纯客户端列表，协议落地后接）。
 * NPC 的显示名走 `npc.<nameKey>` 本地化（与名牌同源）；翻译缺失时回退原 key（显式，不编名）。
 */

// 原版目标窗按钮贴图（playmain.cpp:1505-1515）。⚠ 方向：`_` 后缀 = **常态**、无后缀 = **悬停**
//（DisplayPartyTradeButton：未悬停画 [cnt][0]=icon-c5_，悬停画 [cnt][1]=icon-c5）——首版搞反了。
const BTN_TRADE = '/res/image/party/icon-c5_.bmp';
const BTN_TRADE_H = '/res/image/party/icon-c5.bmp';
const BTN_PARTY = '/res/image/party/icon-c1_.bmp';
const BTN_PARTY_H = '/res/image/party/icon-c1.bmp';
const BTN_FRIEND = '/res/image/party/icon-c2_.bmp';
const BTN_FRIEND_H = '/res/image/party/icon-c2.bmp';
const BTN_CLAN = '/res/image/party/icon_clan_.bmp';
const BTN_CLAN_H = '/res/image/party/icon_clan.bmp';

/** 托盘底图：原版 MatEachMenuBox（cw-1.tga，原生 128×64），照原版画成 100×50 */
const TRAY = '/res/image/cw-1.tga';

function npcDisplayName(nameKey: string): string {
  if (!nameKey) return '';
  // 与名牌同一套查表（WorldView:5084 `t(\`npc.${nameKey}.name\`)`）——locale 是 { name: ... } 嵌套；
  // 少拼 .name 就会像截图那样把原 key 顶到界面上（用户 2026-09-25 实测）
  return tOr(`npc.${nameKey}.name`, nameKey);
}

/** 原版式 20×20 图标按钮：普通/悬停双贴图（⚠ `_` 后缀=常态、无后缀=悬停），悬停出 i18n 文字提示 */
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
      disabled={disabled}
      onPointerEnter={() => setHot(true)}
      onPointerLeave={() => setHot(false)}
      onClick={() => { if (!disabled && onClick) onClick(); }}
    >
      <img src={((hot && hover) ? hover : base) ?? undefined} alt={title} draggable={false} />
      {hot && <span className="jpt-tip">{title}</span>}
    </button>
  );
}

export default function TargetInfoPanel() {
  const [, tick] = useState(0);
  const holeRef = useRef<HTMLDivElement | null>(null);
  const tray = useUiImageUrl(TRAY);
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
  const ratio = showHp ? Math.max(0, Math.min(1, info.hp / info.maxHp)) : 0;
  // 与怪物名牌血条同一套画法（WorldView.drawBar）：填充色 = hsl(120×比例) 绿→黄→红 + 玻璃高光
  const hue = Math.round(120 * ratio);

  return (
    <div className={`jpt${info.dead ? ' jpt-dead' : ''}`} data-layer="target-window">
      {/* 纯方形框：整个 div 是 3D 头像孔，名字是框内叠层（原版版式） */}
      <div className="jpt-hole" ref={holeRef}>
        <div className="jpt-name">
          {info.level > 0 && <span className="jpt-level">Lv.{info.level} </span>}
          <span className="jpt-name-text">{name}</span>
        </div>
      </div>
      {/* 血条在**框下方**（用户 2026-09-25 定），画法与怪物名牌血条同一套（圆槽+hsl 红绿渐变+高光） */}
      {showHp && (
        <div className="jpt-hpbar">
          <div className="jpt-hp-slot">
            <div
              className="jpt-hp-fill"
              style={{
                width: `${Math.max(0, Math.min(100, ratio * 100))}%`,
                background: `linear-gradient(rgba(255,255,255,0.40), rgba(255,255,255,0.10) 45%, rgba(0,0,0,0.25)), hsl(${hue} 85% 50%)`,
              }}
            />
          </div>
        </div>
      )}
      {info.kind === 'player' && (
        <div className={`jpt-actions${!info.clanName ? ' jpt-actions-4' : ''}`}>
          <img className="jpt-tray" src={tray ?? undefined} alt="" draggable={false} />
          {/* 次序与原版一致：交易 / 组队 / 好友 / 部族——部族原版仅"族长 && 对方无公会"时出现；
          我方客户端不持有会长身份（服务端权威），显示条件取**对方无公会**，资格由服务端校验 */}
          <IconBtn icon={BTN_TRADE} iconHover={BTN_TRADE_H}
                   title={t('target.button.trade')}
                   onClick={() => sendTradeRequest(name)} />
          <IconBtn icon={BTN_PARTY} iconHover={BTN_PARTY_H}
                   title={t('target.button.party')}
                   onClick={() => sendPartyInvite(info.id)} />
          <IconBtn icon={BTN_FRIEND} iconHover={BTN_FRIEND_H}
                   title={t('target.button.friend')} disabled />
          {!info.clanName && (
            <IconBtn icon={BTN_CLAN} iconHover={BTN_CLAN_H}
                     title={t('target.button.clan')}
                     onClick={() => sendClanInvite(info.id, name)} />
          )}
        </div>
      )}
    </div>
  );
}
