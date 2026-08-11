<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('health_snapshots', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->date('recorded_on');

            // All nullable: a device can report sleep without heart rate or the reverse,
            // and the recovery score's components degrade independently by design. A
            // half-populated row is valid data, not a broken record.
            $table->unsignedInteger('sleep_minutes')->nullable();
            $table->unsignedSmallInteger('deep_sleep_minutes')->nullable();
            $table->unsignedSmallInteger('rem_sleep_minutes')->nullable();
            $table->decimal('resting_heart_rate', 4, 1)->nullable();

            $table->timestamps();

            // One snapshot per user per day. Ingest is idempotent -- a device re-syncing
            // the same night must update rather than accumulate duplicates, which would
            // silently corrupt every trailing baseline computed from these rows.
            $table->unique(['user_id', 'recorded_on']);

            // The baseline query is "this user's preceding N days", so it reads along
            // this index directly.
            $table->index(['user_id', 'recorded_on']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('health_snapshots');
    }
};
