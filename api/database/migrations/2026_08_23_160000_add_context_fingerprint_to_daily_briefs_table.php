<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * What a briefing was written from, so it can be rewritten when that has moved.
 *
 * The job refused to rewrite a `ready` brief, and the reason was a good one: advice
 * changing under the reader on a reopen is its own kind of broken. But a brief written at
 * 07:00 went on telling someone at 21:00 they had drunk 250 ml when they had since drunk
 * two litres, and stability does not make that true.
 *
 * A timer would have resolved it in the wrong currency — rewriting briefs nothing had
 * changed about, and still missing the day a night is logged at noon. A brief is a
 * function of its context, so what is stored here is that context's identity: a hash over
 * bucketed inputs, compared before any model call is made. See
 * `App\Domain\Advice\ValueObject\ContextFingerprint` for the bucket widths and the
 * argument for each of them.
 *
 * Nullable, and every existing row is left null rather than backfilled. A null reads as
 * "we do not know what this was written from", which earns exactly one rewrite — the right
 * answer, and cheaper than inventing a fingerprint for advice nobody can reproduce.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('daily_briefs', function (Blueprint $table) {
            // Fixed width because it is a sha256 in hex, and unindexed because it is only
            // ever read back on a row already found by (user_id, brief_for).
            $table->string('context_fingerprint', 64)->nullable()->after('model');
        });
    }

    public function down(): void
    {
        Schema::table('daily_briefs', function (Blueprint $table) {
            $table->dropColumn('context_fingerprint');
        });
    }
};
