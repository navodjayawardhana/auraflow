<?php

namespace App\Infrastructure\Nutrition;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

/**
 * Barcode lookup against Open Food Facts.
 *
 * Chosen over a commercial nutrition API for two reasons that matter here: it needs no key
 * (so a marker can run this project without signing up for anything), and it is an open
 * database with public provenance — which lets the app say *where a number came from*
 * rather than presenting it as its own.
 *
 * Their terms ask for an identifying User-Agent rather than an API key, and ask that
 * clients not hammer the service. Both are honoured below.
 */
final class OpenFoodFactsClient
{
    private const BASE_URL = 'https://world.openfoodfacts.org/api/v2';

    /** Products do not change. A long cache is polite and makes a rescan instant. */
    private const CACHE_TTL_SECONDS = 86_400;

    private const USER_AGENT = 'AuraFlow/1.0 (CMP7003 coursework project)';

    /**
     * Null when the barcode is not in the database — a real and common outcome, not an
     * error. The caller falls back to letting the user enter their own figure.
     *
     * @return array<string, mixed>|null
     */
    public function findByBarcode(string $barcode): ?array
    {
        return Cache::remember(
            'off.'.$barcode,
            self::CACHE_TTL_SECONDS,
            fn () => $this->fetch($barcode),
        );
    }

    /**
     * @return array<string, mixed>|null
     */
    private function fetch(string $barcode): ?array
    {
        $response = Http::timeout(8)
            ->withHeaders(['User-Agent' => self::USER_AGENT])
            ->get(self::BASE_URL.'/product/'.$barcode, [
                // Ask only for what is used. Their full product document is very large.
                'fields' => 'code,product_name,brands,nutriments,serving_quantity',
            ]);

        if (! $response->successful() || $response->json('status') !== 1) {
            return null;
        }

        $product = $response->json('product') ?? [];
        $nutriments = $product['nutriments'] ?? [];

        // Energy is per 100 g in their schema. Rounding here rather than in the client
        // keeps one definition of "how precise is this figure".
        $kcalPer100g = $nutriments['energy-kcal_100g'] ?? null;

        if ($kcalPer100g === null) {
            // A product with no energy value is not usable for a calorie log, and
            // guessing one would be exactly the false precision this avoids.
            return null;
        }

        $name = trim((string) ($product['product_name'] ?? ''));
        $brand = trim((string) explode(',', (string) ($product['brands'] ?? ''))[0]);

        return [
            'barcode' => (string) ($product['code'] ?? $barcode),
            'name' => $name !== '' ? $name : 'Unnamed product',
            'brand' => $brand !== '' ? $brand : null,
            'kcal_per_100g' => (int) round((float) $kcalPer100g),
            'protein_per_100g' => $this->gramsOrNull($nutriments['proteins_100g'] ?? null),
            'carbs_per_100g' => $this->gramsOrNull($nutriments['carbohydrates_100g'] ?? null),
            'fat_per_100g' => $this->gramsOrNull($nutriments['fat_100g'] ?? null),
            'serving_g' => $this->gramsOrNull($product['serving_quantity'] ?? null),
            'source' => 'Open Food Facts',
        ];
    }

    private function gramsOrNull(mixed $value): ?int
    {
        return is_numeric($value) ? (int) round((float) $value) : null;
    }
}
