import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';

import {
  planOccurrences,
  REMINDERS,
  reminderFor,
  type PlannedOccurrence,
  type ReminderKind,
} from '@/services/reminder-schedule';
import type { ReminderSettings } from '@/services/reminder-settings';

/**
 * Everything that talks to the OS notification centre.
 *
 * ## Why there is no push notification anywhere in this app
 *
 * Not an omission, and not a scope cut. Two facts decided it, and they point the same way.
 *
 * The first is a platform one: `expo-notifications` stopped supporting *remote* notifications
 * in Expo Go on Android at SDK 53, while local ones still work there. Adding push would mean
 * a development build, FCM and APNs credentials, and a server that holds device tokens —
 * and it would mean this project could no longer be run by a marker on a borrowed phone.
 *
 * The second is that there is nothing to push. Every reminder here is a time of day the
 * phone already knows, checked against a target and a completion state the phone has
 * already cached. A server round trip would add a dependency and tell us nothing new.
 *
 * The one thing a server *could* usefully say — "they already did this on another device,
 * cancel it" — is exactly the residual case documented in `reminder-completion`, and it is
 * a small enough gap that it does not justify the rest.
 *
 * ## Why one-shot occurrences rather than a repeating daily trigger
 *
 * `SchedulableTriggerInputTypes.DAILY` exists and would be one line. It is wrong here for
 * a reason that has nothing to do with timekeeping: a repeat cannot be told to skip a day,
 * and skipping the day someone has already checked in is the entire point of the feature.
 *
 * The timekeeping is worth knowing anyway, because it decides how often re-arming has to
 * happen. On Android the daily trigger recomputes its next fire from local calendar fields
 * each time it re-arms, so it survives daylight saving on its own; it has no receiver for
 * `ACTION_TIMEZONE_CHANGED`, so flying somewhere leaves it on the old zone's clock until it
 * next fires. On iOS it becomes a `UNCalendarNotificationTrigger`, which tracks wall-clock
 * time through a DST change but binds to the zone it was scheduled in.
 *
 * Placing explicit one-shot dates and recomputing them on every foreground makes both moot:
 * `nextOccurrence` derives each firing from local calendar fields at the moment it plans
 * them, so 07:00 stays 07:00 through a DST change, and a change of zone is corrected the
 * first time the app is opened there.
 */

/** How far ahead firings are placed. See `upcomingOccurrences` for why it is a week. */
export const HORIZON_DAYS = 7;

/**
 * Marks a notification as ours.
 *
 * Every scheduled notification carries this, and cancelling reads it rather than calling
 * `cancelAllScheduledNotificationsAsync`. Being surgical matters most in Expo Go, where the
 * notification sandbox belongs to the Expo Go app and is shared with every other project
 * that has been opened on that handset.
 */
const OWNER = 'auraflow.reminder';

export interface ReminderNotificationData {
  owner: typeof OWNER;
  kind: ReminderKind;
  /** The local date the firing was planned for — carried so a tap can be reconciled later. */
  onDate: string;
  route: string;
}

export const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/**
 * How the app behaves when a reminder arrives while it is already open.
 *
 * A banner, no sound. The sound is the part that earns resentment, and it is redundant when
 * the person is holding the phone looking at the app that sent it. `shouldShowList` keeps it
 * in the notification centre, so one that arrives during a glance at another screen is still
 * there afterwards.
 *
 * `shouldShowAlert` is deprecated as of SDK 53 in favour of the banner/list split and is
 * deliberately not set — passing both is how a handler ends up doing different things on
 * the two platforms.
 */
export function configureNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

/**
 * Android needs the channel to exist before anything can be posted to it, and a channel's
 * importance is fixed at creation — the OS ignores later changes, on the principle that once
 * a user has adjusted it, the app does not get to adjust it back. So the value chosen here is
 * chosen once, per kind.
 *
 * The morning check-in is the only one set to `HIGH`. It is the one reminder whose value is
 * entirely in arriving at the right moment: a check-in taken two hours late is not a late
 * check-in, it is a reading against a different baseline. The rest are `DEFAULT` or `LOW`,
 * and the two optional ones make no sound at all.
 *
 * A no-op off Android, where importance is a property of the notification rather than a
 * channel the user manages.
 */
export async function ensureChannelsAsync(): Promise<void> {
  if (Platform.OS !== 'android') return;

  const importanceFor: Record<ReminderKind, Notifications.AndroidImportance> = {
    'morning-checkin': Notifications.AndroidImportance.HIGH,
    'log-night': Notifications.AndroidImportance.DEFAULT,
    water: Notifications.AndroidImportance.LOW,
    movement: Notifications.AndroidImportance.LOW,
  };

  await Promise.all(
    REMINDERS.map((definition) =>
      Notifications.setNotificationChannelAsync(definition.channelId, {
        name: definition.label,
        description: definition.rationale,
        importance: importanceFor[definition.kind],
        sound: importanceFor[definition.kind] >= Notifications.AndroidImportance.DEFAULT
          ? 'default'
          : null,
      }),
    ),
  );
}

/**
 * The four states the settings screen has to be able to explain.
 *
 * `blocked` is separated from `denied` because only one of them has a next step the app can
 * offer. A denied permission can be asked for again; a blocked one can only be changed in
 * the OS settings, and a screen that shows an Allow button which silently does nothing is
 * worse than one that says where to go.
 */
export type PermissionState = 'granted' | 'denied' | 'blocked' | 'undetermined';

function toState(status: Notifications.NotificationPermissionsStatus): PermissionState {
  if (status.granted) return 'granted';
  if (status.status === 'undetermined') return 'undetermined';

  return status.canAskAgain ? 'denied' : 'blocked';
}

export async function getPermissionStateAsync(): Promise<PermissionState> {
  return toState(await Notifications.getPermissionsAsync());
}

/**
 * Asked at the point of value, never on launch.
 *
 * The only caller is the settings screen, reached from Profile, and only when a reminder is
 * switched on. Someone who has just chosen a time for a morning check-in knows exactly what
 * they are being asked to allow; the same dialog on first launch is a dialog about nothing,
 * and the answer to a dialog about nothing is No — permanently, on iOS, where it can only be
 * asked once.
 *
 * `allowProvisional` is deliberately not requested. Provisional authorisation would let
 * reminders arrive silently with no prompt at all, which sounds generous and is not: the
 * user would not know the app had started sending them.
 */
export async function requestPermissionAsync(): Promise<PermissionState> {
  return toState(
    await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowSound: true, allowBadge: false },
    }),
  );
}

/** Where a blocked permission can actually be changed. */
export async function openSystemSettingsAsync(): Promise<void> {
  await Linking.openSettings();
}

function isOurs(request: Notifications.NotificationRequest): boolean {
  return (request.content.data as Partial<ReminderNotificationData> | null)?.owner === OWNER;
}

/**
 * Serialises reconciles.
 *
 * Two of them overlapping would interleave a cancel from one pass with a schedule from the
 * other and leave either duplicates or nothing at all. That is not hypothetical: flipping a
 * switch reconciles, and the app returning to the foreground reconciles, and a switch
 * flipped as the screen opens does both.
 */
let pending: Promise<unknown> = Promise.resolve();

function serialise<T>(work: () => Promise<T>): Promise<T> {
  const next = pending.then(work, work);
  pending = next.catch(() => undefined);

  return next;
}

/**
 * Brings what the OS holds into line with what the settings and today's facts say it should.
 *
 * Cancel-then-place rather than a diff. The set is at most a few dozen entries, the
 * arithmetic that produces it is cheap, and a diff would have to compare trigger dates that
 * the OS reports back in a shape that differs by platform — three ways to be subtly wrong
 * in exchange for saving nothing measurable.
 *
 * @returns the occurrences now scheduled, so the settings screen can say when the next one is.
 */
export async function syncScheduleAsync(
  settings: ReminderSettings,
  doneDates: Map<ReminderKind, Set<string>>,
  now = new Date(),
): Promise<PlannedOccurrence[]> {
  return serialise(async () => {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();

    await Promise.all(
      scheduled
        .filter(isOurs)
        .map((request) => Notifications.cancelScheduledNotificationAsync(request.identifier)),
    );

    const permission = await getPermissionStateAsync();

    // Nothing is placed without permission. Scheduling anyway would "work" — the calls
    // resolve — and then silently deliver nothing, which is the failure mode most likely to
    // be mistaken for a bug in this file.
    if (permission !== 'granted') return [];

    await ensureChannelsAsync();

    const planned = REMINDERS.flatMap((definition) =>
      planOccurrences(
        definition.kind,
        settings.reminders[definition.kind],
        settings.quiet,
        doneDates.get(definition.kind) ?? new Set<string>(),
        now,
        HORIZON_DAYS,
      ),
    );

    await Promise.all(planned.map(place));

    return planned;
  });
}

async function place(occurrence: PlannedOccurrence): Promise<void> {
  const definition = reminderFor(occurrence.kind);

  const data: ReminderNotificationData = {
    owner: OWNER,
    kind: occurrence.kind,
    onDate: occurrence.onDate,
    route: definition.route,
  };

  await Notifications.scheduleNotificationAsync({
    content: {
      title: definition.title,
      body: definition.body,
      data: data as unknown as Record<string, unknown>,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: occurrence.at,
      // Ignored off Android. Named here rather than relying on a default channel so the
      // importance set in `ensureChannelsAsync` is the one that actually applies.
      channelId: definition.channelId,
    },
  });
}

/** Removes everything this app scheduled. Called on sign-out. */
export async function cancelAllRemindersAsync(): Promise<void> {
  return serialise(async () => {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();

    await Promise.all(
      scheduled
        .filter(isOurs)
        .map((request) => Notifications.cancelScheduledNotificationAsync(request.identifier)),
    );
  });
}

/**
 * The screen a tapped reminder should open, or null when the tap was not one of ours.
 *
 * Read off the notification's own payload rather than mapped from its kind here, so the
 * destination travels with the notification. One scheduled by a previous version of the app
 * is still sitting in the OS after an update, and it should still land somewhere sensible.
 */
export function routeForResponse(response: Notifications.NotificationResponse): string | null {
  const data = response.notification.request.content.data as
    | Partial<ReminderNotificationData>
    | null
    | undefined;

  if (data?.owner !== OWNER) return null;

  return typeof data.route === 'string' ? data.route : null;
}
