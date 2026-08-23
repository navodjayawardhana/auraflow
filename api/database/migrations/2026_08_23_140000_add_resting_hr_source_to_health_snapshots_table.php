<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A resting heart rate is not interpretable without knowing how it was taken.
 *
 * The column has been holding two different measurements. A watch reports the lowest
 * sustained rate across a night's sleep; the IoT node reports a finger on a pad while the
 * person is awake, upright and a few hours into their day. The second sits several bpm
 * above the first for the same heart, and neither is wrong -- they are answers to
 * different questions that happened to share a column.
 *
 * That is not a hypothetical failure. EVIDENCE-LOG E-015's second correction was the same
 * shape: two measurements sharing one 0-100 scale made a participant's day-to-day ranking
 * incoherent, and separating them moved the correlation from 0.063 to 0.123. Here the
 * mixture is upstream of that, inside the baseline itself -- a mean and standard deviation
 * computed across both kinds describes neither, and the z-score taken against it is
 * arithmetic without a referent.
 *
 * Stored beside the reading rather than inferred later, because nothing downstream can
 * recover it: a 62 is a 62 whichever way it was measured.
 *
 * Nullable only because the reading it qualifies is. The invariant is that the two are
 * present or absent together, which the form request enforces with `required_with` and the
 * repository preserves by writing them as a pair.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('health_snapshots', function (Blueprint $table) {
            // A string rather than a database enum: SQLite has no native enum and MySQL's
            // is altered by rewriting the table. The permitted values live in the domain's
            // RestingHeartRateSource, which is the one place a reader should have to look.
            $table->string('resting_hr_source', 16)->nullable()->after('resting_heart_rate');
        });

        // Every rate written before this column existed came from a watch or a dataset
        // export of one, because the seated path had no way to say otherwise -- the node
        // button wrote into the same field. Backfilling them as `overnight` is therefore a
        // statement of fact rather than an assumption, and it is what keeps existing users'
        // baselines and scores identical across this migration.
        DB::table('health_snapshots')
            ->whereNotNull('resting_heart_rate')
            ->update(['resting_hr_source' => 'overnight']);
    }

    public function down(): void
    {
        Schema::table('health_snapshots', function (Blueprint $table) {
            $table->dropColumn('resting_hr_source');
        });
    }
};
