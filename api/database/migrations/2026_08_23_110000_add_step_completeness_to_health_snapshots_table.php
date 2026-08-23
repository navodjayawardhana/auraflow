<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * A step count is not interpretable without knowing how much of the day it saw.
 *
 * The two platforms mean different things by the same integer. iOS answers from the
 * operating system's own pedometer history, so a day's figure is the day. Android has no
 * history to ask: all the app can offer is what it witnessed while foregrounded, which on
 * a day spent not looking at your phone is a small fraction of the truth.
 *
 * Stored as a flag beside the count rather than inferred later, because nothing
 * downstream can recover it. A median built from undercounts sets a step goal below what
 * the person already walks, and an adherence panel then congratulates them for clearing
 * it -- both worse than the population default they replace.
 *
 * Nullable in its own right, and the null is not a third platform: it means a count
 * arrived without stating its provenance (an old row, a dataset import written before
 * the flag existed). Everything that needs a whole day requires `true` explicitly, so an
 * unstated count is treated as partial rather than quietly promoted.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('health_snapshots', function (Blueprint $table) {
            $table->boolean('steps_are_complete')->nullable()->after('steps');
        });
    }

    public function down(): void
    {
        Schema::table('health_snapshots', function (Blueprint $table) {
            $table->dropColumn('steps_are_complete');
        });
    }
};
