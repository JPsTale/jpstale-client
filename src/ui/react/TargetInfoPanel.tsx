import { useEffect, useRef, useState } from 'react';
import { targetWindowState } from '../targetWindow.js';
import { useUiImageUrl } from './useUiImage.js';
import { sendPartyInvite } from '../../net/bridge.js';
import { t } from '../../i18n/index.js';

/**
 * **目标信息窗**（右上角，原版 DrawEachPlayer 对应的 DOM 侧）：
 * 顶部名字条 → 中间**透明孔**（WorldView 在 WebGL 画布里 scissor 出的 3D 头像）→ 血条 → 动作按钮。
 *
 * 与 WorldView 的分工（见 targetWindow.ts 说明）：面板只负责量孔、显示文字/血条/按钮；
 * 3D 头像由 WorldView 每帧直渲进孔里（层隔离，不用 clone，装备外观自动一致）。
 *
 * 动作按钮**只放端到端可用的**（AGENTS #12：不做点了没反应的假按钮）：
 *   · 组队 → C2S_PartyInvite（服务端 405 已实现）；
 *   · 交易不做——服务端 C2S_TradeRequest(401) 还没有 handler；好友/部族系统未实现。
 *     这些按钮等对应系统落地后补，界面上显式"没有"。
 *
 * NPC 的显示名走 `npc.<nameKey>` 本地化（与名牌同源）；翻译缺失时回退原 key（显式，不编名）。
 */

const HP_BASE = '/res/image/energy_red.tga';
const HP_FILL = '/res/image/energy_blue.tga';

function npcDisplayName(nameKey: string): string {
  if (!nameKey) return '';
  const full = `npc.${nameKey}`;
  const tr = t(full);
  return tr === full ? nameKey : tr;
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
      <div className="jpt-head">
        {info.level > 0 && <span className="jpt-level">Lv.{info.level}</span>}
        <span className="jpt-name">{name}</span>
      </div>
      <div className="jpt-hole" ref={holeRef} />
      {showHp && (
        <div className="jpt-hpbar">
          <img className="jpt-hp-base" src={hpBase ?? undefined} alt="" draggable={false} />
          <img className="jpt-hp-fill" src={hpFill ?? undefined} alt="" draggable={false} style={{ width: `${pct}%` }} />
        </div>
      )}
      {info.kind === 'player' && (
        <div className="jpt-actions">
          <button className="jpt-action" onClick={() => sendPartyInvite(info.id)}>
            {t('target.button.party')}
          </button>
        </div>
      )}
    </div>
  );
}
