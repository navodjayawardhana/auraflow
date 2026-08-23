<?php

namespace App\Application\Profile\UseCase;

use App\Application\Profile\DTO\ProfileView;
use App\Domain\Profile\Repository\UserProfileRepository;
use App\Domain\Wellbeing\ValueObject\UserId;

final class GetProfileUseCase
{
    public function __construct(private readonly UserProfileRepository $profiles)
    {
    }

    /**
     * Null when the user has never saved a profile.
     *
     * Not an empty one. The client uses the difference to decide between showing the
     * screen and prompting the user to fill it in, and manufacturing a blank profile here
     * would erase that distinction for the sake of a non-null return type.
     */
    public function execute(string $userId): ?ProfileView
    {
        $profile = $this->profiles->findFor(UserId::fromString($userId));

        return $profile === null ? null : ProfileView::fromDomain($profile);
    }
}
