import { useState } from 'react';
import { useSyncExternalStore } from 'react';
import { getGameSnapshot, setShopSellMode, subscribeGame, type ShopItem } from '../../app/gameStore.js';
import { sendShopBuy } from '../../net/bridge.js';
import { itemIconUrl, itemDefById } from '../../game/data/itemDefs.js';
import { t } from '../../i18n/index.js';

/**
 * NPC 商店面板（买 / 卖）。
 *
 * 依据原版：
 * - 商品按**三个类别**分列（`npclist` 的 `weaponshop/defenseshop/miscshop`），一个 NPC 可以同时是
 *   武器店 + 防具店，所以行上有 `kind`，这里用页签分组；
 * - 买入：药水才有数量选择（原版默认 = 堆叠数），其余一次一件；
 * - **卖出不是拖拽**：原版是"点商店的 Sell 按钮 → 光标变成卖出光标 → 点自己背包里的物品即刻卖出"
 *   （`sinShop.cpp:1318 CursorClass = SIN_CURSOR_SELL` + `sinInvenTory.cpp:6154-6189`）。
 *   所以这里只有一个"卖出模式"开关，打开后去背包点物品即为卖出 —— 不引入商店容器。
 */
const KIND_KEYS = ['weapon', 'defense', 'misc'] as const;

export default function ShopPanel() {
  const snap = useSyncExternalStore(subscribeGame, getGameSnapshot);
  const shop = snap.shop;
  const [kind, setKind] = useState<number>(0);
  const [count, setCount] = useState(1);

  if (!shop) return null;

  const kinds = KIND_KEYS.map((k, i) => ({ i, key: k })).filter(({ i }) => shop.items.some((o) => o.kind === i));
  const active = kinds.some((k) => k.i === kind) ? kind : (kinds[0]?.i ?? 0);
  const rows = shop.items.filter((o) => o.kind === active);
  const gold = snap.inventory?.gold ?? 0;

  return (
    <div className="jp-shop">
      <div className="jp-shop-head">
        <span className="jp-shop-gold">{t('item.gold')}: {gold}</span>
        <button
          type="button"
          className={`jp-shop-sellmode${shop.sellMode ? ' on' : ''}`}
          onClick={() => setShopSellMode(!shop.sellMode)}
        >
          {t('shop.sellMode')}
        </button>
      </div>
      <div className="jp-shop-tabs">
        {kinds.map(({ i, key }) => (
          <button
            type="button"
            key={key}
            className={`jp-shop-tab${i === active ? ' on' : ''}`}
            onClick={() => setKind(i)}
          >
            {t(`shop.kind.${key}`)}
          </button>
        ))}
      </div>
      <div className="jp-shop-list">
        {rows.map((o) => (
          <ShopRow key={o.itemlistId} offer={o} gold={gold} count={count} onCount={setCount} entityId={shop.entityId} />
        ))}
      </div>
      {shop.sellMode ? <div className="jp-shop-hint">{t('shop.sellHint')}</div> : null}
    </div>
  );
}

function ShopRow({ offer, gold, count, onCount, entityId }: {
  offer: ShopItem;
  gold: number;
  count: number;
  onCount: (n: number) => void;
  entityId: number;
}) {
  const def = itemDefById(offer.itemlistId);
  const icon = def ? itemIconUrl(def) : null;
  // 只有可堆叠物（药水）才谈数量 —— 与服务器一致（原版也只有药水给数量框）
  const stackable = (def?.class ?? 0) === 8192;
  const n = stackable ? count : 1;
  const afford = gold >= offer.price * n;
  return (
    <button
      type="button"
      className={`jp-shop-row${afford ? '' : ' jp-shop-row--poor'}`}
      onDoubleClick={() => sendShopBuy(entityId, offer.itemlistId, n)}
      onClick={() => sendShopBuy(entityId, offer.itemlistId, n)}
      title={t('shop.buy')}
    >
      {icon ? <img className="jp-shop-icon" src={icon} alt="" draggable={false} /> : null}
      <span className="jp-shop-name">{offer.name || `#${offer.itemlistId}`}</span>
      <span className="jp-shop-price">{offer.price}{t('item.gold')}</span>
      {stackable ? (
        <span className="jp-shop-count" onClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => onCount(Math.max(1, count - 1))}>-</button>
          <input
            value={count}
            onChange={(e) => onCount(Math.max(1, Math.min(1000, Number(e.target.value) || 1)))}
            onClick={(e) => e.stopPropagation()}
          />
          <button type="button" onClick={() => onCount(Math.min(1000, count + 1))}>+</button>
        </span>
      ) : null}
    </button>
  );
}
