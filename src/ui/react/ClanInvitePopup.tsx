// 公会邀请弹窗（S2C_ClanInviteAsk → 被邀请者决定接受/拒绝）。
//
// 形状与语义照 `PartyHud` 里的组队邀请弹窗：常驻挂载（不随公会面板开关）、
// 60s 超时（与服务端 `ClanHandler.INVITE_TTL_MS` 同长）、拒绝不发通知（原版同）。
// 内层文字/按钮复用 `.jp-party-invite-*` 样式 —— 两类邀请在屏幕上就该长得一样（同为"对方想拉你"）。
// ⚠ 根类必须是 `.jp-clan-invite`：宿主容器 `#jp-react-panels` 是 pointer-events:none，
// 各常驻件要自己开 auto（`.jp-party` 的注释就是为这个写的——2026-09-25 用户实测漏开 = 弹窗点不动）。
import { useEffect } from 'react';
import { useSyncExternalStore } from 'react';
import { getGameSnapshot, subscribeGame, setClanInviteAsk } from '../../app/gameStore.js';
import { sendClanInviteAccept } from '../../net/bridge.js';
import { t } from '../../i18n/index.js';

/** 与服务端 ClanHandler.INVITE_TTL_MS 同长（PartyHud 的 INVITE_TTL_MS 也是这个值）。 */
const INVITE_TTL_MS = 60_000;

export default function ClanInvitePopup() {
  const { clanInviteAsk } = useSyncExternalStore(subscribeGame, getGameSnapshot);

  useEffect(() => {
    if (!clanInviteAsk) return;
    const id = window.setTimeout(() => setClanInviteAsk(null), INVITE_TTL_MS);
    return () => window.clearTimeout(id);
  }, [clanInviteAsk]);

  if (!clanInviteAsk) return null;

  return (
    <div className="jp-clan-invite" data-layer="clan-invite">
      <div className="jp-party-invite-text">
        {t('clan.invite.askTitle', { name: clanInviteAsk.inviterName, clan: clanInviteAsk.clanName })}
      </div>
      <div className="jp-party-invite-buttons">
        <button
          className="jp-party-invite-ok"
          onClick={() => { sendClanInviteAccept(clanInviteAsk.inviterId, true); setClanInviteAsk(null); }}
        >{t('clan.invite.accept')}</button>
        <button
          className="jp-party-invite-no"
          onClick={() => { sendClanInviteAccept(clanInviteAsk.inviterId, false); setClanInviteAsk(null); }}
        >{t('clan.invite.decline')}</button>
      </div>
    </div>
  );
}
