<?php

namespace App\Providers;

use App\Domain\Auth\Repository\AccountRepository;
use App\Domain\Auth\Repository\PasswordResetChallengeRepository;
use App\Domain\Auth\Service\ResetCodeHasher;
use App\Domain\Auth\Service\ResetCodeNotifier;
use App\Domain\Movement\Repository\CompletedSessionRepository;
use App\Domain\Nutrition\Repository\LoggedMealRepository;
use App\Domain\Planning\Repository\WellbeingPlanRepository;
use App\Domain\Profile\Repository\UserProfileRepository;
use App\Domain\Wellbeing\Repository\DailyHealthSnapshotRepository;
use App\Infrastructure\Auth\HashedResetCodeHasher;
use App\Infrastructure\Auth\MailResetCodeNotifier;
use App\Infrastructure\Auth\Persistence\DatabasePasswordResetChallengeRepository;
use App\Infrastructure\Auth\Persistence\EloquentAccountRepository;
use App\Infrastructure\Movement\Persistence\EloquentCompletedSessionRepository;
use App\Infrastructure\Nutrition\Persistence\EloquentLoggedMealRepository;
use App\Infrastructure\Planning\Persistence\EloquentWellbeingPlanRepository;
use App\Infrastructure\Profile\Persistence\EloquentUserProfileRepository;
use App\Infrastructure\Wellbeing\Persistence\EloquentDailyHealthSnapshotRepository;
use Illuminate\Support\ServiceProvider;

/**
 * The one place the dependency rule is inverted in practice.
 *
 * The domain declares what it needs as an interface and never learns what satisfies it.
 * This provider is where the container is told, so swapping Eloquent for another store
 * means changing this file and the Infrastructure implementation -- nothing in Domain or
 * Application moves.
 *
 * Keep it to bindings. Anything that looks like a business rule appearing here is a sign
 * something belongs in a domain service instead.
 */
class DomainServiceProvider extends ServiceProvider
{
    /**
     * @var array<class-string, class-string> domain interface => infrastructure implementation
     */
    private array $repositories = [
        AccountRepository::class => EloquentAccountRepository::class,
        DailyHealthSnapshotRepository::class => EloquentDailyHealthSnapshotRepository::class,
        CompletedSessionRepository::class => EloquentCompletedSessionRepository::class,
        LoggedMealRepository::class => EloquentLoggedMealRepository::class,
        UserProfileRepository::class => EloquentUserProfileRepository::class,
        WellbeingPlanRepository::class => EloquentWellbeingPlanRepository::class,

        // Password reset. The challenge store and the hasher are storage and cryptography;
        // the notifier is the single seam through which a reset code is allowed to leave
        // the server, which is worth being able to point at in one line.
        PasswordResetChallengeRepository::class => DatabasePasswordResetChallengeRepository::class,
        ResetCodeHasher::class => HashedResetCodeHasher::class,
        ResetCodeNotifier::class => MailResetCodeNotifier::class,
    ];

    public function register(): void
    {
        foreach ($this->repositories as $interface => $implementation) {
            $this->app->bind($interface, $implementation);
        }
    }
}
