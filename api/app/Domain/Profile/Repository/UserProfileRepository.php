<?php

namespace App\Domain\Profile\Repository;

use App\Domain\Profile\Model\UserProfile;
use App\Domain\Wellbeing\ValueObject\UserId;

interface UserProfileRepository
{
    /**
     * Null when the user has never opened the profile screen.
     *
     * Distinct from UserProfile::empty(), which is a profile that exists and says
     * nothing. The API reports the first as `null` and the second as an object of nulls,
     * and the client uses the difference to decide whether to prompt.
     */
    public function findFor(UserId $userId): ?UserProfile;

    public function save(UserProfile $profile): void;
}
