<?php

namespace App\Domain\Auth\Service;

use App\Domain\Auth\ValueObject\ResetCode;

/**
 * The one and only place a reset code is allowed to leave the server.
 *
 * Expressed as an interface so the domain can say "tell the owner of this address" without
 * learning what a mailer is -- and so the single egress point is a named seam that a
 * reviewer can check, rather than a `Mail::to(...)` buried in a use case.
 */
interface ResetCodeNotifier
{
    /**
     * @param  int  $expiresInMinutes  told to the recipient so the mail can say when the
     *                                 code dies without restating the domain's constant
     */
    public function send(string $email, ResetCode $code, int $expiresInMinutes): void;
}
