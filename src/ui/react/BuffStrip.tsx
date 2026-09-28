import { useEffect, useState, useSyncExternalStore } from 'react';
import { getGameSnapshot, subscribeGame, type BuffEntry } from '../../app/gameStore.js';
import { itemDefByCode, itemIconUrl } from '../../game/data/itemDefs.js';
import { itemDisplayNameOf } from '../../game/itemName.js';
import { skillRowBySkillId } from '../../game/skillIdentity.js';
import { t } from '../../i18n/index.js';
import { useItemImg } from './ItemPanel.js';
import { useTextureImg } from './useTextureImg.js';

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
const SIZE = 32;   // 原版原尺寸：32×32（图标自带外圈计时环，**不另画**）

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
      {live.map((b) => <BuffIcon key={b.skillId > 0 ? `s${b.skillId}` : `i${b.itemCode}`} b={b} now={now} />)}
    </div>
  );
}

function BuffIcon({ b, now }: { b: BuffEntry; now: number }) {
  // 技能 buff：图标 = 技能身份表的 keepIcon（原版 sSkill[] 第 4 列，keep/ 目录 TGA）；
  // 物品 buff：物品自己的图标（itemDefByCode）。
  const isSkill = b.skillId > 0;
  const skillRow = isSkill ? skillRowBySkillId(b.skillId) : null;
  const keepUrl = skillRow?.keepIcon ? `/res/image/sinimage/skill/keep/${skillRow.keepIcon.toLowerCase()}` : null;
  const keepSrc = useTextureImg(keepUrl);
  const ringSrc = useTextureImg('/res/image/sinimage/skill/keep/ga_.tga');
  const def = isSkill ? null : itemDefByCode(b.itemCode);
  const src = useItemImg(isSkill ? null : (def ? itemIconUrl(def) : null));
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
      {/* **原版三层**（`cSKILL::DrawUp`，`sinSkill.cpp:716-722`）：
          ① `GA_.tga` 镂空环底框 ② `SkillBarDraw` 已过时间饼（力量石=金/其余=青，画在图标**下面**，
          从图标外缘与底环之间的环带里透出来）③ keep 图标（**外圈计时条是它自带的**，画在最上层）。
          饼 = conic-gradient 从顶部顺时针扫过 elapsed 比例（原版扇形 0→72 段同语义）。 */}
      <img className="jp-buff-layer" src={ringSrc ?? undefined} alt="" draggable={false} />
      <div
        className="jp-buff-pie"
        style={{ background: `conic-gradient(from -90deg, ${(b.skillId > 0 ? '#00ffc8' : '#ffbe1e')} ${(elapsed * 360).toFixed(1)}deg, transparent 0deg)` }}
      />
      <div className="jp-buff-face">
        {isSkill
          ? (keepSrc ? <img src={keepSrc} alt={skillRow?.name ?? `skill ${b.skillId}`} draggable={false} /> : null)
          : (src ? <img src={src} alt={itemDisplayNameOf(def)} draggable={false} /> : null)}
      </div>
      {b.stack > 1 ? <span className="jp-buff-stack">{b.stack}</span> : null}
      {hover ? (
        <div className="jp-buff-tip">
          <div className="jp-buff-tip-name">{isSkill
            ? (skillRow?.name ?? `skill #${b.skillId}`)
            : itemDisplayNameOf(def, `#${b.itemCode}`)}</div>
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
