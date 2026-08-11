<?php

use App\Http\Controllers\Api\V1\RecoveryController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

/*
 * Versioned from the first endpoint. Retrofitting /v1 once a mobile client is in users'
 * hands means supporting both forever, and app updates cannot be forced.
 */
Route::prefix('v1')->middleware('auth:sanctum')->group(function () {
    Route::get('/user', fn (Request $request) => $request->user());

    Route::get('/recovery/{date}', [RecoveryController::class, 'show'])
        ->where('date', '\d{4}-\d{2}-\d{2}')
        ->name('recovery.show');
});
