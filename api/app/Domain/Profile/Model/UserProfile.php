<?php

namespace App\Domain\Profile\Model;

use App\Domain\Profile\Exception\InvalidProfileException;
use App\Domain\Profile\ValueObject\ActivityLevel;
use App\Domain\Profile\ValueObject\BmiScale;
use App\Domain\Profile\ValueObject\BodyMassIndex;
use App\Domain\Profile\ValueObject\Sex;
use App\Domain\Wellbeing\ValueObject\UserId;
use DateTimeImmutable;

/**
 * What the person told the app about themselves.
 *
 * Every field is optional and stays optional. This is the aggregate a whole phase of
 * personalisation hangs off, and the temptation is to require enough of it to make the
 * formulas work -- but a profile is filled in over weeks, by someone who came here for a
 * step counter, and refusing to hold a half-answered one would just push the emptiness
 * one layer out. The plan handles the gaps instead, and names them.
 *
 * The bounds below are the only rules here, and they are physiological rather than
 * cosmetic: they reject values no living adult has, so a fat-fingered 1700 cm cannot
 * propagate into a BMI, a BMR and a calorie goal.
 */
final class UserProfile
{
    public const MIN_HEIGHT_CM = 80;
    public const MAX_HEIGHT_CM = 250;

    public const MIN_WEIGHT_KG = 25.0;
    public const MAX_WEIGHT_KG = 350.0;

    /**
     * Ages outside this are rejected rather than clamped. A date of birth in the future
     * is a wrong device clock, and both Tanaka and the NSF bands would otherwise be
     * evaluated at a negative age and return a plausible-looking number.
     */
    public const MAX_AGE_YEARS = 120;

    private function __construct(
        private readonly UserId $userId,
        private ?DateTimeImmutable $dateOfBirth,
        private Sex $sex,
        private ?int $heightCm,
        private ?float $weightKg,
        private ?ActivityLevel $activityLevel,
        private ?BmiScale $bmiScale,
        private ?DateTimeImmutable $updatedAt,
    ) {
    }

    /** A profile for someone who has told the app nothing. Still a valid profile. */
    public static function empty(UserId $userId): self
    {
        return new self($userId, null, Sex::Unspecified, null, null, null, null, null);
    }

    public static function of(
        UserId $userId,
        ?DateTimeImmutable $dateOfBirth = null,
        Sex $sex = Sex::Unspecified,
        ?int $heightCm = null,
        ?float $weightKg = null,
        ?ActivityLevel $activityLevel = null,
        ?BmiScale $bmiScale = null,
        ?DateTimeImmutable $updatedAt = null,
    ): self {
        self::guardHeight($heightCm);
        self::guardWeight($weightKg);

        return new self($userId, $dateOfBirth?->setTime(0, 0), $sex, $heightCm, $weightKg, $activityLevel, $bmiScale, $updatedAt);
    }

    /**
     * Rebuild from storage without re-running the creation rules.
     *
     * Stored rows can predate a bound, the same way health snapshots can -- and a profile
     * that fails to load is a user who cannot open the app.
     */
    public static function reconstitute(
        UserId $userId,
        ?DateTimeImmutable $dateOfBirth,
        Sex $sex,
        ?int $heightCm,
        ?float $weightKg,
        ?ActivityLevel $activityLevel,
        ?BmiScale $bmiScale,
        ?DateTimeImmutable $updatedAt,
    ): self {
        return new self($userId, $dateOfBirth?->setTime(0, 0), $sex, $heightCm, $weightKg, $activityLevel, $bmiScale, $updatedAt);
    }

    /**
     * Merge the fields a request actually carried.
     *
     * **Present key means write, absent key means leave alone, explicit null means
     * clear.** Absence and null are different instructions and the distinction is the
     * whole rule: the profile screen can submit one field, so a partial write must not
     * wipe the rest of the person -- and a user who typed the wrong year of birth has to
     * be able to take it back out, so null cannot be silently ignored either.
     *
     * `array_key_exists` throughout rather than isset or ??, both of which read a present
     * null as absent and would quietly make clearing impossible.
     *
     * Clearing `sex` returns it to Unspecified rather than null, because the domain has
     * no third state: Unspecified *is* the cleared value, and the plan already knows to
     * withhold a BMR for it.
     *
     * @param  array<string, mixed>  $changes  keys among date_of_birth, sex, height_cm,
     *                                         weight_kg, activity_level, bmi_scale
     */
    public function apply(array $changes): void
    {
        if (array_key_exists('date_of_birth', $changes)) {
            $value = $changes['date_of_birth'];
            $this->dateOfBirth = $value === null ? null : (new DateTimeImmutable($value))->setTime(0, 0);
        }

        if (array_key_exists('sex', $changes)) {
            $this->sex = $changes['sex'] === null ? Sex::Unspecified : Sex::from($changes['sex']);
        }

        if (array_key_exists('height_cm', $changes)) {
            $height = $changes['height_cm'] === null ? null : (int) $changes['height_cm'];
            self::guardHeight($height);
            $this->heightCm = $height;
        }

        if (array_key_exists('weight_kg', $changes)) {
            $weight = $changes['weight_kg'] === null ? null : round((float) $changes['weight_kg'], 1);
            self::guardWeight($weight);
            $this->weightKg = $weight;
        }

        if (array_key_exists('activity_level', $changes)) {
            $this->activityLevel = $changes['activity_level'] === null
                ? null
                : ActivityLevel::from($changes['activity_level']);
        }

        if (array_key_exists('bmi_scale', $changes)) {
            $this->bmiScale = $changes['bmi_scale'] === null
                ? null
                : BmiScale::from($changes['bmi_scale']);
        }
    }

    public function userId(): UserId
    {
        return $this->userId;
    }

    public function dateOfBirth(): ?DateTimeImmutable
    {
        return $this->dateOfBirth;
    }

    public function sex(): Sex
    {
        return $this->sex;
    }

    public function heightCm(): ?int
    {
        return $this->heightCm;
    }

    public function weightKg(): ?float
    {
        return $this->weightKg;
    }

    /** What was actually recorded -- null when the question was never answered. */
    public function statedActivityLevel(): ?ActivityLevel
    {
        return $this->activityLevel;
    }

    /** Null when the user never chose; see bmiScale() for what is actually applied. */
    public function statedBmiScale(): ?BmiScale
    {
        return $this->bmiScale;
    }

    public function bmiScale(): BmiScale
    {
        return $this->bmiScale ?? BmiScale::DEFAULT;
    }

    /** What the formulas should use, which is the conservative band when nothing was said. */
    public function activityLevel(): ActivityLevel
    {
        return $this->activityLevel ?? ActivityLevel::DEFAULT;
    }

    public function updatedAt(): ?DateTimeImmutable
    {
        return $this->updatedAt;
    }

    /**
     * Completed years on the given date, or null when there is no date of birth.
     *
     * The reference date is a parameter rather than "now" so the domain stays free of
     * the clock: a plan derived for a date has to age the person as at that date, and a
     * test has to be able to fix it.
     */
    public function ageOn(DateTimeImmutable $on): ?int
    {
        if ($this->dateOfBirth === null) {
            return null;
        }

        $years = (int) $this->dateOfBirth->diff($on->setTime(0, 0))->format('%r%y');

        return ($years < 0 || $years > self::MAX_AGE_YEARS) ? null : $years;
    }

    public function bodyMassIndex(): ?BodyMassIndex
    {
        if ($this->heightCm === null || $this->weightKg === null) {
            return null;
        }

        return BodyMassIndex::of($this->heightCm, $this->weightKg);
    }

    private static function guardHeight(?int $heightCm): void
    {
        if ($heightCm !== null && ($heightCm < self::MIN_HEIGHT_CM || $heightCm > self::MAX_HEIGHT_CM)) {
            throw InvalidProfileException::heightOutOfRange($heightCm);
        }
    }

    private static function guardWeight(?float $weightKg): void
    {
        if ($weightKg !== null && ($weightKg < self::MIN_WEIGHT_KG || $weightKg > self::MAX_WEIGHT_KG)) {
            throw InvalidProfileException::weightOutOfRange($weightKg);
        }
    }
}
