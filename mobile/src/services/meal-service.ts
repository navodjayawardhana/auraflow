import { apiDelete, apiGet, apiPost } from '@/services/api-client';

/**
 * Three kinds of claim, kept apart because they are not equally trustworthy: a figure
 * someone else measured, a figure the user typed, and a figure a vision model guessed from
 * a photograph with no scale in it.
 */
export type MealSource = 'lookup' | 'estimate' | 'photo';

export interface MealEntry {
  id: number;
  name: string;
  kcal: number;
  /** Where the figure came from — the UI renders each of the three differently. */
  source: MealSource;
  barcode: string | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  portion_g: number | null;
  eaten_at: string;
}

export interface DayNutrition {
  meals: MealEntry[];
  totalKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export interface FoodProduct {
  barcode: string;
  name: string;
  brand: string | null;
  kcal_per_100g: number;
  protein_per_100g: number | null;
  carbs_per_100g: number | null;
  fat_per_100g: number | null;
  serving_g: number | null;
  source: string;
}

export interface LogMealInput {
  name: string;
  kcal: number;
  source: MealSource;
  barcode?: string;
  protein_g?: number;
  carbs_g?: number;
  fat_g?: number;
  portion_g?: number;
}

export async function fetchDay(date: string): Promise<DayNutrition> {
  const payload = await apiGet<{
    data: MealEntry[];
    meta: { total_kcal: number; protein_g: number; carbs_g: number; fat_g: number };
  }>(`/meals?date=${date}`);

  return {
    meals: payload.data,
    totalKcal: payload.meta.total_kcal,
    proteinG: payload.meta.protein_g,
    carbsG: payload.meta.carbs_g,
    fatG: payload.meta.fat_g,
  };
}

export async function logMeal(input: LogMealInput): Promise<MealEntry> {
  const payload = await apiPost<{ data: MealEntry }>('/meals', input);
  return payload.data;
}

export async function removeMeal(id: number): Promise<void> {
  await apiDelete(`/meals/${id}`);
}

/** Null when the barcode is not in the database — common, and not an error. */
export async function lookupBarcode(barcode: string): Promise<FoodProduct | null> {
  try {
    const payload = await apiGet<{ data: FoodProduct }>(`/foods/${barcode}`);
    return payload.data;
  } catch {
    return null;
  }
}
