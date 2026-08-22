<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Food logged during a day.
 *
 * A separate table from `health_snapshots` rather than more nullable columns, and the
 * reason is the write pattern: a night is written once, a day's meals are written several
 * times and each is its own event with its own time. Folding many rows into one day row
 * would mean either losing the individual entries or inventing a JSON column to hold them.
 *
 * `source` is load-bearing. A figure looked up from a food database and a figure the user
 * guessed are different kinds of claim, and the UI shows them differently — so the
 * distinction is stored rather than inferred.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('meal_entries', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->date('eaten_on');
            $table->timestamp('eaten_at');

            $table->string('name');
            $table->unsignedInteger('kcal');

            // 'lookup' -> from Open Food Facts; 'estimate' -> the user's own figure.
            $table->string('source')->default('estimate');
            $table->string('barcode')->nullable();

            // Grams. Nullable because a barcode lookup gives per-100g values that only
            // become a meal once a portion is known, and a user estimate may skip them.
            $table->unsignedSmallInteger('protein_g')->nullable();
            $table->unsignedSmallInteger('carbs_g')->nullable();
            $table->unsignedSmallInteger('fat_g')->nullable();
            $table->unsignedSmallInteger('portion_g')->nullable();

            $table->timestamps();

            // Every read is "this user's day, in the order eaten".
            $table->index(['user_id', 'eaten_on']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('meal_entries');
    }
};
