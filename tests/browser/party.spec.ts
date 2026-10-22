import { test, expect, type BrowserContext } from '@playwright/test';
async function mockYouTube(context: BrowserContext, partialMetadata = false) {
  await context.route('**/api/video?*', (route) =>
    route.fulfill({ json: { title: 'Together — test video' } }),
  );
  await context.addInitScript((partialMetadata) => {
    type Opts = {
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

test('room survives delayed YouTube readiness and missing playback-rate metadata', async ({
  browser,
}) => {
  const context = await browser.newContext();
  await mockYouTube(context, true);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Create a room', exact: true }).click();
  await page.getByLabel('Your display name').fill('Loading check');
  await page.getByRole('button', { name: 'Create room', exact: true }).click();
  await page.getByLabel('YouTube URL').fill('abcdefghijk');
  await page.getByRole('button', { name: 'Add to queue', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Synced', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect
    .poll(async () => Number(await page.getByLabel('Seek position').inputValue()))
    .toBeGreaterThan(3);
  await expect(page.getByRole('heading', { name: 'Together — test video' })).toBeVisible();
  expect(errors).toEqual([]);
  await context.close();
});
test('two browsers create, join, synchronize controls and chat', async ({ browser }) => {
  const a = await browser.newContext(),
    b = await browser.newContext();
  await mockYouTube(a);
  await mockYouTube(b);
  const first = await a.newPage(),
    second = await b.newPage();
  await first.goto('/');
  await first.getByRole('button', { name: 'Create a room', exact: true }).click();
  await first.getByLabel('Your display name').fill('Alex');
  await first.getByRole('button', { name: 'Create room', exact: true }).click();
  await expect(first.getByRole('heading', { name: 'The listening room' })).toBeVisible();
  const invite = first.url();
  await second.goto(invite);
  await second.getByLabel('Your display name').fill('Jamie');
  await second.getByRole('button', { name: 'Join room', exact: true }).click();
  await expect(second.locator('.person').filter({ hasText: 'Alex' })).toBeVisible();
  await first.getByLabel('YouTube URL').fill('https://youtu.be/abcdefghijk');
  await first.getByRole('button', { name: 'Add to queue', exact: true }).click();
  await expect(second.getByRole('heading', { name: 'Together — test video' })).toBeVisible();
  await first.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(second.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await second.getByLabel('Seek position').fill('150');
  await second.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(first.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await expect
    .poll(async () => Number(await first.getByLabel('Seek position').inputValue()))
    .toBeGreaterThan(148);
  await first.getByRole('button', { name: /Room chat/ }).click();
  await second.getByRole('button', { name: /Room chat/ }).click();
  await second.getByLabel('Chat message').fill('Same wavelength!');
  await second.getByRole('button', { name: 'Send message' }).click();
  await expect(first.getByText('Same wavelength!', { exact: true })).toBeVisible();
  await b.close();
  await a.close();
});
test('mobile lobby has no horizontal overflow and validates URL input', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Different places/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Create a room', exact: true }).click();
  await page.getByLabel('Your display name').fill('Mobile');
  await page.getByRole('button', { name: 'Create room', exact: true }).click();
  await page.getByLabel('YouTube URL').fill('https://evil.com/video');
  await page.getByRole('button', { name: 'Add to queue', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('valid YouTube');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
