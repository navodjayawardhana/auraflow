import {
  isBiometrics,
  isDeviceTelemetry,
  isLightState,
  isSettling,
  usableHeartRate,
  usableHeartRateMaxim,
  usableSpo2,
} from '@/services/iot-payloads';

/**
 * A real frame, copied verbatim from the node during the transport spike — and
 * deliberately left on the older shape, without `settled` or the second estimator. It is
 * the fixture that proves a node on earlier firmware still reads.
 */
const REAL_BIOMETRICS = {
  finger: true,
  ir_mean: 168540,
  hr_bpm: 113,
  spo2_pct: 99,
  hr_valid: true,
  spo2_valid: true,
  uptime_s: 269,
};

/** The current shape: settled, with both estimators reporting the same heartbeat. */
const SETTLED_BIOMETRICS = {
  finger: true,
  settled: true,
  ir_mean: 168540,
  hr_bpm: 72.4,
  hr_bpm_maxim: 71,
  spo2_pct: 98,
  hr_valid: true,
  hr_maxim_valid: true,
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

  it('accepts the settled frame with both estimators', () => {
    expect(isBiometrics(SETTLED_BIOMETRICS)).toBe(true);
  });

  it('rejects a settling flag sent as anything but a boolean', () => {
    expect(isBiometrics({ ...SETTLED_BIOMETRICS, settled: 'true' })).toBe(false);
  });

  it('rejects the second estimator sent as a string', () => {
    expect(isBiometrics({ ...SETTLED_BIOMETRICS, hr_bpm_maxim: '71' })).toBe(false);
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
        sample_rate_hz: 24.97,
        dropped_samples: 0,
      }),
    ).toBe(true);
  });

  it('rejects a stream-health field sent as a string', () => {
    expect(
      isDeviceTelemetry({
        rssi: -84,
        ip: '192.168.1.33',
        uptime_s: 180,
        heap_free_b: 219416,
        light_mode: 'off',
        pulse_sensor: true,
        sample_rate_hz: '24.97',
      }),
    ).toBe(false);
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

  it('keeps the fractional heart rate the beat-interval estimator resolves', () => {
    // The whole reason the node runs a second estimator is that Maxim's cannot express a
    // value between its steps. Rounding here would throw that away again.
    expect(usableHeartRate(SETTLED_BIOMETRICS)).toBe(72.4);
    expect(usableHeartRateMaxim(SETTLED_BIOMETRICS)).toBe(71);
  });

  it('withholds the window-based readings from a frame that is still settling', () => {
    // Contact made, window not yet full. Maxim's rate and the SpO2 ratio both read the
    // whole buffer, half of which is still the step between no-finger and finger samples,
    // and they arrive flagged valid regardless.
    const settling = { ...SETTLED_BIOMETRICS, settled: false };

    expect(usableHeartRateMaxim(settling)).toBeNull();
    expect(usableSpo2(settling)).toBeNull();
  });

  it('keeps the streaming heart rate on an unsettled frame', () => {
    // hr_bpm does not read the window. It gates each cycle on its own perfusion band and
    // reports a median of recent intervals, so it resolves seconds before the window
    // fills — and holding it back was three seconds of dashes for nothing.
    const settling = { ...SETTLED_BIOMETRICS, settled: false };

    expect(usableHeartRate(settling)).toBe(72.4);
    expect(isSettling(settling)).toBe(false);
  });

  it('calls it settling while contact is made but no rate has resolved', () => {
    const searching = { ...SETTLED_BIOMETRICS, settled: false, hr_valid: false };

    expect(usableHeartRate(searching)).toBeNull();
    expect(isSettling(searching)).toBe(true);
  });

  it('trusts a frame from firmware that predates the settled flag', () => {
    // Absent is not false: that firmware only ever published readings it already
    // considered final, so discarding them would break a node nobody has reflashed.
    expect(usableHeartRate(REAL_BIOMETRICS)).toBe(113);
    expect(isSettling(REAL_BIOMETRICS)).toBe(false);
  });

  it('withholds the second estimator unless it says so itself', () => {
    // hr_valid covers the beat-interval rate only. A frame where the reference algorithm
    // failed to converge still carries a usable hr_bpm.
    const maximLost = { ...SETTLED_BIOMETRICS, hr_maxim_valid: false };

    expect(usableHeartRate(maximLost)).toBe(72.4);
    expect(usableHeartRateMaxim(maximLost)).toBeNull();
  });

  it('does not call an untouched sensor settling', () => {
    expect(
      isSettling({ ...SETTLED_BIOMETRICS, finger: false, settled: false, hr_valid: false }),
    ).toBe(false);
    expect(isSettling(null)).toBe(false);
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
