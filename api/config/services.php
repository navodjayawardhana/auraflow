<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Mailgun, Postmark, AWS and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    /*
     * The weather key lives here, server-side, and never reaches the app.
     *
     * EXPO_PUBLIC_* variables are inlined into the JavaScript bundle and readable from
     * the APK, so a key shipped that way is a published key. The app calls our own
     * endpoint instead and we call OpenWeatherMap.
     */
    'openweather' => [
        'key' => env('OPENWEATHER_API_KEY'),
        'base_url' => env('OPENWEATHER_BASE_URL', 'https://api.openweathermap.org/data/2.5'),
    ],

    /*
     * The keyless fallback. No account and no quota to sign up for, which is exactly why
     * it is second in the chain rather than absent: a fresh checkout still fills the
     * weather chip. See App\Infrastructure\Weather\ChainedWeatherProvider.
     */
    'openmeteo' => [
        'base_url' => env('OPENMETEO_BASE_URL', 'https://api.open-meteo.com/v1'),
    ],

    /*
     * Gemini, for the daily lifestyle summary. Server-side for the same reason as the
     * weather key, plus one more: an LLM key in a shipped bundle is a bill anyone can run
     * up. Free tier at aistudio.google.com.
     */
    'gemini' => [
        'key' => env('GEMINI_API_KEY'),
        'model' => env('GEMINI_MODEL', 'gemini-3.6-flash'),
        'base_url' => env('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta'),

        /*
         * Meal photo recognitions per minute, per user. See the 'meal-photo' limiter in
         * AppServiceProvider. Twelve is generous for someone logging meals and tight for
         * anyone testing the flow, which is why it is an env var rather than a constant.
         */
        'photo_rate_limit' => env('GEMINI_PHOTO_RATE_LIMIT', 12),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

];
