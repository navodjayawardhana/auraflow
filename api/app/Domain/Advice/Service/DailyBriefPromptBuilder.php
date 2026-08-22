<?php

namespace App\Domain\Advice\Service;

use App\Domain\Advice\ValueObject\DailyContext;

/**
 * Turns a day's measurements into the prompt that asks for advice.
 *
 * This is the testable half of the feature. A language model's reply cannot be asserted
 * against a golden value, but what we *ask* it can be — and the prompt is where the
 * safety rules, the refusal to invent data, and the tone actually live. Everything that
 * decides whether this feature is responsible is in this file, so this file is pure.
 */
final class DailyBriefPromptBuilder
{
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
           number that is not there. If something is missing, either say nothing about it
           or say plainly that it was not recorded.
        3. Do not claim causation. Sleep and heart rate are correlated with how someone
           feels; they do not prove why. Prefer "you may find" over "this means".
        4. Do not be alarming. A low score is information for planning, not a warning.
        5. If a figure is marked as an estimate or as provisional, describe it that way.

        Structure your reply as exactly three short paragraphs, no labels:

        First: what the body is saying today, in one or two sentences, grounded in the
        figures given.
        Second: one concrete suggestion for how to shape the day around it — when to do
        demanding work, when to rest, whether to train.
        Third: one small, specific thing to pay attention to, drawn from the weakest signal
        in the data.

        Keep the whole reply under 120 words.
        TEXT;
    }

    /**
     * The data half. Only what was actually measured, each labelled with what it is.
     */
    public function userPrompt(DailyContext $context): string
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
            $lines[] = sprintf('Resting heart rate: %.1f bpm.', $context->restingHeartRate);
        }

        if ($context->steps !== null) {
            $lines[] = sprintf(
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

        $lines[] = 'Write the briefing now.';

        return implode("\n", $lines);
    }
}
