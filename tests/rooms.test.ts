import { randomUUID } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { Rooms } from '../server/rooms';
import { type Action } from '../lib/protocol';
function setup(max = 10) {
  let now = 100000;
  const rooms = new Rooms(max, 100, 6000, () => now);
  const r = rooms.create('Our room');
  const a = rooms.join(r.state.id, 'Alex', 'a'.repeat(30), 'a');
  const b = rooms.join(r.state.id, 'Alex', 'b'.repeat(30), 'b');
  const command = (
    action: Action,
    source = a.id,
    baseVersion = r.state.version,
    id = randomUUID(),
  ) => rooms.apply(r, source, { ...action, id, baseVersion });
  return {
    rooms,
    r,
    a,
    b,
    command,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
describe('authoritative command processor', () => {
  it('creates private rooms, distinguishes duplicate display names, and chooses a host', () => {
    const { r, a, b } = setup();
    expect(r.state.id).toMatch(/^[\w-]{24}$/);
    expect(a.name).toBe('Alex');
    expect(b.name).toBe('Alex (2)');
    expect(r.state.hostId).toBe(a.id);
  });
  it('plays, pauses, seeks both directions, and anchors elapsed position', () => {
    const { r, command, advance } = setup();
    command({ type: 'add', videoId: 'abcdefghijk' });
    command({ type: 'play' });
    advance(2500);
    command({ type: 'pause' });
    expect(r.state.position).toBe(2.5);
    command({ type: 'seek', position: 150 });
    expect(r.state.position).toBe(150);
    command({ type: 'seek', position: 10 });
    command({ type: 'rate', rate: 1.5 });
    command({ type: 'play' });
    advance(2000);
    command({ type: 'pause' });
    expect(r.state.position).toBe(13);
    expect(r.state.version).toBe(8);
  });
  it('rejects delayed and conflicting commands without modifying authoritative state', () => {
    const { r, command, b } = setup();
    command({ type: 'add', videoId: 'abcdefghijk' });
    const base = r.state.version;
    command({ type: 'play' }, b.id, base);
    const snapshot = structuredClone(r.state);
    expect(() => command({ type: 'pause' }, b.id, base)).toThrow('Room changed');
    expect(r.state).toEqual(snapshot);
    command({ type: 'pause' });
    expect(r.state.version).toBe(snapshot.version + 1);
  });
  it('is idempotent for duplicate command IDs even when the base version is old', () => {
    const { r, command, a } = setup();
    const id = randomUUID();
    command({ type: 'add', videoId: 'abcdefghijk' }, a.id, 0, id);
    command({ type: 'add', videoId: 'abcdefghijk' }, a.id, 0, id);
    expect(r.state.queue).toHaveLength(1);
    expect(r.state.version).toBe(1);
  });
  it('keeps queue ordering consistent and advances without duplicate transitions', () => {
    const { r, command, b } = setup();
    command({ type: 'add', videoId: 'abcdefghijk' });
    command({ type: 'add', videoId: 'ABCDEFGHIJK' });
    const second = r.state.queue[1].id;
    command({ type: 'move', itemId: second, direction: -1 });
    expect(r.state.queue[0].id).toBe(second);
    command({ type: 'select', itemId: second });
    expect(r.state.videoId).toBe('ABCDEFGHIJK');
    command({ type: 'ended', videoId: 'ABCDEFGHIJK' });
    expect(r.state.videoId).toBe('abcdefghijk');
    expect(() => command({ type: 'ended', videoId: 'ABCDEFGHIJK' }, b.id)).toThrow();
    command({ type: 'remove', itemId: r.state.currentId! });
    expect(r.state.videoId).toBe('ABCDEFGHIJK');
    expect(() => command({ type: 'add', videoId: 'ABCDEFGHIJK' })).toThrow('already');
  });
  it('enforces host and hybrid permissions, including queue permissions', () => {
    const { r, a, b, command } = setup();
    command({ type: 'add', videoId: 'abcdefghijk' });
    command({ type: 'settings', mode: 'host', queueEveryone: true });
    expect(() => command({ type: 'play' }, b.id)).toThrow('restricted');
    expect(() =>
      command({ type: 'settings', mode: 'collaborative', queueEveryone: true }, b.id),
    ).toThrow('host');
    command({ type: 'settings', mode: 'hybrid', queueEveryone: false });
    command({ type: 'play' }, b.id);
    expect(() => command({ type: 'add', videoId: 'ABCDEFGHIJK' }, b.id)).toThrow('restricted');
    expect(() => command({ type: 'select', itemId: r.state.currentId! }, b.id)).toThrow(
      'restricted',
    );
    command({ type: 'transfer', participantId: b.id }, a.id);
    expect(r.state.hostId).toBe(b.id);
  });
  it('rejoins by secret token, restores current state, and transfers disconnected hosts', () => {
    const { r, a, b, rooms, command, advance } = setup();
    command({ type: 'add', videoId: 'abcdefghijk' });
    command({ type: 'seek', position: 50 });
    rooms.leave(r, a.id, 'a');
    expect(r.state.hostId).toBe(b.id);
    advance(1000);
    const back = rooms.join(r.state.id, 'Changed', 'a'.repeat(30), 'c');
    expect(back.id).toBe(a.id);
    expect(r.state.position).toBe(50);
    expect(r.state.hostId).toBe(b.id);
  });
  it('checks passwords, capacity, expired rooms and invalid operations atomically', () => {
    const { rooms, r, command, advance, a, b } = setup(2);
    expect(() => rooms.join(r.state.id, 'Third', 'c'.repeat(30), 'c')).toThrow('full');
    const p = rooms.create('Protected', 'secret');
    expect(() => rooms.join(p.state.id, 'Guest', 'd'.repeat(30), 'd', 'wrong')).toThrow('password');
    expect(rooms.join(p.state.id, 'Guest', 'd'.repeat(30), 'd', 'secret')).toBeTruthy();
    const snapshot = structuredClone(r.state);
    expect(() => command({ type: 'next' })).toThrow();
    expect(r.state).toEqual(snapshot);
    expect(() => command({ type: 'seek', position: -10 })).toThrow();
    rooms.leave(r, a.id, 'a');
    rooms.leave(r, b.id, 'b');
    advance(7000);
    rooms.cleanup();
    expect(() => rooms.get(r.state.id)).toThrow('expired');
  });
});
