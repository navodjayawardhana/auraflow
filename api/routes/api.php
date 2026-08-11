<?php

use App\Http\Controllers\Api\V1\AuthController;
use App\Http\Controllers\Api\V1\RecoveryController;
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

    Route::middleware('auth:sanctum')->group(function () {
        Route::post('/logout', [AuthController::class, 'logout'])->name('auth.logout');
        Route::post('/logout-everywhere', [AuthController::class, 'logoutEverywhere'])
            ->name('auth.logout-everywhere');
        Route::get('/me', [AuthController::class, 'me'])->name('auth.me');

        Route::get('/user', fn (Request $request) => $request->user());

        Route::get('/recovery/{date}', [RecoveryController::class, 'show'])
            ->where('date', '\d{4}-\d{2}-\d{2}')
            ->name('recovery.show');
    });
});
