<?php

namespace App\Console\Commands;

use App\Models\User;
use Database\Seeders\DemoContentSeeder;
use Database\Seeders\DemoTimelineSeeder;
use Illuminate\Console\Command;

/**
 * Fills one account's history without touching anyone else's data.
 *
 * `db:seed` only ever seeds the factory test user, so an account registered on a
 * phone during a demo starts with an empty timeline and every screen shows its
 * empty state. This backfills that account in place — no migrate:fresh, no data
 * loss for other accounts.
 *
 * Two seeders, because they answer different questions. The timeline fills
 * `health_snapshots`, which is what the recovery ring and the sleep panels read.
 * The content seeder fills the body profile, the derived plan, a fortnight of
 * meals and a movement history — without those, Insights' coverage panel
 * correctly reports the gaps and the walk-through has nothing to show.
 *
 * `--timeline-only` exists for the case where the nights need rebasing onto today
 * but the account's meals and sessions are real and must not be written over.
 */
class SeedDemoTimeline extends Command
{
    protected $signature = 'auraflow:seed-demo
        {email : The account to backfill}
        {--timeline-only : Only rebase the 30 nights; leave profile, plan, meals and sessions alone}
        {--force-profile : Overwrite body-profile fields the account has already set}';

    protected $description = 'Seed the demo history onto an existing account, ending today';

    public function handle(DemoTimelineSeeder $timeline, DemoContentSeeder $content): int
    {
        $email = (string) $this->argument('email');
        $user = User::query()->where('email', $email)->first();

        if (! $user) {
            $this->error("No account found for {$email}.");

            return self::FAILURE;
        }

        $timeline->setCommand($this)->run($user);

        if ($this->option('timeline-only')) {
            $this->line('Skipped profile, plan, meals and sessions (--timeline-only).');

            return self::SUCCESS;
        }

        $content->setCommand($this)->run($user, (bool) $this->option('force-profile'));

        // The brief is deliberately not seeded. It is written by a queued job calling
        // the model, and a hand-written row would put advice on the dashboard that
        // nothing generated — the one screen in the demo whose whole claim is that
        // the text came from the user's own figures.
        $this->line('Daily brief left to the queue worker — open the app once before the demo so it generates.');

        return self::SUCCESS;
    }
}
