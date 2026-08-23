<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The user's daily targets, one immutable row per version.
 *
 * Append-only. A recalculation or a hand edit writes a new row rather than updating the
 * last one, because a goal is something the user was told and then measured against: a
 * day charted as "8,200 of 10,000" must keep saying 10,000 after the goal moves to
 * 11,000, or the history rewrites itself every time the profile changes.
 *
 * `basis` is stored rather than recomputed on read for the same reason. It records the
 * resting heart rate, the formulas and the gaps *as they were* when the number was
 * issued; deriving it again later would explain a plan the user never saw, using a
 * baseline that has since moved.
 *
 * `hr_zones` is nullable because Tanaka needs an age and there is no honest substitute
 * for one. Every other goal has a defensible population fallback; a heart-rate zone
 * invented for an unknown age would be exercise advice with nothing behind it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('wellbeing_plans', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();

            $table->unsignedInteger('version');

            /** 'derived' or 'edited' -- see App\Domain\Planning\ValueObject\PlanSource. */
            $table->string('source', 16);

            $table->unsignedInteger('step_goal');
            $table->unsignedInteger('water_ml');
            // Nullable for the same reason as hr_zones: without a mass, a height, an age
            // and a sex there is no Mifflin-St Jeor, and "burn 400 kcal" invented for a
            // body the app has never been told about is advice with nothing behind it.
            $table->unsignedInteger('active_kcal_goal')->nullable();

            // Hours to one decimal: the NSF bands are whole and half hours, and a
            // float column would reintroduce the rounding the domain rounds away.
            $table->decimal('sleep_need_hours', 3, 1);

            $table->json('hr_zones')->nullable();

            // Why each number above is what it is. The mobile app renders this, so it is
            // part of the product rather than diagnostics.
            $table->json('basis');

            /** Which fields the user overrode by hand in this version. Empty when derived. */
            $table->json('edited_fields');

            // The client's own id for one edit, so an offline outbox can replay a write
            // whose response was lost without minting a phantom version in the user's
            // history. Same mechanism as exercise_sessions.client_uuid, and here for a
            // sharper reason: a duplicated session is a wrong number, a duplicated plan
            // version is the app telling someone they changed a goal on a day they did
            // not. Nullable because a derived plan has no client behind it, and several
            // NULLs coexist happily under a unique index.
            $table->string('client_uuid', 64)->nullable();

            $table->timestamps();

            $table->unique(['user_id', 'client_uuid']);

            // The version sequence is per user and has to stay dense and unique --
            // "version 3" is how the client and the history refer to a row. A race
            // between two recalculations would otherwise write two version 3s.
            $table->unique(['user_id', 'version']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('wellbeing_plans');
    }
};
