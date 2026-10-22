import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { commandSchema, type RoomState, type Command } from '../lib/protocol';
import { targetPosition } from '../lib/sync';

type Member = {
  id: string;
  tokenHash: string;
  name: string;
  sockets: Set<string>;
  leftAt: number | null;
};
export type Room = {
  state: RoomState;
  members: Map<string, Member>;
  password: Buffer | null;
  salt: string;
  seen: Map<string, string>;
  touched: number;
};
export class Rooms {
  rooms = new Map<string, Room>();
  constructor(
    public maxSize = 10,
    public maxRooms = 1000,
    public ttl = 21600000,
    public now = Date.now,
  ) {}
  create(name: string, password?: string) {
    this.cleanup();
    if (this.rooms.size >= this.maxRooms) throw Error('Server is full. Try again later.');
    const id = randomBytes(18).toString('base64url'),
      salt = randomBytes(16).toString('hex');
    const room: Room = {
      salt,
      password: password ? scryptSync(password, salt, 32) : null,
      members: new Map(),
      seen: new Map(),
      touched: this.now(),
      state: {
        id,
        name,
        version: 0,
        videoId: null,
        currentId: null,
        playing: false,
        position: 0,
        rate: 1,
        updatedAt: this.now(),
        hostId: null,
        mode: 'collaborative',
        queueEveryone: true,
        queue: [],
        participants: [],
        messages: [],
      },
    };
    this.rooms.set(id, room);
    return room;
  }
  get(id: string) {
    const r = this.rooms.get(id);
    if (!r) throw Error('Room not found or expired. Create a new room.');
    return r;
  }
  join(id: string, name: string, token: string, socketId: string, password?: string) {
    const r = this.get(id),
      hash = createHash('sha256').update(token).digest('hex');
    if (r.password && !timingSafeEqual(r.password, scryptSync(password ?? '', r.salt, 32)))
      throw Error('Incorrect room password.');
    let member = [...r.members.values()].find((m) => m.tokenHash === hash);
    const online = [...r.members.values()].filter((m) => m.sockets.size > 0);
    if (!member?.sockets.size && online.length >= this.maxSize) throw Error('This room is full.');
    if (!member) {
      const used = new Set([...r.members.values()].map((m) => m.name));
      let unique = name,
        suffix = 2;
      while (used.has(unique)) unique = `${name.slice(0, 19)} (${suffix++})`;
      member = {
        id: randomUUID(),
        name: unique,
        tokenHash: hash,
        sockets: new Set(),
        leftAt: null,
      };
      r.members.set(member.id, member);
    }
    if (member.sockets.size >= 4) throw Error('Too many tabs for this participant.');
    member.sockets.add(socketId);
    member.leftAt = null;
    if (!r.state.hostId) r.state.hostId = member.id;
    r.touched = this.now();
    this.presence(r);
    return member;
  }
  presence(r: Room) {
    r.state.participants = [...r.members.values()].map((m) => ({
      id: m.id,
      name: m.name,
      online: m.sockets.size > 0,
    }));
  }
  leave(r: Room, participantId: string, socketId: string) {
    const m = r.members.get(participantId);
    if (!m) return;
    m.sockets.delete(socketId);
    if (!m.sockets.size) m.leftAt = this.now();
    if (r.state.hostId === m.id && !m.sockets.size) {
      r.state.hostId = [...r.members.values()].find((x) => x.sockets.size)?.id ?? null;
      r.state.version++;
    }
    r.touched = this.now();
    this.presence(r);
  }
  apply(r: Room, source: string, input: unknown) {
    const c = commandSchema.parse(input),
      s = r.state;
    if (!r.members.get(source)?.sockets.size) throw Error('Join the room first.');
    if (r.seen.get(c.id) === source) return s;
    if (r.seen.has(c.id)) throw Error('Command ID already used.');
    if (c.baseVersion !== s.version)
      throw Error('Room changed. State refreshed; try your action again.');
    this.authorize(r, source, c);
    const now = this.now();
    // Mutate a detached candidate so invalid operations cannot partially change authoritative state.
    const draft = structuredClone(s);
    draft.position = targetPosition(s, now);
    draft.updatedAt = now;
    const select = (index: number) => {
      const item = draft.queue[index];
      if (!item) throw Error('No video in that direction.');
      draft.currentId = item.id;
      draft.videoId = item.videoId;
      draft.position = 0;
      draft.rate = 1;
      draft.playing = true;
    };
    const index = draft.queue.findIndex((q) => q.id === draft.currentId);
    switch (c.type) {
      case 'play':
        if (!draft.videoId) throw Error('Add a video first.');
        draft.playing = true;
        break;
      case 'pause':
        draft.playing = false;
        break;
      case 'seek':
        if (!draft.videoId) throw Error('Add a video first.');
        draft.position = c.position;
        break;
      case 'rate':
        draft.rate = c.rate;
        break;
      case 'add': {
        if (draft.queue.length >= 100) throw Error('Queue is full (100 videos).');
        if (draft.queue.some((q) => q.videoId === c.videoId))
          throw Error('That video is already in the queue.');
        draft.queue.push({
          id: randomUUID(),
          videoId: c.videoId,
          title: `YouTube · ${c.videoId}`,
          addedBy: r.members.get(source)!.name,
        });
        if (!draft.videoId) {
          select(draft.queue.length - 1);
          draft.playing = false;
        }
        break;
      }
      case 'select': {
        const i = draft.queue.findIndex((q) => q.id === c.itemId);
        select(i);
        break;
      }
      case 'next':
        select(index + 1);
        break;
      case 'previous':
        select(index - 1);
        break;
      case 'ended':
        if (c.videoId !== draft.videoId || !draft.playing || source !== draft.hostId)
          throw Error('Only the host can advance the current ended video.');
        if (index + 1 < draft.queue.length) select(index + 1);
        else draft.playing = false;
        break;
      case 'remove': {
        const i = draft.queue.findIndex((q) => q.id === c.itemId);
        if (i < 0) throw Error('Queue item no longer exists.');
        draft.queue.splice(i, 1);
        if (draft.currentId === c.itemId) {
          if (draft.queue.length) select(Math.min(i, draft.queue.length - 1));
          else {
            draft.videoId = null;
            draft.currentId = null;
            draft.position = 0;
            draft.playing = false;
          }
        }
        break;
      }
      case 'move': {
        const i = draft.queue.findIndex((q) => q.id === c.itemId),
          j = i + c.direction;
        if (i < 0 || j < 0 || j >= draft.queue.length) throw Error('Cannot move that item.');
        [draft.queue[i], draft.queue[j]] = [draft.queue[j], draft.queue[i]];
        break;
      }
      case 'settings':
        draft.mode = c.mode;
        draft.queueEveryone = c.queueEveryone;
        break;
      case 'transfer':
        if (!r.members.get(c.participantId)?.sockets.size)
          throw Error('Choose an online participant.');
        draft.hostId = c.participantId;
        break;
    }
    draft.version++;
    draft.lastCommand = { id: c.id, source, type: c.type };
    r.state = draft;
    r.seen.set(c.id, source);
    if (r.seen.size > 512) r.seen.delete(r.seen.keys().next().value!);
    r.touched = now;
    return draft;
  }
  authorize(r: Room, source: string, c: Command) {
    const s = r.state,
      host = source === s.hostId;
    if (['settings', 'transfer'].includes(c.type) && !host)
      throw Error('Only the host can change room settings.');
    const queueEdit = ['add', 'remove', 'move'].includes(c.type);
    const videoChange = ['select', 'next', 'previous'].includes(c.type);
    if (
      !host &&
      (s.mode === 'host' || (queueEdit && !s.queueEveryone) || (videoChange && s.mode === 'hybrid'))
    )
      throw Error('This action is restricted to the host.');
  }
  cleanup() {
    const now = this.now();
    for (const [id, r] of this.rooms) {
      for (const [pid, m] of r.members)
        if (m.leftAt !== null && now - m.leftAt > 120000) r.members.delete(pid);
      this.presence(r);
      if (![...r.members.values()].some((m) => m.sockets.size) && now - r.touched > this.ttl)
        this.rooms.delete(id);
    }
  }
}
