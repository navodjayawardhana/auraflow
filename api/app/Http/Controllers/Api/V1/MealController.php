<?php

namespace App\Http\Controllers\Api\V1;

use App\Application\Nutrition\UseCase\EstimateMealFromPhotoUseCase;
use App\Domain\Nutrition\Exception\UnreadableMealPhotoException;
use App\Domain\Nutrition\Service\NutritionAggregator;
use App\Domain\Nutrition\ValueObject\DateRange;
use App\Domain\Nutrition\ValueObject\LoggedMeal;
use App\Domain\Nutrition\ValueObject\Period;
use App\Domain\Nutrition\ValueObject\PeriodTotals;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\EstimateMealPhotoRequest;
use App\Http\Requests\Api\V1\ListMealsRequest;
use App\Http\Requests\Api\V1\StoreMealRequest;
use App\Infrastructure\Nutrition\OpenFoodFactsClient;
use App\Models\MealEntry;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Throwable;

final class MealController extends Controller
{
    public function __construct(
        private readonly OpenFoodFactsClient $foodFacts,
        private readonly EstimateMealFromPhotoUseCase $estimateFromPhoto,
        private readonly NutritionAggregator $aggregator,
    ) {
    }

    /**
     * The meals in a window, and what they add up to by day, by week and by month.
     *
     * All three groupings come back from one request rather than behind a `group`
     * parameter. The window is capped at a quarter, so the widest reply is 92 day buckets,
     * 14 week buckets and 4 month ones — a few kilobytes — and the alternative is three
     * round trips to draw one screen, or a client that switches tabs and shows a spinner
     * over totals it already has the meals for.
     */
    public function index(ListMealsRequest $request): JsonResponse
    {
        $range = $request->range();

        $meals = MealEntry::query()
            ->forUserBetween($request->user()->id, $range->fromIso(), $range->toIso())
            ->get();

        // Out of Eloquent and into the domain before anything is added up. The aggregator
        // is the part that can be silently wrong, so it works on plain values it can be
        // tested against by hand rather than on rows fetched by this query.
        $logged = $meals->map(fn (MealEntry $meal) => $meal->toLoggedMeal())->all();
        $totals = $this->aggregator->total($logged, $range);

        return response()->json([
            'data' => $meals->map($this->toArray(...))->all(),
            'meta' => [
                'from' => $range->fromIso(),
                'to' => $range->toIso(),

                // The day view's four figures, unchanged and unprefixed, because a client
                // that predates the history screen still reads exactly these.
                'total_kcal' => $totals->kcal,
                'protein_g' => $totals->proteinG,
                'carbs_g' => $totals->carbsG,
                'fat_g' => $totals->fatG,
                // Deliberately no "net calories". Energy out is estimated from steps that
                // are themselves only counted while the app is open, so a net figure
                // would be a small number computed from two large uncertain ones -- the
                // most misleading arithmetic a health app can offer.

                // The same sum with its provenance intact: how much of it a manufacturer
                // declared and how much of it somebody guessed. A client that shows the
                // total without this has no way to know whether to qualify it.
                'totals' => $totals->toArray(),

                'days' => $this->bucketsOf($logged, $range, Period::Day),
                'weeks' => $this->bucketsOf($logged, $range, Period::Week),
                'months' => $this->bucketsOf($logged, $range, Period::Month),
            ],
        ]);
    }

    /**
     * @param  list<LoggedMeal>  $logged
     * @return list<array<string, mixed>>
     */
    private function bucketsOf(array $logged, DateRange $range, Period $period): array
    {
        return array_map(
            static fn (PeriodTotals $bucket): array => $bucket->toArray(),
            $this->aggregator->summarise($logged, $range, $period),
        );
    }

    public function store(StoreMealRequest $request): JsonResponse
    {
        $eatenAt = $request->filled('eaten_at') ? $request->date('eaten_at') : now();

        $meal = MealEntry::query()->create([
            'user_id' => $request->user()->id,
            // The day is taken from the offset the client sent, not from the instant after
            // it is stored. A meal eaten at half past midnight in Colombo is 19:00 the
            // previous day in UTC, and filing it under yesterday would move it into the
            // wrong day, the wrong week and sometimes the wrong month. `eaten_at` keeps the
            // instant; `eaten_on` keeps the day the eater was living in.
            'eaten_on' => $eatenAt->format('Y-m-d'),
            'eaten_at' => $eatenAt,
            'name' => $request->string('name')->trim()->toString(),
            'kcal' => $request->integer('kcal'),
            'source' => $request->string('source')->toString(),
            'barcode' => $request->input('barcode'),
            'protein_g' => $request->input('protein_g'),
            'carbs_g' => $request->input('carbs_g'),
            'fat_g' => $request->input('fat_g'),
            'portion_g' => $request->input('portion_g'),
        ]);

        return response()->json(['data' => $this->toArray($meal)], 201);
    }

    public function destroy(Request $request, int $meal): JsonResponse
    {
        // Scoped to the caller, so an id from another account resolves to nothing rather
        // than to someone else's row.
        $deleted = MealEntry::query()
            ->where('user_id', $request->user()->id)
            ->where('id', $meal)
            ->delete();

        return response()->json(null, $deleted > 0 ? 204 : 404);
    }

    /** Barcode lookup. 404 when the product is unknown — a normal outcome, not a fault. */
    public function lookup(Request $request, string $barcode): JsonResponse
    {
        $request->user();

        if (! preg_match('/^\d{6,14}$/', $barcode)) {
            return response()->json(['message' => 'That is not a barcode.'], 422);
        }

        $product = $this->foodFacts->findByBarcode($barcode);

        if ($product === null) {
            return response()->json([
                'message' => "That product isn't in Open Food Facts — you can enter it yourself.",
            ], 404);
        }

        return response()->json(['data' => $product]);
    }

    /**
     * What a vision model thinks is on the plate.
     *
     * Estimates only, and nothing is written here: the reply is a draft the user edits and
     * then posts to `store` like any other meal. Splitting it that way is what keeps the
     * model out of the write path — a figure only ever reaches the database after a person
     * has looked at it.
     */
    public function estimate(EstimateMealPhotoRequest $request): JsonResponse
    {
        try {
            $estimate = $this->estimateFromPhoto->execute($request->imageBytes(), $request->mimeType());
        } catch (UnreadableMealPhotoException) {
            // 422: the photo is the problem, and retrying the same one will fail the same
            // way. Distinct from the 503 below, which is worth trying again.
            return response()->json([
                'message' => "AuraFlow couldn't find food in that photo — you can type it in instead.",
            ], 422);
        } catch (Throwable) {
            return response()->json([
                'message' => 'Photo recognition is unavailable right now.',
            ], 503);
        }

        return response()->json([
            'data' => $estimate->toArray() + [
                // Named for the same reason a brief names its writer: a guess produced by a
                // model since replaced should be identifiable rather than anonymous.
                'model' => config('services.gemini.model'),
                // The source the client posts back, sent rather than assumed, so what this
                // row's provenance will be is decided in one place.
                'source' => MealEntry::SOURCE_PHOTO,
            ],
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    private function toArray(MealEntry $meal): array
    {
        return [
            'id' => $meal->id,
            'name' => $meal->name,
            'kcal' => $meal->kcal,
            // The client renders a looked-up figure and a guessed one differently, so the
            // distinction travels with the row rather than being inferred from `barcode`.
            'source' => $meal->source,
            'barcode' => $meal->barcode,
            'protein_g' => $meal->protein_g,
            'carbs_g' => $meal->carbs_g,
            'fat_g' => $meal->fat_g,
            'portion_g' => $meal->portion_g,
            'eaten_at' => $meal->eaten_at?->toAtomString(),
            // The day the meal was filed under, sent alongside the instant. The client
            // groups a history list by this rather than re-deriving a date from the
            // timestamp, which would put a late supper on the wrong day for anyone whose
            // offset differs from the one the row was written with.
            'eaten_on' => $meal->eaten_on?->format('Y-m-d'),
        ];
    }
}
