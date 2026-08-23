import { STALE_AFTER_MS } from '@/config/iot';
import { BLE_HOLD_OFF_MS, mergeVitals, type TransportFrame } from '@/services/vitals-merge';
import type { BiometricsTelemetry } from '@/types';

/**
 * The rule these cover is the one that decides what a person sees when a Bluetooth link is
 * failing: whether the number on a health dashboard holds steady, flickers between two
 * transports, or goes stale without saying so. None of that is observable by holding a
 * phone at the edge of range for long enough to be sure.
 */

function frame(bpm: number): BiometricsTelemetry {
  return {
    finger: true,
    ir_mean: 120_000,
    hr_bpm: bpm,
    hr_valid: true,
    spo2_valid: false,
    uptime_s: 60,
  };
}

const NOW = 1_700_000_000_000;

function at(bpm: number, msAgo: number): TransportFrame {
  return { frame: frame(bpm), receivedAt: NOW - msAgo };
}

const NOTHING: TransportFrame = { frame: null, receivedAt: null };

describe('mergeVitals', () => {
  it('reports nothing when neither transport has ever delivered', () => {
    expect(mergeVitals(NOTHING, NOTHING, NOW)).toEqual({
      frame: null,
      source: null,
      isStale: false,
    });
  });

  it('uses MQTT when that is all there is', () => {
    const merged = mergeVitals(NOTHING, at(70, 500), NOW);

    expect(merged.source).toBe('mqtt');
    expect(merged.frame?.hr_bpm).toBe(70);
    expect(merged.isStale).toBe(false);
  });

  it('prefers a fresh BLE frame over a fresher MQTT one', () => {
    const merged = mergeVitals(at(72, 1_400), at(70, 0), NOW);

    expect(merged.source).toBe('ble');
    expect(merged.frame?.hr_bpm).toBe(72);
  });

  it('holds BLE as the source across a gap shorter than the hold-off', () => {
    // The flapping-link case: BLE stopped notifying two seconds ago and MQTT is publishing
    // normally. Switching here would change the displayed number for a link that is about
    // to come back, which reads as a broken sensor rather than a weak radio.
    const merged = mergeVitals(at(72, BLE_HOLD_OFF_MS - 1), at(70, 0), NOW);

    expect(merged.source).toBe('ble');
    expect(merged.isStale).toBe(false);
  });

  it('falls back to MQTT once the hold-off has expired', () => {
    const merged = mergeVitals(at(72, BLE_HOLD_OFF_MS), at(70, 0), NOW);

    expect(merged.source).toBe('mqtt');
    expect(merged.frame?.hr_bpm).toBe(70);
    expect(merged.isStale).toBe(false);
  });

  it('does not flap back and forth as BLE frames arrive late', () => {
    // Three consecutive evaluations across one recovered drop. The source must move at
    // most once, and must not alternate — alternating is the visible defect.
    const sources = [
      mergeVitals(at(72, 1_000), at(70, 0), NOW).source,
      mergeVitals(at(72, BLE_HOLD_OFF_MS - 1), at(70, 0), NOW).source,
      mergeVitals(at(72, 0), at(70, 0), NOW).source,
    ];

    expect(sources).toEqual(['ble', 'ble', 'ble']);
  });

  it('never holds BLE past the point where its own frame is stale', () => {
    // The bound that makes the hold-off safe. If it were ever loosened past the staleness
    // window, a held BLE frame could be presented as current while being older than the
    // threshold that exists to stop exactly that.
    expect(BLE_HOLD_OFF_MS).toBeLessThan(STALE_AFTER_MS);
  });

  it('marks a stale MQTT frame stale rather than dropping it', () => {
    const merged = mergeVitals(NOTHING, at(70, STALE_AFTER_MS), NOW);

    // Kept, because the card needs the frame to say whether a finger is on the pad at all.
    expect(merged.frame?.hr_bpm).toBe(70);
    expect(merged.source).toBe('mqtt');
    expect(merged.isStale).toBe(true);
  });

  it('keeps an aged-out BLE frame when MQTT has nothing at all', () => {
    // The offline demo after the node loses power: no broker in the loop, so there is no
    // other transport to fall back to. The reading stays visible and is marked stale.
    const merged = mergeVitals(at(72, STALE_AFTER_MS + 1), NOTHING, NOW);

    expect(merged.source).toBe('ble');
    expect(merged.isStale).toBe(true);
  });

  it('does not call a BLE frame stale merely for outliving the hold-off', () => {
    // Between the hold-off and the staleness window with no MQTT to switch to: the frame
    // is past its preference window but is still a current reading, and dimming it would
    // be a lie in the safe direction rather than the truth.
    const merged = mergeVitals(at(72, BLE_HOLD_OFF_MS + 1), NOTHING, NOW);

    expect(merged.source).toBe('ble');
    expect(merged.isStale).toBe(false);
  });

  it('ignores a transport that has a timestamp but no frame', () => {
    // Reachable while a link is up and the node has published nothing yet. An empty
    // transport must not win the preference and leave the screen blank.
    const merged = mergeVitals({ frame: null, receivedAt: NOW }, at(70, 0), NOW);

    expect(merged.source).toBe('mqtt');
    expect(merged.frame?.hr_bpm).toBe(70);
  });
});
