<?php

namespace App\Domain\Advice\Service;

use App\Domain\Advice\ValueObject\GroundingPack;
use App\Domain\Advice\ValueObject\HistoryDay;
use App\Domain\Advice\ValueObject\PlanTargets;
use App\Domain\Advice\ValueObject\RecentMeal;
use App\Domain\Movement\ValueObject\CompletedSession;
use App\Domain\Nutrition\ValueObject\MealSource;
use App\Domain\Planning\ValueObject\PlanSource;
use App\Domain\Wellbeing\ValueObject\RestingHeartRateSource;

/**
 * How a fortnight of someone's own rows is described to a model — decided once.
 *
 * The briefing and the assistant ask different questions of the same pack, but they must
 * not describe it differently: two renderings of the same history is two chances for one
 * of them to drop a qualifier, and the qualifier is the entire point. `1,800 kcal` and
 * `1,800 kcal, none of it measured` are the same integer and different claims, and a model
 * shown the first will say "you ate 1,800 calories" with complete confidence.
 *
 * Pure, like the prompt builders it serves, and for the same reason: everything here can
 * be asserted against a golden string, and everything here is a decision about honesty
 * rather than about plumbing.
 *
 * ## The legend is load-bearing
 *
 * Fourteen labelled lines cost more tokens than fourteen bare ones, and the tokens buy the
 * only thing that makes history safe to hand over. A dash has to be readable as "nobody
 * measured this" rather than zero; a seated resting rate has to be unpoolable with an
 * overnight one; a partial step count has to stay a floor. So the legend is emitted before
 * the rows and states each convention once, rather than repeating a parenthetical on every
 * line.
 */
final class GroundingPackRenderer
{
    /** What a missing figure looks like. Explained in the legend, never bare. */
    private const ABSENT = '-';

    /**
     * The whole pack, as the block that precedes a question or a request for a briefing.
     *
     * Order is deliberate: today first, because most questions are about today and a model
     * answers from what it read most recently as readily as from what is most relevant;
     * then the history it may be asked to compare today against; then the detail.
     */
    public function render(GroundingPack $pack): string
    {
        $sections = array_filter([
            $this->renderHistory($pack->history),
            $this->renderMeals($pack->recentMeals),
            $this->renderSessions($pack->sessions),
            $this->renderTargets($pack->targets),
        ]);

        return implode("\n\n", $sections);
    }

    /**
     * @param  list<HistoryDay>  $history
     */
    public function renderHistory(array $history): string
    {
        // Days nothing was recorded are dropped rather than printed as rows of dashes. A
        // user who logged four days of a fortnight should see four lines and a stated
        // window, not ten lines of nothing that read as ten measured days of absence.
        $recorded = array_values(array_filter($history, static fn (HistoryDay $day): bool => ! $day->isEmpty()));

        if ($recorded === []) {
            return 'Daily history: nothing has been recorded in the last '
                .GroundingPack::HISTORY_DAYS.' days. Do not infer anything from that silence.';
        }

        $lines = [
            'Daily history for the last '.GroundingPack::HISTORY_DAYS.' days, oldest first. '
                .'Days on which nothing at all was recorded are not listed; there are '
                .count($recorded).' of '.count($history).' days below.',
            'Each line reads: date, recovery score out of 100, sleep, resting heart rate, '
                .'steps, water, food.',
            '"'.self::ABSENT.'" means that figure was not recorded that day. It does not mean zero.',
            '"provisional" marks a score computed without a personal resting-heart-rate baseline.',
            '"overnight" and "seated" say how a resting rate was taken. They are two different '
                .'measurements of the same heart and read several bpm apart, so they must never '
                .'be averaged together or compared with one another.',
            '"partial" marks a step count that covers only the hours the app was open, so it is '
                .'a floor and not a day.',
            '"est" is the part of a day\'s calories that nobody measured — a photograph\'s guess '
                .'or the person\'s own.',
            '',
        ];

        foreach ($recorded as $day) {
            $lines[] = $this->renderHistoryDay($day);
        }

        return implode("\n", $lines);
    }

    /**
     * @param  list<RecentMeal>  $meals
     */
    public function renderMeals(array $meals): string
    {
        if ($meals === []) {
            return 'Named meals: none logged in the last '.GroundingPack::NAMED_MEAL_DAYS
                .' days. Earlier days have calorie totals in the history above but no names, '
                .'so you cannot say what was eaten on them.';
        }

        $lines = [
            'Named meals from the last '.GroundingPack::NAMED_MEAL_DAYS.' days, oldest first. '
                .'Older days have totals in the history above and no names.',
        ];

        foreach ($meals as $meal) {
            $lines[] = sprintf(
                '- %s %s, %d kcal (%s)',
                $meal->date,
                $meal->name,
                $meal->kcal,
                $this->describeMealSource($meal->source),
            );
        }

        return implode("\n", $lines);
    }

    /**
     * @param  list<CompletedSession>  $sessions
     */
    public function renderSessions(array $sessions): string
    {
        if ($sessions === []) {
            return 'Movement sessions: none recorded in the last '.GroundingPack::HISTORY_DAYS
                .' days. That means none were logged in the app, which is not the same as none '
                .'having happened.';
        }

        $lines = [
            'Movement sessions in the last '.GroundingPack::HISTORY_DAYS.' days, most recent first, '
                .'at most '.GroundingPack::SESSION_LIMIT.' shown.',
        ];

        foreach ($sessions as $session) {
            $lines[] = '- '.$this->renderSession($session);
        }

        return implode("\n", $lines);
    }

    public function renderTargets(?PlanTargets $targets): string
    {
        if ($targets === null) {
            return 'Targets: this person has no derived plan yet, so there are no step, water or '
                .'sleep goals to measure their day against. Do not invent one.';
        }

        $lines = [
            'Their current targets, each with where the number came from. A target is only theirs '
                .'where the source says so — never present a population default as personal.',
            sprintf('- Steps: %d (%s)', $targets->stepGoal, $this->describePlanSource($targets->stepGoalSource)),
            sprintf('- Water: %d ml (%s)', $targets->waterMl, $this->describePlanSource($targets->waterSource)),
            sprintf('- Sleep: %.1f hours (%s)', $targets->sleepNeedHours, $this->describePlanSource($targets->sleepNeedSource)),
        ];

        $lines[] = $targets->activeKcalGoal === null
            // Absent rather than substituted, and the prompt says why. A population figure
            // here would be the app prescribing an energy target for somebody else.
            ? '- Active energy: no target, because their profile does not carry the figures one '
                .'would need. Say it is not set rather than suggesting a number.'
            : sprintf('- Active energy: %d kcal', $targets->activeKcalGoal);

        $lines[] = $targets->heartRateZoneSummary === null
            ? '- Training heart-rate range: not set, for the same reason. Never suggest one.'
            : '- Training heart-rate range: '.$targets->heartRateZoneSummary;

        if ($targets->missingFromProfile !== []) {
            $lines[] = 'Their profile is missing: '.implode(', ', $targets->missingFromProfile)
                .'. That is why some targets are absent.';
        }

        return implode("\n", $lines);
    }

    private function renderHistoryDay(HistoryDay $day): string
    {
        $cells = [
            $day->date,
            $day->recoveryScore === null
                ? 'recovery '.self::ABSENT
                : 'recovery '.$day->recoveryScore.($day->recoveryIsProvisional ? ' provisional' : ''),
            $day->sleepMinutes === null
                ? 'sleep '.self::ABSENT
                : sprintf('sleep %.1fh', $day->sleepMinutes / 60),
            $day->restingHeartRate === null
                ? 'resting HR '.self::ABSENT
                : sprintf(
                    'resting HR %.1f %s',
                    $day->restingHeartRate,
                    $this->describeHeartRateSource($day->restingHeartRateSource),
                ),
            $day->steps === null
                ? 'steps '.self::ABSENT
                : 'steps '.$day->steps.($day->stepsAreComplete === true ? '' : ' partial'),
            $day->waterMl === null ? 'water '.self::ABSENT : 'water '.$day->waterMl.'ml',
            $this->renderDayFood($day),
        ];

        return implode('  ', $cells);
    }

    private function renderDayFood(HistoryDay $day): string
    {
        if ($day->kcal === null) {
            return 'food '.self::ABSENT;
        }

        $food = sprintf('food %d kcal over %d meals', $day->kcal, $day->mealCount);

        // Stated even when it is zero of the total. "No estimate in it" is a claim worth
        // making, and its absence would be read as the qualifier simply not applying.
        return $food.sprintf(', est %d kcal', $day->estimatedKcal);
    }

    private function renderSession(CompletedSession $session): string
    {
        $line = sprintf('%s %s, %d reps', $session->performedOn->format('Y-m-d'), $session->exercise, $session->totalReps);

        if ($session->durationSeconds !== null) {
            $line .= sprintf(', %d minutes', (int) round($session->durationSeconds / 60));
        }

        // The claim, not a footnote on it. A guided session's reps were never observed, and
        // a count of assumed reps summed beside a count of graded ones is one confident
        // number that is only half earned.
        $line .= $session->source->wasObserved()
            ? ($session->goodFormReps === null
                ? ', watched and counted by the on-device pose model'
                : sprintf(', %d of them at full depth as graded by the on-device pose model', $session->goodFormReps))
            : ', followed along to a guided figure — the reps are assumed, nothing observed them';

        return $line;
    }

    private function describeMealSource(MealSource $source): string
    {
        return match ($source) {
            MealSource::Lookup => 'looked up in a food database, so measured by the manufacturer',
            MealSource::Estimate => 'the person\'s own estimate, not measured',
            MealSource::Photo => 'a vision model\'s guess from a photograph, not measured',
        };
    }

    private function describeHeartRateSource(?RestingHeartRateSource $source): string
    {
        return match ($source) {
            RestingHeartRateSource::Overnight => 'overnight',
            RestingHeartRateSource::SeatedSpot => 'seated',
            // A rate whose provenance the row does not state. Guessing at it is the one
            // thing the whole distinction exists to prevent.
            null => 'source not stated',
        };
    }

    /**
     * The plan's provenance strings, said in words.
     *
     * A model handed `measured_7d` will paraphrase it, and the paraphrase is where "your
     * seven-day median" becomes "your usual". These are the app's own claims about where a
     * number came from and they are spelled out rather than left to be interpreted.
     */
    private function describePlanSource(string $source): string
    {
        return match ($source) {
            PlanSource::MEASURED_14D => 'from their own last 14 days',
            PlanSource::MEASURED_7D => 'from their own last 7 days',
            PlanSource::PROFILE_MASS => 'calculated from their body mass',
            PlanSource::PROFILE_SEX => 'a reference intake for their sex, not personal to them',
            PlanSource::PROFILE_AGE => 'the published age band, not personal to them',
            PlanSource::USER_EDITED => 'a figure they chose themselves',
            PlanSource::POPULATION_DEFAULT => 'a population default — not personal to them at all',
            default => 'source not stated',
        };
    }
}
