import { recentDates, todayIsoDate } from '@/services/recovery-service';

describe('todayIsoDate', () => {
  it('uses local calendar parts rather than UTC', () => {
    // 23:30 on the 21st in a timezone ahead of UTC is still the 22nd in UTC, so
    // toISOString() would report tomorrow and the app would ask for a night that has
    // not happened. The date shown to a user is always their own calendar date.
    const lateEvening = new Date(2026, 7, 21, 23, 30, 0);

    expect(todayIsoDate(lateEvening)).toBe('2026-08-21');
  });

  it('pads single-digit months and days', () => {
    expect(todayIsoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('recentDates', () => {
  it('returns the window oldest first, ending today', () => {
    const dates = recentDates(7, new Date(2026, 7, 21));

    expect(dates).toHaveLength(7);
    expect(dates[0]).toBe('2026-08-15');
    expect(dates[6]).toBe('2026-08-21');
  });

  it('crosses a month boundary correctly', () => {
    const dates = recentDates(4, new Date(2026, 8, 2));

    expect(dates).toEqual(['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02']);
  });

  it('crosses a leap-year February correctly', () => {
    const dates = recentDates(3, new Date(2028, 2, 1));

    expect(dates).toEqual(['2028-02-28', '2028-02-29', '2028-03-01']);
  });
});
