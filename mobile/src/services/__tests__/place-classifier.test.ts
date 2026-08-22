import {
  classifyContext,
  distanceMeters,
  matchPlace,
  type TaggedPlace,
} from '@/services/place-classifier';

const HOME: TaggedPlace = {
  id: 'home',
  label: 'Home',
  context: 'HOME',
  latitude: 6.9271,
  longitude: 79.8612,
  radiusMeters: 120,
};

const OFFICE: TaggedPlace = {
  id: 'office',
  label: 'Office',
  context: 'WORK/SCHOOL',
  latitude: 6.9319,
  longitude: 79.8478,
  radiusMeters: 200,
};

/** Deliberately inside the office radius — a gym in the same building. */
const GYM: TaggedPlace = {
  id: 'gym',
  label: 'Gym',
  context: 'GYM',
  latitude: 6.9319,
  longitude: 79.848,
  radiusMeters: 40,
};

describe('distanceMeters', () => {
  it('is zero for the same point', () => {
    expect(distanceMeters(HOME, HOME)).toBeCloseTo(0, 6);
  });

  it('matches a known separation', () => {
    // Colombo Fort to Colombo 7 is roughly 1.6 km; the exact figure matters less than
    // the order of magnitude being right, which is what a radius check depends on.
    const metres = distanceMeters(HOME, OFFICE);

    expect(metres).toBeGreaterThan(1_400);
    expect(metres).toBeLessThan(1_900);
  });

  it('is symmetric', () => {
    expect(distanceMeters(HOME, OFFICE)).toBeCloseTo(distanceMeters(OFFICE, HOME), 6);
  });
});

describe('matchPlace', () => {
  it('matches a place the user is standing in', () => {
    const match = matchPlace({ latitude: 6.9271, longitude: 79.8613 }, [HOME, OFFICE]);

    expect(match?.place.id).toBe('home');
  });

  it('prefers the nearest match when places overlap', () => {
    // A gym inside an office block: the tighter radius is the more specific claim, so
    // standing in it should report the gym rather than the building around it.
    const match = matchPlace({ latitude: 6.9319, longitude: 79.848 }, [OFFICE, GYM]);

    expect(match?.place.id).toBe('gym');
  });

  it('returns null outside every radius', () => {
    expect(matchPlace({ latitude: 7.5, longitude: 80.5 }, [HOME, OFFICE, GYM])).toBeNull();
  });

  it('returns null when nothing has been tagged yet', () => {
    expect(matchPlace({ latitude: 6.9271, longitude: 79.8612 }, [])).toBeNull();
  });
});

describe('classifyContext', () => {
  it('reports the context of the matched place', () => {
    expect(classifyContext({ latitude: 6.9319, longitude: 79.8478 }, [HOME, OFFICE])).toBe(
      'WORK/SCHOOL',
    );
  });

  it('reports null rather than guessing at an untagged location', () => {
    // The model encodes an absent context as all-zeros, its held-out OTHER category.
    // Rounding to the nearest place would fabricate an input the user never gave.
    expect(classifyContext({ latitude: 7.5, longitude: 80.5 }, [HOME, OFFICE])).toBeNull();
  });
});
