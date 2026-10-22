import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { z } from 'zod';
import {
  createSchema,
  joinSchema,
  type ClientEvents,
  type ServerEvents,
  type Reply,
} from '../lib/protocol';
import { Rooms, type Room } from './rooms';
export function attachRealtime(
  http: HttpServer,
  options: { origins: string[]; rooms?: Rooms; onChange?: (room: Room) => void },
) {
  const rooms =
    options.rooms ??
    new Rooms(
      Number(process.env.MAX_ROOM_SIZE) || 10,
      Number(process.env.MAX_ROOMS) || 1000,
      Number(process.env.ROOM_TTL_MS) || 21600000,
    );
  const io = new Server<ClientEvents, ServerEvents>(http, {
    transports: ['websocket'],
    maxHttpBufferSize: 16384,
    cors: { origin: options.origins },
    allowRequest: (req, cb) =>
      cb(null, !!req.headers.origin && options.origins.includes(req.headers.origin)),
  });
  const limits = new Map<string, { at: number; count: number }>();
  const allow = (key: string, max: number, window = 10000) => {
    const now = Date.now(),
      old = limits.get(key);
    if (!old || now - old.at >= window) {
      limits.set(key, { at: now, count: 1 });
      return true;
    }
    return ++old.count <= max;
  };
  const publish = (r: Room) => {
    io.to(r.state.id).emit('state', r.state);
    options.onChange?.(r);
  };
  const cleanup = setInterval(() => {
    rooms.cleanup();
    for (const [key, v] of limits) if (Date.now() - v.at > 60000) limits.delete(key);
  }, 60000);
  cleanup.unref();
  io.on('connection', (socket) => {
    const ip = socket.handshake.address;
    if (io.engine.clientsCount > 2000 || !allow(`connect:${ip}`, 60, 60000))
      return void socket.disconnect(true);
    let active: { r: Room; pid: string } | null = null;
    const guarded = (ack: ((reply: Reply) => void) | undefined, fn: () => Reply) => {
      if (typeof ack !== 'function') return;
      try {
        if (!allow(`socket:${socket.id}`, 80)) throw Error('Too many requests. Slow down.');
        ack(fn());
      } catch (e) {
        ack({
          ok: false,
          error:
            e instanceof z.ZodError
              ? 'Invalid request.'
              : e instanceof Error
                ? e.message
                : 'Request failed.',
          state: active?.r.state,
        });
      }
    };
    const leave = () => {
      if (!active) return;
      const { r, pid } = active;
      rooms.leave(r, pid, socket.id);
      void socket.leave(r.state.id);
      active = null;
      publish(r);
    };
    socket.on('create', (input, ack) =>
      guarded(ack, () => {
        if (!allow(`create:${ip}`, 12, 60000)) throw Error('Too many room creations. Try later.');
        const c = createSchema.parse(input);
        const r = rooms.create(c.name, c.password);
        return { ok: true, roomId: r.state.id };
      }),
    );
    socket.on('join', (input, ack) =>
      guarded(ack, () => {
        if (!allow(`join:${ip}`, 40, 60000)) throw Error('Too many join attempts. Try later.');
        const c = joinSchema.parse(input);
        if (active) leave();
        const member = rooms.join(c.roomId, c.name, c.token, socket.id, c.password),
          r = rooms.get(c.roomId);
        active = { r, pid: member.id };
        void socket.join(c.roomId);
        publish(r);
        return { ok: true, participantId: member.id, state: r.state };
      }),
    );
    socket.on('command', (input, ack) =>
      guarded(ack, () => {
        if (!active) throw Error('Join a room first.');
        const s = rooms.apply(active.r, active.pid, input);
        publish(active.r);
        return { ok: true, state: s };
      }),
    );
    socket.on('refresh', (ack) =>
      guarded(ack, () => {
        if (!active) throw Error('Join a room first.');
        return { ok: true, state: active.r.state };
      }),
    );
    socket.on('clock', (ack) => {
      if (typeof ack === 'function' && allow(`clock:${socket.id}`, 20)) ack(Date.now());
    });
    socket.on('chat', (input, ack) =>
      guarded(ack, () => {
        if (!active) throw Error('Join a room first.');
        if (!allow(`chat:${active.pid}`, 8)) throw Error('Chat is moving too fast.');
        const { text } = z
          .object({ text: z.string().trim().min(1).max(500) })
          .strict()
          .parse(input);
        const { r, pid } = active;
        r.state.messages.push({
          id: crypto.randomUUID(),
          name: r.members.get(pid)!.name,
          text,
          at: Date.now(),
        });
        r.state.messages = r.state.messages.slice(-100);
        publish(r);
        return { ok: true };
      }),
    );
    socket.on('reaction', (input) => {
      if (
        active &&
        ['💜', '🔥', '✨', '👏', '🎵'].includes(input) &&
        allow(`react:${active.pid}`, 5)
      )
        io.to(active.r.state.id).emit('reaction', {
          emoji: input,
          name: active.r.members.get(active.pid)!.name,
        });
    });
    socket.on('leave', (ack) => {
      leave();
      if (typeof ack === 'function') ack();
    });
    socket.on('disconnect', leave);
  });
  io.on('close', () => clearInterval(cleanup));
  return { io, rooms };
}
