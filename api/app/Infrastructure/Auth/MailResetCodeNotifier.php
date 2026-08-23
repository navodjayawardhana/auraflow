<?php

namespace App\Infrastructure\Auth;

use App\Domain\Auth\Service\ResetCodeNotifier;
use App\Domain\Auth\ValueObject\ResetCode;
use App\Infrastructure\Auth\Mail\PasswordResetCodeMail;
use Illuminate\Support\Facades\Mail;

final class MailResetCodeNotifier implements ResetCodeNotifier
{
    /**
     * Sent inline, not queued, and that is on purpose.
     *
     * QUEUE_CONNECTION is `database`, so a queued mail sits in a table until somebody runs
     * `queue:work`. During a demo -- and during every first run of this flow on a fresh
     * checkout -- nobody has. A reset code that arrives when a worker is eventually
     * started is worse than useless, because by then it has expired. The extra hundred
     * milliseconds on a request that already ran a bcrypt hash is not worth that risk.
     *
     * Nothing is logged here. The mail body carries the code, so the log driver's output
     * carries it too when MAIL_MAILER=log -- but that is the mailbox standing in for a
     * mailbox, not the application writing a secret into its own diagnostics.
     */
    public function send(string $email, ResetCode $code, int $expiresInMinutes): void
    {
        Mail::to($email)->send(new PasswordResetCodeMail($code->toString(), $expiresInMinutes));
    }
}
