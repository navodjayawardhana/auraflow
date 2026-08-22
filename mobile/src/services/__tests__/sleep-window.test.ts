import { formatDuration, parseTimeOfDay, sleepMinutesBetween } from '@/services/sleep-window';

describe('parseTimeOfDay', () => {
  it('accepts a real time in either width', () => {
    expect(parseTimeOfDay('23:30')).toEqual({ hours: 23, minutes: 30 });
    expect(parseTimeOfDay('6:45')).toEqual({ hours: 6, minutes: 45 });
    expect(parseTimeOfDay('00:00')).toEqual({ hours: 0, minutes: 0 });
  });

  it('rejects a time that no clock shows', () => {
    expect(parseTimeOfDay('24:00')).toBeNull();
    expect(parseTimeOfDay('23:60')).toBeNull();
  });

  it('rejects a half-typed one rather than guessing at it', () => {
    expect(parseTimeOfDay('23')).toBeNull();
    expect(parseTimeOfDay('23:3')).toBeNull();
    expect(parseTimeOfDay('')).toBeNull();
  });
});

describe('sleepMinutesBetween', () => {
  it('wraps over midnight, which is the ordinary night', () => {
    expect(
      sleepMinutesBetween({ hours: 23, minutes: 30 }, { hours: 6, minutes: 45 }),
    ).toBe(435); // 7h 15m
  });

  it('handles a night that does not cross midnight', () => {
    expect(sleepMinutesBetween({ hours: 1, minutes: 0 }, { hours: 8, minutes: 30 })).toBe(450);
  });

  it('handles an afternoon nap', () => {
    expect(sleepMinutesBetween({ hours: 13, minutes: 0 }, { hours: 14, minutes: 0 })).toBe(60);
  });

  it('reads two identical times as nothing, not as a full day', () => {
    // Someone who enters the same time twice has mistyped. Twenty-four hours of sleep is
    // not the charitable reading, and it would sail through the API's 0-1440 range.
    expect(sleepMinutesBetween({ hours: 7, minutes: 0 }, { hours: 7, minutes: 0 })).toBe(0);
  });

  it('is exact at the midnight boundary', () => {
    expect(sleepMinutesBetween({ hours: 0, minutes: 0 }, { hours: 0, minutes: 1 })).toBe(1);
    expect(sleepMinutesBetween({ hours: 23, minutes: 59 }, { hours: 0, minutes: 0 })).toBe(1);
  });
});

describe('formatDuration', () => {
  it('shows hours and minutes', () => {
    expect(formatDuration(435)).toBe('7h 15m');
  });

  it('drops the empty half of the pair', () => {
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(480)).toBe('8h');
  });
});
