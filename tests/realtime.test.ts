import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { attachRealtime } from '../server/realtime';
import {
  type Action,
  type ClientEvents,
  type ServerEvents,
  type Reply,
  type RoomState,
} from '../lib/protocol';
const origin = 'http://localhost:3001';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn();
});
async function setup(count = 2) {
  const http = createServer(),
    rt = attachRealtime(http, { origins: [origin] });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  if (!address || typeof address === 'string') throw Error();
  const clients: Socket<ServerEvents, ClientEvents>[] = [],
    states: RoomState[] = [];
  cleanups.push(async () => {
    clients.forEach((s) => s.disconnect());
    await new Promise<void>((resolve) => rt.io.close(() => resolve()));
  });
  for (let i = 0; i < count; i++) {
    const s = io(`http://127.0.0.1:${address.port}`, {
      transports: ['websocket'],
      extraHeaders: { origin },
      forceNew: true,
      reconnection: false,
    });
    clients.push(s);
    s.on('state', (state) => {
      states[i] = state;
    });
    await new Promise<void>((resolve, reject) => {
      s.once('connect', resolve);
      s.once('connect_error', reject);
    });
  }
  const create = () =>
    new Promise<Reply>((resolve) =>
      clients[0].emit('create', { name: 'Integration room' }, resolve),
    );
  const created = await create();
  const roomId = created.roomId!,
    tokens = clients.map(() => randomUUID());
  const join = (i: number) =>
    new Promise<Reply>((resolve) =>
      clients[i].emit('join', { roomId, name: `Person ${i}`, token: tokens[i] }, resolve),
    );
  for (let i = 0; i < count; i++) expect((await join(i)).ok).toBe(true);
  const command = (i: number, a: Action, baseVersion = states[i].version, id = randomUUID()) =>
    new Promise<Reply>((resolve) => clients[i].emit('command', { ...a, id, baseVersion }, resolve));
  return { clients, states, command, roomId, join, rt };
}
describe('real WebSocket clients', () => {
  it('isolates live chat, identifies senders, deduplicates retries, and leaves playback untouched', async () => {
    const t = await setup(3);
    const other = await new Promise<Reply>((resolve) =>
      t.clients[2].emit('create', { name: 'Separate room' }, resolve),
    );
    await new Promise<Reply>((resolve) =>
      t.clients[2].emit(
        'join',
        { roomId: other.roomId!, name: 'Other room', token: randomUUID() },
        resolve,
      ),
    );
    await expect.poll(() => t.states[0].participants.filter((p) => p.online).length).toBe(2);
    await t.command(0, { type: 'add', videoId: 'abcdefghijk' });
    await t.command(0, { type: 'play' });
    await expect.poll(() => t.states[1].version).toBe(t.states[0].version);
    const before = structuredClone(t.rt.rooms.get(t.roomId).state);
    const received: string[][] = [[], [], []];
    const stateEvents = [0, 0, 0];
    t.clients.forEach((s, i) => {
      s.on('chat:message', (data) => received[i].push(data.message.id));
      s.on('state', () => stateEvents[i]++);
    });
    const id = randomUUID();
    const first = await new Promise<Reply>((resolve) =>
      t.clients[0].emit('chat', { text: 'Hello 💜\nTogether!', clientId: id }, resolve),
    );
    const duplicate = await new Promise<Reply>((resolve) =>
      t.clients[0].emit('chat', { text: 'Hello 💜\nTogether!', clientId: id }, resolve),
    );
    expect(first.ok).toBe(true);
    expect(first.message?.id).toBe(duplicate.message?.id);
    expect(first.message?.name).toBe('Person 0');
    expect(first.message?.senderId).toBe(before.hostId);
    expect(first.message?.at).toBeGreaterThan(0);
    await expect.poll(() => received[1].length).toBe(1);
    expect(received.map((messages) => messages.length)).toEqual([1, 1, 0]);
    expect(stateEvents).toEqual([0, 0, 0]);
    const after = t.rt.rooms.get(t.roomId).state;
    expect({ ...after, messages: [] }).toEqual({ ...before, messages: [] });
    t.clients[1].disconnect();
    await new Promise<Reply>((resolve) =>
      t.clients[0].emit('chat', { text: 'Sent while you were offline' }, resolve),
    );
    t.clients[1].connect();
    await new Promise<void>((resolve) => t.clients[1].once('connect', resolve));
    const restored = await t.join(1);
    expect(restored.state?.messages).toHaveLength(2);
    expect(received[1]).toHaveLength(1);
    const spoof = await new Promise<Reply>((resolve) =>
      t.clients[0].emit('chat', { text: 'spoof', name: 'Host' } as { text: string }, resolve),
    );
    expect(spoof.ok).toBe(false);
    await new Promise<void>((resolve) => t.clients[2].emit('leave', resolve));
    const unauthorized = await new Promise<Reply>((resolve) =>
      t.clients[2].emit('chat', { text: 'not joined' }, resolve),
    );
    expect(unauthorized.ok).toBe(false);
  });
  it('rejects empty/oversized/control-only messages and chat spam', async () => {
    const t = await setup();
    for (const text of ['', '   ', '\u0000', 'x'.repeat(501)]) {
      const result = await new Promise<Reply>((resolve) =>
        t.clients[0].emit('chat', { text }, resolve),
      );
      expect(result.ok).toBe(false);
    }
    const results: Reply[] = [];
    for (let i = 0; i < 9; i++)
      results.push(
        await new Promise<Reply>((resolve) =>
          t.clients[0].emit('chat', { text: `Message ${i}` }, resolve),
        ),
      );
    expect(results.filter((r) => r.ok)).toHaveLength(8);
    expect(results[8].error).toMatch(/too fast/);
  });
  it('two clients converge through play/pause, seeks, switching, queue edits and reconnect', async () => {
    const t = await setup();
    for (const a of [
      { type: 'add', videoId: 'abcdefghijk' },
      { type: 'play' },
      { type: 'seek', position: 150 },
      { type: 'seek', position: 12 },
      { type: 'pause' },
      { type: 'add', videoId: 'ABCDEFGHIJK' },
    ] as Action[])
      expect((await t.command(0, a)).ok).toBe(true);
    await expect.poll(() => t.states[1].version).toBe(t.states[0].version);
    expect(t.states[1]).toEqual(t.states[0]);
    expect((await t.command(1, { type: 'select', itemId: t.states[1].queue[1].id })).ok).toBe(true);
    await expect.poll(() => t.states[0].videoId).toBe('ABCDEFGHIJK');
    t.clients[1].disconnect();
    expect((await t.command(0, { type: 'seek', position: 77 })).ok).toBe(true);
    t.clients[1].connect();
    await new Promise<void>((resolve) => t.clients[1].once('connect', resolve));
    const restored = await t.join(1);
    expect(restored.state?.position).toBe(77);
    expect(restored.state?.version).toBe(t.states[0].version);
  });
  it('orders concurrent conflicts, rejects late packets, deduplicates IDs, and restricts hosts', async () => {
    const t = await setup();
    await t.command(0, { type: 'add', videoId: 'abcdefghijk' });
    await expect.poll(() => t.states[1].version).toBe(1);
    const base = t.states[0].version;
    const results = await Promise.all([
      t.command(0, { type: 'seek', position: 100 }, base),
      t.command(1, { type: 'seek', position: 200 }, base),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect((await t.command(1, { type: 'pause' }, base)).ok).toBe(false);
    const id = randomUUID(),
      current = t.rt.rooms.get(t.roomId).state.version;
    const first = await t.command(0, { type: 'pause' }, current, id);
    const duplicate = await t.command(0, { type: 'pause' }, current, id);
    expect(first.state?.version).toBe(duplicate.state?.version);
    await t.command(0, { type: 'settings', mode: 'host', queueEveryone: false });
    await expect.poll(() => t.states[1].mode).toBe('host');
    expect((await t.command(1, { type: 'play' })).ok).toBe(false);
    const invalid = await new Promise<Reply>((resolve) =>
      t.clients[1].emit('chat', { text: 'x'.repeat(501) }, resolve),
    );
    expect(invalid.ok).toBe(false);
  });
  it('broadcasts to ten participants and measures local command propagation', async () => {
    const t = await setup(10);
    await t.command(0, { type: 'add', videoId: 'abcdefghijk' });
    await expect.poll(() => t.states.filter((s) => s.version === 1).length).toBe(10);
    const timings: number[] = [];
    for (let i = 0; i < 12; i++) {
      const expected = t.states[0].version + 1,
        start = performance.now();
      const seen = new Promise<void>((resolve) => {
        const listener = (s: RoomState) => {
          if (s.version === expected) {
            t.clients[9].off('state', listener);
            resolve();
          }
        };
        t.clients[9].on('state', listener);
      });
      await t.command(0, { type: 'seek', position: i });
      await seen;
      timings.push(performance.now() - start);
    }
    await expect.poll(() => new Set(t.states.map((s) => s.version)).size).toBe(1);
    console.info(
      `Local 10-client command propagation median: ${timings.sort((a, b) => a - b)[6].toFixed(2)} ms (not playback drift)`,
    );
  });
});
