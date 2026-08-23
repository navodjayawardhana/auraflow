<?php

namespace App\Infrastructure\Auth\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * The reset code, as plain text and nothing else.
 *
 * Text-only is a choice, twice over. It renders in every client including the ones that
 * strip HTML, and -- the reason it matters here -- with MAIL_MAILER=log the whole MIME
 * message is written to storage/logs/laravel.log, which is how this flow is developed and
 * demonstrated. A multipart HTML mail buries the six digits in a few hundred lines of
 * quoted-printable markup; a text part puts them on a line by themselves.
 *
 * The code is a public property so it can be asserted on with Mail::fake() -- the tests
 * have no other way to learn a code the server generated. It is never rendered anywhere
 * but into this message.
 */
class PasswordResetCodeMail extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(
        public readonly string $code,
        public readonly int $expiresInMinutes,
    ) {
    }

    public function envelope(): Envelope
    {
        // No name, no address, no greeting: the subject line shows in a notification on a
        // lock screen, and a code in a subject is a code anyone standing nearby can read.
        return new Envelope(subject: 'Your AuraFlow password reset code');
    }

    public function content(): Content
    {
        return new Content(text: 'mail.password-reset-code');
    }
}
