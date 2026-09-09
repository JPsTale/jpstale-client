// 游戏内聊天窗口（常驻 World 界面）。
// 折叠窗 + 频道 tab + 输入框。输入前缀解析见 net/protocol.parseChatInput：
//   /名字: 消息  私聊          /TRADE> 消息  交易频道
//   @消息       组队聊天        /xxx          命令（原样上送，服务端权威）
//
// 交互：
// - "普通" tab 聚合所有玩家频道消息（各保留其频道配色）；系统 tab 显示所有系统消息（红色）。
// - 拖拽 tab 条可移动窗口；右下角手柄可缩放。
// - 玩家发送后的系统回执（如"公会未开放"）同时红字显示在发送频道 tab，避免"没反应"。
import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as RPointerEvent } from 'react';
import {
  getChatSnapshot, subscribeChat, setActiveChatChannel, setChatCollapsed, setChatInputOpen,
  noteSentOn, Ch, type ChatMessage,
} from '../../app/chatStore.js';
import { t } from '../../i18n/index.js';
import { send } from '../../net/transport.js';
import { chat, parseChatInput } from '../../net/protocol.js';

const CHANNEL_COLORS: Record<number, string> = {
  [Ch.MAP]: '#e8e6e1',
  [Ch.PARTY]: '#7cd8ff',
  [Ch.GUILD]: '#c6b6ff',
  [Ch.TRADE]: '#ffd98a',
  [Ch.PRIVATE]: '#ff8c94',
  [Ch.SYSTEM]: '#ff5c47',
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

// 频道归位：KEY=tab → 该 tab 展示的频道集合
// "普通"= 全部（所有玩家频道都收，各频道配色保留）；PRIVATE/WORLD 并入普通。
const SHOW_BY_TAB: Record<number, number[]> = {
  [Ch.MAP]: [Ch.MAP, Ch.PARTY, Ch.GUILD, Ch.TRADE, Ch.PRIVATE, Ch.WORLD],
  [Ch.PARTY]: [Ch.PARTY],
  [Ch.GUILD]: [Ch.GUILD],
  [Ch.TRADE]: [Ch.TRADE, Ch.WORLD],
  [Ch.SYSTEM]: [Ch.SYSTEM],
};

const MAX_MSG = 300;

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function renderLine(m: ChatMessage): string {
  if (m.system) return `[系统] ${m.message}`;
  if (m.channel === Ch.PRIVATE || m.channel === Ch.WORLD) return `${m.senderName}: ${m.message}`;
  return m.senderName ? `${m.senderName}: ${m.message}` : m.message;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** 默认窗口几何：贴左下（bottom 12, left 12）。 */
function defaultGeometry() {
  const w = Math.min(420, window.innerWidth * 0.4);
  const h = 252;
  return { x: 12, y: Math.max(8, window.innerHeight - h - 12), w, h };
}

export default function ChatWindow() {
  const snap = useSyncExternalStore(subscribeChat, getChatSnapshot);
  const { messages, activeChannel, collapsed, inputOpen, visible } = snap;
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [geo, setGeo] = useState(defaultGeometry);
  const drag = useRef<null | { mode: 'move' | 'resize'; startX: number; startY: number; baseX: number; baseY: number; baseW: number; baseH: number }>(null);

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

  // 系统 tab 显示所有系统消息；其余 tab 按频道归位表
  const shown = messages.filter((m) => (activeChannel === Ch.SYSTEM ? m.system : (SHOW_BY_TAB[activeChannel] ?? [activeChannel]).includes(m.channel)));
  const last = messages.filter((m) => !m.system).length > 0
    ? [...messages].reverse().find((m) => !m.system) ?? null
    : null;

  function submit() {
    const text = draft;
    setDraft('');
    if (!text.trim()) return;
    const parsed = parseChatInput(text, activeChannel);
    if (parsed.type === 'chat') {
      if (parsed.message) {
        send(chat(parsed.channel, parsed.message));
        noteSentOn(parsed.channel);
      }
    } else if (parsed.type === 'private') {
      if (parsed.targetName && parsed.message) {
        send(chat(Ch.PRIVATE, parsed.message, parsed.targetName));
        noteSentOn(Ch.PRIVATE);
      }
    } else {
      // 命令：原样上送（如 /@gm、//party、/giveitem 等），服务端 treatCommand 权威解析
      const ch = activeChannel === Ch.SYSTEM ? Ch.MAP : activeChannel;
      send(chat(ch, parsed.message));
      noteSentOn(ch);
    }
    inputRef.current?.focus();
  }

  function startDrag(mode: 'move' | 'resize', e: RPointerEvent<HTMLElement>) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { mode, startX: e.clientX, startY: e.clientY, baseX: geo.x, baseY: geo.y, baseW: geo.w, baseH: geo.h };
  }

  function onDragMove(e: RPointerEvent<HTMLElement>) {
    const d = drag.current;
    if (!d) return;
    if (d.mode === 'move') {
      setGeo((g) => ({
        ...g,
        x: clamp(d.baseX + (e.clientX - d.startX), 4, window.innerWidth - 120),
        y: clamp(d.baseY + (e.clientY - d.startY), 4, window.innerHeight - 34),
      }));
    } else {
      setGeo((g) => ({
        ...g,
        w: clamp(d.baseW + (e.clientX - d.startX), 260, window.innerWidth - 8),
        h: clamp(d.baseH + (e.clientY - d.startY), 120, window.innerHeight - 8),
      }));
    }
  }

  function endDrag() {
    drag.current = null;
  }

  // 折叠态：单行下条（跟随拖动位置）
  if (collapsed) {
    return (
      <div className="jp-chat jp-chat--collapsed" style={{ left: geo.x, top: geo.y }} onClick={() => setChatCollapsed(false)}>
        <span className="jp-chat-preview" style={{ color: last ? CHANNEL_COLORS[last.channel] ?? '#e8e6e1' : '#9aa0a6' }}>
          {last ? renderLine(last) : t('chat.empty')}
        </span>
        <span className="jp-chat-fold">▸</span>
      </div>
    );
  }

  const readonly = TABS.find((tab) => tab.channel === activeChannel)?.readonly;
  const shownTail = shown.slice(-MAX_MSG);

  return (
    <div className="jp-chat" style={{ left: geo.x, top: geo.y, width: geo.w, height: geo.h }}>
      <div
        className="jp-chat-tabs"
        onPointerDown={(e) => startDrag('move', e)}
        onPointerMove={onDragMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
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
        {shownTail.map((m) => (
          <div
            key={m.id}
            className={'jp-chat-line' + (m.system ? ' jp-chat-line--system' : '')}
            style={m.system ? undefined : { color: CHANNEL_COLORS[m.channel] ?? '#e8e6e1' }}
          >
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

      <div
        className="jp-chat-resize"
        onPointerDown={(e) => startDrag('resize', e)}
        onPointerMove={onDragMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      />
    </div>
  );
}