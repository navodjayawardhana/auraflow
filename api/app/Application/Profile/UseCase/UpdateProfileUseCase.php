<?php

namespace App\Application\Profile\UseCase;

use App\Application\Profile\DTO\ProfileView;
use App\Domain\Profile\Model\UserProfile;
use App\Domain\Profile\Repository\UserProfileRepository;
use App\Domain\Wellbeing\ValueObject\UserId;

/**
 * Saves what the user changed, and stops there.
 *
 * Deliberately does *not* recalculate the plan. Moving somebody's step and calorie goals
 * as a side effect of them correcting their height would be the app changing a target
 * they are being measured against without asking -- and a goal that moves on its own is
 * not a goal. The client compares `profile.updated_at` against `plan.created_at`, sees
 * the plan is behind, and offers; POST /plan/recalculate stays user-triggered.
 *
 * The merge rules -- present key writes, absent key leaves alone, explicit null clears --
 * belong to the aggregate, not here. See UserProfile::apply.
 */
final class UpdateProfileUseCase
{
    public function __construct(private readonly UserProfileRepository $profiles)
    {
    }

    /**
     * @param  array<string, mixed>  $changes  only the fields the request carried
     */
    public function execute(string $userId, array $changes): ProfileView
    {
        $id = UserId::fromString($userId);

        $profile = $this->profiles->findFor($id) ?? UserProfile::empty($id);
        $profile->apply($changes);

        $this->profiles->save($profile);

        // Read back rather than returned from memory: `updated_at` is set by the write,
        // and it is the field the client compares against the plan's `created_at` to
        // decide whether to offer a recalculation. Returning a null timestamp here would
        // make a fresh profile look older than a stale plan.
        return ProfileView::fromDomain($this->profiles->findFor($id) ?? $profile);
    }
}
