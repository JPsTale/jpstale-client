/**
 * 「拆分堆叠物品」弹框的全局状态（用户 2026-09-14）。
 *
 * 为什么放全局而不是某个面板里：这个能力要服务于**多个来源** ——
 * 背包格、HUD 药水槽、以及以后的仓库格。挂在某个组件里，其余来源就用不了
 * （与 `AGENTS #31/#34` 同源：状态放在哪个组件里，就决定了它能被谁用）。
 *
 * 交互（用户定的）：**Shift + 左键点击**堆叠物 → 弹框输入要"拆出去几个"（1 ~ 总数-1）。
 * 数量为 1 时无效（没得拆）。拆出去的那份进鼠标位，随后照常放下/丢弃。
 */
import { useSyncExternalStore } from 'react';
import { beginOptimistic, getGameSnapshot, localToHeld } from './gameStore.js';
import { sendTakeToHand } from '../net/bridge.js';

export interface SplitRequest {
  /** 被拆的那件（原件，仍在原格） */
  uid: number;
  /** 原件当前总数（用于校验输入范围 1 ~ total-1） */
  total: number;
  /** 物品名（弹框标题用） */
  name: string;
}

let req: SplitRequest | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function subscribeSplit(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function getSplitRequest(): SplitRequest | null {
  return req;
}

/**
 * 请求拆分。**调用方负责先判"可拆"**（可堆叠 && `count > 1`）——
 * 这里不再回头猜，数量 ≤ 1 直接忽略（用户："当数量只有1的时候无效"）。
 */
export function requestSplit(uid: number, total: number, name: string): void {
  if (total <= 1) return;
  req = { uid, total, name };
  emit();
}

export function cancelSplit(): void {
  if (!req) return;
  req = null;
  emit();
}

/**
 * 确认：`count` 个进鼠标位；发 `TakeToHand{uid, count}`。
 *
 * **`count == 总数` 时等价于"不按 Shift 直接单击那堆"**（整堆拿起）—— 用户 2026-09-14 提的用法。
 * 这一点由两个既有判定共同保证，这里不需要分支：
 *   - 客户端 `localToHeld`：`n >= count` 时走"整件移到鼠标位"那条路；
 *   - 服务端 `takeToHand`：`splitCount < have` 才拆分，传总数落回"整行移到鼠标位"。
 * ⚠ 上下界都按 `总数` 收敛 —— 曾写成 `total - 1`，于是界面显示"全部"、实际却只拿走了 `总数-1`
 *   （用户 2026-09-14 实测追问"输入总数是不是应该等价于单击"时暴露）。**界面的说法与行为必须一致。**
 *
 * 先 `beginOptimistic` 记快照：服务端拒绝时（手位被占等）`rollbackOptimistic` 会把数量与位置还原。
 */
export function confirmSplit(count: number): void {
  const r = req;
  if (!r) return;
  req = null;
  emit();
  const n = Math.max(1, Math.min(count, r.total));
  const src = getGameSnapshot().inventory?.items.find((x) => x.uid === r.uid);
  if (src) beginOptimistic([src]);
  localToHeld(r.uid, n);
  sendTakeToHand(r.uid, n);
}

/** 供组件订阅（React 用法） */
export function useSplitRequest(): SplitRequest | null {
  return useSyncExternalStore(subscribeSplit, getSplitRequest);
}
