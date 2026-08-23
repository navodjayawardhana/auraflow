<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The one thing Laravel's `password_reset_tokens` table is missing for a typed code.
 *
 * The shipped shape -- email as primary key, token, created_at -- was designed for an
 * emailed link, where the secret is long enough that nobody guesses it and an attempt
 * counter would be pointless. A six-digit code is guessable by definition, so the count
 * of failed guesses has to live somewhere durable: in a cache it would evaporate on a
 * restart, and per-IP rate limiting alone is defeated by an attacker with more than one
 * address to come from.
 *
 * Everything else already fits. The primary key on `email` gives "one outstanding code
 * per address" without a unique index of our own; `token` is a varchar wide enough for a
 * bcrypt digest; `created_at` is all the expiry check needs.
 *
 * A separate migration rather than an edit to 0001_01_01_000000_create_users_table --
 * that one has run on every existing database, and editing a migration that has already
 * run is a change nobody's `migrate` will ever apply.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('password_reset_tokens', function (Blueprint $table) {
            // Tiny: the bound is five, and a column that cannot hold a number larger than
            // 255 is a column no runaway loop can turn into a surprise.
            $table->unsignedTinyInteger('attempts')->default(0)->after('token');
        });
    }

    public function down(): void
    {
        Schema::table('password_reset_tokens', function (Blueprint $table) {
            $table->dropColumn('attempts');
        });
    }
};
