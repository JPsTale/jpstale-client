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

/**
 * 追加系统消息（S2C_SystemMessage / S2C_Error）。
 * @param forChannel 若指定（玩家发送操作触发的反馈），该消息同时归属该频道 tab
 *                   （红色系统样式），且仍会出现在系统 tab；null=仅系统 tab。
 */
export function appendSystemMessage(text: string, timestamp = Date.now(), forChannel?: ChatChannel): void {
  appendChatMessage({ channel: forChannel ?? Ch.SYSTEM, senderId: 0, senderName: '', system: true, message: text, timestamp });
}

// 发送反馈路由：玩家最近一次发送到哪个频道（限时记忆），
// 到达的系统消息若有 forChannel 即在此频道 tab 内红色显示（"发消息后立刻有反馈"）。
let pendingSentChannel: ChatChannel | null = null;
let pendingSentExpire = 0;

/** 发送成功后记录频道（限时 3s，够服务端回执）。 */
export function noteSentOn(channel: ChatChannel): void {
  pendingSentChannel = channel;
  pendingSentExpire = Date.now() + 3000;
}

/** 取走并清空待关联频道（无则 null）。 */
export function takePendingSentOn(): ChatChannel | null {
  const ch = pendingSentChannel;
  if (ch == null || Date.now() > pendingSentExpire) {
    pendingSentChannel = null;
    return null;
  }
  pendingSentChannel = null;
  return ch;
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