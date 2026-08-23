import type { BmiBand, BmiScale } from '@/types';

/**
 * BMI, and the two sets of cut-offs a value can be read against.
 *
 * The number is arithmetic; the band is a judgement, and which judgement depends on the
 * population. WHO's 2004 expert consultation found South Asian populations carry the
 * cardiometabolic risk of a European "overweight" at a markedly lower BMI, and recommended
 * 23 and 27.5 as additional public-health action points. This app's users are in Sri Lanka.
 * Showing them 24.0 as "healthy" on European cut-offs alone would not be a rounding
 * difference, it would be the wrong answer — so both bands are computed and neither is
 * presented as the one that settles it.
 *
 * The server computes and stores this too, and its figures are the record. This exists for
 * the one thing a round trip cannot do: move the bands while a weight is being typed, before
 * anything has been saved. It reproduces the server's arithmetic exactly — round to one
 * decimal, then band, with 18.5 shared by both scales — so a preview cannot promise a band
 * the saved profile then contradicts. If one side changes, this file changes with it.
 */

const CUT_OFFS: Record<BmiScale, { overweight: number; obese: number }> = {
  who_standard: { overweight: 25, obese: 30 },
  who_asian: { overweight: 23, obese: 27.5 },
};

/** The Asian revision moved only the upper two points; 18.5 is underweight on both. */
const UNDERWEIGHT_BELOW = 18.5;

export const BMI_SCALES: BmiScale[] = ['who_standard', 'who_asian'];

export const BMI_SCALE_LABELS: Record<BmiScale, string> = {
  who_standard: 'WHO standard',
  who_asian: 'WHO Asian',
};

export const BMI_BAND_LABELS: Record<BmiBand, string> = {
  underweight: 'Underweight',
  healthy: 'Healthy weight',
  overweight: 'Overweight',
  obese: 'Obese',
};

/**
 * Rounded to one decimal, and that rounding is deliberate rather than cosmetic: the band
 * below is taken from this same value, so the number on screen and the word beside it can
 * never disagree about which side of a cut-off they are on.
 */
export function bmiFor(heightCm: number | null, weightKg: number | null): number | null {
  if (heightCm === null || weightKg === null) return null;
  if (heightCm <= 0 || weightKg <= 0) return null;

  const metres = heightCm / 100;

  return Math.round((weightKg / (metres * metres)) * 10) / 10;
}

export function bmiBandFor(bmi: number, scale: BmiScale): BmiBand {
  const cutOffs = CUT_OFFS[scale];

  if (bmi < UNDERWEIGHT_BELOW) return 'underweight';
  if (bmi < cutOffs.overweight) return 'healthy';
  if (bmi < cutOffs.obese) return 'overweight';

  return 'obese';
}

/** The cut-offs themselves, so the UI can state them rather than assert the band. */
export function cutOffsFor(scale: BmiScale): { overweight: number; obese: number } {
  return CUT_OFFS[scale];
}

/** Whole years, from an ISO date of birth. Null when there is no date to count from. */
export function ageFrom(dateOfBirth: string | null, on = new Date()): number | null {
  if (dateOfBirth === null) return null;

  const born = new Date(`${dateOfBirth}T00:00:00`);
  if (Number.isNaN(born.getTime())) return null;

  let years = on.getFullYear() - born.getFullYear();

  // A birthday later this year has not happened yet, and an age that is a year early
  // shifts every age-banded formula the plan uses.
  const hasHadBirthday =
    on.getMonth() > born.getMonth() ||
    (on.getMonth() === born.getMonth() && on.getDate() >= born.getDate());

  if (!hasHadBirthday) years -= 1;

  return years < 0 ? null : years;
}
