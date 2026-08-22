import {
  isBiometrics,
  isDeviceTelemetry,
  isLightState,
  usableHeartRate,
  usableSpo2,
} from '@/services/iot-payloads';

/** A real frame, copied verbatim from the node during the transport spike. */
const REAL_BIOMETRICS = {
  finger: true,
  ir_mean: 168540,
  hr_bpm: 113,
  spo2_pct: 99,
  hr_valid: true,
  spo2_valid: true,
  uptime_s: 269,
};

describe('isBiometrics', () => {
  it('accepts a real frame from the node', () => {
    expect(isBiometrics(REAL_BIOMETRICS)).toBe(true);
  });

  it('accepts a frame with no reading yet, which omits the vitals entirely', () => {
    expect(
      isBiometrics({ finger: true, ir_mean: 86849, hr_valid: false, spo2_valid: false, uptime_s: 264 }),
    ).toBe(true);
  });

  it('rejects a frame missing a required field', () => {
    const { finger, ...withoutFinger } = REAL_BIOMETRICS;
    void finger;

    expect(isBiometrics(withoutFinger)).toBe(false);
  });

  it('rejects a vital sent as a string', () => {
    // The broker is public, so a frame is untrusted input. A "113" would render and then
    // poison any arithmetic downstream.
    expect(isBiometrics({ ...REAL_BIOMETRICS, hr_bpm: '113' })).toBe(false);
  });

  it('rejects things that are not objects at all', () => {
    expect(isBiometrics(null)).toBe(false);
    expect(isBiometrics('online')).toBe(false);
    expect(isBiometrics(42)).toBe(false);
  });
});

describe('isDeviceTelemetry', () => {
  it('accepts a real frame', () => {
    expect(
      isDeviceTelemetry({
        rssi: -84,
        ip: '192.168.1.33',
        uptime_s: 180,
        heap_free_b: 219416,
        light_mode: 'off',
        pulse_sensor: true,
        sensor_die_temp_c: 31.31,
      }),
    ).toBe(true);
  });

  it('rejects an unknown light mode', () => {
    expect(
      isDeviceTelemetry({
        rssi: -84,
        ip: '192.168.1.33',
        uptime_s: 180,
        heap_free_b: 219416,
        light_mode: 'disco',
        pulse_sensor: true,
      }),
    ).toBe(false);
  });
});

describe('isLightState', () => {
  it('accepts a retained state frame', () => {
    expect(
      isLightState({ mode: 'focus', brightness: 90, source: 'mqtt', rssi: -77, uptime_s: 305 }),
    ).toBe(true);
  });

  it('rejects a mode the firmware does not implement', () => {
    expect(
      isLightState({ mode: 'strobe', brightness: 90, source: 'mqtt', rssi: -77, uptime_s: 305 }),
    ).toBe(false);
  });
});

describe('usable readings', () => {
  it('returns a reading the firmware marked valid', () => {
    expect(usableHeartRate(REAL_BIOMETRICS)).toBe(113);
    expect(usableSpo2(REAL_BIOMETRICS)).toBe(99);
  });

  it('withholds a reading the firmware marked invalid, even when the key is present', () => {
    // The validity flag is the authority, not the presence of the number.
    const converging = { ...REAL_BIOMETRICS, hr_valid: false, spo2_valid: false };

    expect(usableHeartRate(converging)).toBeNull();
    expect(usableSpo2(converging)).toBeNull();
  });

  it('handles having no frame at all', () => {
    expect(usableHeartRate(null)).toBeNull();
    expect(usableSpo2(null)).toBeNull();
  });
});
