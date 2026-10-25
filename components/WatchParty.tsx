'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  Crown,
  Disc3,
  Expand,
  Minimize,
  Headphones,
  Link,
  ListMusic,
  LockKeyhole,
  LogOut,
  MessageCircle,
  Music2,
  Pause,
  Play,
  Plus,
  Radio,
  Settings2,
  ShieldCheck,
  SkipBack,
  SkipForward,
  Sparkles,
  Trash2,
  Users,
  Volume2,
  Waves,
  X,
} from 'lucide-react';
import {
  APP_NAME,
  type Action,
  type ClientEvents,
  type Mode,
  type RoomState,
  type ServerEvents,
  type Reply,
} from '../lib/protocol';
import { ClockEstimator } from '../lib/sync';
import { videoId } from '../lib/youtube';
import { YouTubePlayer, type Diagnostics, type PlayerHandle } from './YouTubePlayer';
import { useRoomChat } from './useRoomChat';
import { ChatPanel } from './ChatPanel';
import { ChatNotifications } from './ChatNotifications';

const suggestions = [
  {
    id: 'jfKfPfyJRdk',
    title: 'lofi hip hop radio',
    artist: 'Lofi Girl',
    label: 'A little less rush. A little more us.',
    color: 'violet',
  },
  {
    id: '5qap5aO4i9A',
    title: 'Late night beats',
    artist: 'A softer soundtrack',
    label: 'For conversations that go past midnight.',
    color: 'teal',
  },
  {
    id: 'aqz-KE-bpKQ',
    title: 'Big Buck Bunny',
    artist: 'Blender Foundation',
    label: 'Make it a movie night.',
    color: 'amber',
  },
];
type Session = { roomId: string; name: string; token: string; password?: string };
const time = (n: number) => `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}`;
export function WatchParty() {
  const socket = useRef<Socket<ServerEvents, ClientEvents> | null>(null),
    stateRef = useRef<RoomState | null>(null),
    session = useRef<Session | null>(null),
    targetRoom = useRef<string | null>(null),
    player = useRef<PlayerHandle>(null),
    clock = useRef(new ClockEstimator());
  const [state, setState] = useState<RoomState | null>(null),
    [connected, setConnected] = useState(false),
    [joined, setJoined] = useState(false),
    [pid, setPid] = useState(''),
    [name, setName] = useState(''),
    [roomName, setRoomName] = useState('The listening room'),
    [password, setPassword] = useState(''),
    [invite, setInvite] = useState(''),
    [joinId, setJoinId] = useState(''),
    [dialog, setDialog] = useState<'create' | 'join' | 'settings' | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [toast, setToast] = useState(''),
    [url, setUrl] = useState(''),
    [tab, setTab] = useState<'queue' | 'chat'>('queue'),
    [debug, setDebug] = useState(false),
    [tolerance, setTolerance] = useState(0.25),
    [offset, setOffset] = useState(0),
    [rtt, setRtt] = useState(0),
    [volume, setVolume] = useState(75),
    [isFullscreen, setIsFullscreen] = useState(false),
    [diag, setDiag] = useState<Diagnostics>({
      drift: 0,
      corrections: 0,
      status: 'Waiting for video',
      position: 0,
      duration: 0,
    }),
    [titles, setTitles] = useState<Record<string, string>>({}),
    [reaction, setReaction] = useState('');
  const pending = useRef(false),
    chatPanel = useRef<HTMLElement>(null);
  const {
    messages: chatMessages,
    notifications: chatNotifications,
    preferences: chatPreferences,
    seed: seedChat,
    receive: receiveChat,
    clear: clearChat,
    updatePreferences: updateChatPreferences,
  } = useRoomChat();
  const accept = useCallback((s: RoomState) => {
    if (s.id !== targetRoom.current) return;
    if (
      !stateRef.current ||
      s.id !== stateRef.current.id ||
      s.version >= stateRef.current.version
    ) {
      stateRef.current = s;
      setState(s);
    }
  }, []);
  const notify = useCallback((text: string) => setToast(text), []);
  useEffect(() => {
    const change = () =>
      setIsFullscreen(!!document.fullscreenElement?.classList.contains('screen-frame'));
    document.addEventListener('fullscreenchange', change);
    return () => document.removeEventListener('fullscreenchange', change);
  }, []);
  const join = useCallback(
    (data: Session) => {
      const s = socket.current;
      if (!s) return;
      setBusy(true);
      setError('');
      targetRoom.current = data.roomId;
      s.timeout(7000).emit('join', data, (err: Error | null, reply: Reply) => {
        setBusy(false);
        if (err || !reply?.ok) {
          setError(reply?.error || 'Connection timed out. Try again.');
          setJoined(false);
          return;
        }
        session.current = data;
        setJoined(true);
        setPid(reply.participantId!);
        seedChat(data.roomId, reply.participantId!, reply.state!.messages);
        accept(reply.state!);
        setDialog(null);
        setPassword('');
        localStorage.setItem('syncwave-name', data.name);
        history.replaceState(null, '', `/?room=${data.roomId}`);
      });
    },
    [accept, seedChat],
  );
  useEffect(() => {
    setName(localStorage.getItem('syncwave-name') || '');
    setTolerance(Number(localStorage.getItem('syncwave-tolerance')) || 0.25);
    const requested = new URLSearchParams(location.search).get('room');
    if (requested) {
      setJoinId(requested);
      setDialog('join');
    }
    const s = io({
      transports: ['websocket'],
      autoConnect: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 10000,
      randomizationFactor: 0.5,
    });
    socket.current = s;
    const ping = () => {
      if (!s.connected) return;
      const start = Date.now();
      s.timeout(3000).emit('clock', (err: Error | null, server: number) => {
        if (!err) {
          clock.current.add(start, Date.now(), server);
          setOffset(clock.current.best.offset);
          setRtt(clock.current.best.rtt);
        }
      });
    };
    s.on('connect', () => {
      setConnected(true);
      ping();
      setTimeout(ping, 250);
      setTimeout(ping, 750);
      if (session.current) join(session.current);
    });
    s.on('disconnect', () => {
      setConnected(false);
      setJoined(false);
      pending.current = false;
      clearChat();
    });
    s.on('connect_error', () =>
      setError('Could not connect. Check your connection and the server origin settings.'),
    );
    s.on('state', accept);
    s.on('chat:message', receiveChat);
    s.on('reaction', (data) => {
      setReaction(`${data.emoji} ${data.name}`);
    });
    const interval = setInterval(ping, 30000);
    const wake = () => {
      if (!document.hidden && s.connected && session.current) {
        ping();
        s.emit('refresh', (reply: Reply) => {
          if (reply.state) accept(reply.state);
        });
      }
    };
    document.addEventListener('visibilitychange', wake);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', wake);
      s.disconnect();
      socket.current = null;
    };
  }, [accept, join, receiveChat, clearChat]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 4500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (!reaction) return;
    const t = setTimeout(() => setReaction(''), 2500);
    return () => clearTimeout(t);
  }, [reaction]);
  useEffect(() => {
    const ids = state?.queue.map((q) => q.videoId).filter((id) => !titles[id]) ?? [];
    if (!ids.length) return;
    let cancelled = false;
    void Promise.all(
      ids.map(async (id) => {
        try {
          const r = await fetch(`/api/video?id=${id}`);
          const d = await r.json();
          return [id, d.title || `YouTube · ${id}`] as const;
        } catch {
          return [id, `YouTube · ${id}`] as const;
        }
      }),
    ).then((entries) => {
      if (!cancelled) setTitles((t) => ({ ...t, ...Object.fromEntries(entries) }));
    });
    return () => {
      cancelled = true;
    };
  }, [state?.queue, titles]);
  const action = useCallback(
    (a: Action) => {
      const s = socket.current,
        current = stateRef.current;
      if (!s?.connected || !current || pending.current) return;
      pending.current = true;
      s.timeout(5000).emit(
        'command',
        { ...a, id: crypto.randomUUID(), baseVersion: current.version },
        (err: Error | null, reply: Reply) => {
          pending.current = false;
          if (reply?.state) accept(reply.state);
          if (err || !reply?.ok) {
            notify(reply?.error || 'Command timed out. Reconnecting to room state…');
            s.emit('refresh', (r) => {
              if (r.state) accept(r.state);
            });
          }
        },
      );
    },
    [accept, notify],
  );
  const isHost = state?.hostId === pid,
    canPlayback = !!state && (isHost || state.mode !== 'host'),
    canVideo = !!state && (isHost || state.mode === 'collaborative'),
    canQueue = !!state && (isHost || (state.mode !== 'host' && state.queueEveryone));
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (
        !stateRef.current ||
        !canPlayback ||
        !joined ||
        dialog ||
        (e.target as HTMLElement).closest('input,textarea,select,button,iframe')
      )
        return;
      if (e.code === 'Space') {
        e.preventDefault();
        action({ type: stateRef.current.playing ? 'pause' : 'play' });
      }
      if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
        e.preventDefault();
        action({
          type: 'seek',
          position: Math.max(
            0,
            (player.current?.current() || 0) + (e.code === 'ArrowRight' ? 10 : -10),
          ),
        });
      }
    };
    document.addEventListener('keydown', keys);
    return () => document.removeEventListener('keydown', keys);
  }, [action, canPlayback, joined, dialog]);
  const token = () => {
    let t = sessionStorage.getItem('syncwave-token');
    if (!t) {
      t = crypto.randomUUID() + crypto.randomUUID();
      sessionStorage.setItem('syncwave-token', t);
    }
    return t;
  };
  const start = (e: React.FormEvent) => {
    e.preventDefault();
    if (!socket.current?.connected) return setError('Wait for the server connection.');
    setError('');
    if (dialog === 'join') {
      let id = joinId;
      try {
        id = new URL(joinId).searchParams.get('room') || joinId;
      } catch {
        /* A plain room ID is also accepted. */
      }
      join({ roomId: id, name: name.trim(), token: token(), password });
      return;
    }
    setBusy(true);
    socket.current
      .timeout(7000)
      .emit(
        'create',
        { name: roomName.trim(), password: password || undefined },
        (err: Error | null, reply: Reply) => {
          if (err || !reply?.ok) {
            setBusy(false);
            setError(reply?.error || 'Could not create room.');
            return;
          }
          join({ roomId: reply.roomId!, name: name.trim(), token: token(), password });
        },
      );
  };
  const add = (input: string) => {
    const id = videoId(input);
    if (!id) return notify('Paste a valid YouTube URL, Shorts URL, or 11-character video ID.');
    action({ type: 'add', videoId: id });
    setUrl('');
  };
  const copy = async () => {
    const link = `${location.origin}/?room=${state?.id}`;
    try {
      await navigator.clipboard.writeText(link);
      setInvite('copied');
      notify('Invite link copied. Send it to your people.');
      setTimeout(() => setInvite(''), 2000);
    } catch {
      setInvite(link);
    }
  };
  const leave = () => {
    socket.current?.emit('leave', () => {});
    session.current = null;
    targetRoom.current = null;
    seedChat('', '', []);
    stateRef.current = null;
    setState(null);
    setJoined(false);
    history.replaceState(null, '', '/');
    setDiag({ drift: 0, corrections: 0, status: 'Waiting for video', position: 0, duration: 0 });
  };
  const current = state?.queue.find((q) => q.id === state.currentId),
    online = state?.participants.filter((p) => p.online) ?? [];
  const title = current
    ? titles[current.videoId] || current.title
    : 'The best nights start with a play.';
  const sendChat = useCallback(
    (text: string, clientId: string) =>
      new Promise<void>((resolve, reject) => {
        const s = socket.current,
          roomId = session.current?.roomId;
        if (!s?.connected || !roomId) return reject(Error('Reconnect before sending a message.'));
        s.timeout(5000).emit('chat', { text, clientId }, (err: Error | null, reply: Reply) => {
          if (err || !reply?.ok)
            return reject(Error(reply?.error || 'Message timed out. Retry to send it safely.'));
          if (reply.message) receiveChat({ roomId, message: reply.message });
          resolve();
        });
      }),
    [receiveChat],
  );
  const openChat = () => {
    setTab('chat');
    requestAnimationFrame(() =>
      chatPanel.current
        ?.querySelector<HTMLTextAreaElement>('textarea')
        ?.focus({ preventScroll: true }),
    );
  };
  return (
    <div className="app">
      <header className="topbar">
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            if (state) e.preventDefault();
          }}
        >
          <span className="brand-mark">
            <Waves size={24} />
          </span>
          {APP_NAME}
          <span className="beta">BETA</span>
        </a>
        <div className="top-middle">
          <span className={`status-dot ${connected ? '' : 'offline'}`} />
          {state ? (
            <>
              <LockKeyhole size={13} />
              {state.name}
              <span className="divider" />
              <span className="muted">Private room</span>
            </>
          ) : (
            'Good company. Great music.'
          )}
        </div>
        <div className="top-actions">
          {state ? (
            <>
              <div className="avatar-stack">
                {online.slice(0, 4).map((p, i) => (
                  <span key={p.id} className={`avatar color-${i % 4}`} title={p.name}>
                    {p.name[0].toUpperCase()}
                  </span>
                ))}
              </div>
              <button className="button primary small" onClick={() => void copy()}>
                {invite === 'copied' ? <Check size={16} /> : <Plus size={16} />}Invite friends
              </button>
              <button
                className="icon-button"
                aria-label="Room settings"
                onClick={() => setDialog('settings')}
              >
                <Settings2 size={19} />
              </button>
            </>
          ) : (
            <>
              <span className="connection-label">
                {connected ? 'Ready when you are' : 'Connecting…'}
              </span>
              <button
                className="button secondary small"
                onClick={() => {
                  setError('');
                  setDialog('join');
                }}
              >
                Join a room
                <ChevronRight size={15} />
              </button>
            </>
          )}
        </div>
      </header>
      {!state ? (
        <main className="lobby">
          <div className="hero-copy">
            <div className="eyebrow">
              <span className="status-dot" />
              DISTANCE OFF. VOLUME UP.
            </div>
            <h1>
              Different places.
              <br />
              Same <span>wavelength.</span>
            </h1>
            <p>
              Your favorite videos, your favorite people.
              <br />
              One shared moment, perfectly your vibe.
            </p>
            <div className="hero-buttons">
              <button
                className="button primary large"
                onClick={() => {
                  setDialog('create');
                  setError('');
                }}
              >
                <Plus size={20} />
                Create a room
                <ChevronRight size={18} />
              </button>
              <button
                className="button text-button"
                onClick={() => {
                  setDialog('join');
                  setError('');
                }}
              >
                <Link size={17} />I have an invite
              </button>
            </div>
            <div className="hero-trust">
              <span>
                <ShieldCheck size={15} />
                Private by default
              </span>
              <span>
                <Users size={15} />
                No account needed
              </span>
              <span>
                <Radio size={15} />
                Shared playback
              </span>
            </div>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="orb orb-one" />
            <div className="orb orb-two" />
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="record">
              <div className="record-label">
                <Waves size={48} />
                <span>
                  ON THE SAME
                  <br />
                  WAVELENGTH
                </span>
                <i />
              </div>
            </div>
            <div className="floating-tag tag-top">
              <span className="status-dot" />A little closer, wherever you are.
            </div>
            <div className="floating-tag tag-bottom">
              <Headphones size={18} />
              <span>
                Made for listening.
                <br />
                <strong>Better together.</strong>
              </span>
              <div className="equalizer">
                <i />
                <i />
                <i />
                <i />
                <i />
              </div>
            </div>
            <span className="art-spark spark-one">✦</span>
            <span className="art-spark spark-two">✦</span>
          </div>
          <section className="how-it-works">
            <div>
              <span className="step-number">01</span>
              <h3>Make room for your people.</h3>
              <p>Create your own little corner of the internet.</p>
            </div>
            <div>
              <span className="step-number">02</span>
              <h3>Send a link. Set the mood.</h3>
              <p>Drop in a YouTube video and invite your friends.</p>
            </div>
            <div>
              <span className="step-number">03</span>
              <h3>Press play, together.</h3>
              <p>Shared controls. A live queue. Zero distance.</p>
            </div>
          </section>
          <div className="lobby-footer">
            <Waves size={18} />
            <span>A shared soundtrack to your everyday.</span>
            <span>YouTube powered. People inspired.</span>
          </div>
        </main>
      ) : (
        <main className="room-layout">
          <section className="watch-column">
            <div className="room-heading">
              <div>
                <div className="eyebrow">YOUR LITTLE CORNER OF THE INTERNET</div>
                <h1>
                  {state.name}
                  <span className="live-pill">
                    <span className="status-dot" />
                    LIVE
                  </span>
                </h1>
              </div>
              <button className="button text-button" onClick={leave}>
                <LogOut size={15} />
                Leave room
              </button>
            </div>
            <div className="screen-frame">
              <div className="screen-top">
                <span>
                  <span className="status-dot" />
                  {connected && joined ? 'Room connected' : 'Reconnecting…'}
                </span>
                <button
                  className="player-chat-toggle"
                  aria-controls="room-chat"
                  aria-expanded={tab === 'chat'}
                  onClick={() => (tab === 'chat' ? setTab('queue') : openChat())}
                >
                  <MessageCircle size={14} />
                  {tab === 'chat' ? 'Hide chat' : 'Open chat'}
                </button>
                {isFullscreen && <span>Exit fullscreen to open chat</span>}
              </div>
              {state.videoId ? (
                <YouTubePlayer
                  key={state.id}
                  ref={player}
                  state={state}
                  offset={offset}
                  tolerance={tolerance}
                  connected={connected && joined}
                  isHost={isHost}
                  onAction={action}
                  onDiagnostics={setDiag}
                >
                  <ChatNotifications items={chatNotifications} announce={tab !== 'chat'} />
                </YouTubePlayer>
              ) : (
                <div className="empty-player">
                  <div className="empty-disc">
                    <Disc3 size={70} strokeWidth={1} />
                  </div>
                  <span className="eyebrow">LET’S SET THE MOOD</span>
                  <h2>Every good night has a soundtrack.</h2>
                  <p>
                    Add a YouTube video to your queue.
                    <br />
                    We’ll take care of keeping everyone together.
                  </p>
                  <button
                    className="button primary"
                    onClick={() => document.getElementById('video-url')?.focus()}
                  >
                    <Plus size={16} />
                    Add your first video
                  </button>
                  <ChatNotifications items={chatNotifications} announce={tab !== 'chat'} />
                </div>
              )}
              <div className="transport">
                <div className="transport-main">
                  <button
                    className="icon-button"
                    disabled={
                      !canVideo ||
                      !joined ||
                      state.queue.findIndex((q) => q.id === state.currentId) <= 0
                    }
                    onClick={() => action({ type: 'previous' })}
                    aria-label="Previous video"
                  >
                    <SkipBack size={19} />
                  </button>
                  <button
                    className="play-button"
                    disabled={!canPlayback || !joined || !state.videoId}
                    onClick={() => action({ type: state.playing ? 'pause' : 'play' })}
                    aria-label={state.playing ? 'Pause' : 'Play'}
                  >
                    {state.playing ? (
                      <Pause size={20} fill="currentColor" />
                    ) : (
                      <Play size={20} fill="currentColor" />
                    )}
                  </button>
                  <button
                    className="icon-button"
                    disabled={
                      !canVideo ||
                      !joined ||
                      state.queue.findIndex((q) => q.id === state.currentId) >=
                        state.queue.length - 1
                    }
                    onClick={() => action({ type: 'next' })}
                    aria-label="Next video"
                  >
                    <SkipForward size={19} />
                  </button>
                  <span className="timecode">
                    {time(diag.position)}
                    <span> / {diag.duration ? time(diag.duration) : '—:—'}</span>
                  </span>
                </div>
                <div className="transport-end">
                  <Volume2 size={17} />
                  <input
                    aria-label="Volume"
                    type="range"
                    min="0"
                    max="100"
                    value={volume}
                    onChange={(e) => {
                      setVolume(+e.target.value);
                      player.current?.volume(+e.target.value);
                    }}
                  />
                  <select
                    aria-label="Playback speed"
                    value={state.rate}
                    disabled={!canPlayback || !joined}
                    onChange={(e) => action({ type: 'rate', rate: +e.target.value as 1 })}
                  >
                    {[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => (
                      <option key={r} value={r}>
                        {r}×
                      </option>
                    ))}
                  </select>
                  <button
                    className="icon-button"
                    aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                    title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen with floating chat'}
                    disabled={!state.videoId}
                    onClick={() => {
                      void player.current
                        ?.fullscreen()
                        .catch(() =>
                          notify(
                            'This browser could not enter fullscreen. Try opening SyncWave directly in a supported browser.',
                          ),
                        );
                    }}
                  >
                    {isFullscreen ? <Minimize size={18} /> : <Expand size={18} />}
                  </button>
                </div>
              </div>
              {state.videoId && (
                <input
                  className="seek-bar"
                  aria-label="Seek position"
                  type="range"
                  min="0"
                  max={diag.duration || 1}
                  value={Math.min(diag.position, diag.duration || 1)}
                  step="0.1"
                  disabled={!canPlayback || !joined || !diag.duration}
                  onChange={(e) => action({ type: 'seek', position: +e.target.value })}
                />
              )}
            </div>
            <div className="now-playing">
              <div>
                <span className="eyebrow purple">
                  <span className="equalizer tiny">
                    <i />
                    <i />
                    <i />
                  </span>
                  {state.videoId ? 'NOW PLAYING' : 'THE STAGE IS YOURS'}
                </span>
                <h2>{title}</h2>
                <p>
                  {current
                    ? `Added by ${current.addedBy} · YouTube`
                    : 'Nothing queued yet. Bring something you love.'}
                </p>
              </div>
              <button
                className={`sync-badge ${!connected || !joined ? 'warning' : ''}`}
                onClick={() => setDebug((v) => !v)}
              >
                <Activity size={15} />
                {!connected || !joined
                  ? 'Reconnecting'
                  : state.videoId
                    ? diag.status
                    : 'Ready to sync'}
              </button>
            </div>
            <section className="people-panel">
              <div className="section-label">
                <span>
                  <Users size={17} />
                  Here together <span className="count">{online.length}</span>
                </span>
                <span className="muted">
                  {state.mode === 'collaborative'
                    ? 'Everyone has the aux'
                    : state.mode === 'host'
                      ? 'Host controls playback'
                      : 'Host chooses the videos'}
                </span>
              </div>
              <div className="people-list">
                {state.participants.map((p, i) => (
                  <div className="person" key={p.id}>
                    <span className={`avatar color-${i % 4} ${p.online ? '' : 'away'}`}>
                      {p.name[0].toUpperCase()}
                      <i className={p.online ? '' : 'offline'} />
                    </span>
                    <span>
                      {p.name}
                      {p.id === pid && <small> (you)</small>}
                      <small>
                        {p.id === state.hostId
                          ? 'Room host'
                          : p.online
                            ? 'Hanging out'
                            : 'Disconnected'}
                      </small>
                    </span>
                    {p.id === state.hostId && <Crown size={13} className="crown" />}
                  </div>
                ))}
                <button className="invite-person" onClick={() => void copy()}>
                  <Plus size={19} />
                  <span>Make room for a friend</span>
                </button>
              </div>
            </section>
            <div className="mood-row">
              <span>
                Good vibes travel.<span className="muted"> Send one.</span>
              </span>
              <div>
                {['💜', '🔥', '✨', '👏', '🎵'].map((emoji) => (
                  <button
                    key={emoji}
                    disabled={!joined}
                    onClick={() => socket.current?.emit('reaction', emoji)}
                    aria-label={`React ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
            {debug && (
              <section className="diagnostics">
                <div className="section-label">
                  <span>
                    <Activity size={16} />
                    Sync diagnostics
                  </span>
                  <button
                    className="icon-button"
                    aria-label="Close diagnostics"
                    onClick={() => setDebug(false)}
                  >
                    <X size={16} />
                  </button>
                </div>
                <div className="metrics grid grid-cols-3">
                  {[
                    ['Socket', connected ? 'Connected' : 'Offline'],
                    ['Round trip', `${rtt} ms`],
                    ['Clock offset', `${offset.toFixed(0)} ms`],
                    ['Player drift', `${diag.drift.toFixed(0)} ms`],
                    ['Corrections', diag.corrections],
                    ['State version', state.version],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <small>{k}</small>
                      <strong>{v}</strong>
                    </div>
                  ))}
                </div>
                <p>
                  Round trip measures network latency. Player drift is an estimate; ads, buffering,
                  and device output delays can affect alignment.
                </p>
              </section>
            )}
            <div className="watch-footer">
              <Headphones size={14} />
              Different places. Same wavelength.<span>Space to play / pause · ← → to seek</span>
            </div>
          </section>
          <aside className={`sidebar ${tab === 'chat' ? 'chat-open' : ''}`} ref={chatPanel}>
            <div className="sidebar-tabs">
              <button className={tab === 'queue' ? 'active' : ''} onClick={() => setTab('queue')}>
                <ListMusic size={18} />
                Up next<span>{state.queue.length}</span>
              </button>
              <button className={tab === 'chat' ? 'active' : ''} onClick={openChat}>
                <MessageCircle size={17} />
                Room chat<span>{chatMessages.length}</span>
              </button>
            </div>
            {tab === 'queue' ? (
              <>
                <div className="queue-intro">
                  <h2>A queue with good company.</h2>
                  <p>A little of your taste. A little of theirs.</p>
                </div>
                <form
                  className="add-video"
                  onSubmit={(e) => {
                    e.preventDefault();
                    add(url);
                  }}
                >
                  <div>
                    <Link size={16} />
                    <input
                      id="video-url"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="Paste a YouTube link…"
                      aria-label="YouTube URL"
                      disabled={!canQueue || !joined}
                    />
                  </div>
                  <button className="button primary" disabled={!url.trim() || !canQueue || !joined}>
                    <Plus size={16} />
                    Add to queue
                  </button>
                </form>
                <div className="queue-label">
                  <span>THE SHARED QUEUE</span>
                  <span>
                    {state.queue.length} {state.queue.length === 1 ? 'video' : 'videos'}
                  </span>
                </div>
                <div className="queue-items">
                  {state.queue.map((q, i) => (
                    <div
                      key={q.id}
                      className={`queue-item ${q.id === state.currentId ? 'current' : ''}`}
                    >
                      <span className="queue-number">
                        {q.id === state.currentId ? (
                          <span className="equalizer tiny">
                            <i />
                            <i />
                            <i />
                          </span>
                        ) : (
                          String(i + 1).padStart(2, '0')
                        )}
                      </span>
                      <button
                        className="queue-select"
                        disabled={!canVideo || !joined}
                        onClick={() => action({ type: 'select', itemId: q.id })}
                      >
                        <img
                          src={`https://i.ytimg.com/vi/${q.videoId}/mqdefault.jpg`}
                          alt=""
                          loading="lazy"
                        />
                        <span>
                          <strong>{titles[q.videoId] || q.title}</strong>
                          <small>
                            {q.id === state.currentId ? 'Now playing' : `Added by ${q.addedBy}`}
                          </small>
                        </span>
                      </button>
                      <div className="queue-actions">
                        <button
                          aria-label={`Move video ${i + 1} up`}
                          disabled={!canQueue || !joined || i === 0}
                          onClick={() => action({ type: 'move', itemId: q.id, direction: -1 })}
                        >
                          <ArrowUp size={13} />
                        </button>
                        <button
                          aria-label={`Move video ${i + 1} down`}
                          disabled={!canQueue || !joined || i === state.queue.length - 1}
                          onClick={() => action({ type: 'move', itemId: q.id, direction: 1 })}
                        >
                          <ArrowDown size={13} />
                        </button>
                        <button
                          aria-label={`Remove video ${i + 1}`}
                          disabled={!canQueue || !joined}
                          onClick={() => action({ type: 'remove', itemId: q.id })}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                  {!state.queue.length && (
                    <div className="empty-queue">
                      <ListMusic size={30} />
                      <h3>Room for your favorites.</h3>
                      <p>
                        The next great discovery
                        <br />
                        could be yours to share.
                      </p>
                    </div>
                  )}
                </div>
                <div className="suggestions">
                  <div className="section-label">
                    <span>
                      <Sparkles size={15} />
                      Need a starting note?
                    </span>
                  </div>
                  {suggestions.map((s) => (
                    <button
                      className="suggestion"
                      key={s.id}
                      disabled={!canQueue || !joined}
                      onClick={() => add(s.id)}
                    >
                      <span className={`suggestion-art ${s.color}`}>
                        <Music2 size={21} />
                      </span>
                      <span>
                        <strong>{s.title}</strong>
                        <small>{s.artist}</small>
                      </span>
                      <Plus size={16} />
                    </button>
                  ))}
                </div>
                <div className="sidebar-bottom">
                  <ShieldCheck size={16} />
                  <p>
                    Your room, your rhythm.
                    <br />
                    <span>Only people with your link can join.</span>
                  </p>
                </div>
              </>
            ) : (
              <ChatPanel
                key={state.id}
                messages={chatMessages}
                connected={connected && joined}
                onSend={sendChat}
                onClose={() => setTab('queue')}
                preferences={chatPreferences}
                onPreferences={updateChatPreferences}
                onClear={clearChat}
              />
            )}
          </aside>
        </main>
      )}
      {dialog && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setDialog(null);
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setDialog(null);
              if (e.key === 'Tab') {
                const els = e.currentTarget.querySelectorAll<HTMLElement>(
                  'button:not(:disabled),input:not(:disabled),select:not(:disabled)',
                );
                const first = els[0],
                  last = els[els.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                  e.preventDefault();
                  last?.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                  e.preventDefault();
                  first?.focus();
                }
              }
            }}
          >
            <button
              className="modal-close icon-button"
              onClick={() => setDialog(null)}
              aria-label="Close dialog"
            >
              <X size={20} />
            </button>
            <span className="modal-icon">
              {dialog === 'settings' ? <Settings2 size={26} /> : <Headphones size={28} />}
            </span>
            <span className="eyebrow purple">
              {dialog === 'settings' ? 'YOUR ROOM, YOUR RULES' : 'GOOD COMPANY STARTS HERE'}
            </span>
            <h2 id="dialog-title">
              {dialog === 'create'
                ? 'Make a little room.'
                : dialog === 'join'
                  ? 'Your people are waiting.'
                  : 'Set your wavelength.'}
            </h2>
            <p>
              {dialog === 'settings'
                ? 'Fine-tune how you watch together.'
                : 'No sign-ups. No fuss. Just press play together.'}
            </p>
            {dialog !== 'settings' ? (
              <form onSubmit={start}>
                <label>
                  Your display name
                  <input
                    autoFocus
                    required
                    maxLength={24}
                    placeholder="What should we call you?"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                {dialog === 'create' ? (
                  <label>
                    Room name
                    <input
                      required
                      maxLength={60}
                      value={roomName}
                      onChange={(e) => setRoomName(e.target.value)}
                    />
                  </label>
                ) : (
                  <label>
                    Invite link or room ID
                    <input
                      required
                      value={joinId}
                      onChange={(e) => setJoinId(e.target.value)}
                      placeholder="Paste your invite link"
                    />
                  </label>
                )}
                <label>
                  Room password{' '}
                  <span className="muted">
                    {dialog === 'create' ? '(optional)' : '(if required)'}
                  </span>
                  <input
                    type="password"
                    maxLength={128}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={dialog === 'create' ? 'new-password' : 'current-password'}
                    placeholder="Keep it a little more private"
                  />
                </label>
                {error && (
                  <p className="form-error" role="alert">
                    {error}
                  </p>
                )}
                <button className="button primary" disabled={busy || !connected}>
                  {busy
                    ? 'Getting your room ready…'
                    : dialog === 'create'
                      ? 'Create room'
                      : 'Join room'}
                  <ChevronRight size={17} />
                </button>
              </form>
            ) : (
              state && (
                <div className="settings-form">
                  <label>
                    Who holds the remote?
                    <select
                      autoFocus
                      disabled={!isHost || !joined}
                      value={state.mode}
                      onChange={(e) =>
                        action({
                          type: 'settings',
                          mode: e.target.value as Mode,
                          queueEveryone: state.queueEveryone,
                        })
                      }
                    >
                      <option value="collaborative">Everyone — shared controls</option>
                      <option value="host">Host only — sit back and enjoy</option>
                      <option value="hybrid">Everyone plays; host picks videos</option>
                    </select>
                  </label>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      disabled={!isHost || !joined}
                      checked={state.queueEveryone}
                      onChange={(e) =>
                        action({
                          type: 'settings',
                          mode: state.mode,
                          queueEveryone: e.target.checked,
                        })
                      }
                    />
                    Let everyone edit the queue
                  </label>
                  {isHost && (
                    <label>
                      Pass the host role
                      <select
                        value=""
                        disabled={!joined}
                        onChange={(e) => {
                          if (e.target.value)
                            action({ type: 'transfer', participantId: e.target.value });
                        }}
                      >
                        <option value="">Choose a friend…</option>
                        {online
                          .filter((p) => p.id !== pid)
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                      </select>
                    </label>
                  )}
                  <label>
                    Sync sensitivity <span className="muted">(this device)</span>
                    <select
                      value={tolerance}
                      onChange={(e) => {
                        setTolerance(+e.target.value);
                        localStorage.setItem('syncwave-tolerance', e.target.value);
                      }}
                    >
                      <option value="0.15">Tight — 150 ms tolerance</option>
                      <option value="0.25">Balanced — 250 ms tolerance</option>
                      <option value="0.5">Relaxed — 500 ms tolerance</option>
                    </select>
                  </label>
                  <button
                    className="button secondary"
                    onClick={() => {
                      setDebug(true);
                      setDialog(null);
                    }}
                  >
                    <Activity size={16} />
                    Open sync diagnostics
                  </button>
                  <p className="muted">
                    {isHost
                      ? 'You’re the host. Your friends bring the good taste.'
                      : 'Only the host can change shared room settings.'}
                  </p>
                </div>
              )
            )}
          </section>
        </div>
      )}
      {invite.startsWith('http') && (
        <div className="clipboard-fallback">
          <label>
            Copy this invite link
            <input readOnly value={invite} onFocus={(e) => e.target.select()} />
          </label>
          <button className="icon-button" onClick={() => setInvite('')} aria-label="Close invite">
            <X size={18} />
          </button>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <Activity size={17} />
          {toast}
          <button aria-label="Dismiss notification" onClick={() => setToast('')}>
            <X size={15} />
          </button>
        </div>
      )}
      {reaction && <div className="reaction-float">{reaction}</div>}
      {error && !dialog && (
        <div className="connection-error" role="alert">
          {error}
          <button onClick={() => setError('')} aria-label="Dismiss error">
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
