<?php

namespace Tests\Feature\Performance;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Server-side handling latency for an authenticated read.
 *
 * Measured in-process on purpose. `php artisan serve` re-bootstraps PHP on every
 * request, which adds a constant ~265 ms on this machine and says nothing about a
 * deployment behind php-fpm with opcache. What is deployment-independent, and what
 * this project can actually be held to, is the time the application itself spends
 * between receiving the request and returning the response.
 */
class ApiLatencyTest extends TestCase
{
    use RefreshDatabase;

    private const RUNS = 300;
    private const BUDGET_MS = 300.0;

    public function test_should_serve_an_authenticated_read_within_the_latency_budget(): void
    {
        $user = User::factory()->create();

        for ($i = 0; $i < 20; $i++) {
            $this->actingAs($user, 'sanctum')->getJson('/api/v1/me');
        }

        $samples = [];
        for ($i = 0; $i < self::RUNS; $i++) {
            $started = hrtime(true);
            $this->actingAs($user, 'sanctum')->getJson('/api/v1/me')->assertOk();
            $samples[] = (hrtime(true) - $started) / 1e6;
        }

        sort($samples);
        $at = fn (float $q) => $samples[(int) floor($q * (count($samples) - 1))];

        fwrite(STDERR, PHP_EOL . json_encode([
            'endpoint' => 'GET /api/v1/me',
            'runs' => self::RUNS,
            'p50_ms' => round($at(0.50), 1),
            'p95_ms' => round($at(0.95), 1),
            'p99_ms' => round($at(0.99), 1),
        ]) . PHP_EOL);

        $this->assertLessThan(self::BUDGET_MS, $at(0.95));
    }
}
