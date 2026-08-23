<?php

namespace App\Domain\Advice\Service;

use App\Domain\Advice\ValueObject\DailyContext;
use App\Domain\Advice\ValueObject\GroundingPack;
use App\Domain\Wellbeing\ValueObject\RestingHeartRateSource;

/**
 * Turns a day's measurements, and the fortnight behind them, into the prompt that asks
 * for advice.
 *
 * This is the testable half of the feature. A language model's reply cannot be asserted
 * against a golden value, but what we *ask* it can be — and the prompt is where the
 * safety rules, the refusal to invent data, and the tone actually live. Everything that
 * decides whether this feature is responsible is in this file, so this file is pure.
 *
 * The history arrived after the rules did, and it made them matter more rather than less.
 * A model holding one day can be wrong about one day; a model holding a fortnight can be
 * confidently wrong about a trend, offer a mechanism for it, and average a seated heart
 * rate against an overnight one on the way. Rules 3 to 5 below exist for that, and none
 * of them was needed when the prompt was one morning's figures.
 */
final class DailyBriefPromptBuilder
{
    public function __construct(private readonly GroundingPackRenderer $renderer)
    {
    }

    /**
     * The instruction half. Deliberately restrictive.
     *
     * This is a wellbeing app, not a clinician. An unconstrained model asked about sleep
     * and heart rate will happily speculate about conditions, and a health app that lets
     * it is a different and much more serious product. The boundaries are stated as
     * rules rather than hoped for.
     */
    public function systemInstruction(): string
    {
        return <<<'TEXT'
        You are the daily briefing writer for AuraFlow, a wellbeing app that helps someone
        plan their day around how recovered their body is.

        Write in plain, warm, direct British English. Second person. No emoji, no headings,
        no markdown, no bullet symbols.

        Hard rules, in order of importance:

        1. Never diagnose, never name a medical condition, and never suggest or discourage
           any medication, supplement or treatment. If the data looks concerning, the only
           acceptable action you may suggest is speaking to a doctor.
        2. Only refer to figures given to you below. Never invent, estimate or infer a
           number that is not there. You may count and compare the figures you are given —
           "three of the last seven nights were under six hours" is a fair reading of the
           history — but every number you use must either appear below or be a plain count
           or difference of numbers that do. If something is missing, either say nothing
           about it or say plainly that it was not recorded.
        3. A gap in the history is a gap. A day that is not listed is a day nothing was
           recorded, not a day of zero and not a bad day. Never describe missing data as
           inactivity, as a decline, or as anything at all.
        4. Do not claim causation, and take extra care now there is history. Two series
           that move together do not explain each other. You may say what each did; you
           may never say that one caused, drove, explained or led to the other, and you
           may not offer a mechanism for why a trend happened. Prefer "you may find" over
           "this means".
        5. Never pool measurements of different kinds. A seated resting heart rate and an
           overnight one are two different measurements and must not be averaged or
           trended together. A partial step count is a floor, never a day's total.
           Estimated calories are not measured ones. Wherever a figure is marked
           provisional, partial or estimated, say so in the same breath as the number.
        6. Do not be alarming. A low score is information for planning, not a warning.
        7. If the figures below do not contain what you would need, say so plainly rather
           than reaching for a plausible answer.

        Structure your reply as exactly three short paragraphs, no labels:

        First: what the body is saying today, in one or two sentences, grounded in the
        figures given.
        Second: one concrete suggestion for how to shape the rest of the day around it —
        when to do demanding work, when to rest, whether to train. Match it to the time of
        day you are told it is; advice about a morning is worthless if the morning is over.
        Third: one small, specific thing to pay attention to, drawn from the weakest signal
        in the data.

        Keep the whole reply under 120 words.
        TEXT;
    }

    /**
     * The data half. Only what was actually measured, each labelled with what it is.
     */
    public function userPrompt(GroundingPack $pack): string
    {
        $lines = $this->todayLines($pack->today);

        if ($pack->dayPart !== null) {
            // Between today's figures and the history, because it qualifies the first and
            // not the second: it is the reason the same numbers want different advice at
            // breakfast and at nine in the evening.
            $lines[] = $pack->dayPart->describe();
        }

        $lines[] = '';
        $lines[] = $this->renderer->render($pack);
        $lines[] = '';
        $lines[] = 'Write the briefing now.';

        return implode("\n", $lines);
    }

    /**
     * Today, in full sentences rather than the history's table.
     *
     * Two shapes for the same signals, on purpose. Today is what the briefing is about and
     * carries the qualifiers a reader of one day needs spelled out; the fortnight behind it
     * is a table, because fourteen paragraphs of this would be most of the prompt.
     *
     * @return list<string>
     */
    private function todayLines(DailyContext $context): array
    {
        $lines = ['Today is '.$context->date.'.'];

        if ($context->recoveryScore !== null) {
            $qualifier = $context->recoveryIsProvisional
                ? ' (provisional — there is not yet enough history for a personal resting-heart-rate baseline)'
                : '';

            $lines[] = sprintf(
                'Recovery score: %d out of 100%s. It combines sleep duration, sleep stages and resting heart rate against this person\'s own recent baseline.',
                $context->recoveryScore,
                $qualifier,
            );
        } else {
            $lines[] = 'Recovery score: not available today — '.($context->recoveryUnavailableReason ?? 'no reason given').'.';
        }

        if ($context->illnessWarning) {
            $lines[] = 'Resting heart rate is unusually high compared with their own recent baseline. Mention it calmly as something to watch, never as a diagnosis.';
        }

        if ($context->sleepMinutes !== null) {
            $sleep = sprintf('Sleep last night: %.1f hours', $context->sleepMinutes / 60);

            if ($context->deepSleepMinutes !== null && $context->remSleepMinutes !== null) {
                $sleep .= sprintf(
                    ', of which %d minutes deep and %d minutes REM',
                    $context->deepSleepMinutes,
                    $context->remSleepMinutes,
                );
            }

            $lines[] = $sleep.'.';
        }

        if ($context->restingHeartRate !== null) {
            // The kind of reading, not just the number. A seated morning capture reads
            // several bpm above the same person's overnight rate, so a briefing that
            // compares today's figure with the table above has to know which it is holding.
            $lines[] = sprintf(
                'Resting heart rate: %.1f bpm, %s.',
                $context->restingHeartRate,
                $this->describeRestingHeartRate($context),
            );
        }

        if ($context->steps !== null) {
            // Two different sentences for the same integer. Where the operating system
            // kept the count, it is the day and may be spoken of as one; where the app
            // did, it is whatever the user's screen time happened to cover.
            $lines[] = $context->stepsAreComplete === true
                ? sprintf('Steps so far: %d, counted by the phone all day.', $context->steps)
                : sprintf(
                    'Steps so far: %d. This is only counted while the app is open, so treat it as a floor rather than a total.',
                    $context->steps,
                );
        }

        if ($context->waterMl !== null) {
            $lines[] = sprintf('Water logged: %d ml against a %d ml target.', $context->waterMl, $context->waterTargetMl);
        }

        if ($context->weatherDescription !== null) {
            $weather = 'Weather where they are: '.$context->weatherDescription;
            if ($context->temperatureC !== null) {
                $weather .= sprintf(', %.0f degrees', $context->temperatureC);
            }
            $lines[] = $weather.'.';
        }

        if ($context->locationContext !== null) {
            $lines[] = 'They are currently at: '.$context->locationContext.'.';
        }

        if ($context->bestFocusWindow !== null) {
            $lines[] = sprintf(
                'An on-device model suggests their best window for demanding work is around %s. The model is weak (holdout ROC-AUC 0.67) and predicts a mood-derived proxy rather than measured focus, so present it as a suggestion, not a fact.',
                $context->bestFocusWindow,
            );
        }

        return $lines;
    }

    private function describeRestingHeartRate(DailyContext $context): string
    {
        return match ($context->restingHeartRateSource) {
            RestingHeartRateSource::Overnight => 'measured overnight',
            RestingHeartRateSource::SeatedSpot => 'a seated morning capture, which reads above the same person\'s overnight rate',
            null => 'the row does not say how it was taken, so do not compare it with the readings in the history',
        };
    }
}
