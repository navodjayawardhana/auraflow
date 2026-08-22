import { monthGridFor, shiftMonth, WEEKDAY_INITIALS } from '@/services/month-grid';

/** Every date the grid holds, in order, with the padding dropped. */
function days(iso: string): string[] {
  return monthGridFor(iso)
    .weeks.flat()
    .filter((day): day is string => day !== null);
}

describe('monthGridFor', () => {
  it('is always six rows of seven, so the sheet does not change height', () => {
    for (const iso of ['2026-02-15', '2026-08-22', '2026-01-01']) {
      const { weeks } = monthGridFor(iso);

      expect(weeks).toHaveLength(6);
      for (const week of weeks) expect(week).toHaveLength(WEEKDAY_INITIALS.length);
    }
  });

  it('reports the month it was asked for, whatever day it was given', () => {
    expect(monthGridFor('2026-08-22').monthStart).toBe('2026-08-01');
    expect(monthGridFor('2026-08-01').monthStart).toBe('2026-08-01');
    expect(monthGridFor('2026-08-31').monthStart).toBe('2026-08-01');
  });

  it('holds every day of the month, once, in order', () => {
    // August 2026 has 31 days.
    const august = days('2026-08-10');

    expect(august).toHaveLength(31);
    expect(august[0]).toBe('2026-08-01');
    expect(august[30]).toBe('2026-08-31');
    expect(new Set(august).size).toBe(31);
  });

  it('starts the week on Monday', () => {
    // 1 August 2026 is a Saturday: five blanks, then the 1st in the sixth column.
    const [first] = monthGridFor('2026-08-01').weeks;

    expect(first.slice(0, 5)).toEqual([null, null, null, null, null]);
    expect(first[5]).toBe('2026-08-01');
    expect(first[6]).toBe('2026-08-02');
  });

  it('pads a month that begins on a Sunday with a full leading week', () => {
    // 1 February 2026 is a Sunday — the far end of a Monday-first week.
    const [first, second] = monthGridFor('2026-02-01').weeks;

    expect(first.slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(first[6]).toBe('2026-02-01');
    expect(second[0]).toBe('2026-02-02');
  });

  it('counts February correctly in a leap year and out of one', () => {
    expect(days('2028-02-01')).toHaveLength(29);
    expect(days('2026-02-01')).toHaveLength(28);
  });

  it('fits a 31-day month that starts late in the week', () => {
    // The case that needs all six rows: 5 leading blanks plus 31 days is 36 cells.
    const august = monthGridFor('2026-08-01');

    expect(august.weeks[5].some((day) => day !== null)).toBe(true);
  });
});

describe('shiftMonth', () => {
  it('moves a whole month at a time', () => {
    expect(shiftMonth('2026-08-22', -1)).toBe('2026-07-22');
    expect(shiftMonth('2026-08-22', 1)).toBe('2026-09-22');
  });

  it('crosses the year boundary in both directions', () => {
    expect(shiftMonth('2026-01-15', -1)).toBe('2025-12-15');
    expect(shiftMonth('2026-12-15', 1)).toBe('2027-01-15');
  });

  it('clamps to the last day rather than rolling into the month after', () => {
    // The bug this guards: `new Date(2026, 0, 31).setMonth(1)` is 3 March, so paging back
    // from the 31st would skip February altogether.
    expect(shiftMonth('2026-03-31', -1)).toBe('2026-02-28');
    expect(shiftMonth('2028-03-31', -1)).toBe('2028-02-29');
    expect(shiftMonth('2026-01-31', 1)).toBe('2026-02-28');
  });

  it('leaves a day every month has alone', () => {
    expect(shiftMonth('2026-03-15', -1)).toBe('2026-02-15');
  });
});
