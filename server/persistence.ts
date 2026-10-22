import type { Rooms, Room } from './rooms';
// Opt-in snapshots. The hot command path never awaits database writes.
export async function persistence(rooms: Rooms) {
  if (!process.env.DATABASE_URL) return { save: (_r: Room) => {}, close: async () => {} };
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient();
  await db.$connect();
  const records = await db.room.findMany({
    where: { expiresAt: { gt: new Date() } },
    take: rooms.maxRooms,
  });
  for (const rec of records) {
    const data = rec.snapshot as unknown as {
      state: Room['state'];
      salt: string;
      password: string | null;
    };
    data.state.position = (await import('../lib/sync')).targetPosition(data.state, Date.now());
    data.state.updatedAt = Date.now();
    data.state.playing = false;
    data.state.hostId = null;
    data.state.participants = [];
    data.state.version++;
    rooms.rooms.set(rec.id, {
      state: data.state,
      salt: data.salt,
      password: data.password ? Buffer.from(data.password, 'hex') : null,
      members: new Map(),
      seen: new Map(),
      touched: Date.now(),
    });
  }
  const dirty = new Map<string, Room>();
  let inFlight: Promise<void> | null = null;
  const flush = async () => {
    if (inFlight) return inFlight;
    const write = async () => {
      const batch = [...dirty];
      dirty.clear();
      try {
        for (const [id, r] of batch) {
          const snapshot = JSON.parse(
            JSON.stringify({
              state: r.state,
              salt: r.salt,
              password: r.password?.toString('hex') ?? null,
            }),
          );
          await db.room.upsert({
            where: { id },
            create: { id, snapshot, expiresAt: new Date(Date.now() + rooms.ttl) },
            update: { snapshot, expiresAt: new Date(Date.now() + rooms.ttl) },
          });
        }
        await db.room.deleteMany({ where: { expiresAt: { lt: new Date() } } });
      } catch (e) {
        console.error('Snapshot failed', e instanceof Error ? e.message : 'database error');
        for (const [id, r] of batch) if (!dirty.has(id)) dirty.set(id, r);
      }
    };
    inFlight = write();
    try {
      await inFlight;
    } finally {
      inFlight = null;
    }
  };
  const timer = setInterval(() => void flush(), 2000);
  timer.unref();
  return {
    save: (r: Room) => {
      dirty.set(r.state.id, r);
    },
    close: async () => {
      clearInterval(timer);
      await flush();
      if (dirty.size) await flush();
      await db.$disconnect();
    },
  };
}
