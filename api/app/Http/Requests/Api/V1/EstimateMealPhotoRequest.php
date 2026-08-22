<?php

namespace App\Http\Requests\Api\V1;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

/**
 * The photograph, as base64 in a JSON body.
 *
 * Base64 rather than multipart because the provider wants base64 anyway — a file upload
 * would be decoded here only to be re-encoded a moment later — and because the mobile
 * client has one JSON transport and no reason to grow a second.
 *
 * The declared type is not trusted. What the bytes actually are is read from the bytes.
 */
class EstimateMealPhotoRequest extends FormRequest
{
    /**
     * Roughly 4 MB of image once decoded. Comfortably above a downscaled phone capture and
     * below the point where the request itself becomes the slow part.
     */
    private const MAX_BASE64_LENGTH = 5_600_000;

    /** Below this it is a thumbnail or a truncated upload, and not worth a paid call. */
    private const MIN_BYTES = 1024;

    private const ACCEPTED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

    private ?string $decoded = null;

    private ?string $mimeType = null;

    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    public function rules(): array
    {
        return [
            'photo' => ['required', 'string', 'max:'.self::MAX_BASE64_LENGTH],
        ];
    }

    public function after(): array
    {
        return [
            function (Validator $validator) {
                if ($validator->errors()->has('photo')) {
                    return;
                }

                $bytes = base64_decode($this->stripDataUri($this->string('photo')->toString()), true);

                if ($bytes === false || strlen($bytes) < self::MIN_BYTES) {
                    $validator->errors()->add('photo', 'That photo did not arrive in one piece.');

                    return;
                }

                $mimeType = finfo_buffer(finfo_open(FILEINFO_MIME_TYPE), $bytes) ?: '';

                if (! in_array($mimeType, self::ACCEPTED_MIME_TYPES, true)) {
                    // Read from the content rather than taken on trust: a client that says
                    // "image/jpeg" over a zip would otherwise have those bytes forwarded to
                    // a third party on our key.
                    $validator->errors()->add('photo', 'That file is not a photo.');

                    return;
                }

                $this->decoded = $bytes;
                $this->mimeType = $mimeType;
            },
        ];
    }

    /** Only valid after validation has passed. */
    public function imageBytes(): string
    {
        return (string) $this->decoded;
    }

    public function mimeType(): string
    {
        return (string) $this->mimeType;
    }

    /** Some clients send the whole data URI. Cheaper to accept it than to explain it. */
    private function stripDataUri(string $photo): string
    {
        $comma = strpos($photo, ',');

        return str_starts_with($photo, 'data:') && $comma !== false
            ? substr($photo, $comma + 1)
            : $photo;
    }
}
