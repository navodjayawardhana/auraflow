import { buildFocusFeatures } from '@/ml/focus-features';
import { predictFocusReady } from '@/ml/focus-model';

/**
 * Not an assertion about correctness \u2014 a measurement for the report's
 * non-functional table. Reports the distribution rather than one number, since a
 * single timing on a warm JIT says very little.
 */
describe('inference cost', () => {
  it('measures readiness inference latency', () => {
    const N = 5000;
    const samples: number[] = [];

    for (let i = 0; i < 500; i++) predictFocusReady({});   // warm-up

    for (let i = 0; i < N; i++) {
      const t0 = process.hrtime.bigint();
      predictFocusReady({});
      const t1 = process.hrtime.bigint();
      samples.push(Number(t1 - t0) / 1e6);
    }

    samples.sort((a, b) => a - b);
    const at = (q: number) => samples[Math.floor(q * (samples.length - 1))];
    console.log(JSON.stringify({
      runs: N,
      median_ms: at(0.5),
      p95_ms: at(0.95),
      p99_ms: at(0.99),
      max_ms: samples[samples.length - 1],
    }));
    expect(at(0.95)).toBeLessThan(50);
  });
});
