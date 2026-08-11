export type User = {
  id: number;
  name: string;
  email: string;
};

export type AuthPayload = {
  user: User;
  token: string;
};

/**
 * A day's recovery reading.
 *
 * `available: false` is a normal state, not an error: the user exists and the date is
 * valid, there is simply nothing recorded to score yet.
 *
 * `provisional` distinguishes a score computed without the autonomic component -- which
 * needs several days of resting-heart-rate history -- from an established one. They are
 * different measurements sharing a scale, so the UI must not chart them on one line.
 */
export type RecoveryReading =
  | {
      date: string;
      available: false;
      score: null;
      reason: string;
    }
  | {
      date: string;
      available: true;
      score: number;
      provisional: boolean;
      components_used: number;
      illness_warning: boolean;
    };

export type ApiEnvelope<T> = { data: T };
