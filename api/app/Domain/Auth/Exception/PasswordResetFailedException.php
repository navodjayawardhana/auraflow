<?php

namespace App\Domain\Auth\Exception;

use DomainException;

/**
 * Why a reset was refused, in words safe to hand straight to the person who asked.
 *
 * The message *is* the user-facing string, deliberately, so there is no second table of
 * copy that can drift from the reasons. That constrains what may be said here: none of
 * these may name the code, the address, or how many guesses are left.
 *
 * "No challenge on file", "wrong code" and "the address is not registered" all collapse
 * into `codeIsWrong`. Separating them would turn this endpoint into the enumeration
 * oracle the request endpoint is so careful not to be.
 *
 * Expiry and exhaustion are told apart, and that is a considered trade. Both reveal that
 * *some* reset was recently requested for the address -- but only to someone who already
 * knew the address, and the alternative is a person staring at "that code is not right"
 * while holding a code that was right sixteen minutes ago. Telling them to ask for a new
 * one is the difference between a flow that finishes and a support ticket.
 */
final class PasswordResetFailedException extends DomainException
{
    public static function codeIsWrong(): self
    {
        return new self('That code is not right. Check the email and try again.');
    }

    public static function codeHasExpired(): self
    {
        return new self('That code has expired. Ask for a new one.');
    }

    public static function tooManyAttempts(): self
    {
        return new self('Too many incorrect codes. Ask for a new one.');
    }
}
