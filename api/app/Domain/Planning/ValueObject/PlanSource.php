<?php

namespace App\Domain\Planning\ValueObject;

/**
 * Whether the plan's numbers came from the formulas or from the user.
 *
 * Sticky, and deliberately so: once someone has set their own step goal, a later
 * recalculation must not silently reclaim it. A plan that says 'edited' is a plan the app
 * has to ask before overwriting.
 */
enum PlanSource: string
{
    case Derived = 'derived';
    case Edited = 'edited';

    /**
     * The `basis` provenance strings. They live here rather than as loose literals so a
     * typo in one of the three producers cannot ship a source the client has no case for.
     */
    public const MEASURED_14D = 'measured_14d';
    public const MEASURED_7D = 'measured_7d';
    public const POPULATION_DEFAULT = 'population_default';
    public const PROFILE_MASS = 'mass_only';
    public const PROFILE_SEX = 'sex_reference_intake';
    public const PROFILE_AGE = 'age_band';
    public const USER_EDITED = 'user_edited';
}
