import type { BrowserContext } from '@playwright/test';
export async function mockYouTube(context: BrowserContext, partialMetadata = false) {
  await context.route('**/api/video?*', (route) =>
    route.fulfill({ json: { title: 'Together — test video' } }),
  );
  await context.addInitScript((partialMetadata) => {
    type Opts = {
      playerVars: { fs?: number };
      events: {
        onReady: () => void;
        onStateChange: (e: { data: number }) => void;
        onPlaybackRateChange: (e: { data: number }) => void;
      };
    };
    class MockPlayer {
      pos = 0;
      at = Date.now();
      status = 5;
      rate = 1;
      id = '';
      readyAt = Infinity;
      metadataAt = Infinity;
      opts: Opts;
      constructor(node: HTMLElement, opts: Opts) {
        this.opts = opts;
        node.textContent = 'YouTube player (deterministic test adapter)';
        node.style.padding = '40px';
        node.dataset.iframeFullscreen = String(opts.playerVars.fs);
        setTimeout(
          () => {
            this.readyAt = Date.now();
            opts.events.onReady();
          },
          partialMetadata ? 1200 : 20,
        );
      }
      getCurrentTime() {
        return this.pos + (this.status === 1 ? ((Date.now() - this.at) / 1000) * this.rate : 0);
      }
      getDuration() {
        return 300;
      }
      getPlayerState() {
        if (partialMetadata && Date.now() < this.readyAt) return undefined;
        return this.status;
      }
      getAvailablePlaybackRates() {
        if (partialMetadata && Date.now() < this.metadataAt) return undefined;
        return [0.5, 0.75, 1, 1.25, 1.5, 2];
      }
      getPlaybackRate() {
        if (partialMetadata && Date.now() < this.metadataAt) return undefined;
        return this.rate;
      }
      setPlaybackRate(n: number) {
        this.pos = this.getCurrentTime();
        this.at = Date.now();
        this.rate = n;
        this.opts.events.onPlaybackRateChange({ data: n });
      }
      getVideoData() {
        return { video_id: this.id };
      }
      seekTo(n: number) {
        this.pos = n;
        this.at = Date.now();
      }
      loadVideoById(v: { videoId: string; startSeconds: number }) {
        this.metadataAt = Date.now() + 2500;
        this.id = v.videoId;
        this.pos = v.startSeconds;
        this.at = Date.now();
        this.status = 1;
        this.opts.events.onStateChange({ data: 1 });
      }
      cueVideoById(v: { videoId: string; startSeconds: number }) {
        this.metadataAt = Date.now() + 2500;
        this.id = v.videoId;
        this.pos = v.startSeconds;
        this.at = Date.now();
        this.status = 5;
      }
      playVideo() {
        this.at = Date.now();
        this.status = 1;
        this.opts.events.onStateChange({ data: 1 });
      }
      pauseVideo() {
        this.pos = this.getCurrentTime();
        this.at = Date.now();
        this.status = 2;
        this.opts.events.onStateChange({ data: 2 });
      }
      setVolume() {}
      destroy() {}
    }
    Object.assign(window, {
      YT: {
        Player: MockPlayer,
        PlayerState: { PLAYING: 1, PAUSED: 2, ENDED: 0, BUFFERING: 3, UNSTARTED: -1, CUED: 5 },
      },
    });
  }, partialMetadata);
}
