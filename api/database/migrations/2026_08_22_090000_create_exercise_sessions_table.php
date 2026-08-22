<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * One camera-guided movement session.
 *
 * Append-only and shaped like `meal_entries` rather than `health_snapshots`: a night is
 * written once per day and merged, whereas someone can do three sets before lunch and
 * each is its own event with its own start time. There is deliberately no unique key on
 * (user, day) — two sessions on one day are two rows, not a conflict.
 *
 * `good_form_reps` is stored beside `total_reps` instead of a ratio because the two are
 * different claims: the count is what the state machine observed, the ratio would be a
 * derived figure that hides how few reps it was computed from.
 *
 * `recovery_score` and `prescribed_intensity` record what the session was gated on at the
 * time. Recomputing them later from the snapshot would give a different answer once more
 * of the day's data arrived, and the honest record is what the user was actually told.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('exercise_sessions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();

            // The date column is what the list query filters on; the timestamp is the
            // ordering key within a day. Same split as meal_entries.
            $table->date('performed_on');
            $table->timestamp('performed_at');

            $table->string('exercise');
            $table->unsignedSmallInteger('total_reps');
            $table->unsignedSmallInteger('good_form_reps');
            $table->unsignedInteger('duration_seconds');

            // Null whenever the node was not connected — most sessions, honestly. A zero
            // here would be a claim that the heart stopped.
            $table->unsignedSmallInteger('mean_heart_rate')->nullable();

            $table->string('prescribed_intensity');
            $table->unsignedTinyInteger('recovery_score')->nullable();

            // The client's own id for this session, so the offline outbox can replay a
            // write whose response was lost without creating the session twice. Unlike
            // health_snapshots there is no natural key to be idempotent on -- two
            // identical sets on one morning are genuinely two sessions -- so the only
            // thing that can tell a replay from a repeat is the client saying so.
            // Nullable because a session written online never needs one, and several
            // NULLs coexist happily under a unique index.
            $table->string('client_uuid', 64)->nullable();

            $table->timestamps();

            $table->index(['user_id', 'performed_on']);
            $table->unique(['user_id', 'client_uuid']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('exercise_sessions');
    }
};
