import { test, expect } from '@playwright/test';
import { mockYouTube } from './helpers';
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
    .toBeGreaterThan(1);
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
  await expect(
    first
      .getByRole('log', { name: 'Room messages' })
      .getByText('Same wavelength!', { exact: true }),
  ).toBeVisible();
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
