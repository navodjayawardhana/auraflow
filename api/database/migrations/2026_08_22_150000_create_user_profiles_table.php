<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * What the app knows about the person, as opposed to what it measured about them.
 *
 * Every column is nullable, and that is the whole point: nothing here is required to use
 * the app. A profile filled in halfway is the normal case, not a broken row, and the plan
 * derived from it degrades field by field rather than refusing to exist.
 *
 * Nothing derived is stored. BMI is a division; storing it would let the stored value and
 * the stored mass disagree the moment one is updated without the other, and a stale BMI
 * is worse than none.
 *
 * `activity_level` is nullable rather than defaulted because "never told us" and "told us
 * they are sedentary" are different facts. Both read out as sedentary -- the conservative
 * choice, since it is the one that cannot overstate energy expenditure -- but only the
 * first appears in the plan's `basis.missing`.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('user_profiles', function (Blueprint $table) {
            $table->id();

            // One profile per user, enforced here rather than by convention: a second row
            // would silently split the person in two and the plan would derive from
            // whichever the query happened to return first.
            $table->foreignId('user_id')->unique()->constrained()->cascadeOnDelete();

            $table->date('date_of_birth')->nullable();

            // A string rather than an enum column. The set is fixed by the domain
            // (App\Domain\Profile\ValueObject\Sex), and a database enum would mean a
            // migration against a live table every time that set moved.
            $table->string('sex', 16)->nullable();

            $table->unsignedSmallInteger('height_cm')->nullable();

            // One decimal place, which is what a bathroom scale reports. decimal rather
            // than float so a weight logged as 72.3 comes back as 72.3 and not 72.29999.
            $table->decimal('weight_kg', 5, 1)->nullable();

            $table->string('activity_level', 16)->nullable();

            // Which population's BMI cut-offs to read the user's band against. A stored
            // preference and not a query parameter: it is a fact about the person that
            // has to survive a reinstall, and the same body must not read as "healthy" on
            // one device and "overweight" on another. Null means the default -- see
            // App\Domain\Profile\ValueObject\BmiScale, which leads with the Asian
            // cut-offs because that is where this app's users are.
            $table->string('bmi_scale', 16)->nullable();

            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('user_profiles');
    }
};
