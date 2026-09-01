<?php

namespace Database\Seeders;

use App\Application\Planning\UseCase\RecalculatePlanUseCase;
use App\Application\Profile\UseCase\UpdateProfileUseCase;
use App\Application\Wellbeing\Service\RecoveryScoreSeriesReader;
use App\Domain\Nutrition\ValueObject\MealSource;
use App\Domain\Profile\Repository\UserProfileRepository;
use App\Domain\Profile\ValueObject\Sex;
use App\Domain\Wellbeing\ValueObject\UserId;
use App\Models\ExerciseSession;
use App\Models\MealEntry;
use App\Models\User;
use DateTimeImmutable;
use Illuminate\Database\Seeder;

/**
 * Everything the demo needs that `DemoTimelineSeeder` does not write.
 *
 * The timeline seeder fills `health_snapshots` — sleep, resting heart rate, steps,
 * water — which is enough for the recovery ring and the sleep panels. It is not
 * enough for the rest of the app: Insights' coverage panel reports meals and the
 * plan separately, and with neither present it correctly says so ("Meal logged
 * 2 of 14"), which is honest and demonstrates nothing.
 *
 * So this seeder adds the four things a walk-through actually touches: a body
 * profile, the plan derived from it, a fortnight of meals, and a movement history.
 *
 * Everything here is synthetic and exists only so the screens have something
 * plausible to draw. Nothing it writes is ever a measurement, and nothing it writes
 * reaches training — `ml/provenance.py` and its CI test enforce that separately.
 *
 * Idempotent by construction rather than by truncation: meals key on
 * (user, day, name) and sessions on the deterministic `client_uuid` the unique
 * index already exists for, so re-running updates in place and never deletes a row
 * this seeder did not write. That matters because the account this runs against is
 * a real account on a live server, not a scratch database.
 */
class DemoContentSeeder extends Seeder
{
    /** Insights reads a fortnight, so a fortnight is what has to be complete. */
    private const DAYS = 14;

    /**
     * The demo user's body. Only written where the account has left a field null,
     * unless the caller forces it — overwriting a height somebody actually entered
     * to make a demo tidier is the app editing the user's own record behind them.
     */
    private const PROFILE = [
        'date_of_birth' => '2003-01-30',
        'sex' => 'male',
        'height_cm' => 158,
        'weight_kg' => 65.0,
        'activity_level' => 'sedentary',
        // Left null so the domain's own default applies — see BmiScale, which leads
        // with the Asian cut-offs because that is where this app's users are.
        'bmi_scale' => null,
    ];

    /**
     * A repeating week of meals. Sources are mixed deliberately: the demo makes a
     * point of looked-up values being marked apart from the user's own estimates,
     * and a table where every row says "estimate" cannot show that.
     *
     * @var list<array{name: string, kcal: int, source: string, barcode: ?string, protein_g: int, carbs_g: int, fat_g: int, portion_g: ?int, hour: int, minute: int}>
     */
    private const MENU = [
        // breakfast
        ['name' => 'String hoppers with dhal', 'kcal' => 420, 'source' => 'photo', 'barcode' => null, 'protein_g' => 14, 'carbs_g' => 68, 'fat_g' => 9, 'portion_g' => 320, 'hour' => 7, 'minute' => 40],
        ['name' => 'Milk rice and lunu miris', 'kcal' => 465, 'source' => 'photo', 'barcode' => null, 'protein_g' => 9, 'carbs_g' => 72, 'fat_g' => 15, 'portion_g' => 300, 'hour' => 7, 'minute' => 55],
        ['name' => 'Oats with banana', 'kcal' => 340, 'source' => 'estimate', 'barcode' => null, 'protein_g' => 11, 'carbs_g' => 58, 'fat_g' => 7, 'portion_g' => 280, 'hour' => 8, 'minute' => 5],
        ['name' => 'Toast and eggs', 'kcal' => 395, 'source' => 'estimate', 'barcode' => null, 'protein_g' => 21, 'carbs_g' => 34, 'fat_g' => 18, 'portion_g' => 240, 'hour' => 7, 'minute' => 50],
        // lunch
        ['name' => 'Rice and curry', 'kcal' => 720, 'source' => 'photo', 'barcode' => null, 'protein_g' => 26, 'carbs_g' => 108, 'fat_g' => 21, 'portion_g' => 520, 'hour' => 12, 'minute' => 45],
        ['name' => 'Chicken kottu', 'kcal' => 810, 'source' => 'photo', 'barcode' => null, 'protein_g' => 34, 'carbs_g' => 96, 'fat_g' => 31, 'portion_g' => 480, 'hour' => 13, 'minute' => 10],
        ['name' => 'Fried rice with vegetables', 'kcal' => 640, 'source' => 'estimate', 'barcode' => null, 'protein_g' => 18, 'carbs_g' => 94, 'fat_g' => 19, 'portion_g' => 450, 'hour' => 12, 'minute' => 55],
        // dinner
        ['name' => 'Roast chicken and salad', 'kcal' => 520, 'source' => 'photo', 'barcode' => null, 'protein_g' => 42, 'carbs_g' => 18, 'fat_g' => 30, 'portion_g' => 360, 'hour' => 19, 'minute' => 30],
        ['name' => 'Roti with sambol', 'kcal' => 480, 'source' => 'estimate', 'barcode' => null, 'protein_g' => 12, 'carbs_g' => 66, 'fat_g' => 18, 'portion_g' => 300, 'hour' => 19, 'minute' => 50],
        ['name' => 'Noodles with prawns', 'kcal' => 560, 'source' => 'photo', 'barcode' => null, 'protein_g' => 29, 'carbs_g' => 74, 'fat_g' => 16, 'portion_g' => 400, 'hour' => 20, 'minute' => 5],
        // snacks — the barcode rows, so the lookup/estimate distinction is visible
        ['name' => 'Munchee Marie biscuits', 'kcal' => 148, 'source' => 'lookup', 'barcode' => '4792063000019', 'protein_g' => 3, 'carbs_g' => 24, 'fat_g' => 4, 'portion_g' => 34, 'hour' => 16, 'minute' => 20],
        ['name' => 'Anchor full cream milk', 'kcal' => 122, 'source' => 'lookup', 'barcode' => '9418783000027', 'protein_g' => 7, 'carbs_g' => 10, 'fat_g' => 7, 'portion_g' => 200, 'hour' => 16, 'minute' => 40],
    ];

    private const BREAKFASTS = [0, 1, 2, 3];

    private const LUNCHES = [4, 5, 6];

    private const DINNERS = [7, 8, 9];

    private const SNACKS = [10, 11];

    public function __construct(
        private readonly UpdateProfileUseCase $updateProfile,
        private readonly RecalculatePlanUseCase $recalculatePlan,
        private readonly UserProfileRepository $profiles,
        private readonly RecoveryScoreSeriesReader $recoveryScores,
    ) {
    }

    public function run(?User $user = null, bool $forceProfile = false): void
    {
        $user ??= User::query()->firstOrFail();

        // Same seeded stream as the timeline, so the whole demo account reproduces
        // exactly on a re-run rather than drifting a little each time.
        mt_srand(7003);

        $this->seedProfile($user, $forceProfile);
        $meals = $this->seedMeals($user);
        $sessions = $this->seedSessions($user);
        $plan = $this->seedPlan($user);

        $this->command?->info(sprintf(
            'Seeded %d meals and %d movement sessions across %d days for %s. Plan: %s.',
            $meals,
            $sessions,
            self::DAYS,
            $user->email,
            $plan,
        ));
    }

    /**
     * Fills the body profile, and by default only where the account left a gap.
     *
     * The plan is derived from these five numbers, so a missing height means the
     * calorie goal falls back to a constant and the demo shows a population default
     * where it should show a personal figure.
     */
    private function seedProfile(User $user, bool $force): void
    {
        $existing = $this->profiles->findFor(UserId::fromString((string) $user->id));

        if ($existing === null || $force) {
            $this->updateProfile->execute((string) $user->id, self::PROFILE);

            return;
        }

        // Merge rules live in UserProfile::apply — an absent key leaves the stored
        // value alone — so sending only the gaps is enough to fill them.
        //
        // `statedActivityLevel` and not `activityLevel`: the latter answers with the
        // domain's default when nothing was stated, which would read as "already set"
        // and leave the field empty. Sex is the same shape, defaulting to Unspecified.
        $stored = [
            'date_of_birth' => $existing->dateOfBirth(),
            'sex' => $existing->sex() === Sex::Unspecified ? null : $existing->sex(),
            'height_cm' => $existing->heightCm(),
            'weight_kg' => $existing->weightKg(),
            'activity_level' => $existing->statedActivityLevel(),
            'bmi_scale' => $existing->statedBmiScale(),
        ];

        $changes = [];

        foreach (self::PROFILE as $field => $value) {
            if ($value !== null && ($stored[$field] ?? null) === null) {
                $changes[$field] = $value;
            }
        }

        if ($changes !== []) {
            $this->updateProfile->execute((string) $user->id, $changes);
        }
    }

    /**
     * Breakfast, lunch and dinner every day, plus a snack on most of them.
     *
     * Keyed on (user, day, name) rather than inserted blind: `meal_entries` has no
     * unique index — two identical lunches on one day are genuinely two meals — so
     * idempotency has to come from the seeder knowing what it wrote last time.
     */
    private function seedMeals(User $user): int
    {
        $written = 0;

        foreach ($this->days() as $offset => $date) {
            $picks = [
                self::BREAKFASTS[$offset % count(self::BREAKFASTS)],
                self::LUNCHES[$offset % count(self::LUNCHES)],
                self::DINNERS[$offset % count(self::DINNERS)],
            ];

            // Not every day has a snack — a fortnight where every slot is filled
            // reads as generated, and the coverage panel is more interesting when
            // it has something real to report.
            if ($offset % 3 !== 0) {
                $picks[] = self::SNACKS[$offset % count(self::SNACKS)];
            }

            foreach ($picks as $index) {
                $meal = self::MENU[$index];
                $eatenAt = $date->setTime($meal['hour'], $meal['minute']);

                $attributes = [
                    'eaten_at' => $eatenAt->format('Y-m-d H:i:s'),
                    'kcal' => $meal['kcal'],
                    'source' => MealSource::from($meal['source'])->value,
                    'barcode' => $meal['barcode'],
                    'protein_g' => $meal['protein_g'],
                    'carbs_g' => $meal['carbs_g'],
                    'fat_g' => $meal['fat_g'],
                    'portion_g' => $meal['portion_g'],
                ];

                // whereDate, not updateOrCreate on the raw value: `eaten_on` is cast to
                // a date and stored with a time component, so the plain equality inside
                // updateOrCreate never matches and every re-run inserts the fortnight
                // again. Same trap DemoTimelineSeeder::upsertNight documents.
                $existing = MealEntry::query()
                    ->where('user_id', $user->id)
                    ->whereDate('eaten_on', $date->format('Y-m-d'))
                    ->where('name', $meal['name'])
                    ->first();

                if ($existing !== null) {
                    $existing->fill($attributes)->save();
                } else {
                    MealEntry::query()->create($attributes + [
                        'user_id' => $user->id,
                        'eaten_on' => $date->format('Y-m-d'),
                        'name' => $meal['name'],
                    ]);
                }

                $written++;
            }
        }

        return $written;
    }

    /**
     * A movement history that agrees with the recovery scores around it.
     *
     * The app gates a session on the day's recovery score — full at 70 and above,
     * reduced at 50, mobility below — so seeding sessions whose intensity contradicts
     * the night they sit on would put a contradiction on screen during the one demo
     * step that explains the gating. The score is therefore read back off the seeded
     * snapshot rather than invented.
     */
    private function seedSessions(User $user): int
    {
        $written = 0;
        $days = $this->days();

        // The scores the app itself would show for these days, read through the same
        // service Insights uses. An approximation invented here would put a session
        // marked "full" on a day the dashboard scores at 40, and the demo step that
        // explains the gating would be contradicted by the history behind it.
        $scores = $this->recoveryScores->scoreDays(
            UserId::fromString((string) $user->id),
            $days[0],
            $days[count($days) - 1],
        );

        foreach ($days as $offset => $date) {
            // Roughly every other day, which is what the guided routine suggests.
            if ($offset % 2 === 1) {
                continue;
            }

            $scored = $scores[$date->format('Y-m-d')] ?? null;
            $score = $scored === null ? null : (int) round($scored->score);
            $intensity = match (true) {
                $score === null => ExerciseSession::INTENSITY_UNKNOWN,
                $score >= 70 => ExerciseSession::INTENSITY_FULL,
                $score >= 50 => ExerciseSession::INTENSITY_REDUCED,
                default => ExerciseSession::INTENSITY_MOBILITY,
            };

            $guided = $intensity === ExerciseSession::INTENSITY_MOBILITY;
            $target = match ($intensity) {
                ExerciseSession::INTENSITY_FULL => 15,
                ExerciseSession::INTENSITY_REDUCED => 8,
                default => 12,
            };

            $reps = $target;
            // A counted session grades depth; a few reps short of it is what a real
            // set looks like. A guided one reports no form count at all — nothing
            // watched it, and claiming otherwise would pass reps off as a measurement.
            $goodForm = $guided ? null : max(0, $reps - mt_rand(0, 3));

            ExerciseSession::query()->updateOrCreate(
                [
                    'user_id' => $user->id,
                    'client_uuid' => sprintf('demo-seed-%s', $date->format('Ymd')),
                ],
                [
                    'performed_on' => $date->format('Y-m-d'),
                    'performed_at' => $date->setTime(8, 15)->format('Y-m-d H:i:s'),
                    'exercise' => $guided ? ExerciseSession::EXERCISE_MARCH : ExerciseSession::EXERCISE_SQUAT,
                    'source' => $guided ? ExerciseSession::SOURCE_GUIDED : ExerciseSession::SOURCE_POSE,
                    'total_reps' => $reps,
                    'good_form_reps' => $goodForm,
                    'duration_seconds' => 60 + $reps * mt_rand(4, 7),
                    // Null on most, because the node usually was not connected. A number
                    // here on every session would claim a heart rate nothing recorded.
                    'mean_heart_rate' => $offset % 4 === 0 ? mt_rand(96, 128) : null,
                    'prescribed_intensity' => $intensity,
                    'recovery_score' => $score,
                ],
            );

            $written++;
        }

        return $written;
    }

    /**
     * Derives the plan through the same use case POST /plan/recalculate runs.
     *
     * Not hand-written numbers: the six formulas behind a plan are the product, and
     * a seeded plan that disagrees with what the app would compute is a demo showing
     * something the code does not do.
     */
    private function seedPlan(User $user): string
    {
        $plan = $this->recalculatePlan->ensureExists((string) $user->id);

        return sprintf('version %d (%s)', $plan->version(), $plan->source()->value);
    }

    /**
     * The last DAYS days, oldest first, ending today.
     *
     * @return list<DateTimeImmutable>
     */
    private function days(): array
    {
        $today = new DateTimeImmutable('today');

        return array_map(
            static fn (int $back): DateTimeImmutable => $today->modify(sprintf('-%d days', $back)),
            range(self::DAYS - 1, 0),
        );
    }
}
