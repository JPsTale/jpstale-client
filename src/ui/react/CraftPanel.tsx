import { useEffect, useState, useSyncExternalStore } from 'react';
import { getGameSnapshot, setCraftPreview, subscribeGame, type CraftPreview, type GameItem } from '../../app/gameStore.js';
import { ITEM_CLASS } from '../../game/itemClass.js';
import { itemDefById, itemIconUrl } from '../../game/data/itemDefs.js';
import { itemDisplayNameOf } from '../../game/itemName.js';
import { t } from '../../i18n/index.js';
import { sendAgeItem, sendForceOrbItem, sendMixItem, sendMixPreview } from '../../net/bridge.js';
import PanelShell from './PanelShell.js';
import { useItemHover } from './ItemInfo.js';
import { useItemImg } from './ItemPanel.js';

/**
 * NPC 的打造窗口（合成 / 锻造 / 力量石）—— 由服务端 `S2C_CraftOpen` 打开。
 *
 * **档位由服务端给**（`craft.modes`，取值见服务端 `NpcCraftTable`）：原版每个 NPC 的脚本里写着
 * 它提供哪种服务（`*아이템조합` / `*아이템에이징` / `*아이템연금`），客户端**不**按 NPC 名字或模型判断
 * —— 那会在改名/换模型时静默失效。只有一档时不显示标签条（没有可切的东西）。
 *
 * **材料是"引用"而不是搬运**：格子里的石头**仍在背包里**，格子上记的是它的 uid。
 * 原版是把物品搬进窗口格子（关窗再退回来）；我们这么做是因为"物品在哪个容器"是**服务端权威**的，
 * 客户端自造一个临时容器就会出现"客户端以为在窗口里、服务端以为在背包"的分叉。
 * 好处是关窗不会丢东西、服务端校验（在背包 + 是材料石）就是现成的 `MixService` / `AgeService`。
 *
 * 投石/合成的**结果**由服务端算（配方匹配、掷点、破坏），这里只负责把 uid 列表发出去；
 * 失败原因经 `S2C_Error` 的 `item.op.*` key 回到聊天系统消息里（不在这里另造一套提示）。
 */
const MIX = 1;
const AGE = 2;
const FORCE = 3;

/** 材料石家族（原版 `sinOS1 = 0x02350000`，投石/合成的"石头"就是这个族）。 */
const STONE_FAMILY = 0x0235;
/** 材料格上限：原版 NPC 界面是 3×4 = 12 格（用户 2026-09-22） */
const MAX_CELLS = 12;

function isStone(code: number | null | undefined): boolean {
  return ((code ?? 0) >>> 16) === STONE_FAMILY;
}

/** 装备类（按 classItem 的槽位位值判，**排除**材料石 —— 宝石位 0x100 它们也有） */
function isEquipment(it: GameItem): boolean {
  if (isStone(it.itemCode)) return false;
  const cls = itemDefById(it.itemlistId)?.class ?? 0;
  const bits = ITEM_CLASS.LHAND | ITEM_CLASS.RHAND | ITEM_CLASS.ARMOR | ITEM_CLASS.BOOTS | ITEM_CLASS.GLOVES
    | ITEM_CLASS.RING | ITEM_CLASS.SHELTOM | ITEM_CLASS.AMULET | ITEM_CLASS.ARMLET | ITEM_CLASS.COSTUME;
  return (cls & bits) !== 0;
}

export default function CraftPanel() {
  const snap = useSyncExternalStore(subscribeGame, getGameSnapshot);
  const craft = snap.craft;
  const modes = craft?.modes ?? [];
  const [mode, setMode] = useState<number>(modes[0] ?? MIX);
  const [mats, setMats] = useState<number[]>([]);
  const [target, setTarget] = useState<number | null>(null);

  const items = snap.inventory?.items ?? [];
  const bag = items.filter((x) => x.location === 0);
  const stones = bag.filter((x) => isStone(x.itemCode));
  const gears = bag.filter(isEquipment);

  // 合成预览：材料或目标一变就重新问服务端（150ms 防抖，避免连点时打一串往返）。
  // ⚠ **必须先置 null**：否则上一批石头的结果会挂在新一批材料下面当成本次结果（客户端唯一的"判断"
  //   就是"这是不是服务端刚给我的那一份"，数字本身一个都不算）。
  const preview = snap.craftPreview;
  useEffect(() => {
    const ask = mode === MIX && target != null && mats.length > 0;
    setCraftPreview(null);
    if (!ask) return;
    const t0 = window.setTimeout(() => sendMixPreview(target, mats), 150);
    return () => window.clearTimeout(t0);
  }, [mode, target, mats.join(',')]);

  const cellCap = mode === AGE ? 1 : MAX_CELLS;
  const canSubmit = mode === FORCE
    ? mats.length > 0
    : target != null && mats.length > 0;

  function addStone(uid: number) {
    if (mats.length >= cellCap || mats.includes(uid)) return;
    setMats([...mats, uid]);
  }
  function removeStone(uid: number) {
    setMats(mats.filter((u) => u !== uid));
  }
  function submit() {
    if (!canSubmit) return;
    if (mode === MIX) sendMixItem(target!, mats);
    else if (mode === AGE) sendAgeItem(target!, mats[0]);
    else sendForceOrbItem(mats);
    // 发完就清空格子：服务端成功后这些石头已经没了（失败则原因会从聊天里看到）。
    // 目标装备**留着**（投石是一颗接一颗，原版也保持装备在窗口里）。
    setMats([]);
  }

  return (
    <PanelShell title={t('panel.craft')} panel="craft" align="left" width="auto">
      <div className="jp-craft">
        {modes.length > 1 ? (
          <div className="jp-craft-tabs">
            {modes.map((m) => (
              <button
                key={m}
                className={`jp-craft-tab${m === mode ? ' is-on' : ''}`}
                onClick={() => { setMode(m); setMats([]); }}
              >
                {tabLabel(m)}
              </button>
            ))}
          </div>
        ) : null}

        {mode !== FORCE ? (
          <div className="jp-craft-row">
            <span className="jp-craft-label">{t('panel.c_target')}</span>
            <CraftSlot it={itemOf(items, target)} cap={1} />
          </div>
        ) : null}

        <div className="jp-craft-row">
          <span className="jp-craft-label">{t('panel.c_materials')}</span>
          <div className="jp-craft-cells">
            {Array.from({ length: cellCap }, (_, i) => (
              <CraftSlot key={i} it={itemOf(items, mats[i])} cap={1} onClick={() => mats[i] != null && removeStone(mats[i])} />
            ))}
          </div>
        </div>

        {/* 预览（只有合成有）：数全部由服务端算好下发，这里一个算术都不做 */}
        {mode === MIX ? <MixPreviewLines preview={preview} /> : null}

        {/* 材料来源：背包里的材料石。点一下放进空格（**不搬运**，只记 uid） */}
        <SourceStrip title={t('panel.c_stoneSource')} list={stones} onClick={addStone}
                     disabled={mats.length >= cellCap} />

        {/* 装备来源：只有需要目标的两种档位才显示 */}
        {mode !== FORCE ? (
          <SourceStrip title={t('panel.c_gearSource')} list={gears}
                       onClick={(uid) => setTarget(uid)} />
        ) : null}

        <div className="jp-craft-actions">
          <button className="jp-craft-ok" disabled={!canSubmit} onClick={submit}>
            {mode === FORCE ? t('panel.c_convert') : t('panel.c_ok')}
          </button>
          <span className="jp-craft-hint">{canSubmit ? '' : t('panel.c_empty')}</span>
        </div>
      </div>
    </PanelShell>
  );
}

/**
 * 合成预览区 —— **只显示服务端给的数**（before → after 与配方名都是下发的）。
 *
 * 为什么不本地算：客户端没有配方表；就算有，两份匹配实现迟早漂移成"窗口说 +15、物品实际 +12"，
 * 而且两边都不报错（本仓最贵的一类 bug）。所以这里唯一的逻辑是"把收到的行排出来"。
 */
function MixPreviewLines({ preview }: { preview: CraftPreview | null }) {
  if (!preview) return null;                       // 还没收到答复：什么都不显示（别显示上一批的）
  if (!preview.matched) {
    return <div className="jp-craft-preview jp-craft-preview--none">{t(preview.reasonKey)}</div>;
  }
  return (
    <div className="jp-craft-preview">
      <div className="jp-craft-preview-name">{t('panel.c_recipe')}：{preview.recipeName}</div>
      {preview.effects.map((e) => (
        <div key={e.bit} className="jp-craft-preview-row">
          <span className="jp-craft-preview-key">{t(e.key)}</span>
          <span className="jp-craft-preview-val">
            {num(e.before)} → <b>{num(e.after)}</b>
            <span className="jp-craft-preview-delta">{fmtDelta(e.after - e.before, e.intField)}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/** 数值显示：整数字段不补小数位；小数字段整数也不补（原版信息框同口径）。 */
function num(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function fmtDelta(d: number, intField: boolean): string {
  const v = intField ? Math.round(d) : d;
  if (v === 0) return '';
  const sign = v > 0 ? '+' : '';
  return `（${sign}${num(v)}）`;
}

/** 档位标签（服务端给的是数字，文案在客户端 —— 服务端只发 key/枚举，不发文案）。 */
function tabLabel(m: number): string {
  if (m === MIX) return t('panel.c_tabMix');
  if (m === AGE) return t('panel.c_tabAge');
  if (m === FORCE) return t('panel.c_tabForce');
  return String(m);
}

function itemOf(items: readonly GameItem[], uid: number | null | undefined): GameItem | undefined {
  return uid == null ? undefined : items.find((x) => x.uid === uid);
}

/** 一个格子（目标格 / 材料格）：空格显示提示，有东西显示图标 + 数量，悬停出物品信息框。 */
function CraftSlot({ it, cap, onClick }: { it?: GameItem; cap: number; onClick?: () => void }) {
  const hover = useItemHover();
  const def = it ? itemDefById(it.itemlistId) : undefined;
  const src = useItemImg(it && def ? itemIconUrl(def) : null);
  return (
    <button
      className={`jp-craft-slot${it ? ' is-filled' : ''}`}
      onClick={onClick}
      disabled={!it || !onClick}
      onPointerEnter={it ? (e) => hover.show({ kind: 'item', uid: it.uid }, e) : undefined}
      onPointerLeave={it ? () => hover.hide() : undefined}
    >
      {it && src ? (
        <>
          <img src={src} alt={itemDisplayNameOf(def)} draggable={false} />
          {it.count > cap ? <span className="jp-craft-count">{it.count}</span> : null}
        </>
      ) : null}
    </button>
  );
}

/** 来源条：列出背包里可用的东西，点一下放进去（原版是"从背包拖进窗口"，我们点选）。 */
function SourceStrip({ title, list, onClick, disabled }: {
  title: string; list: readonly GameItem[]; onClick: (uid: number) => void; disabled?: boolean;
}) {
  const hover = useItemHover();
  return (
    <div className="jp-craft-src">
      <div className="jp-craft-src-title">{title}</div>
      {list.length === 0 ? (
        <div className="jp-craft-src-empty">{t('panel.c_none')}</div>
      ) : (
        <div className="jp-craft-src-list">
          {list.map((it) => (
            <SrcIcon key={it.uid} it={it} onClick={onClick} disabled={disabled} hover={hover} />
          ))}
        </div>
      )}
    </div>
  );
}

function SrcIcon({ it, onClick, disabled, hover }: {
  it: GameItem; onClick: (uid: number) => void; disabled?: boolean;
  hover: { show: (src: { kind: 'item'; uid: number }, e: { clientX: number; clientY: number }) => void; hide: () => void };
}) {
  const def = itemDefById(it.itemlistId);
  const src = useItemImg(def ? itemIconUrl(def) : null);
  return (
    <button
      className="jp-craft-src-icon"
      title={itemDisplayNameOf(def)}
      disabled={disabled}
      onClick={() => onClick(it.uid)}
      onPointerEnter={(e) => hover.show({ kind: 'item', uid: it.uid }, e)}
      onPointerLeave={() => hover.hide()}
    >
      {src ? <img src={src} alt={itemDisplayNameOf(def)} draggable={false} /> : null}
      {it.count > 1 ? <span className="jp-craft-count">{it.count}</span> : null}
    </button>
  );
}
