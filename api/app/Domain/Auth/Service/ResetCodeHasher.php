<?php

namespace App\Domain\Auth\Service;

use App\Domain\Auth\ValueObject\ResetCode;

/**
 * Hashing, stated as a need rather than a library call.
 *
 * The domain's requirement is "what we store must not be usable"; which algorithm
 * satisfies that is a framework concern and will change again the next time a cost factor
 * is revised. Keeping it an interface also means the verification step is forced through
 * `matches`, so no future caller can be tempted into a `===` against the stored value.
 */
interface ResetCodeHasher
{
    public function hash(ResetCode $code): string;

    public function matches(ResetCode $code, string $hash): bool;
}
