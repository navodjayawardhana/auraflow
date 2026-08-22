<?php

namespace App\Console\Commands;

use App\Models\User;
use Database\Seeders\DemoTimelineSeeder;
use Illuminate\Console\Command;

/**
 * Fills one account's history without touching anyone else's data.
 *
 * `db:seed` only ever seeds the factory test user, so an account registered on a
 * phone during a demo starts with an empty timeline and every screen shows its
 * empty state. This backfills that account in place — no migrate:fresh, no data
 * loss for other accounts.
 */
class SeedDemoTimeline extends Command
{
    protected $signature = 'auraflow:seed-demo {email : The account to backfill}';

    protected $description = "Seed the 30-night demo timeline onto an existing account, ending today";

    public function handle(DemoTimelineSeeder $seeder): int
    {
        $email = (string) $this->argument('email');
        $user = User::query()->where('email', $email)->first();

        if (! $user) {
            $this->error("No account found for {$email}.");

            return self::FAILURE;
        }

        $seeder->setCommand($this)->run($user);

        return self::SUCCESS;
    }
}
