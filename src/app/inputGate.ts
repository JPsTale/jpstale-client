/**
 * **全局输入闸门** —— 加载页/遮罩期间屏蔽世界、HUD 与背包的鼠标操作。
 *
 * 为什么需要一个开关（而不是靠"遮罩盖在上面"）：
 * 我们不少输入监听挂在 `window` / `document` 上，它们**不看 DOM 命中**——
 * 加载页盖在最上面也照样触发。实测后果：加载过程中点一下，HUD 的动作会被派发
 * （喝药、切走跑、开关背包），背包开着时点面板外还会**把手上的道具丢到地上**。
 * 依赖"谁盖在谁上面"来决定能不能操作，是把正确性押在 DOM 叠放顺序上 —— 太脆。
 *
 * 用法：单一开关，各监听器**开头查一次**（`if (isInputBlocked()) return;`）。
 * 目前由 `LoadingScreen.show()/hide()` 维护；将来任何"模态遮罩"都应走同一个开关。
 */
let blocked = false;
const listeners = new Set<() => void>();

export function setInputBlocked(value: boolean): void {
  if (blocked === value) return;
  blocked = value;
  for (const l of [...listeners]) l();   // 可订阅：React 侧据此重渲染（如加载结束后重新显示持物图标）
}

export function isInputBlocked(): boolean {
  return blocked;
}

/** `useSyncExternalStore` 用：闸门自身就是一个小 store（不能借 gameStore 的提交来驱动）。 */
export function subscribeInputGate(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
