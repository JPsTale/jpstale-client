// 游戏内聊天窗口（常驻 World 界面）。
// 折叠窗 + 频道 tab + 输入框。输入前缀解析见 net/protocol.parseChatInput：
//   /名字: 消息  私聊          /TRADE> 消息  交易频道
//   @消息       组队聊天        /xxx          命令（原样上送，服务端权威）
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getChatSnapshot, subscribeChat, setActiveChatChannel, setChatCollapsed, setChatInputOpen, Ch, type ChatMessage } from '../../app/chatStore.js';
import { t } from '../../i18n/index.js';
import { send } from '../../net/transport.js';
import { chat, parseChatInput } from '../../net/protocol.js';

const CHANNEL_COLORS: Record<number, string> = {
  [Ch.MAP]: '#e8e6e1',
  [Ch.PARTY]: '#7cd8ff',
  [Ch.GUILD]: '#b3a4ff',
  [Ch.TRADE]: '#ffd98a',
  [Ch.PRIVATE]: '#ff8c94',
  [Ch.SYSTEM]: '#ffd94d',
  [Ch.WORLD]: '#ffd98a',
};

/** tab 定义：key=channel 值；私聊与系统为只读（无发送语义） */
const TABS: { channel: number; label: string; readonly?: boolean }[] = [
  { channel: Ch.MAP, label: 'chat.normal' },
  { channel: Ch.PARTY, label: 'chat.party' },
  { channel: Ch.GUILD, label: 'chat.guild' },
  { channel: Ch.TRADE, label: 'chat.trade' },
  { channel: Ch.SYSTEM, label: 'chat.system', readonly: true },
];

// 私聊消息显示在"普通"tab 下
const SHOW_BY_TAB: Record<number, number[]> = {
  [Ch.MAP]: [Ch.MAP, Ch.PRIVATE],
  [Ch.PARTY]: [Ch.PARTY],
  [Ch.GUILD]: [Ch.GUILD],
  [Ch.TRADE]: [Ch.TRADE, Ch.WORLD],
  [Ch.SYSTEM]: [Ch.SYSTEM],
};

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function renderLine(m: ChatMessage): string {
  if (m.system) return `[系统] ${m.message}`;
  if (m.channel === Ch.PRIVATE || m.channel === Ch.WORLD) return `${m.senderName}: ${m.message}`;
  return m.senderName ? `${m.senderName}: ${m.message}` : m.message;
}

export default function ChatWindow() {
  const snap = useSyncExternalStore(subscribeChat, getChatSnapshot);
  const { messages, activeChannel, collapsed, inputOpen, visible } = snap;
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 新消息自动滚到底（inputOpen 时也跟随）
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, activeChannel]);

  // 打开输入框 → 自动聚焦
  useEffect(() => {
    if (inputOpen) inputRef.current?.focus();
  }, [inputOpen]);

  if (!visible) return null;

  const shown = messages.filter((m) => (SHOW_BY_TAB[activeChannel] ?? [activeChannel]).includes(m.channel));
  const last = messages[messages.length - 1];

  function submit() {
    const text = draft;
    setDraft('');
    if (!text.trim()) return;
    const parsed = parseChatInput(text, activeChannel);
    if (parsed.type === 'chat') {
      if (parsed.message) send(chat(parsed.channel, parsed.message));
    } else if (parsed.type === 'private') {
      if (parsed.targetName && parsed.message) send(chat(Ch.PRIVATE, parsed.message, parsed.targetName));
    } else {
      // 命令：原样上送（如 /@gm、//party、/giveitem 等），服务端 treatCommand 权威解析
      send(chat(activeChannel === Ch.SYSTEM ? Ch.MAP : activeChannel, parsed.message));
    }
    inputRef.current?.focus();
  }

  // 折叠态：单行下条
  if (collapsed) {
    return (
      <div className="jp-chat jp-chat--collapsed" onClick={() => setChatCollapsed(false)}>
        <span className="jp-chat-preview" style={{ color: last ? CHANNEL_COLORS[last.channel] ?? '#e8e6e1' : '#9aa0a6' }}>
          {last ? renderLine(last) : t('chat.empty')}
        </span>
        <span className="jp-chat-fold">▸</span>
      </div>
    );
  }

  const readonly = TABS.find((tab) => tab.channel === activeChannel)?.readonly;

  return (
    <div className="jp-chat">
      <div className="jp-chat-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.channel}
            className={'jp-chat-tab' + (activeChannel === tab.channel ? ' jp-chat-tab--active' : '')}
            onClick={() => setActiveChatChannel(tab.channel)}
          >
            {t(tab.label)}
          </button>
        ))}
        <button className="jp-chat-fold" title={t('chat.fold')} onClick={() => setChatCollapsed(true)}>▾</button>
      </div>

      <div className="jp-chat-list" ref={listRef}>
        {shown.map((m) => (
          <div key={m.id} className="jp-chat-line" style={{ color: CHANNEL_COLORS[m.channel] ?? '#e8e6e1' }}>
            <span className="jp-chat-time">{fmtTime(m.timestamp)}</span>
            <span className="jp-chat-text">{renderLine(m)}</span>
          </div>
        ))}
      </div>

      {inputOpen ? (
        <div className="jp-chat-input">
          <input
            ref={inputRef}
            value={draft}
            placeholder={readonly ? t('chat.readonly') : t('chat.placeholder')}
            disabled={readonly}
            maxLength={80}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
              else if (e.key === 'Escape') { setChatInputOpen(false); setDraft(''); }
            }}
            onBlur={() => setChatInputOpen(false)}
          />
        </div>
      ) : (
        <div className="jp-chat-hint" onClick={() => setChatInputOpen(true)}>
          {t('chat.hint')}
        </div>
      )}
    </div>
  );
}