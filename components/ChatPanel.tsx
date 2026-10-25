'use client';
import { useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, MessageCircle, Send, X } from 'lucide-react';
import type { Message } from '../lib/protocol';
import type { ChatPreferences } from '../lib/chat';

export function ChatPanel({
  messages,
  connected,
  onSend,
  onClose,
  preferences,
  onPreferences,
  onClear,
}: {
  messages: Message[];
  connected: boolean;
  onSend: (text: string, clientId: string) => Promise<void>;
  onClose: () => void;
  preferences: ChatPreferences;
  onPreferences: (preferences: ChatPreferences) => void;
  onClear: () => void;
}) {
  const [draft, setDraft] = useState(''),
    [sending, setSending] = useState(false),
    [error, setError] = useState(''),
    [unread, setUnread] = useState(0);
  const scroll = useRef<HTMLDivElement>(null),
    stick = useRef(true),
    previous = useRef(messages.at(-1)?.id),
    receipt = useRef<string | null>(null),
    mounted = useRef(true);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useLayoutEffect(() => {
    const node = scroll.current;
    if (!node) return;
    if (stick.current) {
      node.scrollTop = node.scrollHeight;
      setUnread(0);
    } else if (previous.current !== messages.at(-1)?.id) setUnread((n) => n + 1);
    previous.current = messages.at(-1)?.id;
  }, [messages]);
  const bottom = () => {
    if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
    stick.current = true;
    setUnread(0);
  };
  const send = async () => {
    if (sending || !connected || !draft.trim()) return;
    const id = receipt.current ?? crypto.randomUUID();
    receipt.current = id;
    setSending(true);
    setError('');
    try {
      await onSend(draft, id);
      if (mounted.current) {
        setDraft('');
        receipt.current = null;
        bottom();
      }
    } catch (e) {
      if (mounted.current)
        setError(e instanceof Error ? e.message : 'Message failed. Please retry.');
    } finally {
      if (mounted.current) setSending(false);
    }
  };
  return (
    <section className="room-chat-panel" id="room-chat" aria-label="Room chat panel">
      <div className="chat-panel-heading">
        <div>
          <h2>The conversation between songs.</h2>
          <p>
            <span className={`status-dot ${connected ? '' : 'offline'}`} />
            {connected ? 'Connected · messages are live' : 'Reconnecting · sending paused'}
          </p>
        </div>
        <button className="icon-button" aria-label="Close chat" onClick={onClose}>
          <X size={17} />
        </button>
      </div>
      <details className="chat-settings">
        <summary>Player notification settings</summary>
        <div>
          <label>
            <input
              type="checkbox"
              checked={preferences.enabled}
              onChange={(e) => onPreferences({ ...preferences, enabled: e.target.checked })}
            />
            Floating chat notifications
          </label>
          <label>
            <input
              type="checkbox"
              checked={preferences.showOwn}
              onChange={(e) => onPreferences({ ...preferences, showOwn: e.target.checked })}
            />
            Show my own messages
          </label>
          <button className="button secondary small" onClick={onClear}>
            Clear visible notifications
          </button>
        </div>
      </details>
      <div
        ref={scroll}
        className="chat-messages"
        role="log"
        aria-label="Room messages"
        aria-live="polite"
        aria-relevant="additions"
        onScroll={() => {
          const node = scroll.current!;
          stick.current = node.scrollHeight - node.scrollTop - node.clientHeight < 60;
          if (stick.current) setUnread(0);
        }}
      >
        {!messages.length && (
          <div className="empty-queue">
            <MessageCircle size={28} />
            <h3>Say the first hello.</h3>
            <p>Good music starts conversations.</p>
          </div>
        )}
        {messages.map((message) => (
          <div
            className={`chat-message ${message.system ? 'chat-system-message' : ''}`}
            key={message.id}
            data-message-id={message.id}
          >
            {!message.system && (
              <span className="avatar color-0" aria-hidden="true">
                {message.name[0]?.toUpperCase()}
              </span>
            )}
            <div>
              <strong>
                {message.system ? 'Room update' : message.name}
                <time dateTime={new Date(message.at).toISOString()}>
                  {new Date(message.at).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
              </strong>
              <p>{message.text}</p>
            </div>
          </div>
        ))}
      </div>
      {unread > 0 && (
        <button className="chat-new-messages" onClick={bottom}>
          <ChevronDown size={14} />
          {unread} new {unread === 1 ? 'message' : 'messages'}
        </button>
      )}
      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          aria-label="Chat message"
          placeholder="Send a little hello…"
          maxLength={500}
          rows={2}
          value={draft}
          readOnly={sending}
          disabled={!connected}
          onChange={(e) => {
            setDraft(e.target.value);
            receipt.current = null;
            setError('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button
          className="icon-button"
          disabled={!draft.trim() || !connected || sending}
          aria-label="Send message"
        >
          <Send size={18} />
        </button>
      </form>
      <small className={`chat-hint ${error ? 'chat-send-error' : ''}`} role="status">
        {error ||
          (sending
            ? 'Sending…'
            : !connected
              ? 'Waiting for your connection…'
              : 'Enter to send · Shift+Enter for a new line · 500 characters')}
      </small>
    </section>
  );
}
