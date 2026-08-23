import {
  isWithinQuietHours,
  nextOccurrence,
  planOccurrences,
  REMINDERS,
  reminderFor,
  upcomingOccurrences,
  type QuietHours,
} from '@/services/reminder-schedule';

/**
 * A local instant, built from calendar fields so the tests mean the same thing wherever
 * they run. `new Date(2026, 7, 22, 6, 30)` is 06:30 on the machine's own clock; an ISO
 * string with a `Z` would not be.
 */
const at = (
  year: number,
  month: number,
  day: number,
  hours = 0,
  minutes = 0,
): Date => new Date(year, month - 1, day, hours, minutes, 0, 0);

const quiet = (start: [number, number], end: [number, number]): QuietHours => ({
  isEnabled: true,
  start: { hours: start[0], minutes: start[1] },
  end: { hours: end[0], minutes: end[1] },
});

const OFF: QuietHours = { isEnabled: false, start: { hours: 0, minutes: 0 }, end: { hours: 0, minutes: 0 } };

describe('nextOccurrence', () => {
  it('finds a time still to come today', () => {
    const result = nextOccurrence({ hours: 7, minutes: 0 }, at(2026, 8, 22, 6, 30));

    expect(result).toEqual(at(2026, 8, 22, 7, 0));
  });

  it('rolls to tomorrow once the time has passed', () => {
    const result = nextOccurrence({ hours: 7, minutes: 0 }, at(2026, 8, 22, 7, 1));

    expect(result).toEqual(at(2026, 8, 23, 7, 0));
  });

  it('treats the exact moment as passed, so re-planning as one fires does not duplicate it', () => {
    const result = nextOccurrence({ hours: 7, minutes: 0 }, at(2026, 8, 22, 7, 0));

    expect(result).toEqual(at(2026, 8, 23, 7, 0));
  });

  it('crosses a month end', () => {
    expect(nextOccurrence({ hours: 9, minutes: 0 }, at(2026, 8, 31, 10, 0))).toEqual(
      at(2026, 9, 1, 9, 0),
    );
  });

  it('crosses a year end', () => {
    expect(nextOccurrence({ hours: 9, minutes: 0 }, at(2026, 12, 31, 10, 0))).toEqual(
      at(2027, 1, 1, 9, 0),
    );
  });

  it('crosses a leap day rather than skipping it', () => {
    expect(nextOccurrence({ hours: 9, minutes: 0 }, at(2028, 2, 28, 10, 0))).toEqual(
      at(2028, 2, 29, 9, 0),
    );
  });

  /**
   * The daylight-saving guarantee, asserted as the invariant it actually is rather than
   * against one hardcoded zone.
   *
   * A reminder set for 07:00 must read 07:00 on the wall in every zone, on every day,
   * including the two each year that are 23 and 25 hours long. Walking a full year forward
   * puts every transition the runner's own zone observes inside the loop — northern or
   * southern hemisphere, or none at all if the runner sits in UTC. Anything that advanced by
   * a fixed 86,400,000 ms would come out an hour off for half the year and fail here.
   */
  it('holds the wall-clock time through a whole year, DST transitions included', () => {
    let cursor = at(2026, 1, 1, 0, 0);

    for (let day = 0; day < 365; day++) {
      cursor = nextOccurrence({ hours: 7, minutes: 0 }, cursor);

      expect(cursor.getHours()).toBe(7);
      expect(cursor.getMinutes()).toBe(0);
    }
  });

  it('always moves forward', () => {
    const from = at(2026, 3, 28, 12, 0);
    const result = nextOccurrence({ hours: 2, minutes: 30 }, from);

    // 02:30 does not exist on a spring-forward morning. Whatever the platform resolves it
    // to, it must still be a real instant in the future — never NaN, never the past.
    expect(Number.isNaN(result.getTime())).toBe(false);
    expect(result.getTime()).toBeGreaterThan(from.getTime());
  });
});

describe('isWithinQuietHours', () => {
  const overnight = quiet([22, 0], [7, 0]);

  it('catches a time inside a window that wraps midnight', () => {
    expect(isWithinQuietHours({ hours: 23, minutes: 30 }, overnight)).toBe(true);
    expect(isWithinQuietHours({ hours: 3, minutes: 0 }, overnight)).toBe(true);
  });

  it('lets a daytime through', () => {
    expect(isWithinQuietHours({ hours: 14, minutes: 0 }, overnight)).toBe(false);
    expect(isWithinQuietHours({ hours: 21, minutes: 30 }, overnight)).toBe(false);
  });

  it('is half-open, so a reminder set for the moment quiet hours end still fires', () => {
    // The ordinary configuration: quiet until 07:00, check-in at 07:00.
    expect(isWithinQuietHours({ hours: 7, minutes: 0 }, overnight)).toBe(false);
    expect(isWithinQuietHours({ hours: 22, minutes: 0 }, overnight)).toBe(true);
  });

  it('handles a window that does not wrap', () => {
    const daytime = quiet([9, 0], [17, 0]);

    expect(isWithinQuietHours({ hours: 12, minutes: 0 }, daytime)).toBe(true);
    expect(isWithinQuietHours({ hours: 8, minutes: 59 }, daytime)).toBe(false);
    expect(isWithinQuietHours({ hours: 17, minutes: 0 }, daytime)).toBe(false);
  });

  it('suppresses nothing when switched off', () => {
    expect(isWithinQuietHours({ hours: 3, minutes: 0 }, { ...overnight, isEnabled: false })).toBe(
      false,
    );
  });

  it('reads equal ends as no quiet period rather than as the whole day', () => {
    // Failing the other way would silently suppress every reminder the user had switched
    // on, and look exactly like notifications being broken.
    expect(isWithinQuietHours({ hours: 3, minutes: 0 }, quiet([22, 0], [22, 0]))).toBe(false);
  });
});

describe('upcomingOccurrences', () => {
  it('returns one firing per day, in order, tagged with its local date', () => {
    const result = upcomingOccurrences(
      'morning-checkin',
      { hours: 7, minutes: 0 },
      at(2026, 8, 22, 6, 0),
      3,
    );

    expect(result.map((o) => o.onDate)).toEqual(['2026-08-22', '2026-08-23', '2026-08-24']);
    expect(result.every((o) => o.at.getHours() === 7)).toBe(true);
  });

  it('starts tomorrow when today’s time has gone', () => {
    const result = upcomingOccurrences(
      'log-night',
      { hours: 21, minutes: 30 },
      at(2026, 8, 22, 22, 0),
      2,
    );

    expect(result.map((o) => o.onDate)).toEqual(['2026-08-23', '2026-08-24']);
  });
});

describe('planOccurrences', () => {
  const time = { hours: 7, minutes: 0 };
  const on = { isEnabled: true, time };
  const from = at(2026, 8, 22, 6, 0);

  it('places nothing for a reminder that is switched off', () => {
    expect(
      planOccurrences('morning-checkin', { isEnabled: false, time }, OFF, new Set(), from, 7),
    ).toEqual([]);
  });

  it('places nothing when the chosen time sits inside quiet hours', () => {
    // Dropped rather than shifted: a 03:00 check-in moved to 07:00 would be a different
    // measurement, and one the user never asked for.
    const result = planOccurrences(
      'morning-checkin',
      { isEnabled: true, time: { hours: 3, minutes: 0 } },
      quiet([22, 0], [7, 0]),
      new Set(),
      from,
      7,
    );

    expect(result).toEqual([]);
  });

  it('skips a day that has already been answered', () => {
    const result = planOccurrences(
      'morning-checkin',
      on,
      OFF,
      new Set(['2026-08-22', '2026-08-24']),
      from,
      4,
    );

    expect(result.map((o) => o.onDate)).toEqual(['2026-08-23', '2026-08-25']);
  });

  it('skips today without disturbing the rest of the horizon', () => {
    const result = planOccurrences('morning-checkin', on, OFF, new Set(['2026-08-22']), from, 7);

    expect(result).toHaveLength(6);
    expect(result[0].onDate).toBe('2026-08-23');
  });

  it('fills the horizon when nothing suppresses it', () => {
    expect(planOccurrences('morning-checkin', on, OFF, new Set(), from, 7)).toHaveLength(7);
  });
});

describe('REMINDERS', () => {
  it('defaults on exactly the two reminders a measurement depends on', () => {
    const on = REMINDERS.filter((r) => r.isOnByDefault).map((r) => r.kind);

    // The optional two stay off. This is a product decision the tests are allowed to guard:
    // a health app that arrives nagging is one people delete.
    expect(on.sort()).toEqual(['log-night', 'morning-checkin']);
  });

  it('gives every kind its own Android channel', () => {
    const channels = REMINDERS.map((r) => r.channelId);

    expect(new Set(channels).size).toBe(REMINDERS.length);
  });

  it('resolves every kind it declares', () => {
    for (const definition of REMINDERS) {
      expect(reminderFor(definition.kind)).toBe(definition);
    }
  });

  it('throws on a kind left behind by an older build rather than returning undefined', () => {
    expect(() => reminderFor('retired-kind' as never)).toThrow(/Unknown reminder kind/);
  });
});
