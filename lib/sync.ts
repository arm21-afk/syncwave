import type { RoomState } from './protocol';
export const defaultSync = { tiny: 0.25, large: 1.2, interval: 1000, cooldown: 3000 };
export function targetPosition(
  state: Pick<RoomState, 'position' | 'updatedAt' | 'playing' | 'rate'>,
  serverNow: number,
) {
  return Math.max(
    0,
    state.position +
      (state.playing ? (Math.max(0, serverNow - state.updatedAt) / 1000) * state.rate : 0),
  );
}
export function correction(
  drift: number,
  playing: boolean,
  baseRate: number,
  rates: number[],
  tolerance = defaultSync.tiny,
): { kind: 'none' | 'seek' | 'rate'; rate?: number } {
  if (Math.abs(drift) <= tolerance) return { kind: 'none' };
  if (!playing || Math.abs(drift) >= defaultSync.large) return { kind: 'seek' };
  const desired = baseRate + (drift > 0 ? 0.05 : -0.05);
  const supported = rates.find((r) => Math.abs(r - desired) < 0.015);
  // YouTube usually offers only coarse rates: wait until the hard threshold instead of audible 25% changes.
  return supported ? { kind: 'rate', rate: supported } : { kind: 'none' };
}
export class ClockEstimator {
  samples: { rtt: number; offset: number }[] = [];
  add(sent: number, received: number, server: number) {
    this.samples.push({ rtt: received - sent, offset: server - (sent + received) / 2 });
    this.samples = this.samples.slice(-12);
  }
  get best() {
    return [...this.samples].sort((a, b) => a.rtt - b.rtt)[0] ?? { rtt: 0, offset: 0 };
  }
}
