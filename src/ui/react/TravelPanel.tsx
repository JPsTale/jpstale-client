import { useState, useSyncExternalStore } from 'react';
import { getGameSnapshot, closePanel, subscribeGame } from '../../app/gameStore.js';
import { t } from '../../i18n/index.js';
import { canEnterMap } from '../../game/safeZones.js';
import { sendTravelUse } from '../../net/bridge.js';
import PanelShell from './PanelShell.js';

/**
 * 传送目的地选点盘 —— 由服务端 `S2C_TravelOpen` 打开（三种 kind 共用一个组件）：
 *   1 = NPC 付费传送（点传送 NPC） / 2 = 翅膀传送门网络（踩中 mode2 门，服务端已"吸附"） /
 *   3 = Teleport Core 选图（右键 BI108 卷轴）。
 *
 * **这里零判定**：options 是服务端给的纯展示数据（名字/费用/等级）；点击只回
 * `C2S_TravelUse{kind, target=map_id}`，钱够不够、等级够不够、人还在不在门心 ——
 * 全部由服务端复核（失败走 `S2C_Error`/聊天系统消息）。本地唯一的"软拦截"是按
 * `safeZones.canEnterMap` 把明显不够的目的地**置灰**（与跨图边界本地拦截同一份数据），
 * 但真正的拒绝仍然只认服务端 —— 两边结论不一致时以服务端为准。
 *
 * 确认即关盘：服务端成功后 `S2C_PlayerTeleport` 随后到达（applyTeleport 搬人）；
 * 失败时提示从聊天系统消息里看（原版 MESSAGE_WARP 确认框同款节奏）。
 */
const KIND_NPC = 1;
const KIND_WING_GATE = 2;
const KIND_TELEPORT_CORE = 3;

export default function TravelPanel() {
  const snap = useSyncExternalStore(subscribeGame, getGameSnapshot);
  const travel = snap.travel;
  const [selected, setSelected] = useState<number | null>(null);

  if (!travel) return null;
  const open = travel;
  const level = snap.player?.level ?? null;
  const sel = travel.options.find((o) => o.mapId === selected) ?? null;

  function confirm() {
    if (selected == null) return;
    sendTravelUse(open.kind, selected);
    closePanel('travel');
  }

  return (
    <PanelShell title={titleOf(travel.kind)} panel="travel" align="left" width="auto">
      <div className="jp-travel">
        <div className="jp-shop-list jp-travel-list">
          {travel.options.map((o) => {
            const gate = level == null ? 'unknown' : canEnterMap(o.mapId, level);
            const disabled = gate === 'level' || gate === 'locked';
            return (
              <button
                key={o.mapId}
                className={`jp-shop-row jp-travel-row${o.mapId === selected ? ' is-on' : ''}`}
                disabled={disabled}
                onClick={() => setSelected(o.mapId)}
              >
                <span className="jp-travel-name">{o.name}</span>
                <span className="jp-travel-meta">
                  {o.cost > 0 ? `${o.cost}${t('item.gold')}` : t('travel.free')}
                  {o.levelReq > 0 ? ` · ${t('travel.levelReq')} ${o.levelReq}` : ''}
                </span>
              </button>
            );
          })}
        </div>
        <div className="jp-craft-actions">
          <button className="jp-craft-ok" disabled={sel == null} onClick={confirm}>
            {t('travel.confirm')}
          </button>
          <span className="jp-craft-hint">{t('travel.hint')}</span>
        </div>
      </div>
    </PanelShell>
  );
}

function titleOf(kind: number): string {
  if (kind === KIND_NPC) return t('travel.titleNpc');
  if (kind === KIND_WING_GATE) return t('travel.titleWingGate');
  if (kind === KIND_TELEPORT_CORE) return t('travel.titleCore');
  return t('travel.title');
}
