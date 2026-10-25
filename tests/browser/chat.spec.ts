import { test, expect, type Browser, type Page } from '@playwright/test';
import { mockYouTube } from './helpers';

async function room(browser: Browser) {
  const a = await browser.newContext(),
    b = await browser.newContext();
  await mockYouTube(a);
  await mockYouTube(b);
  const host = await a.newPage(),
    friend = await b.newPage();
  await host.goto('/');
  await host.getByRole('button', { name: 'Create a room', exact: true }).click();
  await host.getByLabel('Your display name').fill('Alex');
  await host.getByRole('button', { name: 'Create room', exact: true }).click();
  await expect(host.getByRole('heading', { name: 'The listening room' })).toBeVisible();
  await friend.goto(host.url());
  await friend.getByLabel('Your display name').fill('Jamie');
  await friend.getByRole('button', { name: 'Join room', exact: true }).click();
  await expect(friend.locator('.person').filter({ hasText: 'Alex' })).toBeVisible();
  await host.getByLabel('YouTube URL').fill('abcdefghijk');
  await host.getByRole('button', { name: 'Add to queue', exact: true }).click();
  await expect(friend.getByRole('heading', { name: 'Together — test video' })).toBeVisible();
  await host.getByRole('button', { name: 'Open chat', exact: true }).click();
  return {
    host,
    friend,
    a,
    b,
    close: async () => {
      await a.close();
      await b.close();
    },
  };
}
async function send(page: Page, text: string) {
  await page.getByLabel('Chat message', { exact: true }).fill(text);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByLabel('Chat message', { exact: true })).toHaveValue('');
}
const overlays = (page: Page) =>
  page.getByRole('region', { name: 'Player chat notifications', exact: true });

test('fullscreen includes incoming chat and playback controls without remounting the video', async ({
  browser,
}) => {
  const t = await room(browser);
  try {
    await t.host.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(t.friend.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    await expect(t.friend.locator('[data-iframe-fullscreen]')).toHaveAttribute(
      'data-iframe-fullscreen',
      '0',
    );
    await t.friend.getByRole('button', { name: 'Fullscreen', exact: true }).click();
    await expect
      .poll(() => t.friend.evaluate(() => document.fullscreenElement?.className))
      .toBe('screen-frame');
    await expect(
      t.friend.getByRole('button', { name: 'Exit fullscreen', exact: true }),
    ).toBeVisible();
    await send(t.host, 'Hello in fullscreen 💜');
    await expect(overlays(t.friend)).toContainText('Hello in fullscreen 💜');
    expect(
      await overlays(t.friend).evaluate((el) => document.fullscreenElement?.contains(el)),
    ).toBe(true);
    const fullscreenBounds = await t.friend.locator('.screen-frame').boundingBox();
    const card = await overlays(t.friend).locator('article').boundingBox();
    expect(card!.x + card!.width).toBeLessThanOrEqual(fullscreenBounds!.width + 1);
    expect(card!.y + card!.height).toBeLessThan(fullscreenBounds!.height - 60);
    await t.friend.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(t.host.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    const position = Number(await t.friend.getByLabel('Seek position').inputValue());
    await t.friend.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
    await expect.poll(() => t.friend.evaluate(() => document.fullscreenElement)).toBeNull();
    await expect(t.friend.getByRole('button', { name: 'Fullscreen', exact: true })).toBeVisible();
    expect(Number(await t.friend.getByLabel('Seek position').inputValue())).toBeGreaterThanOrEqual(
      position - 1,
    );
    // Repeated entry and browser-initiated exit restore the correct control state.
    await t.friend.getByRole('button', { name: 'Fullscreen', exact: true }).click();
    await expect
      .poll(() => t.friend.evaluate(() => document.fullscreenElement?.className))
      .toBe('screen-frame');
    await t.friend.evaluate(() => document.exitFullscreen());
    await expect(t.friend.getByRole('button', { name: 'Fullscreen', exact: true })).toBeVisible();
  } finally {
    await t.close();
  }
});

test('incoming messages overlay the player, queue without replacing, and expire', async ({
  browser,
}) => {
  const t = await room(browser);
  try {
    // Freeze only the receiving device's timers; real sockets still deliver the messages.
    // This keeps slow CI/browser actions from consuming the notification lifetime.
    await t.friend.clock.install({ time: new Date('2026-10-25T00:00:00Z') });
    await t.friend.clock.pauseAt(new Date('2026-10-25T00:00:01Z'));
    for (let i = 1; i <= 4; i++) await send(t.host, `Burst ${i} 💜`);
    const cards = overlays(t.friend).locator('article');
    await expect(cards).toHaveCount(3);
    await expect(cards.first()).toContainText('Burst 1');
    await expect(cards.last()).toContainText('Burst 3');
    await expect(overlays(t.host).locator('article')).toHaveCount(0);
    const card = await cards.last().boundingBox(),
      player = await t.friend.locator('.player-shell').boundingBox();
    expect(card && player).toBeTruthy();
    expect(card!.x).toBeGreaterThan(player!.x + player!.width / 2 - 10);
    expect(card!.x + card!.width).toBeLessThanOrEqual(player!.x + player!.width);
    expect(card!.y + card!.height).toBeLessThan(player!.y + player!.height - 45);
    await t.friend.clock.fastForward(5001);
    await expect(overlays(t.friend)).toContainText('Burst 4');
    await expect(cards).toHaveCount(1);
    await t.friend.clock.fastForward(5001);
    await expect(cards).toHaveCount(0);
  } finally {
    await t.close();
  }
});

test('settings, multiline text, history restore, and chat preserve shared playback', async ({
  browser,
}) => {
  const t = await room(browser);
  try {
    await t.host.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(t.friend.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    await t.host.getByLabel('Chat message').fill('Line one');
    await t.host.getByLabel('Chat message').press('Shift+Enter');
    await t.host.getByLabel('Chat message').pressSequentially('Line two 🎵');
    await t.host.getByLabel('Chat message').press('Enter');
    await expect(overlays(t.friend)).toContainText('Line two 🎵');
    await t.friend.getByRole('button', { name: 'Open chat', exact: true }).click();
    await t.friend.getByText('Player notification settings', { exact: true }).click();
    await t.friend.getByLabel('Floating chat notifications', { exact: true }).uncheck();
    await expect(overlays(t.friend).locator('article')).toHaveCount(0);
    await send(t.host, 'Still in the chat');
    await expect(t.friend.getByRole('log', { name: 'Room messages' })).toContainText(
      'Still in the chat',
    );
    await expect(overlays(t.friend).locator('article')).toHaveCount(0);
    await t.friend.getByLabel('Floating chat notifications', { exact: true }).check();
    await t.friend.getByLabel('Show my own messages', { exact: true }).check();
    await send(t.friend, 'My own message');
    await expect(overlays(t.friend)).toContainText('My own message');
    await t.friend
      .getByRole('button', { name: 'Clear visible notifications', exact: true })
      .click();
    await expect(overlays(t.friend).locator('article')).toHaveCount(0);
    await t.friend.getByRole('button', { name: 'Close chat', exact: true }).click();
    await send(t.host, 'Panel closed, still here');
    await expect(overlays(t.friend)).toContainText('Panel closed, still here');
    await expect(t.friend.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    await t.friend.reload();
    await t.friend.getByRole('button', { name: 'Join room', exact: true }).click();
    await expect(t.friend.getByRole('heading', { name: 'Together — test video' })).toBeVisible();
    await t.friend.getByRole('button', { name: 'Open chat', exact: true }).click();
    await expect(t.friend.getByRole('log', { name: 'Room messages' })).toContainText(
      'Panel closed, still here',
    );
    await expect(overlays(t.friend).locator('article')).toHaveCount(0);
    await t.friend.getByText('Player notification settings', { exact: true }).click();
    await expect(t.friend.getByLabel('Show my own messages', { exact: true })).toBeChecked();
    await t.friend.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(t.host.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  } finally {
    await t.close();
  }
});

test('older-message scroll is preserved and mobile chat/long notifications fit', async ({
  browser,
}) => {
  const t = await room(browser);
  try {
    await t.friend.getByRole('button', { name: 'Open chat', exact: true }).click();
    for (let i = 0; i < 7; i++)
      await send(t.host, `Older ${i}: ` + 'a longer message 💜 '.repeat(23));
    const log = t.friend.getByRole('log', { name: 'Room messages' });
    await log.evaluate((el) => {
      el.scrollTop = 0;
      el.dispatchEvent(new Event('scroll'));
    });
    await send(t.host, 'New while reading');
    await expect(log).toContainText('New while reading');
    expect(await log.evaluate((el) => el.scrollTop)).toBeLessThan(10);
    await t.friend.getByRole('button', { name: /1 new message/ }).click();
    await expect
      .poll(() => log.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight))
      .toBeLessThan(60);
    await t.friend.setViewportSize({ width: 390, height: 844 });
    await t.friend.getByText('Player notification settings', { exact: true }).click();
    await t.friend.getByLabel('Show my own messages', { exact: true }).check();
    await t.friend
      .getByRole('button', { name: 'Clear visible notifications', exact: true })
      .click();
    await send(t.friend, '<script>' + 'x'.repeat(480));
    await expect(overlays(t.friend).locator('article')).toHaveCount(1);
    await expect(log).toContainText('<script>');
    await t.friend.getByRole('button', { name: 'Close chat', exact: true }).click();
    const stack = await overlays(t.friend).boundingBox(),
      player = await t.friend.locator('.player-shell').boundingBox();
    expect(stack!.x).toBeGreaterThanOrEqual(player!.x);
    expect(stack!.x + stack!.width).toBeLessThanOrEqual(player!.x + player!.width);
    expect(await t.friend.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  } finally {
    await t.close();
  }
});
