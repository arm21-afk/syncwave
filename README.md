# SyncWave

A private YouTube watch room with an authoritative Node server, real WebSockets, shared controls, queue, chat, and reconnect recovery. Built in its own directory to preserve the existing Kindred application in the parent folder.

## Run locally

Requires **Node.js 22.12+** (Node 24 recommended). No account, API key, or database required.

```powershell
cd "C:\Users\arm21\OneDrive\Documents\ChatGPT\New project\syncwave"
npm ci
npm run dev
```

Open **http://localhost:3001**. Create a room, enter a display name, and copy its invite link. Open the link in another browser or an incognito window. Add any embeddable YouTube video. Click Play. A participant whose browser blocks autoplay must click **Join playback**.

For another device on your network, set `APP_ORIGIN` to the exact address used by those browsers, for example `http://192.168.1.50:3001`. Comma-separated origins are supported. You also need your firewall to permit the port. Clipboard access and `crypto.randomUUID` require a secure browser context: use localhost locally and HTTPS for remote devices.

`.env` is optional; copy `.env.example` to `.env` to change limits. Environment variables are loaded by the server. `APP_ORIGIN` is mandatory in production. Never expose this development server directly on the internet.

```sh
npm run typecheck
npm run lint
npm test
npx playwright install chromium
npm run test:e2e
npm run build
# Set APP_ORIGIN first, e.g. https://watch.example.com
npm start
```

Default port is 3001 so this app can coexist with the original repository app on 3000. Change the product name in `lib/protocol.ts` and the title/description in `app/layout.tsx`.

## Included

- Next.js App Router, TypeScript, React, Socket.IO in WebSocket-only mode, and Zod. Tailwind CSS and custom responsive components give the app its cinema styling without a UI library dependency.
- Official YouTube IFrame Player API. Standard, shortened, music, Shorts, embed, and live video URLs; 11-character video IDs. Media always plays through YouTube.
- Private cryptographic room IDs, optional scrypt-hashed passwords, participant names, duplicate-name disambiguation, host succession and transfer, ten-person default capacity.
- Collaborative controls by default; host-only and hybrid (everyone controls playback, host changes videos) modes. Separate queue editing permission.
- Shared ordered queue: add, remove, move up/down, select, next/previous, host-triggered automatic advance on ended events. Duplicate videos are rejected.
- Chat with timestamps, bounded history, throttled emoji reactions, invite copying, fullscreen, local volume, playback speeds, Space/arrow shortcuts, reduced motion, keyboard focus styles and dialogs.
- Reconnect backoff with jitter; rejoin by a tab-scoped secret token; fresh state restoration; clock estimation; configurable tolerance and drift diagnostics.
- In-memory development and optional PostgreSQL/Prisma room snapshots. No external services are represented as configured.

## Synchronization architecture

`lib/protocol.ts` defines shared events and Zod command schemas. `server/rooms.ts` owns each room's single authoritative state. `server/realtime.ts` validates/rate-limits messages, binds the authenticated socket membership, and broadcasts accepted state immediately. `components/YouTubePlayer.tsx` adapts the official player; `lib/sync.ts` owns time projection and correction policy.

Every playback/queue command includes a UUID and the last observed version. The server ignores repeated IDs from the same participant (last 512 IDs), rejects a UUID reused by another participant, and requires an exact version match. It applies commands synchronously in server arrival order and increments the version. The latest **accepted** command wins. If two commands race from the same version, one wins and the other receives an error plus fresh state. The losing user may repeat the action; old intent is never automatically retried against new state. The UI has one command in flight and disables controls while disconnected. Client timestamps are never used for command authority.

State candidates are cloned and validated before committing, so invalid queue actions cannot partly mutate room state. Membership and chat broadcasts can share a playback version; clients accept those but discard lower versions. Host succession increments the version. Playback is anchored as `{position, playing, rate, updatedAt}`. Playing target position is `position + max(0, estimatedServerNow - updatedAt) * rate / 1000`.

Clock measurements run three times at connection and once per 30 seconds, plus on tab resume. The lowest RTT of the last twelve samples estimates offset from the request midpoint, reducing asymmetric-delay noise. State changes are pushed, never polled. Device observations run once per second without network traffic. Display diagnostics update at this rate; there is no animation-frame React rendering loop.

The device adapter suppresses player callbacks for 1.5–2 seconds around remote loads, seeks, and playback changes to prevent echo loops. It reconciles again after load and on tab resume. Native player play/pause/rate events and clear position discontinuities outside this window become commands. Custom room controls are the most direct command path; a native control used during the suppression window can be corrected back to room state. Local buffering is not sent as a room pause. Only the current host advances on an ended event, and the command includes the expected video and version to reject duplicate/late end events.

## Drift trade-offs and diagnostics

- Default tiny tolerance: **250 ms**; per-device settings offer 150/250/500 ms.
- Between tolerance and **1.2 seconds**, use ±5% rate corrections only if those precise rates are advertised by the player. YouTube usually only offers coarse rates; then moderate drift is tolerated until the hard threshold instead of changing music speed by 25%.
- At/above 1.2 seconds, seek, with a **3-second cooldown**. Authoritative commands force alignment without waiting for this cooldown. A paused device is aligned when outside its tolerance.
- The API's supported speed list determines actual rate changes; YouTube can refuse a requested speed. Ads, buffering, device output delays, background suspension, and autoplay policy can prevent alignment.

Thresholds and intervals live in `lib/sync.ts`. A tolerance is a correction policy, **not a guaranteed maximum drift**. The target of under 250 ms steady alignment is not claimed as achieved. An RTT below 100 ms does not prove synchronized audio or video. The diagnostics show measured network RTT separately from estimated player drift and correction count. Ten-client integration testing prints local command propagation timing; this is a loopback benchmark only.

## PostgreSQL (optional)

Memory rooms disappear on restart, and empty rooms expire after six hours by default. PostgreSQL can save room settings, queue, password hash and playback snapshots; writes are coalesced every two seconds outside the hot command path. A crash can lose the last two seconds or more if the database is unavailable. Startup pauses restored rooms and clears ephemeral membership so participants can join and deliberately resume. The first returning participant becomes host. Participant tokens and their socket IDs are never persisted.

```sh
docker compose --profile database up -d postgres
```

Set `DATABASE_URL=postgresql://syncwave:localdev@localhost:5432/syncwave` in `.env`, then:

```sh
npm run db:generate
npm run db:push
npm run dev
```

Change the example database password for any shared deployment. A `User` model is supplied for future registered profiles; registration, account authentication, and persistent user preferences are **not implemented**. Display names and sensitivity preferences are stored locally. PostgreSQL startup and recovery need verification against your configured database; local memory development does not exercise a live database.

## Deployment

### Render Free

The included `render.yaml` provisions one free Node web service with no paid database or disk. It sets Node 24, installs build dependencies, builds Next.js, starts the custom WebSocket server, and automatically sets `APP_ORIGIN` to Render's assigned HTTPS URL.

Publish the **contents of this `syncwave` directory** as the root of a GitHub repository, then create a Render Blueprint from that repository. If publishing the entire parent repository instead, set the service's `rootDir` to `syncwave` in the Blueprint and select `syncwave/render.yaml` as its Blueprint path. Keep the Free plan selected. Sleeping/restarting loses memory rooms; create a new room for each session. No external account or deployment is configured merely by adding this file.

Deploy to a persistent Node-compatible container host (for example a VM or container service that supports WebSocket upgrades). **One process / one replica** is required because memory is the active source of truth. PostgreSQL snapshots do not provide distributed command coordination. Scaling to multiple replicas would require shared room ownership and pub/sub and is outside this implementation.

```sh
docker compose up --build -d app
```

The Compose default is local HTTP. On a remote host set `APP_ORIGIN=https://your-domain.example` and terminate TLS at your reverse proxy. Forward both normal HTTP and `/socket.io/` WebSocket upgrades to port 3001; allow idle upgraded connections for at least 60 seconds. Keep `Origin` unchanged. Do not use a platform that runs only short-lived serverless handlers or static files. The Next production build is served by the custom Node server via `npm start`, not `next start`.

The image builds and runs the full project as the unprivileged `node` user. `/health` is the health check. Set secrets through your host's secret store. Docker configuration is supplied but has not been executed here (Docker is not installed); no remote service has been provisioned. Sites hosting uses Cloudflare Workers, so this Node/Socket.IO implementation is not published to Sites.

Security controls: exact-origin WebSocket handshake enforcement (including rejection of missing origins), bounded input sizes (16 KiB), strict command schemas, connection/room/member limits, per-IP connection/create/join limits, per-socket event limits, per-participant chat/reaction limits, server-owned membership, host authorization, hashed room passwords, and safe React text rendering. Rooms are capability links: anyone who has the URL and optional password can join. Put additional abuse protection at the trusted reverse proxy for a public deployment. IP limits use the socket remote address; forwarded client IP headers are deliberately not trusted automatically.

## Verification

`npm test` covers creation/joining, password/full/expired errors, duplicate names, playing and paused targets, forward/backward seeking, video switching, simultaneous conflict ordering, duplicate UUIDs, stale versions, host/hybrid/queue permissions, host transfer, reconnection, ordered queues, URL validation, clock estimation, and drift decisions with mocked player observations. Integration tests start an actual Socket.IO server and connect two and ten independent WebSocket clients. They do not fetch or play YouTube media.

Playwright uses two isolated browser contexts and a deterministic in-browser player adapter, leaving the real room server/protocol in place. It tests room create/join, cross-browser playback controls/seeking, chat, invalid input, and mobile overflow. This gives repeatable CI coverage without YouTube ads or autoplay dependencies.

### Manual two-browser check with actual YouTube

1. Start the app, create a room in browser A, copy the link, join in browser B/incognito with a different name. Check both participant lists.
2. Paste a known embeddable non-live video. Press Play in A; click Join playback in B if prompted. Both should progress. Repeat Pause and Play from B.
3. Seek to 2:30 then 0:20 using the progress bar and official player. Check the other browser converges. Compare sync diagnostics; compare audible/visible content separately from RTT.
4. Add two more videos, reorder/remove them in either browser, select another, and check identical queue order. Let the host's video end and verify exactly one advance. Native YouTube next controls should not be used to navigate unrelated recommendations; use room queue controls.
5. Set host-only controls, verify B's controls are disabled and server rejects attempted commands. Try hybrid mode and restricted queue editing. Transfer host to B, then close B and verify A becomes host.
6. Disconnect B using the browser's network controls. Seek/play in A. Reconnect B, verify fresh video/time and unchanged A playback. Suspend/resume B's tab. A reconnect within two minutes retains its participant identity; after cleanup it rejoins as a new participant.
7. Test an unlisted/deleted/embedding-disabled video, incorrect password, full room, invalid invite and network failure. Check errors are actionable. Test mobile width and keyboard navigation/reduced motion.
8. For a ten-person real-device trial, record command propagation, estimated drift distributions, network conditions, media/ads and audio output delays. The automated loopback result alone cannot support internet latency or actual playback alignment claims.

## Troubleshooting and boundaries

- **Join playback:** browsers need a real gesture to permit unmuted playback. Use the prompt; SyncWave never bypasses that restriction.
- **Unavailable / embed disabled:** choose a video whose owner allows embeds. Error 153 can mean a referrer-blocking extension or missing valid origin; use the direct HTTPS app URL. The official [YouTube API reference](https://developers.google.com/youtube/iframe_api_reference) documents these errors and rate/autoplay restrictions.
- **Live streams:** elapsed-position seeking can be unreliable or unsupported; VOD is recommended for alignment. Ads are controlled by YouTube and may differ by viewer.
- **Playlists:** a video URL with a `list` parameter adds that video only. Full YouTube playlist importing needs a separately configured data API and is not implemented. The app's own collaborative queue is fully shared.
- **Reconnect forever:** check `APP_ORIGIN` exactly matches scheme/host/port and the proxy upgrades `/socket.io/`. This app intentionally does not fall back to polling. Localhost and 127.0.0.1 are different origins.
- **Videos load slowly:** the room remains authoritative; the slow client catches up after its player loads. Do not repeatedly pause everyone to compensate for one device.
- **Room vanished:** memory-only rooms do not survive restart. Empty-room expiration and a rolling deploy can also remove them. Use PostgreSQL for snapshots and a single persistent process.
- **Fonts or titles fail:** the UI uses fallback system fonts; missing metadata falls back to a YouTube ID. External Google Fonts/YouTube thumbnail and embed requests need internet access.
- **Known scope:** no registered-user auth, profile UI, full playlist import, drag-and-drop queue gestures, cross-region orchestration, or guarantees of frame/audio synchronization. Queue reordering uses accessible up/down buttons. This is a tested functional foundation, not a claim that a production security review or real-device synchronization study has been completed.

