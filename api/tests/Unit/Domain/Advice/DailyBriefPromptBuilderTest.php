<?php

namespace Tests\Unit\Domain\Advice;

use App\Domain\Advice\Service\DailyBriefPromptBuilder;
use App\Domain\Advice\Service\GroundingPackRenderer;
use App\Domain\Advice\ValueObject\DailyContext;
use App\Domain\Advice\ValueObject\DayPart;
use App\Domain\Advice\ValueObject\GroundingPack;
use App\Domain\Advice\ValueObject\HistoryDay;
use App\Domain\Advice\ValueObject\RecentMeal;
use App\Domain\Nutrition\ValueObject\MealSource;
use App\Domain\Wellbeing\ValueObject\RestingHeartRateSource;
use PHPUnit\Framework\TestCase;

/**
 * The model's reply cannot be asserted against a golden value, but the prompt can — and
 * the prompt is where the safety rules and the refusal to invent data actually live. This
 * is therefore the test that covers whether the feature is responsible, not merely
 * whether it runs.
 */
class DailyBriefPromptBuilderTest extends TestCase
{
    private DailyBriefPromptBuilder $builder;

    protected function setUp(): void
    {
        parent::setUp();
        $this->builder = new DailyBriefPromptBuilder(new GroundingPackRenderer());
    }

    /**
     * The prompt for a day with nothing behind it.
     *
     * The builder takes a whole grounding pack now, but most of what is asserted below is
     * still about a single day's figures, and rewriting every case to build a fortnight it
     * does not use would bury the assertion that matters. So the day is wrapped and the
     * cases read as they did.
     */
    private function promptFor(DailyContext $context, ?DayPart $dayPart = null): string
    {
        return $this->builder->userPrompt(new GroundingPack(today: $context, dayPart: $dayPart));
    }

    // --- The instruction half ---

    public function test_should_forbid_diagnosis_and_treatment(): void
    {
        $instruction = $this->builder->systemInstruction();

        $this->assertStringContainsString('Never diagnose', $instruction);
        $this->assertStringContainsString('never name a medical condition', $instruction);
        $this->assertStringContainsString('medication', $instruction);
    }

    public function test_should_forbid_inventing_figures(): void
    {
        // Collapsed first: the rule is line-wrapped for readability in the heredoc, and a
        // test that breaks on rewrapping would train people to stop editing the prompt.
        $instruction = preg_replace('/\s+/', ' ', $this->builder->systemInstruction());

        $this->assertStringContainsString('Only refer to figures given to you below', $instruction);
        $this->assertStringContainsString('Never invent, estimate or infer a number', $instruction);
    }

    public function test_should_forbid_claiming_causation(): void
    {
        $this->assertStringContainsString('Do not claim causation', $this->builder->systemInstruction());
    }

    // --- The data half ---

    public function test_should_describe_a_provisional_score_as_provisional(): void
    {
        $prompt = $this->promptFor(new DailyContext(
            date: '2026-08-21',
            recoveryScore: 62,
            recoveryIsProvisional: true,
        ));

        $this->assertStringContainsString('62 out of 100', $prompt);
        $this->assertStringContainsString('provisional', $prompt);
    }

    public function test_should_omit_measurements_that_were_not_recorded(): void
    {
        // The one property that matters most: a figure the app does not have must not
        // appear in the prompt at all, because a model shown an empty slot will fill it.
        $prompt = $this->promptFor(new DailyContext(
            date: '2026-08-21',
            recoveryScore: 75,
        ));

        $this->assertStringNotContainsString('Sleep last night', $prompt);
        $this->assertStringNotContainsString('Resting heart rate:', $prompt);
        $this->assertStringNotContainsString('Steps so far', $prompt);
        $this->assertStringNotContainsString('Water logged', $prompt);
        $this->assertStringNotContainsString('Weather', $prompt);
    }

    public function test_should_include_measurements_that_were_recorded(): void
    {
        $prompt = $this->promptFor(new DailyContext(
            date: '2026-08-21',
            recoveryScore: 75,
            sleepMinutes: 450,
            deepSleepMinutes: 92,
            remSleepMinutes: 104,
            restingHeartRate: 57.4,
            steps: 6420,
            waterMl: 1500,
            weatherDescription: 'broken clouds',
            temperatureC: 28.4,
            locationContext: 'work',
            bestFocusWindow: '09:00-11:00',
        ));

        $this->assertStringContainsString('7.5 hours', $prompt);
        $this->assertStringContainsString('92 minutes deep', $prompt);
        $this->assertStringContainsString('57.4 bpm', $prompt);
        $this->assertStringContainsString('6420', $prompt);
        $this->assertStringContainsString('1500 ml', $prompt);
        $this->assertStringContainsString('broken clouds', $prompt);
        $this->assertStringContainsString('work', $prompt);
    }

    public function test_should_qualify_steps_as_a_floor_not_a_total(): void
    {
        // Android only counts while the app is foregrounded. Handing the model a partial
        // figure without saying so would invite it to reason about a sedentary day.
        $prompt = $this->promptFor(new DailyContext(date: '2026-08-21', steps: 900));

        $this->assertStringContainsString('floor rather than a total', $prompt);
    }

    public function test_should_qualify_the_focus_window_as_a_weak_suggestion(): void
    {
        $prompt = $this->promptFor(new DailyContext(
            date: '2026-08-21',
            bestFocusWindow: '09:00-11:00',
        ));

        $this->assertStringContainsString('0.67', $prompt);
        $this->assertStringContainsString('not a fact', $prompt);
    }

    public function test_should_ask_for_calm_wording_when_resting_heart_rate_is_elevated(): void
    {
        $prompt = $this->promptFor(new DailyContext(
            date: '2026-08-21',
            recoveryScore: 41,
            illnessWarning: true,
        ));

        $this->assertStringContainsString('never as a diagnosis', $prompt);
    }

    public function test_should_state_plainly_when_no_score_exists(): void
    {
        $prompt = $this->promptFor(new DailyContext(
            date: '2026-08-21',
            recoveryUnavailableReason: 'No sleep was recorded for this night.',
        ));

        $this->assertStringContainsString('not available today', $prompt);
        $this->assertStringContainsString('No sleep was recorded', $prompt);
    }

    // --- The rules that only history makes necessary ---

    public function test_should_forbid_treating_a_gap_in_the_history_as_a_zero(): void
    {
        // The failure this guards is fluent and invisible: a fortnight with four recorded
        // days reads as ten days of inactivity unless the model is told otherwise, and it
        // will describe those ten days in perfectly warm prose.
        $instruction = preg_replace('/\s+/', ' ', $this->builder->systemInstruction());

        $this->assertStringContainsString('A gap in the history is a gap', $instruction);
        $this->assertStringContainsString('not a day of zero', $instruction);
    }

    public function test_should_forbid_explaining_one_series_by_another(): void
    {
        $instruction = preg_replace('/\s+/', ' ', $this->builder->systemInstruction());

        $this->assertStringContainsString('Two series that move together do not explain each other', $instruction);
        $this->assertStringContainsString('may not offer a mechanism', $instruction);
    }

    public function test_should_forbid_pooling_measurements_of_different_kinds(): void
    {
        $instruction = preg_replace('/\s+/', ' ', $this->builder->systemInstruction());

        $this->assertStringContainsString('Never pool measurements of different kinds', $instruction);
        $this->assertStringContainsString('A partial step count is a floor', $instruction);
    }

    public function test_should_allow_counting_what_it_was_given_but_nothing_further(): void
    {
        // Without this the honest reading of "invent no number" forbids "three of the last
        // seven nights were under six hours", which is the whole reason to hand over a
        // history at all.
        $instruction = preg_replace('/\s+/', ' ', $this->builder->systemInstruction());

        $this->assertStringContainsString('You may count and compare the figures you are given', $instruction);
        $this->assertStringContainsString('plain count or difference of numbers that do', $instruction);
    }

    public function test_should_tell_the_model_to_say_when_the_answer_is_not_there(): void
    {
        $instruction = preg_replace('/\s+/', ' ', $this->builder->systemInstruction());

        $this->assertStringContainsString('say so plainly rather than reaching for a plausible answer', $instruction);
    }

    // --- The pack in the prompt ---

    public function test_should_label_estimated_calories_as_estimated(): void
    {
        // The failure in one line: a model handed "1,800 kcal" says "you ate 1,800
        // calories", and a photograph's guess has just acquired the authority of a label.
        $prompt = $this->builder->userPrompt(new GroundingPack(
            today: new DailyContext(date: '2026-08-21', recoveryScore: 70),
            history: [new HistoryDay(
                date: '2026-08-20',
                kcal: 1800,
                mealCount: 3,
                estimatedKcal: 1200,
                estimatedMealCount: 2,
            )],
            recentMeals: [new RecentMeal('2026-08-21', 'Rice and curry', 640, MealSource::Photo)],
        ));

        $this->assertStringContainsString('food 1800 kcal over 3 meals, est 1200 kcal', $prompt);
        $this->assertStringContainsString('Rice and curry, 640 kcal (a vision model\'s guess from a photograph, not measured)', $prompt);
    }

    public function test_should_say_how_each_resting_heart_rate_was_taken(): void
    {
        $prompt = $this->builder->userPrompt(new GroundingPack(
            today: new DailyContext(
                date: '2026-08-21',
                restingHeartRate: 64.0,
                restingHeartRateSource: RestingHeartRateSource::SeatedSpot,
            ),
            history: [new HistoryDay(
                date: '2026-08-20',
                restingHeartRate: 56.2,
                restingHeartRateSource: RestingHeartRateSource::Overnight,
            )],
        ));

        // Both readings are in the prompt and neither is bare. A seated 64 trended against
        // an overnight 56 is a two-bpm-a-day climb that never happened.
        $this->assertStringContainsString('a seated morning capture', $prompt);
        $this->assertStringContainsString('resting HR 56.2 overnight', $prompt);
        $this->assertStringContainsString('must never be averaged together', $prompt);
    }

    public function test_should_not_print_days_on_which_nothing_was_recorded(): void
    {
        $prompt = $this->builder->userPrompt(new GroundingPack(
            today: new DailyContext(date: '2026-08-21', recoveryScore: 70),
            history: [
                new HistoryDay(date: '2026-08-19'),
                new HistoryDay(date: '2026-08-20', sleepMinutes: 400),
            ],
        ));

        $this->assertStringContainsString('2026-08-20', $prompt);
        $this->assertStringNotContainsString('2026-08-19', $prompt);
        // The window is still stated, so the model can see that a day is missing rather
        // than inferring the history simply began on the 20th.
        $this->assertStringContainsString('there are 1 of 2 days below', $prompt);
    }

    public function test_should_tell_the_model_what_time_of_day_it_is(): void
    {
        // A brief written at nine in the evening that suggests how to plan the morning is
        // the complaint this exists to answer.
        $prompt = $this->promptFor(new DailyContext(date: '2026-08-21', recoveryScore: 70), DayPart::Evening);

        $this->assertStringContainsString('It is the evening', $prompt);
        $this->assertStringNotContainsString('It is the morning', $prompt);
    }

    // --- The gate ---

    public function test_should_refuse_to_brief_on_an_empty_day(): void
    {
        // A briefing written from nothing is the model producing filler, which is the
        // failure this feature most has to avoid.
        $this->assertFalse((new DailyContext(date: '2026-08-21'))->isSufficient());
        $this->assertFalse((new DailyContext(date: '2026-08-21', steps: 400))->isSufficient());

        $this->assertTrue((new DailyContext(date: '2026-08-21', recoveryScore: 75))->isSufficient());
        $this->assertTrue((new DailyContext(date: '2026-08-21', sleepMinutes: 420))->isSufficient());
    }
}
