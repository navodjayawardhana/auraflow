import { apiGet } from '@/services/api-client';
import type { Coordinates } from '@/services/place-classifier';

export interface CurrentWeather {
  condition: string;
  description: string;
  temperature_c: number;
  feels_like_c: number;
  humidity_percent: number;
  location_name: string | null;
  observed_at: string;
}

/**
 * Weather comes through our own API rather than straight from the provider, so the key
 * stays server-side — an EXPO_PUBLIC_ variable would be readable from the APK — and one
 * cached response serves every client near the same place.
 */
export async function fetchWeather(at: Coordinates): Promise<CurrentWeather> {
  const payload = await apiGet<{ data: CurrentWeather }>(
    `/weather?lat=${at.latitude}&lon=${at.longitude}`,
  );

  return payload.data;
}
