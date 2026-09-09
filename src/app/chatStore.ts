// 框架无关的游戏内聊天状态 store。
// 单向流动：main.ts/bridge（低层）写入，React 聊天窗（高层）只读渲染。
// 用 useSyncExternalStore 桥接（同 gameStore）：getChatSnapshot 返回稳定引用，
// 只有 commit 时才替换快照对象，避免无谓重渲染。

export type ChatChannel = number; // jpt.base.ChatChannel

/** 频道 ID 常量（对齐 proto ChatChannel） */
export const Ch = {
  WORLD: 0,
  MAP: 1,
  PARTY: 2,
  GUILD: 3,
  PRIVATE: 4,
  SYSTEM: 5,
  TRADE: 6,
} as const;

export interface ChatMessage {
  id: number;
  channel: ChatChannel;
  senderId: number;
  senderName: string;
  message: string;
  timestamp: number;
  system?: boolean;
}

export interface ChatSnapshot {
  messages: readonly ChatMessage[];
  /** 当前发送频道 tab（普通/组队/公会/交易；私聊与系统为只读） */
  activeChannel: ChatChannel;
  /** 窗口折叠（仅显示最后一行） */
  collapsed: boolean;
  /** 输入框是否激活 */
  inputOpen: boolean;
  /** 可见（World 界面内） */
  visible: boolean;
}

const MAX_MESSAGES = 300;

function loadInitial(): ChatSnapshot {
  return {
    messages: [],
    activeChannel: Ch.MAP,
    collapsed: false,
    inputOpen: false,
    visible: false,
  };
}

let snapshot: ChatSnapshot = loadInitial();
const listeners = new Set<() => void>();

export function getChatSnapshot(): ChatSnapshot {
  return snapshot;
}

export function subscribeChat(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function commit(patch: Partial<ChatSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  for (const l of [...listeners]) l();
}

let msgId = 0;

/** 追加一条聊天消息（网络层 S2C_Chat）。 */
export function appendChatMessage(entry: Omit<ChatMessage, 'id'>): void {
  const msg: ChatMessage = { ...entry, id: ++msgId };
  const messages = snapshot.messages.length >= MAX_MESSAGES
    ? [...snapshot.messages.slice(snapshot.messages.length - MAX_MESSAGES + 1), msg]
    : [...snapshot.messages, msg];
  commit({ messages });
}

/** 追加系统消息（S2C_SystemMessage）。system 标记显示类型，channel 归系统。 */
export function appendSystemMessage(text: string, timestamp = Date.now()): void {
  appendChatMessage({ channel: Ch.SYSTEM, senderId: 0, senderName: '', system: true, message: text, timestamp });
}

export function setActiveChatChannel(channel: ChatChannel): void {
  if (snapshot.activeChannel === channel) return;
  commit({ activeChannel: channel });
}

export function toggleChatCollapsed(): void {
  commit({ collapsed: !snapshot.collapsed });
}

export function setChatCollapsed(collapsed: boolean): void {
  if (snapshot.collapsed === collapsed) return;
  commit({ collapsed });
}

export function setChatInputOpen(open: boolean): void {
  if (snapshot.inputOpen === open) return;
  commit({ inputOpen: open });
}

export function setChatVisible(visible: boolean): void {
  if (snapshot.visible === visible) return;
  // 离开 World 时收起输入并复位到普通频道
  if (!visible) commit({ inputOpen: false, visible });
  else commit({ visible });
}

/** 清空消息（进图时可选）。 */
export function clearChatMessages(): void {
  if (snapshot.messages.length === 0) return;
  commit({ messages: [] });
}