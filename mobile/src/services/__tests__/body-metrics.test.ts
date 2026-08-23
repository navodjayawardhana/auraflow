import { ageFrom, bmiBandFor, bmiFor } from '@/services/body-metrics';

describe('bmiFor', () => {
  it('computes the textbook value', () => {
    // 70 kg at 1.75 m is 22.857…, which is the worked example in every reference.
    expect(bmiFor(175, 70)).toBe(22.9);
  });

  it('has no value without both measurements', () => {
    expect(bmiFor(null, 70)).toBeNull();
    expect(bmiFor(175, null)).toBeNull();
    expect(bmiFor(null, null)).toBeNull();
  });

  it('refuses a figure that cannot be a body', () => {
    // A zero height divides by zero and yields Infinity, which would render as a band.
    expect(bmiFor(0, 70)).toBeNull();
    expect(bmiFor(175, 0)).toBeNull();
    expect(bmiFor(-175, 70)).toBeNull();
  });
});

describe('bmiBandFor on the standard cut-offs', () => {
  it('bands each range', () => {
    expect(bmiBandFor(17.0, 'who_standard')).toBe('underweight');
    expect(bmiBandFor(22.0, 'who_standard')).toBe('healthy');
    expect(bmiBandFor(27.0, 'who_standard')).toBe('overweight');
    expect(bmiBandFor(32.0, 'who_standard')).toBe('obese');
  });

  it('puts the cut-off itself in the upper band', () => {
    expect(bmiBandFor(18.5, 'who_standard')).toBe('healthy');
    expect(bmiBandFor(25.0, 'who_standard')).toBe('overweight');
    expect(bmiBandFor(30.0, 'who_standard')).toBe('obese');
  });
});

describe('bmiBandFor on the WHO Asian cut-offs', () => {
  it('moves overweight to 23 and obese to 27.5', () => {
    expect(bmiBandFor(23.0, 'who_asian')).toBe('overweight');
    expect(bmiBandFor(22.9, 'who_asian')).toBe('healthy');
    expect(bmiBandFor(27.5, 'who_asian')).toBe('obese');
    expect(bmiBandFor(27.4, 'who_asian')).toBe('overweight');
  });

  it('keeps the underweight threshold where the standard scale has it', () => {
    // The 2004 revision moved the two action points above healthy, not the one below it.
    expect(bmiBandFor(18.4, 'who_asian')).toBe('underweight');
    expect(bmiBandFor(18.5, 'who_asian')).toBe('healthy');
  });

  it('disagrees with the standard scale exactly where it matters', () => {
    // The reason both bands are shown: a Sri Lankan user at 24.0 is healthy by European
    // cut-offs and overweight by the ones WHO recommends for their population.
    expect(bmiBandFor(24.0, 'who_standard')).toBe('healthy');
    expect(bmiBandFor(24.0, 'who_asian')).toBe('overweight');

    expect(bmiBandFor(28.0, 'who_standard')).toBe('overweight');
    expect(bmiBandFor(28.0, 'who_asian')).toBe('obese');
  });
});

describe('ageFrom', () => {
  const on = new Date(2026, 7, 22); // 22 August 2026

  it('counts whole years', () => {
    expect(ageFrom('1990-01-15', on)).toBe(36);
  });

  it('does not credit a birthday that has not happened', () => {
    expect(ageFrom('1990-12-01', on)).toBe(35);
  });

  it('counts the birthday itself', () => {
    expect(ageFrom('1990-08-22', on)).toBe(36);
    expect(ageFrom('1990-08-23', on)).toBe(35);
  });

  it('has no age without a date, or from one in the future', () => {
    expect(ageFrom(null, on)).toBeNull();
    expect(ageFrom('2030-01-01', on)).toBeNull();
  });
});
