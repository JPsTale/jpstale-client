// 公会面板（`S2C_ClanOpen` 打开；数据走 web-server REST，见 net/rest.ts）。
//
// 数据流（与商店/打造不同，公会**没有** tick 推送）：
//   · 读（详情/排名）= 请求-响应：面板挂载/刷新按钮/建会成功后自己拉；
//   · 写（建会）= C2S_ClanCreate → game-server → S2C_ClanCreateResult（store.clanCreate）。
//
// 界面形态：
//   · 在会 → 详情 + 成员列表 + 排名页签；
//   · 不在会 → 建会表单（名称 + 查重 + 费用/等级提示）。
// 查重用 REST `check-name.json`（**与建会同一句 SQL**，见服务端 ClanManager.isNameTaken），
// 但**只作 UI 提示**：真正的唯一性由建会事务兜底（两步之间可能被人抢先）。
import { useSyncExternalStore, useEffect, useState, useCallback } from 'react';
import { subscribeGame, getGameSnapshot } from '../../app/gameStore.js';
import { t, tOr } from '../../i18n/index.js';
import {
  fetchClanDetail, fetchClanRanking, checkClanName,
  RestError, type ClanDetail, type ClanRankRow,
} from '../../net/rest.js';
import { sendClanCreate, sendClanInvite } from '../../net/bridge.js';

type FetchState<T> = { kind: 'loading' } | { kind: 'error'; code: number; msgKey: string } | { kind: 'data'; data: T };

export default function ClanPanel() {
  const { character, clanCreate } = useSyncExternalStore(subscribeGame, getGameSnapshot);
  const charName = character?.name ?? '';

  const [detail, setDetail] = useState<FetchState<ClanDetail> | null>(null);
  const [ranking, setRanking] = useState<FetchState<ClanRankRow[]> | null>(null);
  const [tab, setTab] = useState<'info' | 'ranking'>('info');

  const refresh = useCallback(() => {
    if (!charName) return;
    setDetail({ kind: 'loading' });
    fetchClanDetail(charName).then(
      (d) => setDetail({ kind: 'data', data: d }),
      (e: unknown) => setDetail(e instanceof RestError
        ? { kind: 'error', code: e.code, msgKey: e.msgKey }
        : { kind: 'error', code: -1, msgKey: 'error.web.badResponse' }),
    );
  }, [charName]);

  const refreshRanking = useCallback(() => {
    setRanking({ kind: 'loading' });
    fetchClanRanking().then(
      (rows) => setRanking({ kind: 'data', data: rows }),
      (e: unknown) => setRanking(e instanceof RestError
        ? { kind: 'error', code: e.code, msgKey: e.msgKey }
        : { kind: 'error', code: -1, msgKey: 'error.web.badResponse' }),
    );
  }, []);

  // 挂载 / 角色变化 → 拉详情；切到排名页签时拉排名
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { if (tab === 'ranking' && ranking === null) refreshRanking(); }, [tab, ranking, refreshRanking]);

  // 建会成功 → 重拉详情（WS 异步到达）
  useEffect(() => {
    if (clanCreate?.ok) {
      setDetail({ kind: 'loading' });
      refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clanCreate?.ok, clanCreate?.clanName]);

  const inClan = detail?.kind === 'data';

  return (
    <div className="jp-clan">
      <div className="jp-clan-tabs">
        <button className={`jp-shop-tab${tab === 'info' ? ' is-active' : ''}`} onClick={() => setTab('info')}>
          {t('clan.ui.tabInfo')}
        </button>
        <button className={`jp-shop-tab${tab === 'ranking' ? ' is-active' : ''}`} onClick={() => setTab('ranking')}>
          {t('clan.ui.tabRanking')}
        </button>
        <button className="jp-shop-tab" onClick={() => { refresh(); if (tab === 'ranking') refreshRanking(); }}>
          {t('clan.ui.refresh')}
        </button>
      </div>

      {tab === 'info' && (
        inClan
          ? <ClanInfo detail={(detail as { kind: 'data'; data: ClanDetail }).data} me={charName} />
          : <CreateForm detail={detail} create={clanCreate} canCreate={!!character} />
      )}

      {tab === 'ranking' && <RankingList state={ranking} />}
    </div>
  );
}

// ------------------------------------------------------------------

function ClanInfo({ detail, me }: { detail: ClanDetail; me: string }) {
  const canInvite = detail.amLeader || detail.amSubLeader;
  const [inviteName, setInviteName] = useState('');
  const doInvite = () => {
    const n = inviteName.trim();
    if (n === '') return;
    sendClanInvite(0, n);   // 结果走 S2C_Error（key）或对方的确认弹窗
    setInviteName('');
  };
  return (
    <div className="jp-clan-info">
      <div className="jp-clan-head">
        <span className="jp-clan-name">{detail.clanName}</span>
        <span className="jp-clan-sub">{t('clan.ui.memberCount')}：{detail.memberCount}{detail.rank > 0 ? `　${t('clan.ui.rank')}：#${detail.rank}` : ''}</span>
      </div>
      {detail.note !== '' && <div className="jp-clan-note">{detail.note}</div>}
      <div className="jp-clan-kv">
        <span>{t('clan.ui.leader')}</span><span>{detail.leader}{detail.leader === me ? `（${t('clan.ui.you')}）` : ''}</span>
        <span>{t('clan.ui.subLeader')}</span><span>{detail.subLeader !== '' ? detail.subLeader : t('clan.ui.none')}</span>
        <span>{t('clan.ui.created')}</span><span>{detail.regiDate}</span>
        <span>{t('clan.ui.gold')}</span><span>{detail.clanMoney.toLocaleString()}</span>
      </div>
      {canInvite && (
        <div className="jp-clan-invite-row">
          <input
            className="jp-clan-input"
            maxLength={16}
            placeholder={t('clan.ui.invitePlaceholder')}
            value={inviteName}
            onChange={(e) => setInviteName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') doInvite(); }}
          />
          <button className="jp-step-btn" onClick={doInvite}>{t('clan.ui.inviteBtn')}</button>
        </div>
      )}
      <div className="jp-clan-members-title">{t('clan.ui.members')}</div>
      <div className="jp-clan-list">
        {detail.members.map((m) => (
          <div key={m.charName} className={`jp-clan-row${m.charName === me ? ' is-me' : ''}`}>
            <span className="jp-clan-col-name">
              {m.permission === '2' ? `[${t('clan.ui.subLeaderShort')}] ` : ''}
              {m.charName === detail.leader ? `[${t('clan.ui.leaderShort')}] ` : ''}
              {m.charName}
            </span>
            <span className="jp-clan-col-lv">{t('clan.ui.levelShort')} {m.charLevel}</span>
            <span className="jp-clan-col-date">{m.joinDate.slice(0, 10)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------

function CreateForm({ detail, create, canCreate }: {
  detail: FetchState<ClanDetail> | null;
  create: { ok: boolean; errorKey: string; clanName: string; iconId: number } | null;
  canCreate: boolean;
}) {
  const [name, setName] = useState('');
  const [checking, setChecking] = useState(false);
  const [nameFree, setNameFree] = useState<boolean | null>(null);
  const [nameErr, setNameErr] = useState('');

  // 不在公会 = 详情接口回了 10501；其它错误原样显示（库坏了不能装作"没公会"）
  const notInClan = detail?.kind === 'error' && detail.code === 10501;
  const otherError = detail?.kind === 'error' && detail.code !== 10501;

  const doCheck = async () => {
    const n = name.trim();
    if (n === '') { setNameErr(t('clan.op.nameEmpty')); return; }
    setChecking(true);
    setNameErr('');
    try {
      setNameFree(await checkClanName(n));
    } catch (e) {
      setNameFree(null);
      setNameErr(e instanceof RestError ? tOr(e.msgKey, e.msgKey) : t('error.web.badResponse'));
    } finally {
      setChecking(false);
    }
  };

  const doCreate = () => {
    const n = name.trim();
    if (n === '') { setNameErr(t('clan.op.nameEmpty')); return; }
    setNameErr('');
    sendClanCreate(n);   // 结果走 S2C_ClanCreateResult（store.clanCreate）
  };

  if (otherError) {
    const st = detail as { kind: 'error'; msgKey: string };
    return <div className="jp-clan-empty">{tOr(st.msgKey, st.msgKey)}</div>;
  }
  if (!notInClan && detail?.kind !== 'error') {
    return <div className="jp-clan-empty">{detail === null || detail.kind === 'loading' ? t('clan.ui.loading') : ''}</div>;
  }

  const fail = create && !create.ok && create.errorKey !== '' ? create.errorKey : '';

  return (
    <div className="jp-clan-create">
      <div className="jp-clan-create-req">
        <span>{t('clan.ui.levelReq')}</span>
        <span>{t('clan.ui.cost')}</span>
      </div>
      <div className="jp-clan-create-row">
        <input
          className="jp-clan-input"
          maxLength={20}
          placeholder={t('clan.ui.namePlaceholder')}
          value={name}
          onChange={(e) => { setName(e.target.value); setNameFree(null); }}
        />
        <button className="jp-step-btn" onClick={doCheck} disabled={checking}>{t('clan.ui.check')}</button>
      </div>
      {nameFree === true && <div className="jp-clan-ok">{t('clan.ui.nameOk')}</div>}
      {nameFree === false && <div className="jp-clan-err">{t('clan.op.nameTaken')}</div>}
      {nameErr !== '' && <div className="jp-clan-err">{nameErr}</div>}
      {fail !== '' && <div className="jp-clan-err">{tOr(fail, fail)}</div>}
      {create?.ok && <div className="jp-clan-ok">{t('clan.ui.created2', { name: create.clanName })}</div>}
      <button className="jp-clan-create-btn" onClick={doCreate} disabled={!canCreate}>{t('clan.ui.createBtn')}</button>
      {!canCreate && <div className="jp-clan-err">{t('clan.ui.noCharacter')}</div>}
    </div>
  );
}

// ------------------------------------------------------------------

function RankingList({ state }: { state: FetchState<ClanRankRow[]> | null }) {
  if (state === null || state.kind === 'loading') return <div className="jp-clan-empty">{t('clan.ui.loading')}</div>;
  if (state.kind === 'error') return <div className="jp-clan-empty">{tOr(state.msgKey, state.msgKey)}</div>;
  if (state.data.length === 0) return <div className="jp-clan-empty">{t('clan.ui.noRanking')}</div>;
  return (
    <div className="jp-clan-list">
      {state.data.map((r, i) => (
        <div key={r.clanId} className="jp-clan-row">
          <span className="jp-clan-col-rank">#{i + 1}</span>
          <span className="jp-clan-col-name">{r.clanName}</span>
          <span className="jp-clan-col-lv">{t('clan.ui.memberCountShort')} {r.memberCount}</span>
          <span className="jp-clan-col-date">{r.cPoint.toLocaleString()} {t('clan.ui.points')}</span>
        </div>
      ))}
    </div>
  );
}
