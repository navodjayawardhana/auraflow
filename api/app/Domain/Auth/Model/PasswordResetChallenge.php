<?php

namespace App\Domain\Auth\Model;

use DateTimeImmutable;

/**
 * One outstanding "prove you can read this inbox" for one address.
 *
 * Every number below is AuraFlow's decision rather than the framework's, which is why
 * this lives in Domain at all -- registering and signing in genuinely carry no rule of
 * ours (see AuthController), but how long a reset code lives and how often it may be
 * guessed are exactly the sort of choice that must not end up scattered across a
 * controller and a validator.
 *
 * The aggregate never sees the code itself, only its hash. There is no accessor that
 * could return a working code even if something later asked for one, which is the point:
 * a database dump, a log line and a debug dump are all equally useless.
 */
final class PasswordResetChallenge
{
    /**
     * Fifteen minutes.
     *
     * Long enough for mail to be delivered, read on another device and typed in; short
     * enough that a code left sitting in an abandoned inbox is a very small window. Every
     * minute added here is a minute an attacker with inbox access does not need to hurry.
     */
    public const TTL_MINUTES = 15;

    /**
     * Five wrong guesses and the code is destroyed, not merely rejected.
     *
     * Six digits is a million possibilities; without a bound, a script walks them in
     * minutes and the code stops being a secret. Five caps a single issued code at a
     * 1-in-200,000 chance. Destroying rather than locking matters too: a lock that expires
     * would let the same code be attacked again in the next window, and a lock that
     * persists would let anyone who knows an address deny its owner a reset.
     */
    public const MAX_ATTEMPTS = 5;

    private function __construct(
        private readonly string $email,
        private readonly string $codeHash,
        private readonly DateTimeImmutable $issuedAt,
        private int $failedAttempts,
    ) {
    }

    public static function issue(string $email, string $codeHash, DateTimeImmutable $issuedAt): self
    {
        return new self($email, $codeHash, $issuedAt, 0);
    }

    /** Rebuilt from storage; the attempt count is carried, not reset. */
    public static function restore(
        string $email,
        string $codeHash,
        DateTimeImmutable $issuedAt,
        int $failedAttempts,
    ): self {
        return new self($email, $codeHash, $issuedAt, max(0, $failedAttempts));
    }

    public function email(): string
    {
        return $this->email;
    }

    public function codeHash(): string
    {
        return $this->codeHash;
    }

    public function issuedAt(): DateTimeImmutable
    {
        return $this->issuedAt;
    }

    public function failedAttempts(): int
    {
        return $this->failedAttempts;
    }

    /**
     * Compared against a caller-supplied "now" rather than reading the clock itself, so
     * the boundary is testable without travelling time and so a single request cannot see
     * two different nows.
     */
    public function hasExpiredBy(DateTimeImmutable $now): bool
    {
        return $now->getTimestamp() - $this->issuedAt->getTimestamp() > self::TTL_MINUTES * 60;
    }

    public function recordFailure(): void
    {
        $this->failedAttempts++;
    }

    /**
     * True once the bound is reached. The caller's contract is to delete the challenge
     * when this turns true -- see ResetPasswordUseCase, which is the only place that may.
     */
    public function isExhausted(): bool
    {
        return $this->failedAttempts >= self::MAX_ATTEMPTS;
    }
}
