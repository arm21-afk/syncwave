import type { ChatEnvelope, Message } from './protocol';

export const CHAT_NOTIFICATION_MS = 5000;
export const CHAT_FADE_MS = 250;
export const CHAT_MAX_VISIBLE = 3;
export const CHAT_MAX_PENDING = 20;
export type ChatPreferences = { enabled: boolean; showOwn: boolean };
export const defaultChatPreferences: ChatPreferences = { enabled: true, showOwn: false };
export type FloatingMessage = { message: Message; expiresAt: number };

/** History and transient notifications have separate lifecycles. Only live envelopes notify. */
export class ChatFeed {
  roomId = '';
  participantId = '';
  messages: Message[] = [];
  visible: FloatingMessage[] = [];
  pending: Message[] = [];
  seen = new Set<string>();
  seed(roomId: string, participantId: string, history: Message[]) {
    const previousSeen = roomId === this.roomId ? this.seen : new Set<string>();
    this.roomId = roomId;
    this.participantId = participantId;
    this.messages = [...new Map(history.map((message) => [message.id, message])).values()].slice(
      -100,
    );
    this.seen = new Set(
      [...previousSeen, ...this.messages.map((message) => message.id)].slice(-2048),
    );
    this.clear();
  }
  clear() {
    this.visible = [];
    this.pending = [];
  }
  receive({ roomId, message }: ChatEnvelope, preferences: ChatPreferences, now: number) {
    if (roomId !== this.roomId || this.seen.has(message.id)) return false;
    this.seen.add(message.id);
    if (this.seen.size > 2048) this.seen.delete(this.seen.values().next().value!);
    this.messages = [...this.messages, message].slice(-100);
    if (
      preferences.enabled &&
      !message.system &&
      (preferences.showOwn || message.senderId !== this.participantId)
    ) {
      if (this.visible.length < CHAT_MAX_VISIBLE)
        this.visible = [...this.visible, { message, expiresAt: now + CHAT_NOTIFICATION_MS }];
      else this.pending = [...this.pending, message].slice(-CHAT_MAX_PENDING);
    }
    return true;
  }
  expire(now: number) {
    this.visible = this.visible.filter((item) => item.expiresAt > now);
    while (this.visible.length < CHAT_MAX_VISIBLE && this.pending.length) {
      this.visible.push({ message: this.pending.shift()!, expiresAt: now + CHAT_NOTIFICATION_MS });
    }
    this.visible = [...this.visible];
  }
}
