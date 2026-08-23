<?php

use App\Http\Controllers\Api\V1\AuthController;
use App\Http\Controllers\Api\V1\ChatController;
use App\Http\Controllers\Api\V1\DailyBriefController;
use App\Http\Controllers\Api\V1\ExerciseSessionController;
use App\Http\Controllers\Api\V1\HealthSnapshotController;
use App\Http\Controllers\Api\V1\InsightsController;
use App\Http\Controllers\Api\V1\MealController;
use App\Http\Controllers\Api\V1\PlanController;
use App\Http\Controllers\Api\V1\ProfileController;
use App\Http\Controllers\Api\V1\RecoveryController;
use App\Http\Controllers\Api\V1\WeatherController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

/*
 * Versioned from the first endpoint. Retrofitting /v1 once a mobile client is in users'
 * hands means supporting both forever, and app updates cannot be forced.
 */
Route::prefix('v1')->group(function () {
    // Public. Registration is throttled per IP; login carries its own per-email-and-IP
    // limiter in LoginRequest, so a single address cannot spray many accounts and a
    // known account cannot be locked out from anywhere.
    Route::post('/register', [AuthController::class, 'register'])
        ->middleware('throttle:10,1')
        ->name('auth.register');

    Route::post('/login', [AuthController::class, 'login'])
        ->middleware('throttle:20,1')
        ->name('auth.login');

    /*
     * Forgotten passwords. A six-digit code typed into the app, not an emailed link --
     * the app is demonstrated in Expo Go, which owns the URL scheme, so a link would have
     * to carry a machine-specific `exp://` address that breaks on every restart and on
     * every change of build type. See Domain\Auth\ValueObject\ResetCode.
     *
     * Both are public, so both carry the same two layers as login: a coarse per-IP limit
     * here to blunt a flood, and a per-email-and-IP limiter inside the form request for
     * the reasoning spelled out above -- email alone would let anyone lock a known user
     * out of their own recovery, IP alone would let one host work through a list.
     */
    Route::post('/password/forgot', [AuthController::class, 'forgotPassword'])
        ->middleware('throttle:10,1')
        ->name('password.forgot');

    Route::post('/password/reset', [AuthController::class, 'resetPassword'])
        ->middleware('throttle:20,1')
        ->name('password.reset');

    Route::middleware('auth:sanctum')->group(function () {
        Route::post('/logout', [AuthController::class, 'logout'])->name('auth.logout');
        Route::post('/logout-everywhere', [AuthController::class, 'logoutEverywhere'])
            ->name('auth.logout-everywhere');
        Route::get('/me', [AuthController::class, 'me'])->name('auth.me');

        Route::get('/user', fn (Request $request) => $request->user());

        // The person, and the targets derived from them. Every route here is scoped to
        // the authenticated user and takes no identifier of its own, so there is no path
        // by which one account can read or edit another's.
        Route::get('/profile', [ProfileController::class, 'show'])->name('profile.show');
        Route::put('/profile', [ProfileController::class, 'update'])->name('profile.update');

        Route::get('/plan', [PlanController::class, 'show'])->name('plan.show');
        Route::put('/plan', [PlanController::class, 'update'])->name('plan.update');
        Route::get('/plan/history', [PlanController::class, 'history'])->name('plan.history');

        // Throttled, unlike the reads beside it: a recalculation reads a fortnight of
        // snapshots and can write a row, and a client that calls it on every screen
        // focus should be slowed rather than allowed to version the plan into noise.
        Route::post('/plan/recalculate', [PlanController::class, 'recalculate'])
            ->middleware('throttle:30,1')
            ->name('plan.recalculate');

        Route::get('/recovery/{date}', [RecoveryController::class, 'show'])
            ->where('date', '\d{4}-\d{2}-\d{2}')
            ->name('recovery.show');

        // The single ingest path for health data. Throttled because it is the one write
        // a device bridge could hammer -- a stuck retry loop should be slowed, not fatal.
        Route::post('/health-snapshots', [HealthSnapshotController::class, 'store'])
            ->middleware('throttle:60,1')
            ->name('health-snapshots.store');

        Route::get('/health-snapshots', [HealthSnapshotController::class, 'index'])
            ->name('health-snapshots.index');

        // A fortnight of every signal the insights screen draws, in one reply. It exists
        // because the alternative shape of that screen is a request per day for the
        // recovery score alone, plus one each for snapshots and meals.
        Route::get('/insights', [InsightsController::class, 'show'])->name('insights.show');

        // Proxied so the provider key stays server-side; throttled because it is the one
        // route that costs us money per call.
        Route::get('/weather', [WeatherController::class, 'show'])
            ->middleware('throttle:30,1')
            ->name('weather.show');

        // The daily briefing. GET creates and queues on first ask, then polls; POST forces
        // a rewrite. Throttled harder than the rest -- each generation is a paid model call.
        Route::get('/briefs/{date}', [DailyBriefController::class, 'show'])
            ->where('date', '\d{4}-\d{2}-\d{2}')
            ->middleware('throttle:60,1')
            ->name('briefs.show');

        Route::post('/briefs/{date}/refresh', [DailyBriefController::class, 'refresh'])
            ->where('date', '\d{4}-\d{2}-\d{2}')
            ->middleware('throttle:6,1')
            ->name('briefs.refresh');

        // The assistant. Every route is scoped to the authenticated user; there is no path
        // by which one account can read another's thread.
        // Meals. The barcode lookup is throttled because it hits a free public database
        // whose terms ask clients not to hammer it.
        // Movement sessions. Written by the rep counter, so throttled on the same
        // reasoning as health-snapshots: a counter stuck in a loop should be slowed
        // rather than allowed to fill the table.
        Route::get('/exercise-sessions', [ExerciseSessionController::class, 'index'])
            ->name('exercise-sessions.index');

        Route::post('/exercise-sessions', [ExerciseSessionController::class, 'store'])
            ->middleware('throttle:60,1')
            ->name('exercise-sessions.store');

        Route::get('/meals', [MealController::class, 'index'])->name('meals.index');
        Route::post('/meals', [MealController::class, 'store'])->name('meals.store');
        Route::delete('/meals/{meal}', [MealController::class, 'destroy'])
            ->whereNumber('meal')
            ->name('meals.destroy');
        // Photo recognition. Throttled hardest of anything here: every call is a paid
        // model call carrying a megabyte of image, and the flow behind it is one tap. The
        // limit itself is configuration -- see the 'meal-photo' limiter in AppServiceProvider.
        Route::post('/meals/estimate-from-photo', [MealController::class, 'estimate'])
            ->middleware('throttle:meal-photo')
            ->name('meals.estimate');

        Route::get('/foods/{barcode}', [MealController::class, 'lookup'])
            ->where('barcode', '\d{6,14}')
            ->middleware('throttle:60,1')
            ->name('foods.lookup');

        // The history list, and "new chat". Neither reaches the model, so neither is
        // throttled alongside the paid /chat write.
        Route::get('/chat/conversations', [ChatController::class, 'conversations'])
            ->name('chat.conversations.index');
        Route::post('/chat/conversations', [ChatController::class, 'newConversation'])
            ->name('chat.conversations.store');

        Route::get('/chat', [ChatController::class, 'index'])->name('chat.index');
        Route::post('/chat', [ChatController::class, 'store'])
            ->middleware('throttle:20,1')
            ->name('chat.store');
        Route::delete('/chat', [ChatController::class, 'destroy'])->name('chat.destroy');
    });
});
