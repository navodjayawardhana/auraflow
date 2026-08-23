<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Wellbeing\DTO\RecordHealthSnapshotRequest;
use App\Application\Wellbeing\UseCase\ListHealthSnapshotsUseCase;
use App\Application\Wellbeing\UseCase\RecordHealthSnapshotUseCase;
use App\Domain\Wellbeing\Exception\InvalidHeartRateException;
use App\Domain\Wellbeing\Exception\InvalidSleepSummaryException;
use App\Domain\Wellbeing\Model\DailyHealthSnapshot;
use App\Domain\Wellbeing\ValueObject\RestingHeartRateSource;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\ListHealthSnapshotsRequest;
use App\Http\Requests\Api\V1\StoreHealthSnapshotRequest;
use Illuminate\Http\JsonResponse;
use Illuminate\Validation\ValidationException;

/**
 * The one way health data enters the system, whether it comes from a manual entry
 * screen, a dataset import, or a device bridge.
 */
final class HealthSnapshotController extends Controller
{
    public function __construct(
        private readonly RecordHealthSnapshotUseCase $recordSnapshot,
        private readonly ListHealthSnapshotsUseCase $listSnapshots,
    ) {
    }

    public function store(StoreHealthSnapshotRequest $request): JsonResponse
    {
        try {
            $snapshot = $this->recordSnapshot->execute(new RecordHealthSnapshotRequest(
                userId: (string) $request->user()->id,
                date: $request->string('recorded_on')->toString(),
                sleepMinutes: $request->has('sleep_minutes') ? $request->integer('sleep_minutes') : null,
                deepSleepMinutes: $request->input('deep_sleep_minutes') === null ? null : $request->integer('deep_sleep_minutes'),
                remSleepMinutes: $request->input('rem_sleep_minutes') === null ? null : $request->integer('rem_sleep_minutes'),
                restingHeartRate: $request->input('resting_heart_rate') === null ? null : $request->float('resting_heart_rate'),
                restingHrSource: $request->input('resting_hr_source') === null
                    ? null
                    : RestingHeartRateSource::from($request->string('resting_hr_source')->toString()),
                steps: $request->input('steps') === null ? null : $request->integer('steps'),
                stepsAreComplete: $request->input('steps_are_complete') === null ? null : $request->boolean('steps_are_complete'),
                waterMl: $request->input('water_ml') === null ? null : $request->integer('water_ml'),
            ));
        } catch (InvalidSleepSummaryException $e) {
            // The value objects enforce rules the form request cannot express (a night
            // outside a physiologically plausible range, say). Surfacing them as 422s
            // keeps one error shape for the client rather than leaking a 500.
            throw ValidationException::withMessages(['sleep_minutes' => $e->getMessage()]);
        } catch (InvalidHeartRateException $e) {
            throw ValidationException::withMessages(['resting_heart_rate' => $e->getMessage()]);
        }

        return response()->json(['data' => $this->toArray($snapshot)], 201);
    }

    public function index(ListHealthSnapshotsRequest $request): JsonResponse
    {
        $snapshots = $this->listSnapshots->execute(
            (string) $request->user()->id,
            $request->string('from')->toString(),
            $request->string('to')->toString(),
        );

        return response()->json([
            'data' => array_map($this->toArray(...), $snapshots),
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    private function toArray(DailyHealthSnapshot $snapshot): array
    {
        $sleep = $snapshot->sleep();

        return [
            'date' => $snapshot->date()->format('Y-m-d'),
            'sleep_minutes' => $sleep === null ? null : (int) round($sleep->hours() * 60),
            'deep_sleep_minutes' => $sleep?->deepMinutes() === null ? null : (int) round($sleep->deepMinutes()),
            'rem_sleep_minutes' => $sleep?->remMinutes() === null ? null : (int) round($sleep->remMinutes()),
            'resting_heart_rate' => $snapshot->restingHeartRate()?->bpm(),
            // Back out the way it came in. A client charting a fortnight of these has to be
            // able to see where the method changed, because the step at that point is the
            // measurement moving rather than the person.
            'resting_hr_source' => $snapshot->restingHeartRate()?->source()->value,
            'steps' => $snapshot->steps(),
            'steps_are_complete' => $snapshot->stepsAreComplete(),
            'water_ml' => $snapshot->waterMl(),
        ];
    }
}
