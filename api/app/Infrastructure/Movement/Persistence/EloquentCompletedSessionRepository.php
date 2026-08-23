<?php

namespace App\Infrastructure\Movement\Persistence;

use App\Domain\Movement\Repository\CompletedSessionRepository;
use App\Domain\Movement\ValueObject\CompletedSession;
use App\Domain\Movement\ValueObject\SessionSource;
use App\Domain\Nutrition\ValueObject\CalendarDate;
use App\Domain\Nutrition\ValueObject\DateRange;
use App\Models\ExerciseSession;

final class EloquentCompletedSessionRepository implements CompletedSessionRepository
{
    public function findForUserInRange(string $userId, DateRange $range, int $limit): array
    {
        return ExerciseSession::query()
            ->where('user_id', (int) $userId)
            // Both bounds carry a time for the reason `MealEntry::scopeForUserBetween`
            // records: `performed_on` is a real DATE in MySQL but keeps Eloquent's
            // midnight under SQLite, so a bare `<= 'Y-m-d'` silently drops the last day of
            // every range under test while passing in production.
            ->whereBetween('performed_on', [$range->fromIso().' 00:00:00', $range->toIso().' 23:59:59'])
            ->orderByDesc('performed_at')
            ->orderByDesc('id')
            ->limit($limit)
            ->get()
            ->map(static fn (ExerciseSession $session): CompletedSession => new CompletedSession(
                performedOn: CalendarDate::fromIso($session->performed_on->format('Y-m-d')),
                exercise: (string) $session->exercise,
                source: SessionSource::fromStored($session->source),
                totalReps: (int) $session->total_reps,
                goodFormReps: $session->good_form_reps,
                durationSeconds: $session->duration_seconds,
                prescribedIntensity: $session->prescribed_intensity,
            ))
            ->all();
    }
}
