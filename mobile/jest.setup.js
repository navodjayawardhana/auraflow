/* eslint-env jest */

/**
 * SecureStore is a native module with no JS implementation, so it cannot run under Jest.
 * An in-memory stand-in keeps the token behaviour testable -- which matters, because
 * "the token is stored securely and cleared on sign-out" is a claim worth asserting
 * rather than assuming.
 */
jest.mock('expo-secure-store', () => {
  const store = new Map();

  return {
    __store: store,
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'whenUnlockedThisDeviceOnly',
    getItemAsync: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
    setItemAsync: jest.fn(async (key, value) => {
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key) => {
      store.delete(key);
    }),
  };
});

jest.mock('expo-device', () => ({
  deviceName: 'test-device',
  osName: 'Android',
}));
