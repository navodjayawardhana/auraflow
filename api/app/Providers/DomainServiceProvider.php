<?php

namespace App\Providers;

use App\Domain\Wellbeing\Repository\DailyHealthSnapshotRepository;
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
        DailyHealthSnapshotRepository::class => EloquentDailyHealthSnapshotRepository::class,
    ];

    public function register(): void
    {
        foreach ($this->repositories as $interface => $implementation) {
            $this->app->bind($interface, $implementation);
        }
    }
}
