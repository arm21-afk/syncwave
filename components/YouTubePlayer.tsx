'use client';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Action, RoomState } from '../lib/protocol';
import { correction, defaultSync, targetPosition } from '../lib/sync';
export type PlayerHandle = {
  current: () => number;
  duration: () => number;
  join: () => void;
  fullscreen: () => void;
  volume: (n: number) => void;
};
export type Diagnostics = {
  drift: number;
  corrections: number;
  status: string;
  position: number;
  duration: number;
};
let api: Promise<void> | undefined;
declare global {
  interface Window {
    onYouTubeIframeAPIReady: () => void;
  }
}
function loadAPI() {
  if (window.YT?.Player) return Promise.resolve();
  if (!api)
    api = new Promise<void>((resolve, reject) => {
      window.onYouTubeIframeAPIReady = () => resolve();
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.onerror = () =>
        reject(Error('YouTube could not be reached. Check your network and reload.'));
      document.head.append(script);
      setTimeout(() => {
        if (!window.YT?.Player)
          reject(Error('YouTube took too long to load. Check your connection and reload.'));
      }, 15000);
    });
  return api;
}
const errors: Record<number, string> = {
  2: 'Invalid video ID.',
  5: 'This browser could not play the video.',
  100: 'This video is unavailable or private.',
  101: 'The owner disabled embedding. Try a different video.',
  150: 'The owner disabled embedding. Try a different video.',
  153: 'YouTube could not verify this embed. Disable referrer-blocking extensions or open the app directly.',
};
export const YouTubePlayer = forwardRef<
  PlayerHandle,
  {
    state: RoomState;
    offset: number;
    tolerance: number;
    connected: boolean;
    isHost: boolean;
    onAction: (a: Action) => void;
    onDiagnostics: (d: Diagnostics) => void;
  }
>(function YouTubePlayer(props, ref) {
  const mount = useRef<HTMLDivElement>(null),
    shell = useRef<HTMLDivElement>(null),
    player = useRef<YT.Player | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [error, setError] = useState(''),
    [blocked, setBlocked] = useState(false),
    [ready, setReady] = useState(false);
  const mutedUntil = useRef(0),
    lastCorrection = useRef(0),
    correctionCount = useRef(0),
    loaded = useRef<string | null>(null);
  const previous = useRef<{ at: number; position: number } | null>(null);
  const reconcile = useRef<(force?: boolean) => void>(() => {});
  useImperativeHandle(
    ref,
    () => ({
      current: () => player.current?.getCurrentTime?.() || 0,
      duration: () => player.current?.getDuration?.() || 0,
      join: () => {
        setBlocked(false);
        player.current?.playVideo();
        reconcile.current(true);
      },
      fullscreen: () => {
        void shell.current?.requestFullscreen().catch(() => {});
      },
      volume: (n) => player.current?.setVolume(n),
    }),
    [],
  );
  useEffect(() => {
    let disposed = false;
    let deviceReady = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    void loadAPI()
      .then(() => {
        if (disposed || !mount.current) return;
        const node = document.createElement('div');
        mount.current.append(node);
        const p = new YT.Player(node, {
          width: '100%',
          height: '100%',
          playerVars: { playsinline: 1, controls: 1, rel: 0, origin: location.origin },
          events: {
            onReady: () => {
              if (disposed) return;
              deviceReady = true;
              setReady(true);
              reconcile.current(true);
            },
            onAutoplayBlocked: () => setBlocked(true),
            onError: (e) => setError(errors[e.data] || 'Playback failed. Try another video.'),
            onStateChange: (e) => {
              if (disposed || Date.now() < mutedUntil.current || !latest.current.connected) return;
              const s = latest.current.state;
              if (e.data === YT.PlayerState.ENDED && s.videoId && latest.current.isHost)
                latest.current.onAction({ type: 'ended', videoId: s.videoId });
              if (e.data === YT.PlayerState.PLAYING && !s.playing)
                latest.current.onAction({ type: 'play' });
              if (e.data === YT.PlayerState.PAUSED && s.playing)
                latest.current.onAction({ type: 'pause' });
            },
            onPlaybackRateChange: (e) => {
              if (
                Date.now() >= mutedUntil.current &&
                [0.5, 0.75, 1, 1.25, 1.5, 2].includes(e.data) &&
                e.data !== latest.current.state.rate
              )
                latest.current.onAction({ type: 'rate', rate: e.data as 1 });
            },
          },
        });
        player.current = p;
        reconcile.current = (force = false) => {
          const { state: s, offset, tolerance, connected } = latest.current;
          if (disposed || !deviceReady || !p.getPlayerState || !connected || !s.videoId) return;
          const now = Date.now(),
            target = targetPosition(s, now + offset),
            pos = p.getCurrentTime() || 0;
          if (loaded.current !== s.videoId) {
            loaded.current = s.videoId;
            setError('');
            setBlocked(false);
            mutedUntil.current = now + 2000;
            previous.current = null;
            if (s.playing) p.loadVideoById({ videoId: s.videoId, startSeconds: target });
            else p.cueVideoById({ videoId: s.videoId, startSeconds: target });
            return;
          }
          const status = p.getPlayerState(),
            buffering = status === YT.PlayerState.BUFFERING || status === YT.PlayerState.UNSTARTED;
          // The iframe API can expose its methods before video metadata is populated.
          // Wait for a concrete device state and normalize missing speed capabilities.
          if (!Number.isFinite(status) || buffering) return;
          const rawRates = p.getAvailablePlaybackRates?.();
          const rates = Array.isArray(rawRates) ? rawRates : [1];
          const playbackRate = p.getPlaybackRate?.();
          // Infer an explicit seek from discontinuity of the observed player clock, never from network drift alone.
          const prior = previous.current,
            elapsed = prior ? (now - prior.at) / 1000 : 0;
          if (
            !force &&
            prior &&
            elapsed < 2 &&
            now > mutedUntil.current &&
            Math.abs(pos - prior.position - (status === 1 ? elapsed * s.rate : 0)) > 1.6
          ) {
            previous.current = { at: now, position: pos };
            latest.current.onAction({ type: 'seek', position: pos });
            return;
          }
          const drift = target - pos,
            decision = correction(drift, s.playing, s.rate, rates, tolerance);
          if (
            (force && Math.abs(drift) > tolerance) ||
            (decision.kind === 'seek' && now - lastCorrection.current > defaultSync.cooldown)
          ) {
            mutedUntil.current = now + 1500;
            lastCorrection.current = now;
            correctionCount.current++;
            p.seekTo(target, true);
          } else if (decision.kind === 'rate' && decision.rate !== playbackRate) {
            mutedUntil.current = now + 1500;
            p.setPlaybackRate(decision.rate!);
          } else if (
            Math.abs(drift) < tolerance &&
            Number.isFinite(playbackRate) &&
            playbackRate !== s.rate &&
            rates.includes(s.rate)
          ) {
            mutedUntil.current = now + 1500;
            p.setPlaybackRate(s.rate);
          }
          if (s.playing && status !== YT.PlayerState.PLAYING) {
            mutedUntil.current = now + 1500;
            p.playVideo();
          }
          if (!s.playing && status === YT.PlayerState.PLAYING) {
            mutedUntil.current = now + 1500;
            p.pauseVideo();
          }
          previous.current = { at: now, position: p.getCurrentTime() || 0 };
          latest.current.onDiagnostics({
            drift: drift * 1000,
            corrections: correctionCount.current,
            status: Math.abs(drift) <= tolerance ? 'Synced' : 'Catching up',
            position: pos,
            duration: p.getDuration() || 0,
          });
        };
        timer = setInterval(() => reconcile.current(), defaultSync.interval);
      })
      .catch((e) => {
        if (!disposed) setError(e.message);
      });
    const wake = () => {
      previous.current = null;
      reconcile.current(true);
    };
    document.addEventListener('visibilitychange', wake);
    return () => {
      disposed = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', wake);
      player.current?.destroy();
      player.current = null;
    };
  }, []);
  useEffect(() => {
    if (ready) reconcile.current(true);
  }, [props.state.version, props.state.videoId, props.connected, ready]);
  return (
    <div className="player-shell" ref={shell}>
      <div ref={mount} className="youtube-mount" />
      {(!ready || error) && (
        <div className="player-notice">
          <span className="mini-wave">◖◖◖</span>
          <h3>{error ? 'A little playback trouble' : 'Connecting to YouTube'}</h3>
          <p>{error || 'Getting your front-row seat ready…'}</p>
          {error && (
            <button className="button secondary" onClick={() => location.reload()}>
              Reload player
            </button>
          )}
        </div>
      )}
      {blocked && !error && (
        <div className="autoplay">
          <button
            className="button primary"
            onClick={() => {
              setBlocked(false);
              player.current?.playVideo();
              reconcile.current(true);
            }}
          >
            ▶ Join playback
          </button>
          <small>Your browser needs a click to enable sound.</small>
        </div>
      )}
    </div>
  );
});
