<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\ListMealsRequest;
use App\Http\Requests\Api\V1\StoreMealRequest;
use App\Infrastructure\Nutrition\OpenFoodFactsClient;
use App\Models\MealEntry;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class MealController extends Controller
{
    public function __construct(private readonly OpenFoodFactsClient $foodFacts)
    {
    }

    public function index(ListMealsRequest $request): JsonResponse
    {
        $meals = MealEntry::query()
            ->where('user_id', $request->user()->id)
            ->whereDate('eaten_on', $request->string('date')->toString())
            ->orderBy('eaten_at')
            ->get();

        return response()->json([
            'data' => $meals->map($this->toArray(...))->all(),
            'meta' => [
                'total_kcal' => (int) $meals->sum('kcal'),
                'protein_g' => (int) $meals->sum('protein_g'),
                'carbs_g' => (int) $meals->sum('carbs_g'),
                'fat_g' => (int) $meals->sum('fat_g'),
                // Deliberately no "net calories". Energy out is estimated from steps that
                // are themselves only counted while the app is open, so a net figure
                // would be a small number computed from two large uncertain ones -- the
                // most misleading arithmetic a health app can offer.
            ],
        ]);
    }

    public function store(StoreMealRequest $request): JsonResponse
    {
        $eatenAt = $request->filled('eaten_at') ? $request->date('eaten_at') : now();

        $meal = MealEntry::query()->create([
            'user_id' => $request->user()->id,
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
        ];
    }
}
