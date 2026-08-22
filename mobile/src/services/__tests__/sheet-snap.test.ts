import { resolveSheetSnap } from '@/services/sheet-snap';

/** The Today sheet's real travel on a notched phone, so the numbers below mean something. */
const travel = 326;

describe('resolveSheetSnap', () => {
  it('falls back to where the drag stopped when it stopped', () => {
    expect(resolveSheetSnap({ progress: 0.2, velocityY: 0, travel })).toBe('collapsed');
    expect(resolveSheetSnap({ progress: 0.8, velocityY: 0, travel })).toBe('expanded');
  });

  it('opens on the midpoint rather than closing on it', () => {
    expect(resolveSheetSnap({ progress: 0.5, velocityY: 0, travel })).toBe('expanded');
    expect(resolveSheetSnap({ progress: 0.49, velocityY: 0, travel })).toBe('collapsed');
  });

  it('commits a flick that barely travelled', () => {
    // The whole reason velocity is read at all: forty points of an upward throw is a
    // decision, and a distance-only rule would drop the sheet back down.
    expect(resolveSheetSnap({ progress: 0.12, velocityY: -1800, travel })).toBe('expanded');
    expect(resolveSheetSnap({ progress: 0.88, velocityY: 1800, travel })).toBe('collapsed');
  });

  it('lets a flick beat the position it was thrown from', () => {
    expect(resolveSheetSnap({ progress: 0.95, velocityY: 900, travel })).toBe('collapsed');
    expect(resolveSheetSnap({ progress: 0.05, velocityY: -900, travel })).toBe('expanded');
  });

  it('projects a slow drag forward instead of freezing it at the finger', () => {
    // Just short of the midpoint but still moving up: 0.45 + (300/326 * 0.12) ≈ 0.56.
    expect(resolveSheetSnap({ progress: 0.45, velocityY: -300, travel })).toBe('expanded');
    // Same position, drifting back down.
    expect(resolveSheetSnap({ progress: 0.55, velocityY: 300, travel })).toBe('collapsed');
  });

  it('does not let a crawl override the position', () => {
    expect(resolveSheetSnap({ progress: 0.2, velocityY: -40, travel })).toBe('collapsed');
    expect(resolveSheetSnap({ progress: 0.8, velocityY: 40, travel })).toBe('expanded');
  });

  it('rests rather than dividing by a travel it has not been given', () => {
    expect(resolveSheetSnap({ progress: 0, velocityY: -100, travel: 0 })).toBe('collapsed');
  });
});
