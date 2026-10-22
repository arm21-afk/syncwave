import { createServer } from 'node:http';
import next from 'next';
import { attachRealtime } from './realtime';
import { Rooms } from './rooms';
import { persistence } from './persistence';
import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd());
const dev = process.env.NODE_ENV !== 'production',
  port = Number(process.env.PORT) || 3001;
const origins = (process.env.APP_ORIGIN || `http://localhost:${port},http://127.0.0.1:${port}`)
  .split(',')
  .map((s) => s.trim());
if (!dev && !process.env.APP_ORIGIN)
  throw Error('Set APP_ORIGIN to your exact HTTPS production origin.');
const app = next({ dev, port, hostname: '0.0.0.0' });
await app.prepare();
const handler = app.getRequestHandler();
const http = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200);
    res.end('ok');
  } else void handler(req, res);
});
const rooms = new Rooms(
  Number(process.env.MAX_ROOM_SIZE) || 10,
  Number(process.env.MAX_ROOMS) || 1000,
  Number(process.env.ROOM_TTL_MS) || 21600000,
);
const store = await persistence(rooms);
const { io } = attachRealtime(http, { origins, rooms, onChange: store.save });
http.listen(port, '0.0.0.0', () => console.log(`SyncWave: http://localhost:${port}`));
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    void store.close().finally(() => io.close(() => process.exit(0)));
  });
