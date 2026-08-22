<?php

namespace Database\Seeders;

use App\Models\HealthSnapshot;
use App\Models\User;
use Illuminate\Database\Seeder;
use RuntimeException;

/**
 * Loads the 30-night demo timeline into `health_snapshots`.
 *
 * The source file is a fixed window generated once (2026-07-13 .. 2026-08-11), so
 * loading it verbatim would leave today unavailable and the app would still demo
 * empty. Every date is therefore shifted so the *last* night lands on today —
 * that rebasing is the entire point of this seeder, not an incidental detail.
 *
 * The data is synthetic and says so in its own `meta.warning`; it exists to make
 * the recovery/insights screens demonstrable, never to stand in for measurement.
 */
class DemoTimelineSeeder extends Seeder
{
    private const SOURCE = __DIR__.'/data/demo_timeline.json';

    /**
     * REM is absent from the generator's output. It is derived here as a share of
     * total sleep rather than left null, because `SleepSummary::hasStageBreakdown()`
     * requires deep *and* REM — a null REM silently drops the architecture component
     * and every demo score would be computed from 2 of 3 signals. The timeline is
     * already declared synthetic, so a derived REM adds no new claim of measurement.
     * Documented in docs/DATASET.md.
     */
    private const REM_SHARE = 0.22;
    private const REM_JITTER = 0.10;

    public function run(?User $user = null): void
    {
        $user ??= User::query()->firstOrFail();

        $payload = $this->readSource();
        $nights = $payload['nights'];

        $offset = $this->rebaseOffsetDays($nights);
        // Deterministic jitter, so re-seeding never produces a different timeline.
        mt_srand((int) ($payload['meta']['seed'] ?? 7003));

        foreach ($nights as $night) {
            $sleepMinutes = (int) round(((float) $night['sleep_duration']) * 60);
            $deepMinutes = (int) round((float) $night['deep_sleep_min']);
            $remMinutes = $this->deriveRemMinutes($sleepMinutes, $deepMinutes);

            $this->upsertNight($user, $this->shiftDate($night['date'], $offset), [
                'sleep_minutes' => $sleepMinutes,
                'deep_sleep_minutes' => $deepMinutes,
                'rem_sleep_minutes' => $remMinutes,
                'resting_heart_rate' => round((float) $night['resting_hr'], 1),
                // Activity is derived from the night rather than generated independently:
                // a well-slept, low-stress day moves more. That correlation is not a
                // finding -- it is an assumption baked into demo data, and it exists only
                // so the dashboard has something plausible to draw.
                'steps' => $this->deriveSteps($night),
                'water_ml' => $this->deriveWater(),
            ]);
        }

        $this->command?->info(sprintf(
            'Seeded %d nights for %s, ending today.',
            count($nights),
            $user->email,
        ));
    }

    /**
     * Re-running must update rather than duplicate. Matched with whereDate because
     * `recorded_on` is cast to a date and carries a time component the plain equality
     * in updateOrCreate would miss -- the insert would then hit the unique index.
     *
     * @param  array<string, mixed>  $attributes
     */
    private function upsertNight(User $user, string $date, array $attributes): void
    {
        $existing = HealthSnapshot::query()
            ->where('user_id', $user->id)
            ->whereDate('recorded_on', $date)
            ->first();

        if ($existing !== null) {
            $existing->fill($attributes)->save();

            return;
        }

        HealthSnapshot::query()->create($attributes + [
            'user_id' => $user->id,
            'recorded_on' => $date,
        ]);
    }

    /**
     * @return array{meta: array<string, mixed>, nights: list<array<string, mixed>>}
     */
    private function readSource(): array
    {
        if (! is_readable(self::SOURCE)) {
            throw new RuntimeException('Demo timeline not found at '.self::SOURCE);
        }

        $payload = json_decode((string) file_get_contents(self::SOURCE), true, flags: JSON_THROW_ON_ERROR);

        if (! isset($payload['nights']) || $payload['nights'] === []) {
            throw new RuntimeException('Demo timeline contains no nights.');
        }

        return $payload;
    }

    /**
     * Days between the timeline's last night and today.
     *
     * @param  list<array<string, mixed>>  $nights
     */
    private function rebaseOffsetDays(array $nights): int
    {
        $last = max(array_map(static fn (array $n): string => (string) $n['date'], $nights));

        $lastNight = new \DateTimeImmutable($last.' 00:00:00');
        $today = new \DateTimeImmutable('today');

        return (int) $lastNight->diff($today)->format('%r%a');
    }

    private function shiftDate(string $date, int $offsetDays): string
    {
        return (new \DateTimeImmutable($date.' 00:00:00'))
            ->modify(sprintf('%+d days', $offsetDays))
            ->format('Y-m-d');
    }

    /**
     * A day's steps, scaled by how the night went. Around 8,000 typical, damped on an
     * illness day and on a short night, with jitter from the same seeded stream as REM so
     * the whole timeline reproduces exactly.
     *
     * @param  array<string, mixed>  $night
     */
    private function deriveSteps(array $night): int
    {
        $base = 8000;

        $sleepFactor = min((float) $night['sleep_duration'] / 8.0, 1.15);
        $illnessFactor = ($night['is_illness_day'] ?? false) ? 0.45 : 1.0;
        $jitter = 1 + ((mt_rand(-100, 100) / 100) * 0.25);

        return (int) round($base * $sleepFactor * $illnessFactor * $jitter);
    }

    /** Between one and eight glasses, in the same 250 ml increments the app logs. */
    private function deriveWater(): int
    {
        return mt_rand(3, 8) * 250;
    }

    /** Clamped so the stages can never exceed the night they belong to. */
    private function deriveRemMinutes(int $sleepMinutes, int $deepMinutes): int
    {
        $jitter = 1 + ((mt_rand(-100, 100) / 100) * self::REM_JITTER);
        $rem = (int) round($sleepMinutes * self::REM_SHARE * $jitter);

        return max(0, min($rem, $sleepMinutes - $deepMinutes));
    }
}
