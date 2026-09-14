/**
 * 「手持道具时点游戏画面 → 丢到地面」——**唯一实现**。
 *
 * 为什么独立成文件而不是留在 `ItemPanel` 里（用户 2026-09-14 实测）：
 * 从 **HUD 药水槽**拿起药水时背包是**关着**的（`ItemPanel` 未挂载），
 * 于是挂在面板组件里的 `document.pointerdown` 监听不存在 ⇒ 点空处丢不掉。
 * 与 `AGENTS #31/#34` 同源 —— 行为挂在"哪个组件"里，就决定了它能被谁用；
 * 凡是**多个来源**（背包面板 / HUD 药水槽 / 装备槽）都要触发的行为必须放全局。
 *
 * 现由 `PanelsRoot` 在挂载期注册（它在整个 WORLD 界面期间常驻，不受面板开关影响）。
 * 原版依据：`sinSubMain.cpp` 的 `sinThrowItemToFeild` —— 扔到**地面**。
 */
import {
  beginOptimistic, getGameSnapshot, getHeldUid, isOverUi, throwItem, setHeldUid,
} from '../../app/gameStore.js';
import { isInputBlocked } from '../../app/inputGate.js';
import { isDroppable } from '../../game/itemRules.js';
import { itemDefById } from '../../game/data/itemDefs.js';
import { sfx } from '../../audio/sfx.js';
import { sendDropItem } from '../../net/bridge.js';

/**
 * 处理一次「可能丢到地面」的按下。返回 true = 已消费（调用方应停止传播）。
 *
 * 判定顺序与原实现逐条一致（别简化 —— 每一条都对应一次实测事故）：
 *  ① 手上没东西 / 输入被遮罩挡着（加载页）→ 不动手；
 *  ② 必须点在**游戏画面（canvas）**上 —— 原版 ThrowItem 的语义是"扔到地上"，
 *     旧判定"不在背包面板内就丢"会把点 HUD/信息框也当成丢弃（实测丢过药水）；
 *  ③ 不能落在 UI 交互区（`isOverUi`）：HUD 是 `pointer-events:none` 覆盖层，
 *     点它会穿透到 canvas 上，只判 canvas 会把"点药水槽放入"误判成丢弃；
 *  ④ 手持物必须**仍在背包**（`getHeldUid`）—— 放进药水槽后那件已离开背包，
 *     而 `heldUid` 还留旧值，用它会找到**槽里那瓶**并丢出去。
 *
 * ⚠ "点在面板内"由调用方先判（面板是各自的 `<div ref>`），不在这里 —— 这里只认
 *   "点在游戏画面上"这一件事，与物品来源无关。
 */
export function tryDropHeldToGround(e: PointerEvent): boolean {
  if (getGameSnapshot().heldUid == null) return false;
  if (isInputBlocked()) return false;

  const t = e.target as Node | null;
  const isWorld = t instanceof Element && !!t.closest('canvas');
  if (!isWorld || isOverUi(e.clientX, e.clientY)) return false;

  const uidNow = getHeldUid();
  const it = uidNow == null ? undefined
    : getGameSnapshot().inventory?.items.find((x) => x.uid === uidNow);
  if (!it) return false;

  // 禁丢清单预校验（原版 NotDrow_Item_*）：拦住就不发请求 —— 否则本地已移除、服务端却拒绝，
  // 两端会不一致（物品在服务端还在、客户端没了）。最终仍以服务端为准。
  const def = itemDefById(it.itemlistId) as { code?: number } | undefined;
  if (!isDroppable(def?.code)) {
    console.warn('[bag] 该物品无法丢弃（禁丢清单）：uid=', it.uid, 'idCode=', def?.code);
    sfx.playUi('denied');       // 放下失败 → 失败音
    return true;                // 保持手持不变（等于这次点击没发生）
  }

  console.log('[bag] 丢到地面 uid=', it.uid, 'count=', it.count);
  beginOptimistic([it]);        // 乐观更新前记快照：服务端拒绝时把整件（含数量）恢复
  throwItem(it.uid);            // THROW_ITEM（玩家自己的操作码）：本地移除 + 丢弃音
  sendDropItem(it.uid, it.count || 1);
  setHeldUid(null);
  return true;
}
