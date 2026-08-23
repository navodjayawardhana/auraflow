<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Tells a counted session apart from a followed one.
 *
 * A camera session observes each rep and grades its depth. A guided session plays an
 * animated figure at a tempo and *assumes* the user kept up. Both are worth recording and
 * they are not the same claim, so the distinction is stored rather than guessed from
 * which columns happen to be filled -- the same reason `meal_entries.source` separates a
 * barcode lookup from someone's own estimate.
 *
 * `good_form_reps` becomes nullable as a direct consequence. Nothing watched the form in a
 * guided session, so there is no number to put there; copying `total_reps` across would
 * invent a measurement, and a zero would claim every rep was shallow. Null is the only
 * honest value, and the history has to be able to hold it.
 *
 * Existing rows are all camera sessions -- guided ones did not exist before this
 * migration -- so the default backfills them correctly.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('exercise_sessions', function (Blueprint $table) {
            // 'pose' -> counted by the on-device pose model; 'guided' -> followed along
            // to the animated figure at a fixed tempo.
            $table->string('source')->default('pose')->after('exercise');

            $table->unsignedSmallInteger('good_form_reps')->nullable()->change();
        });
    }

    public function down(): void
    {
        // A guided session holds null here and there is no figure to put in its place, so
        // rolling back drops those rows rather than fabricating a form count for them.
        DB::table('exercise_sessions')->whereNull('good_form_reps')->delete();

        Schema::table('exercise_sessions', function (Blueprint $table) {
            $table->dropColumn('source');
            $table->unsignedSmallInteger('good_form_reps')->nullable(false)->change();
        });
    }
};
