<?php

namespace Tests\Unit\Domain\Wellbeing\ValueObject;

use App\Domain\Wellbeing\Exception\InvalidRecoveryScoreException;
use App\Domain\Wellbeing\ValueObject\RecoveryScore;
use PHPUnit\Framework\TestCase;

class RecoveryScoreTest extends TestCase
{
    // --- Slice A: construction and bounds ---

    // Z
    public function test_should_accept_zero_when_the_user_is_fully_unrecovered(): void
    {
        $score = RecoveryScore::established(0.0, 3);

        $this->assertSame(0.0, $score->value());
    }

    // O
    public function test_should_round_to_one_decimal_when_given_a_longer_value(): void
    {
        $score = RecoveryScore::established(72.4567, 3);

        $this->assertSame(72.5, $score->value());
    }

    // M
    public function test_should_record_how_many_components_contributed(): void
    {
        $this->assertSame(3, RecoveryScore::established(60.0, 3)->componentsUsed());
        $this->assertSame(2, RecoveryScore::provisional(60.0, 2)->componentsUsed());
    }

    // B
    public function test_should_accept_the_upper_bound(): void
    {
        $this->assertSame(100.0, RecoveryScore::established(100.0, 3)->value());
    }

    // B
    public function test_should_reject_a_value_above_one_hundred(): void
    {
        $this->expectException(InvalidRecoveryScoreException::class);

        RecoveryScore::established(100.1, 3);
    }

    // B
    public function test_should_reject_a_negative_value(): void
    {
        $this->expectException(InvalidRecoveryScoreException::class);

        RecoveryScore::established(-0.1, 3);
    }

    // E
    public function test_should_reject_a_non_finite_value(): void
    {
        $this->expectException(InvalidRecoveryScoreException::class);

        RecoveryScore::established(NAN, 3);
    }

    // --- Slice B: provisional vs established ---
    //
    // The distinction is load-bearing. Validation against 1,729 days of self-reported
    // readiness showed that mixing the two dropped the correlation from 0.123 to 0.063,
    // because a participant's day-to-day ranking became incoherent.

    // I
    public function test_should_report_itself_as_provisional_when_built_without_the_autonomic_component(): void
    {
        $score = RecoveryScore::provisional(55.0, 2);

        $this->assertTrue($score->isProvisional());
        $this->assertFalse($score->isEstablished());
    }

    // I
    public function test_should_report_itself_as_established_when_all_signals_were_available(): void
    {
        $score = RecoveryScore::established(55.0, 3);

        $this->assertTrue($score->isEstablished());
        $this->assertFalse($score->isProvisional());
    }

    // E
    public function test_should_refuse_to_compare_a_provisional_score_against_an_established_one(): void
    {
        $this->expectException(InvalidRecoveryScoreException::class);

        RecoveryScore::provisional(80.0, 2)->isBetterThan(RecoveryScore::established(40.0, 3));
    }

    // E
    public function test_should_not_consider_scores_of_different_kinds_equal_even_at_the_same_value(): void
    {
        $this->assertFalse(
            RecoveryScore::provisional(60.0, 2)->equals(RecoveryScore::established(60.0, 3))
        );
    }

    // S
    public function test_should_compare_two_established_scores_by_value(): void
    {
        $better = RecoveryScore::established(78.0, 3);
        $worse = RecoveryScore::established(41.0, 3);

        $this->assertTrue($better->isBetterThan($worse));
        $this->assertFalse($worse->isBetterThan($better));
    }

    // S
    public function test_should_compare_two_provisional_scores_by_value(): void
    {
        $this->assertTrue(
            RecoveryScore::provisional(70.0, 2)->isBetterThan(RecoveryScore::provisional(30.0, 2))
        );
    }
}
