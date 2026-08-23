import type { MealEntry, NutritionTotals } from '@/services/meal-service';
import {
  bandMeals,
  bandOf,
  composeEatenAt,
  groupByDay,
  isApproximate,
  isCurrent,
  isInFuture,
  macroCoverageNote,
  nowAsWheelTime,
  periodSubtitle,
  periodTitle,
  periodWindow,
  provenanceNote,
  retargetWindow,
  shiftPeriodWindow,
} from '@/services/nutrition-history';

/**
 * August 2026 begins on a Saturday and ends on a Monday, which makes it a good month for
 * catching an off-by-one at a week boundary: Monday the 17th opens a week that closes on
 * Sunday the 23rd, and Monday the 31st opens one that runs into September.
 */

function totals(overrides: Partial<NutritionTotals> = {}): NutritionTotals {
  return {
    kcal: 0,
    measured_kcal: 0,
    estimated_kcal: 0,
    meal_count: 0,
    measured_count: 0,
    estimated_count: 0,
    protein_g: 0,
    carbs_g: 0,
    fat_g: 0,
    meals_with_macros: 0,
    ...overrides,
  };
}

function meal(id: number, eatenOn: string, hour: number): MealEntry {
  return {
    id,
    name: `Meal ${id}`,
    kcal: 100,
    source: 'estimate',
    barcode: null,
    protein_g: null,
    carbs_g: null,
    fat_g: null,
    portion_g: null,
    // A local wall-clock time, which is what the band bands on.
    eaten_at: new Date(
      Number(eatenOn.slice(0, 4)),
      Number(eatenOn.slice(5, 7)) - 1,
      Number(eatenOn.slice(8, 10)),
      hour,
    ).toISOString(),
    eaten_on: eatenOn,
  };
}

describe('periodWindow', () => {
  it('makes a day window one day long', () => {
    expect(periodWindow('day', '2026-08-19')).toMatchObject({
      from: '2026-08-19',
      to: '2026-08-19',
    });
  });

  it('runs a week from Monday to Sunday, whichever day it was anchored on', () => {
    for (const anchor of ['2026-08-17', '2026-08-19', '2026-08-23']) {
      expect(periodWindow('week', anchor)).toMatchObject({
        from: '2026-08-17',
        to: '2026-08-23',
      });
    }
  });

  it('puts a Sunday in the week that opened the Monday before it', () => {
    // The boundary that moves a Sunday dinner a whole week if it is drawn on the wrong day.
    expect(periodWindow('week', '2026-08-23').from).toBe('2026-08-17');
    expect(periodWindow('week', '2026-08-24').from).toBe('2026-08-24');
  });

  it('lets a week straddle a month end, because a week is a week', () => {
    expect(periodWindow('week', '2026-09-01')).toMatchObject({
      from: '2026-08-31',
      to: '2026-09-06',
    });
  });

  it('runs a month from the first to the last of the calendar month', () => {
    expect(periodWindow('month', '2026-08-19')).toMatchObject({
      from: '2026-08-01',
      to: '2026-08-31',
    });
  });

  it('gives February its own length, leap year included', () => {
    expect(periodWindow('month', '2027-02-14').to).toBe('2027-02-28');
    expect(periodWindow('month', '2028-02-14').to).toBe('2028-02-29');
  });
});

describe('shiftPeriodWindow', () => {
  it('steps a day at a time', () => {
    const window = periodWindow('day', '2026-09-01');

    expect(shiftPeriodWindow(window, -1).from).toBe('2026-08-31');
    expect(shiftPeriodWindow(window, 1).from).toBe('2026-09-02');
  });

  it('steps a whole week, not seven days from the anchor', () => {
    const window = periodWindow('week', '2026-08-19');

    expect(shiftPeriodWindow(window, -1)).toMatchObject({
      from: '2026-08-10',
      to: '2026-08-16',
    });
  });

  it('does not skip February when stepping back from a 31-day month', () => {
    // `-1 month` from the 31st is the trap: it lands in the month before last.
    const march = periodWindow('month', '2027-03-31');

    expect(shiftPeriodWindow(march, -1)).toMatchObject({
      from: '2027-02-01',
      to: '2027-02-28',
    });
  });

  it('walks several periods without losing one', () => {
    const august = periodWindow('month', '2026-08-15');

    expect(shiftPeriodWindow(august, -3).from).toBe('2026-05-01');
    expect(shiftPeriodWindow(august, 4).from).toBe('2026-12-01');
  });

  it('stays put when asked for no steps at all', () => {
    const window = periodWindow('week', '2026-08-19');

    expect(shiftPeriodWindow(window, 0)).toEqual(window);
  });
});

describe('retargetWindow', () => {
  it('keeps today when the window being left contains it', () => {
    const month = periodWindow('month', '2026-08-01');

    expect(retargetWindow(month, 'day', '2026-08-19').from).toBe('2026-08-19');
  });

  it('keeps the anchor when the window being left is in the past', () => {
    // Someone looking at May and switching to the day view meant a day in May.
    const may = periodWindow('month', '2026-05-14');

    expect(retargetWindow(may, 'day', '2026-08-19').from).toBe('2026-05-14');
  });
});

describe('isCurrent', () => {
  it('is true only for the window today falls in', () => {
    expect(isCurrent(periodWindow('week', '2026-08-19'), '2026-08-23')).toBe(true);
    expect(isCurrent(periodWindow('week', '2026-08-19'), '2026-08-24')).toBe(false);
    expect(isCurrent(periodWindow('month', '2026-08-19'), '2026-08-31')).toBe(true);
    expect(isCurrent(periodWindow('month', '2026-08-19'), '2026-09-01')).toBe(false);
  });
});

describe('period labels', () => {
  it('names today and yesterday rather than dating them', () => {
    expect(periodTitle(periodWindow('day', '2026-08-22'), '2026-08-22')).toBe('Today');
    expect(periodTitle(periodWindow('day', '2026-08-21'), '2026-08-22')).toBe('Yesterday');
  });

  it('spells out the span a week total covers, so it can be reproduced', () => {
    const subtitle = periodSubtitle(periodWindow('week', '2026-08-19'), '2026-09-30');

    expect(subtitle).toContain('Monday to Sunday');
    expect(subtitle).not.toContain('so far');
  });

  it('says a calendar month is a calendar month, not the last thirty days', () => {
    expect(periodSubtitle(periodWindow('month', '2026-08-19'), '2026-09-30')).toContain(
      'Calendar month',
    );
  });

  it('marks a period still being lived through as incomplete', () => {
    expect(periodSubtitle(periodWindow('month', '2026-08-19'), '2026-08-22')).toContain('so far');
  });
});

describe('provenance', () => {
  it('calls any total with a guess in it approximate', () => {
    expect(isApproximate(totals({ kcal: 900, measured_kcal: 900 }))).toBe(false);
    expect(isApproximate(totals({ kcal: 900, measured_kcal: 700, estimated_kcal: 200 }))).toBe(true);
  });

  it('says nothing about a period with no meals in it', () => {
    expect(provenanceNote(totals())).toBeNull();
  });

  it('does not let three guesses read like three measurements', () => {
    const measured = totals({
      kcal: 1800,
      measured_kcal: 1800,
      meal_count: 3,
      measured_count: 3,
    });
    const guessed = totals({
      kcal: 1800,
      estimated_kcal: 1800,
      meal_count: 3,
      estimated_count: 3,
    });

    expect(provenanceNote(measured)).not.toBe(provenanceNote(guessed));
    expect(provenanceNote(guessed)).toContain('estimate');
  });

  it('quantifies the split when a total is part measured and part guessed', () => {
    const note = provenanceNote(
      totals({
        kcal: 1800,
        measured_kcal: 600,
        estimated_kcal: 1200,
        meal_count: 6,
        measured_count: 3,
        estimated_count: 3,
      }),
    );

    expect(note).toContain('600');
    expect(note).toContain('1,800');
  });

  it('warns that macros are under-counted only when some rows lack them', () => {
    expect(macroCoverageNote(totals({ meal_count: 3, meals_with_macros: 3 }))).toBeNull();
    expect(macroCoverageNote(totals({ meal_count: 3, meals_with_macros: 0 }))).toBeNull();
    expect(macroCoverageNote(totals({ meal_count: 3, meals_with_macros: 2 }))).toContain('1 item');
  });
});

describe('bands', () => {
  it('splits the day at 11, 15 and 18', () => {
    const at = (hour: number) => bandOf(new Date(2026, 7, 19, hour).toISOString());

    expect(at(6)).toBe('Morning');
    expect(at(10)).toBe('Morning');
    expect(at(11)).toBe('Midday');
    expect(at(14)).toBe('Midday');
    expect(at(15)).toBe('Afternoon');
    expect(at(17)).toBe('Afternoon');
    expect(at(18)).toBe('Evening');
    expect(at(23)).toBe('Evening');
  });

  it('drops bands nothing was eaten in', () => {
    const grouped = bandMeals([meal(1, '2026-08-19', 8), meal(2, '2026-08-19', 20)]);

    expect(grouped.map((group) => group.band)).toEqual(['Morning', 'Evening']);
  });

  it('keeps several meals in one band together, in the order given', () => {
    const grouped = bandMeals([
      meal(1, '2026-08-19', 12),
      meal(2, '2026-08-19', 13),
      meal(3, '2026-08-19', 20),
    ]);

    expect(grouped[0].meals.map((m) => m.id)).toEqual([1, 2]);
    expect(grouped[1].meals.map((m) => m.id)).toEqual([3]);
  });
});

describe('groupByDay', () => {
  it('groups on the filed day, oldest first', () => {
    const grouped = groupByDay([
      meal(1, '2026-08-20', 9),
      meal(2, '2026-08-19', 9),
      meal(3, '2026-08-20', 19),
    ]);

    expect(grouped.map((day) => day.date)).toEqual(['2026-08-19', '2026-08-20']);
    expect(grouped[1].meals.map((m) => m.id)).toEqual([1, 3]);
  });

  it('returns nothing for a window with no meals in it', () => {
    expect(groupByDay([])).toEqual([]);
  });
});

describe('composeEatenAt', () => {
  it('names the instant the user picked on their own clock', () => {
    // Whatever zone this runs in, the string must mean the same moment as the local Date.
    expect(new Date(composeEatenAt('2026-08-21', '19:30')).getTime()).toBe(
      new Date(2026, 7, 21, 19, 30).getTime(),
    );
  });

  it('keeps the chosen day in the string, so the server files it under that day', () => {
    // The failure this guards: converting to UTC first moves a meal eaten just after
    // midnight onto the day before for anyone east of Greenwich.
    expect(composeEatenAt('2026-08-19', '00:30')).toMatch(/^2026-08-19T00:30:00[+-]\d{2}:\d{2}$/);
  });

  it('pads a single-digit hour', () => {
    expect(composeEatenAt('2026-08-19', '07:05')).toContain('T07:05:00');
  });

  it('rejects nothing, but a moment yet to happen is recognisable as one', () => {
    const now = new Date(2026, 7, 19, 12, 0);

    expect(isInFuture('2026-08-19', '11:55', now)).toBe(false);
    expect(isInFuture('2026-08-19', '12:05', now)).toBe(true);
    expect(isInFuture('2026-08-20', '08:00', now)).toBe(true);
  });
});

describe('nowAsWheelTime', () => {
  it('snaps down to the wheel’s five-minute step', () => {
    expect(nowAsWheelTime(new Date(2026, 7, 19, 9, 4))).toBe('09:00');
    expect(nowAsWheelTime(new Date(2026, 7, 19, 19, 38))).toBe('19:35');
    expect(nowAsWheelTime(new Date(2026, 7, 19, 0, 0))).toBe('00:00');
  });
});
