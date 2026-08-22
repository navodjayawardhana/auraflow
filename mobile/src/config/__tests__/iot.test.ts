import { deviceIdFromStatusTopic, topicsFor } from '@/config/iot';

describe('topicsFor', () => {
  it('builds the exact topics the firmware uses', () => {
    // These strings are a contract with iot/auraflow-node/auraflow-node.ino. A mismatch
    // shows up as "no data" rather than an error, so it is pinned here.
    expect(topicsFor('auraflow-node-01')).toEqual({
      lightSet: 'auraflow/auraflow-node-01/light/set',
      lightState: 'auraflow/auraflow-node-01/light/state',
      biometrics: 'auraflow/auraflow-node-01/telemetry/biometrics',
      device: 'auraflow/auraflow-node-01/telemetry/device',
      status: 'auraflow/auraflow-node-01/status',
    });
  });
});

describe('deviceIdFromStatusTopic', () => {
  it('extracts the id from a status announcement', () => {
    expect(deviceIdFromStatusTopic('auraflow/auraflow-node-01/status')).toBe('auraflow-node-01');
  });

  it('ignores topics that are not status announcements', () => {
    expect(deviceIdFromStatusTopic('auraflow/auraflow-node-01/telemetry/biometrics')).toBeNull();
    expect(deviceIdFromStatusTopic('auraflow/auraflow-node-01/light/state')).toBeNull();
  });

  it('ignores traffic outside our namespace', () => {
    // The broker is public and shared, so the wildcard subscription is the one place
    // another project's topics could leak into our device list.
    expect(deviceIdFromStatusTopic('someoneelse/their-node/status')).toBeNull();
  });

  it('rejects a malformed topic rather than inventing an id', () => {
    expect(deviceIdFromStatusTopic('auraflow//status')).toBeNull();
    expect(deviceIdFromStatusTopic('auraflow/status')).toBeNull();
    expect(deviceIdFromStatusTopic('')).toBeNull();
  });
});
