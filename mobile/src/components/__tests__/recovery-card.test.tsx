import { render, screen } from '@testing-library/react-native';

import { RecoveryCard } from '@/components/recovery-card';
import type { RecoveryReading } from '@/types';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));

const established: RecoveryReading = {
  date: '2026-08-21',
  available: true,
  score: 75,
  provisional: false,
  components_used: 3,
  illness_warning: false,
  resting_hr_source: 'overnight',
};

describe('RecoveryCard', () => {
  it('shows a skeleton while loading', () => {
    render(<RecoveryCard status="loading" reading={null} onRetry={jest.fn()} />);

    expect(screen.queryByText(/No recovery score yet/)).toBeNull();
    expect(screen.queryByText('75')).toBeNull();
  });

  it('offers a retry when the request failed', () => {
    render(<RecoveryCard status="error" reading={null} onRetry={jest.fn()} />);

    expect(screen.getByText(/Couldn't load today's recovery/)).toBeTruthy();
    expect(screen.getByText('Retry')).toBeTruthy();
  });

  it('treats an unavailable score as an empty state, not an error', () => {
    // available:false is a normal 200 from the API — there is simply nothing to score
    // yet. Rendering it as a failure would tell the user something is broken.
    render(
      <RecoveryCard
        status="loaded"
        reading={{
          date: '2026-08-21',
          available: false,
          score: null,
          reason: 'No sleep was recorded for this night.',
          last_known: null,
        }}
        onRetry={jest.fn()}
      />,
    );

    expect(screen.getByText('No recovery score yet')).toBeTruthy();
    expect(screen.getByText('No sleep was recorded for this night.')).toBeTruthy();
    expect(screen.queryByText('Retry')).toBeNull();
  });

  it('renders an established score without a provisional badge', () => {
    render(<RecoveryCard status="loaded" reading={established} onRetry={jest.fn()} />);

    expect(screen.getByText('75')).toBeTruthy();
    expect(screen.queryByText(/Provisional/)).toBeNull();
  });

  it('marks a provisional score as still building its baseline', () => {
    render(
      <RecoveryCard
        status="loaded"
        reading={{ ...established, provisional: true, components_used: 2 }}
        onRetry={jest.fn()}
      />,
    );

    expect(screen.getByText(/Provisional/)).toBeTruthy();
    // Three components, not four — the calculator combines duration, architecture and
    // autonomic signals only.
    expect(screen.getByText(/2 of 3 signals/)).toBeTruthy();
  });

  it('says nothing about the baseline when the score rests on overnight readings', () => {
    // The measurement E-015 actually evaluated. A disclosure here would be a caveat about
    // nothing, and caveats that appear everywhere are read nowhere.
    render(<RecoveryCard status="loaded" reading={established} onRetry={jest.fn()} />);

    expect(screen.queryByText(/not the version that was tested/)).toBeNull();
  });

  it('discloses a score measured against seated check-ins', () => {
    // The one case where the published validation does not describe the number on screen.
    // Silence here would let ρ 0.123 be read as covering a measurement it never saw.
    render(
      <RecoveryCard
        status="loaded"
        reading={{ ...established, resting_hr_source: 'seated_spot' }}
        onRetry={jest.fn()}
      />,
    );

    expect(screen.getByText(/not the version that was tested/)).toBeTruthy();
  });

  it('surfaces an illness warning alongside the score', () => {
    render(
      <RecoveryCard
        status="loaded"
        reading={{ ...established, illness_warning: true }}
        onRetry={jest.fn()}
      />,
    );

    expect(screen.getByText(/resting heart rate is higher than usual/)).toBeTruthy();
  });
});
