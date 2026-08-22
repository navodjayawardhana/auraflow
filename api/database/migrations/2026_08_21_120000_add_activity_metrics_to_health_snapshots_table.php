<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Steps and water join the daily snapshot rather than getting a table of their own.
 *
 * `health_snapshots` already means "one user's health signals for one day" and is keyed
 * unique on (user_id, recorded_on) — which is exactly what a step count and a water
 * intake are. A separate table would duplicate that key, its repository, its mapper and
 * its endpoint without expressing anything the aggregate does not already say.
 *
 * Calories are deliberately absent: they are derived from steps, and storing a derived
 * estimate invites it being read later as a measurement.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('health_snapshots', function (Blueprint $table) {
            // Nullable like every other signal here: a phone with activity permission
            // refused reports neither, and that is valid data rather than a broken row.
            $table->unsignedInteger('steps')->nullable()->after('resting_heart_rate');
            $table->unsignedInteger('water_ml')->nullable()->after('steps');
        });
    }

    public function down(): void
    {
        Schema::table('health_snapshots', function (Blueprint $table) {
            $table->dropColumn(['steps', 'water_ml']);
        });
    }
};
