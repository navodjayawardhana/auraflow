import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Where the API lives.
 *
 * `localhost` means the device itself, not the development machine, so a phone or
 * emulator pointed at it finds nothing. Android emulators reach the host through the
 * fixed alias 10.0.2.2; a physical device needs the machine's LAN address, which is why
 * this reads `EXPO_PUBLIC_API_URL` first.
 */
function resolveBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL;
  if (configured) {
    return configured.replace(/\/$/, '');
  }

  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:8000';
  }

  // Physical devices in Expo Go: fall back to the host that served the bundle.
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  return host ? `http://${host}:8000` : 'http://localhost:8000';
}

export const API_BASE_URL = `${resolveBaseUrl()}/api/v1`;
