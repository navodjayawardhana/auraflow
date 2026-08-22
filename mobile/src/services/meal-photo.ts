import { apiPost } from '@/services/api-client';

/**
 * A meal read off a photograph.
 *
 * The photo goes to our API and our API calls the vision model, for the reason the weather
 * proxy exists: an EXPO_PUBLIC_* value is inlined into the bundle and readable from the
 * APK, and a model key shipped that way is a bill anyone can run up.
 */

export type PhotoConfidence = 'low' | 'medium' | 'high';

export interface PhotoEstimateItem {
  name: string;
  kcal: number;
  /** Null where the model gave no figure — which is not the same as zero. */
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
}

export interface PhotoMealEstimate {
  items: PhotoEstimateItem[];
  name: string;
  kcal: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  /** The model's own claim about itself, never rendered as a number. */
  confidence: PhotoConfidence;
  /** Which model guessed, so a figure from one since replaced stays identifiable. */
  model: string;
}

/**
 * Matches the ceiling the endpoint enforces.
 *
 * Checked here as well so a phone on mobile data does not spend four megabytes of someone's
 * allowance discovering that the server will refuse it.
 */
export const MAX_PHOTO_BASE64_LENGTH = 5_600_000;

/** What the name and macro fields are seeded with, and recomputed to after an edit. */
export interface PhotoMealTotals {
  name: string;
  kcal: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
}

const MAX_NAME_LENGTH = 120;

/**
 * The same arithmetic the API does, repeated here on purpose.
 *
 * Removing an item the model got wrong has to update the totals immediately — asking the
 * server to re-add a list it already sent would be a second paid call to answer a question
 * the phone can answer itself.
 */
export function summarise(items: PhotoEstimateItem[]): PhotoMealTotals {
  return {
    name: joinNames(items.map((item) => item.name)),
    kcal: items.reduce((total, item) => total + item.kcal, 0),
    protein_g: sumReported(items, 'protein_g'),
    carbs_g: sumReported(items, 'carbs_g'),
    fat_g: sumReported(items, 'fat_g'),
  };
}

/** Null rather than zero when nothing reported the macro: silence is not a measurement. */
function sumReported(
  items: PhotoEstimateItem[],
  key: 'protein_g' | 'carbs_g' | 'fat_g',
): number | null {
  const reported = items.map((item) => item[key]).filter((value): value is number => value !== null);

  return reported.length === 0 ? null : reported.reduce((total, value) => total + value, 0);
}

function joinNames(names: string[]): string {
  const joined = names.join(', ');
  if (joined.length <= MAX_NAME_LENGTH) return joined;

  const cut = joined.slice(0, MAX_NAME_LENGTH - 1);
  const lastSpace = cut.lastIndexOf(' ');

  return `${(lastSpace === -1 ? cut : cut.slice(0, lastSpace)).replace(/[ ,]+$/, '')}…`;
}

export function withoutItem(items: PhotoEstimateItem[], index: number): PhotoEstimateItem[] {
  return items.filter((_, at) => at !== index);
}

/** @param photoBase64 A JPEG or PNG, base64 encoded, without a data URI prefix. */
export async function estimateMealFromPhoto(photoBase64: string): Promise<PhotoMealEstimate> {
  const payload = await apiPost<{ data: PhotoMealEstimate }>('/meals/estimate-from-photo', {
    photo: photoBase64,
  });

  return payload.data;
}
