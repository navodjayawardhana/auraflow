<?php

namespace Tests\Unit\Domain\Advice;

use App\Domain\Advice\Service\DailyBriefPromptBuilder;
use App\Domain\Advice\ValueObject\DailyContext;
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
        $this->builder = new DailyBriefPromptBuilder();
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
        $prompt = $this->builder->userPrompt(new DailyContext(
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
        $prompt = $this->builder->userPrompt(new DailyContext(
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
        $prompt = $this->builder->userPrompt(new DailyContext(
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
        $prompt = $this->builder->userPrompt(new DailyContext(date: '2026-08-21', steps: 900));

        $this->assertStringContainsString('floor rather than a total', $prompt);
    }

    public function test_should_qualify_the_focus_window_as_a_weak_suggestion(): void
    {
        $prompt = $this->builder->userPrompt(new DailyContext(
            date: '2026-08-21',
            bestFocusWindow: '09:00-11:00',
        ));

        $this->assertStringContainsString('0.67', $prompt);
        $this->assertStringContainsString('not a fact', $prompt);
    }

    public function test_should_ask_for_calm_wording_when_resting_heart_rate_is_elevated(): void
    {
        $prompt = $this->builder->userPrompt(new DailyContext(
            date: '2026-08-21',
            recoveryScore: 41,
            illnessWarning: true,
        ));

        $this->assertStringContainsString('never as a diagnosis', $prompt);
    }

    public function test_should_state_plainly_when_no_score_exists(): void
    {
        $prompt = $this->builder->userPrompt(new DailyContext(
            date: '2026-08-21',
            recoveryUnavailableReason: 'No sleep was recorded for this night.',
        ));

        $this->assertStringContainsString('not available today', $prompt);
        $this->assertStringContainsString('No sleep was recorded', $prompt);
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
