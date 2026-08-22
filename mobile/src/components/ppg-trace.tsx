import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Path, Svg } from 'react-native-svg';

const WIDTH = 330;
const HEIGHT = 40;
const POINTS = 66;

/**
 * A plethysmograph-shaped trace, beating at the measured rate.
 *
 * Honest framing matters here: the MAX30102 publishes a heart rate every second or so,
 * not the raw optical waveform, so this is a *synthesised* pulse shaped by the real bpm
 * rather than the actual signal. It is presented as motion beside the number, never
 * labelled as a waveform, and it stops when the reading does — a trace still sweeping
 * while the number is stale would be the misleading version.
 */
export function PpgTrace({ bpm, isLive }: { bpm: number | null; isLive: boolean }) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (!isLive || bpm === null) return;

    // Scroll one sample per frame-ish; the period only sets how far apart the peaks fall.
    const timer = setInterval(() => setPhase((p) => (p + 1) % POINTS), 60);
    return () => clearInterval(timer);
  }, [isLive, bpm]);

  if (bpm === null) {
    return (
      <View style={{ height: HEIGHT, justifyContent: 'center' }}>
        <Svg width="100%" height={2} viewBox="0 0 330 2" preserveAspectRatio="none">
          <Path d="M0 1 H330" stroke="rgba(255,255,255,0.18)" strokeWidth={2} />
        </Svg>
      </View>
    );
  }

  // One beat every `samplesPerBeat` points, so a faster heart draws tighter peaks.
  const samplesPerBeat = Math.max(6, Math.round((60 / bpm) * 14));

  const d = Array.from({ length: POINTS }, (_, i) => {
    const x = (i / (POINTS - 1)) * WIDTH;
    const t = (i + phase) % samplesPerBeat;

    // A crude systolic spike with a dicrotic bump — enough to read as a pulse without
    // pretending to be the sensor's own trace.
    const norm = t / samplesPerBeat;
    const spike = Math.exp(-Math.pow((norm - 0.18) * 9, 2));
    const bump = 0.28 * Math.exp(-Math.pow((norm - 0.42) * 12, 2));

    const y = HEIGHT - 4 - (spike + bump) * (HEIGHT - 10);

    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');

  return (
    <Svg
      width="100%"
      height={HEIGHT}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none">
      <Path
        d={d}
        stroke="#00f0ff"
        strokeWidth={2}
        strokeOpacity={0.85}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}
