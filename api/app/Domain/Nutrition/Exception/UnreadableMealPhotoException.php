<?php

namespace App\Domain\Nutrition\Exception;

use RuntimeException;

/**
 * The model answered, but not with anything a calorie log may show.
 *
 * Separate from a provider failure on purpose, and the two get different status codes: a
 * photograph of a car park is a request that cannot be satisfied, while an unreachable
 * provider is a dependency that is down. Telling the user "try again" in the first case
 * would be a lie.
 */
final class UnreadableMealPhotoException extends RuntimeException
{
}
