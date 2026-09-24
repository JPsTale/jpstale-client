import { useEffect, useState, useSyncExternalStore } from 'react';
import { getGameSnapshot, subscribeGame, type BuffEntry } from '../../app/gameStore.js';
import { itemDefByCode, itemIconUrl } from '../../game/data/itemDefs.js';
import { itemDisplayNameOf } from '../../game/itemName.js';
import { t } from '../../i18n/index.js';
import { useItemImg } from './ItemPanel.js';

/**
 * 屏幕**左上角**的 buff 图标条（原版风格：圆形图标 + 外圈圆环倒计时）。
 *
 * 版面依据用户 2026-09-22 提供的私服截图：一排圆形图标，中央是**触发该 buff 的物品自己的图标**，
 * 外圈一圈圆环，**淡蓝色填充表示已经过的时间**，鼠标悬停出提示。
 * （原版没有专门的 buff 图标资产 —— `UpKeepItemName[]` 只有文字 —— 所以图标直接取物品图标：
 * 力量石用 `itfo1NN.bmp`，与背包里那颗长得一样，玩家一眼能对上。）
 *
 * **服务端权威**：`S2C_BuffState` 整表下发（生效/刷新/到期/任何一次状态推送都会重发）。
 * 这里只做两件事：按 `已过/总时长` 画圆环、`remaining` 归零就不再绘制 ——
 * 服务端的生效判据正是 `until > now`，两边同一条线，不会分叉。效果数值全由服务端算。
 */
const SIZE = 44;   // 圆形外径（含圆环）
const RING = 3;    // 圆环粗细
const R = (SIZE - RING) / 2;
const C = 2 * Math.PI * R;

export default function BuffStrip() {
  const { buffs } = useSyncExternalStore(subscribeGame, getGameSnapshot);
  // 只在有 buff 时挂定时器（没有 buff 时零开销）；200ms 与圆环的视觉精度相称
  const [, tick] = useState(0);
  useEffect(() => {
    if (buffs.length === 0) return;
    const id = window.setInterval(() => tick((n) => n + 1), 200);
    return () => window.clearInterval(id);
  }, [buffs.length]);

  const now = Date.now();
  // 归零即不画（纯显示层：服务端到期时会推一张空表把它彻底清掉，见 PlayerService.sweepExpiredBuffs）
  const live = buffs.filter((b) => b.at + b.remainingMs > now);
  if (live.length === 0) return null;
  return (
    <div className="jp-buffs" data-layer="buff-strip">
      {live.map((b) => <BuffIcon key={b.itemCode} b={b} now={now} />)}
    </div>
  );
}

function BuffIcon({ b, now }: { b: BuffEntry; now: number }) {
  const def = itemDefByCode(b.itemCode);
  const src = useItemImg(def ? itemIconUrl(def) : null);
  const [hover, setHover] = useState(false);

  const remain = Math.max(0, b.at + b.remainingMs - now);
  const total = b.totalMs > 0 ? b.totalMs : Math.max(1, b.remainingMs);
  // 已过比例（截图口径：淡蓝填充 = 已经过的时间）
  const elapsed = Math.min(1, Math.max(0, 1 - remain / total));

  return (
    <div
      className="jp-buff"
      style={{ width: SIZE, height: SIZE }}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
    >
      {/* 圆环：底圈 + 已过时间的淡蓝弧（从正上方顺时针推进） */}
      <svg className="jp-buff-ring" width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none"
                stroke="rgba(0,0,0,0.55)" strokeWidth={RING} />
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none"
                stroke="#7fd4ff" strokeWidth={RING} strokeLinecap="round"
                strokeDasharray={C} strokeDashoffset={C * (1 - elapsed)}
                transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`} />
      </svg>
      <div className="jp-buff-face">
        {src ? <img src={src} alt={itemDisplayNameOf(def)} draggable={false} /> : null}
      </div>
      {b.stack > 1 ? <span className="jp-buff-stack">{b.stack}</span> : null}
      {hover ? (
        <div className="jp-buff-tip">
          <div className="jp-buff-tip-name">{itemDisplayNameOf(def, `#${b.itemCode}`)}</div>
          <div className="jp-buff-tip-time">{t('buff.remaining', { s: fmt(remain) })}</div>
        </div>
      ) : null}
    </div>
  );
}

/** 剩余时间：不足 1 分钟显示秒，超过显示 m:ss（玩家要的是"还能撑多久"，不是毫秒） */
function fmt(ms: number): string {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
