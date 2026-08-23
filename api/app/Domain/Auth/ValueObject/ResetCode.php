<?php

namespace App\Domain\Auth\ValueObject;

use App\Domain\Auth\Exception\InvalidResetCodeException;

/**
 * The secret a person types to prove they can read their own inbox.
 *
 * A typed code rather than an emailed link, and that is a decision worth defending
 * because every tutorial reaches for the link. AuraFlow is developed and demonstrated in
 * Expo Go, where the app does not own the `auraflow://` scheme -- Expo Go does. A reset
 * link would therefore have to carry an `exp://192.168.x.x:8081/--/...` address that is
 * regenerated on every `expo start`, differs on every machine, and stops resolving the
 * moment the project moves to a development or release build. A six-digit code needs no
 * scheme, no universal-link association and no conditional: it behaves identically in
 * Expo Go, in a dev client and in a store build, and it survives the user reading the
 * mail on a laptop while holding the phone.
 *
 * Six digits is one million possibilities, which is only safe because it is bounded --
 * see PasswordResetChallenge::MAX_ATTEMPTS. Six digits with unlimited guesses would be
 * no password at all; six digits with five guesses is a 1-in-200,000 chance per issued
 * code, and the code lives fifteen minutes.
 */
final class ResetCode
{
    /** Short enough to hold in your head between the mail app and this app. */
    public const LENGTH = 6;

    private function __construct(private readonly string $digits)
    {
    }

    /**
     * `random_int` and not `rand`/`mt_rand`: this is a credential, and the Mersenne
     * Twister's state can be recovered from a handful of outputs. `random_int` draws
     * from the OS CSPRNG and throws rather than degrading if none is available.
     */
    public static function generate(): self
    {
        return new self(str_pad(
            (string) random_int(0, 10 ** self::LENGTH - 1),
            self::LENGTH,
            '0',
            STR_PAD_LEFT,
        ));
    }

    /**
     * @throws InvalidResetCodeException
     */
    public static function fromString(string $raw): self
    {
        $trimmed = trim($raw);

        if (preg_match('/^\d{'.self::LENGTH.'}$/', $trimmed) !== 1) {
            throw InvalidResetCodeException::malformed();
        }

        return new self($trimmed);
    }

    public function toString(): string
    {
        return $this->digits;
    }
}
