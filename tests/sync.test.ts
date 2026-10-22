import { describe, it, expect } from 'vitest';
import { ClockEstimator, correction, targetPosition } from '../lib/sync';
import { videoId } from '../lib/youtube';
describe('YouTube parsing', () => {
  it.each([
    'abcdefghijk',
    'https://youtu.be/abcdefghijk?t=30',
    'https://www.youtube.com/watch?v=abcdefghijk&list=PL123',
    'https://youtube.com/shorts/abcdefghijk',
    'https://music.youtube.com/watch?v=abcdefghijk',
    'https://youtube.com/embed/abcdefghijk',
  ])('accepts %s', (input) => expect(videoId(input)).toBe('abcdefghijk'));
  it.each([
    '',
    'javascript:alert(1)',
    'https://youtube.com.evil.com/watch?v=abcdefghijk',
    'https://evil.com/abcdefghijk',
    'https://youtube.com/watch?v=abc',
    'https://user@youtube.com/watch?v=abcdefghijk',
    'https://youtube.com/playlist?list=PL123',
  ])('rejects %s', (input) => expect(videoId(input)).toBeNull());
});
describe('device reconciliation with mocked player observations', () => {
  const state = { position: 10, playing: true, rate: 1, updatedAt: 1000 };
  const mock = {
    current: 10.05,
    rates: [0.5, 1, 1.5, 2],
    seekTo(n: number) {
      this.current = n;
    },
  };
  it('projects playing state with server time, keeps paused state fixed', () => {
    expect(targetPosition(state, 3000)).toBe(12);
    expect(targetPosition({ ...state, playing: false }, 3000)).toBe(10);
    expect(targetPosition(state, 500)).toBe(10);
  });
  it('ignores tiny drift, avoids coarse rate changes, seeks large drift', () => {
    expect(correction(10 - mock.current, true, 1, mock.rates).kind).toBe('none');
    expect(correction(0.6, true, 1, mock.rates).kind).toBe('none');
    const target = targetPosition(state, 4000);
    if (correction(target - mock.current, true, 1, mock.rates).kind === 'seek') mock.seekTo(target);
    expect(mock.current).toBe(13);
  });
  it('aligns paused devices and only uses supported gentle rates', () => {
    expect(correction(0.5, false, 1, mock.rates).kind).toBe('seek');
    expect(correction(0.5, true, 1, [1, 1.05])).toEqual({ kind: 'rate', rate: 1.05 });
    expect(correction(-0.5, true, 1, [0.95, 1])).toEqual({ kind: 'rate', rate: 0.95 });
  });
  it('estimates clock offset using the lowest round-trip sample', () => {
    const c = new ClockEstimator();
    c.add(1000, 1200, 1150);
    c.add(2000, 2020, 2060);
    expect(c.best).toEqual({ rtt: 20, offset: 50 });
  });
});
