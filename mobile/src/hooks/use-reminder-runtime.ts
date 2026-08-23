import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/context/auth-context';
import { cancelAllRemindersAsync, routeForResponse } from '@/services/notification-service';
import { reconcileRemindersAsync } from '@/services/reminder-sync';

/**
 * The two things reminders need from a permanently mounted component: a schedule that stays
 * true, and a tap that lands somewhere.
 *
 * Mounted once at the root rather than on the settings screen, because both jobs matter most
 * when the settings screen is nowhere near the top of the stack.
 */
export function useReminderRuntime(): void {
  const { user, isRestoring } = useAuth();
  const userId = user?.id;
  const router = useRouter();

  /**
   * Reconcile on every return to the foreground.
   *
   * This is where "do not remind someone to do a thing they have already done today" is
   * actually enforced for anything beyond the immediate case. A firing placed last night is
   * sitting with the OS and cannot be recalled from here — but it can be *removed* before it
   * is due, and every foreground is a chance to notice that it should be. The same pass
   * corrects a day that has rolled over and a phone that has changed timezone.
   *
   * `AppState` rather than a screen focus effect: the app being reopened is the event, and it
   * happens without any particular screen changing.
   */
  useEffect(() => {
    if (userId === undefined) return;

    // Never awaited and never allowed to reject. This runs for its effect on the OS, at
    // moments nobody asked for it — a failure here has no user to report itself to, and an
    // unhandled rejection from a background reconcile would surface as a redbox over
    // whatever screen happened to be open.
    const run = () => {
      reconcileRemindersAsync(userId).catch(() => undefined);
    };

    run();

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') run();
    });

    return () => subscription.remove();
  }, [userId]);

  /**
   * Signing out cancels everything.
   *
   * A reminder that keeps arriving for an account nobody is signed into would be both a
   * privacy problem — the body text names what the person is being asked to measure — and a
   * dead end, since the tap would land on the login screen.
   */
  useEffect(() => {
    // `isRestoring` is the guard that matters. `user` is null for the first moments of every
    // cold launch while the session is read back from the keychain, and cancelling on that
    // would tear down a signed-in person's whole week of reminders on every single launch,
    // to rebuild it a tick later.
    if (!isRestoring && user === null) cancelAllRemindersAsync().catch(() => undefined);
  }, [isRestoring, user]);

  /**
   * Where a tap goes.
   *
   * `useLastNotificationResponse` rather than an event subscription, because the hard case is
   * the cold start: a tap that launches the app delivers its response before any listener
   * this component could add exists. The hook replays the last one, so both paths — launched
   * by the tap, and tapped while already running — arrive here identically.
   *
   * The trade is that it keeps returning the same response, so it is deduped by identifier.
   * Without that, every re-render after a tap would push the screen again.
   */
  const lastResponse = Notifications.useLastNotificationResponse();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (lastResponse === null || lastResponse === undefined) return;

    // Nothing is routed while signed out. The root layout's gate would bounce it to login
    // anyway, and then leave the reminder's screen underneath in the history.
    if (userId === undefined) return;

    const { identifier } = lastResponse.notification.request;
    if (handled.current === identifier) return;

    // A dismissal is not a request to go anywhere.
    if (lastResponse.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;

    const route = routeForResponse(lastResponse);
    if (route === null) return;

    handled.current = identifier;

    // Pushed, not replaced: the reminder is an entry point to one task, and closing it
    // should leave the person on the dashboard rather than on an empty stack.
    router.push(route as never);
  }, [lastResponse, router, userId]);
}
