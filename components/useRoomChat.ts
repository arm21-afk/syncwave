'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChatFeed,
  defaultChatPreferences,
  type ChatPreferences,
  type FloatingMessage,
} from '../lib/chat';
import type { ChatEnvelope, Message } from '../lib/protocol';

const STORAGE_KEY = 'syncwave-chat-preferences';
export function useRoomChat() {
  const feed = useRef(new ChatFeed());
  const preferenceRef = useRef(defaultChatPreferences);
  const [messages, setMessages] = useState<Message[]>([]);
  const [notifications, setNotifications] = useState<FloatingMessage[]>([]);
  const [preferences, setPreferences] = useState(defaultChatPreferences);
  const sync = useCallback(() => {
    setMessages(feed.current.messages);
    setNotifications(feed.current.visible);
  }, []);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved && typeof saved.enabled === 'boolean' && typeof saved.showOwn === 'boolean') {
        preferenceRef.current = saved;
        setPreferences(saved);
      }
    } catch {
      /* Invalid or unavailable local storage uses the defaults. */
    }
  }, []);
  const seed = useCallback(
    (roomId: string, participantId: string, history: Message[]) => {
      feed.current.seed(roomId, participantId, history);
      sync();
    },
    [sync],
  );
  const receive = useCallback(
    (data: ChatEnvelope) => {
      if (feed.current.receive(data, preferenceRef.current, Date.now())) sync();
    },
    [sync],
  );
  const clear = useCallback(() => {
    feed.current.clear();
    sync();
  }, [sync]);
  const updatePreferences = useCallback(
    (next: ChatPreferences) => {
      preferenceRef.current = next;
      setPreferences(next);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* Settings still work for this tab. */
      }
      if (!next.enabled) {
        feed.current.clear();
        sync();
      }
    },
    [sync],
  );
  useEffect(() => {
    if (!notifications.length) return;
    const next = Math.min(...notifications.map((item) => item.expiresAt));
    const timer = setTimeout(
      () => {
        feed.current.expire(Date.now());
        sync();
      },
      Math.max(0, next - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [notifications, sync]);
  return { messages, notifications, preferences, seed, receive, clear, updatePreferences };
}
