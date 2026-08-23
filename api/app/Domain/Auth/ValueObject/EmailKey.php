<?php

namespace App\Domain\Auth\ValueObject;

/**
 * The one spelling of an address that the reset flow uses as a key.
 *
 * `password_reset_tokens` is keyed by its email column, so "Navod@Example.com" and
 * "navod@example.com" must not be able to hold two separate challenges -- otherwise
 * changing the capitalisation of a letter buys an attacker a second five-guess budget,
 * and the bound that makes six digits safe quietly becomes unbounded.
 *
 * One function, shared by the request and the reset, because normalising in one of the
 * two and not the other is exactly how that hole appears.
 */
final class EmailKey
{
    public static function normalise(string $email): string
    {
        // mb_strtolower rather than strtolower: an address with non-ASCII in the local
        // part should still key consistently, and the byte-wise version leaves those
        // characters untouched.
        return mb_strtolower(trim($email));
    }
}
