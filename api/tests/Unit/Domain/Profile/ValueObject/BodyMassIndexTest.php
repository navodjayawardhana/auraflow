<?php

namespace Tests\Unit\Domain\Profile\ValueObject;

use App\Domain\Profile\ValueObject\BmiBand;
use App\Domain\Profile\ValueObject\BmiScale;
use App\Domain\Profile\ValueObject\BodyMassIndex;
use PHPUnit\Framework\TestCase;

/**
 * Two scales, and the reason the app has to carry both.
 *
 * WHO Expert Consultation. "Appropriate body-mass index for Asian populations and its
 * implications for policy and intervention strategies." Lancet. 2004;363(9403):157-163,
 * which identified public-health action points at 23.0 and 27.5 for Asian populations
 * while keeping the international classification's 25 and 30.
 *
 * The users of this app are in Sri Lanka. Showing them only the European reading would
 * call a BMI of 24 healthy when the evidence for their population calls it a point of
 * increased risk -- so the interesting tests here are the ones where the two disagree.
 */
class BodyMassIndexTest extends TestCase
{
    // --- Slice A: the value ---

    // O
    public function test_should_divide_mass_by_height_in_metres_squared(): void
    {
        // 70 kg at 1.75 m: 70 / 3.0625 = 22.9.
        $this->assertSame(22.9, BodyMassIndex::of(175, 70.0)->value());
    }

    // --- Slice B: where the scales agree ---

    // Z
    public function test_should_call_the_same_low_value_underweight_on_both_scales(): void
    {
        // The consultation kept 18.5 as the underweight boundary for both.
        $bmi = BodyMassIndex::of(175, 50.0);

        $this->assertSame(BmiBand::Underweight, $bmi->bandOn(BmiScale::WhoStandard));
        $this->assertSame(BmiBand::Underweight, $bmi->bandOn(BmiScale::WhoAsian));
    }

    // O
    public function test_should_call_a_clearly_healthy_value_healthy_on_both_scales(): void
    {
        $bmi = BodyMassIndex::of(175, 65.0);   // 21.2

        $this->assertSame(BmiBand::Healthy, $bmi->bandOn(BmiScale::WhoStandard));
        $this->assertSame(BmiBand::Healthy, $bmi->bandOn(BmiScale::WhoAsian));
    }

    // --- Slice C: where they part company, which is the point ---

    // M
    public function test_should_read_a_bmi_of_twenty_four_differently_on_the_two_scales(): void
    {
        // 24.0: healthy under the international classification, overweight under the
        // Asian cut-offs. Applying the first silently to a Sri Lankan user is a real
        // error, not a rounding difference.
        $bmi = BodyMassIndex::of(175, 73.5);

        $this->assertSame(24.0, $bmi->value());
        $this->assertSame(BmiBand::Healthy, $bmi->bandOn(BmiScale::WhoStandard));
        $this->assertSame(BmiBand::Overweight, $bmi->bandOn(BmiScale::WhoAsian));
    }

    // M
    public function test_should_read_a_bmi_of_twenty_eight_differently_on_the_two_scales(): void
    {
        // 28.0: overweight internationally, obese on the Asian scale.
        $bmi = BodyMassIndex::of(175, 85.8);

        $this->assertSame(28.0, $bmi->value());
        $this->assertSame(BmiBand::Overweight, $bmi->bandOn(BmiScale::WhoStandard));
        $this->assertSame(BmiBand::Obese, $bmi->bandOn(BmiScale::WhoAsian));
    }

    // --- Slice D: the boundaries themselves ---

    // B
    public function test_should_place_each_published_cut_off_in_the_band_it_opens(): void
    {
        $bands = static fn (float $value, BmiScale $scale): BmiBand => BodyMassIndex::of(
            100,
            $value,     // height 1.00 m, so mass in kg is the BMI exactly
        )->bandOn($scale);

        $this->assertSame(BmiBand::Healthy, $bands(18.5, BmiScale::WhoStandard));
        $this->assertSame(BmiBand::Overweight, $bands(25.0, BmiScale::WhoStandard));
        $this->assertSame(BmiBand::Obese, $bands(30.0, BmiScale::WhoStandard));

        $this->assertSame(BmiBand::Healthy, $bands(18.5, BmiScale::WhoAsian));
        $this->assertSame(BmiBand::Overweight, $bands(23.0, BmiScale::WhoAsian));
        $this->assertSame(BmiBand::Obese, $bands(27.5, BmiScale::WhoAsian));
    }

    // --- Slice E: reporting both ---

    // I
    public function test_should_report_every_scales_reading_of_the_same_value(): void
    {
        // A band is meaningless without the cut-off behind it, so the client is handed
        // both rather than one verdict and no way to see the other.
        $bands = BodyMassIndex::of(175, 73.5)->allBands();

        $this->assertSame(
            ['who_standard' => 'healthy', 'who_asian' => 'overweight'],
            $bands,
        );
    }

    // S
    public function test_should_lead_with_the_asian_cut_offs_by_default(): void
    {
        // Because that is where this app's users are. The choice is visible in the
        // response's `bmi_scale` rather than tacit.
        $this->assertSame(BmiScale::WhoAsian, BmiScale::DEFAULT);
    }
}
