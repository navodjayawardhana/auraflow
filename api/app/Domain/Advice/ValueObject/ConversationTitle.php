<?php

namespace App\Domain\Advice\ValueObject;

use Stringable;

/**
 * What a conversation is called in the history list.
 *
 * Taken from the opening question rather than written by the model. Naming a chat is
 * worth one substring, not a paid round trip in front of the very first answer the user
 * is waiting on — and a title that summarises the question is less useful than the
 * question, which they will recognise on sight.
 */
final class ConversationTitle implements Stringable
{
    /** Long enough for a real question, short enough not to wrap on a phone row. */
    private const MAX_LENGTH = 44;

    private const FALLBACK = 'New chat';

    private function __construct(public readonly string $value)
    {
    }

    public static function fromFirstMessage(string $body): self
    {
        $flat = trim((string) preg_replace('/\s+/u', ' ', $body));

        if ($flat === '') {
            return new self(self::FALLBACK);
        }

        if (mb_strlen($flat) <= self::MAX_LENGTH) {
            return new self($flat);
        }

        // Cut on the last word boundary so the title does not end mid-word, unless that
        // would leave a stub too short to identify the chat by.
        $cut = mb_substr($flat, 0, self::MAX_LENGTH);
        $boundary = mb_strrpos($cut, ' ');

        if ($boundary !== false && $boundary >= 20) {
            $cut = mb_substr($cut, 0, $boundary);
        }

        return new self(rtrim($cut, " \t,.;:!?-").'…');
    }

    public function __toString(): string
    {
        return $this->value;
    }
}
