<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The assistant conversation, one row per turn.
 *
 * Stored server-side rather than kept in the client so the thread survives a reinstall and
 * follows the account rather than the handset — and so the history sent to the model is
 * the history we actually wrote, not whatever a client chose to replay.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('chat_messages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();

            $table->string('role'); // user | assistant
            $table->text('body');

            $table->timestamps();

            // Every read is "this user's thread, newest last".
            $table->index(['user_id', 'id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('chat_messages');
    }
};
