import { describe, expect, it } from 'vitest';
import { ChatFeed, CHAT_NOTIFICATION_MS, defaultChatPreferences as prefs } from '../lib/chat';
import { chatSchema, type Message } from '../lib/protocol';
const message = (id: string, senderId = 'friend'): Message => ({
  id,
  senderId,
  name: senderId,
  text: `Hello ${id} 💜`,
  at: 1000,
});
function setup() {
  const feed = new ChatFeed();
  feed.seed('room', 'me', [message('history')]);
  return feed;
}
describe('room chat notification lifecycle', () => {
  it('separates history, deduplicates live events, and refuses other rooms', () => {
    const feed = setup();
    expect(feed.visible).toHaveLength(0);
    expect(feed.receive({ roomId: 'room', message: message('history') }, prefs, 0)).toBe(false);
    expect(feed.receive({ roomId: 'elsewhere', message: message('other') }, prefs, 0)).toBe(false);
    expect(feed.receive({ roomId: 'room', message: message('live') }, prefs, 0)).toBe(true);
    feed.receive({ roomId: 'room', message: message('live') }, prefs, 1);
    expect(feed.messages).toHaveLength(2);
    expect(feed.visible).toHaveLength(1);
    feed.seed('room', 'me', feed.messages);
    expect(feed.visible).toHaveLength(0);
    expect(feed.receive({ roomId: 'room', message: message('live') }, prefs, 2)).toBe(false);
  });
  it('does not replace existing notifications; queued messages get a full lifetime', () => {
    const feed = setup();
    for (let i = 0; i < 5; i++)
      feed.receive({ roomId: 'room', message: message(String(i)) }, prefs, i * 100);
    expect(feed.visible.map((item) => item.message.id)).toEqual(['0', '1', '2']);
    expect(feed.pending).toHaveLength(2);
    feed.expire(CHAT_NOTIFICATION_MS - 1);
    expect(feed.visible.map((item) => item.message.id)).toEqual(['0', '1', '2']);
    feed.expire(CHAT_NOTIFICATION_MS);
    expect(feed.visible.map((item) => item.message.id)).toEqual(['1', '2', '3']);
    expect(feed.visible[2].expiresAt).toBe(CHAT_NOTIFICATION_MS * 2);
    feed.expire(CHAT_NOTIFICATION_MS * 2);
    expect(feed.visible.map((item) => item.message.id)).toEqual(['4']);
    feed.expire(CHAT_NOTIFICATION_MS * 3);
    expect(feed.visible).toHaveLength(0);
  });
  it('respects disabled/own preferences, clear, and system events without losing history', () => {
    const feed = setup();
    feed.receive({ roomId: 'room', message: message('own', 'me') }, prefs, 0);
    expect(feed.visible).toHaveLength(0);
    feed.receive(
      { roomId: 'room', message: message('enabled-own', 'me') },
      { ...prefs, showOwn: true },
      0,
    );
    expect(feed.visible).toHaveLength(1);
    feed.receive({ roomId: 'room', message: message('disabled') }, { ...prefs, enabled: false }, 0);
    feed.receive({ roomId: 'room', message: { ...message('system'), system: true } }, prefs, 0);
    expect(feed.visible).toHaveLength(1);
    expect(feed.messages).toHaveLength(5);
    feed.clear();
    feed.expire(10000);
    expect(feed.visible).toHaveLength(0);
    expect(feed.messages).toHaveLength(5);
    feed.seed('new-room', 'me', []);
    expect(feed.messages).toHaveLength(0);
  });
  it('bounds history, deduplication memory, and pending bursts', () => {
    const feed = setup();
    for (let i = 0; i < 2100; i++)
      feed.receive({ roomId: 'room', message: message(String(i)) }, prefs, 0);
    expect(feed.messages).toHaveLength(100);
    expect(feed.seen.size).toBe(2048);
    expect(feed.pending).toHaveLength(20);
    expect(feed.visible).toHaveLength(3);
  });
  it('validates Unicode text and strips non-printing controls without interpreting HTML', () => {
    expect(chatSchema.parse({ text: ' Hello 💜\r\n<script>\u0000' }).text).toBe(
      'Hello 💜\n<script>',
    );
    for (const text of ['', '  ', '\u0000', 'x'.repeat(501)])
      expect(() => chatSchema.parse({ text })).toThrow();
    expect(() => chatSchema.parse({ text: 'Hi', senderId: 'spoofed' })).toThrow();
  });
});
