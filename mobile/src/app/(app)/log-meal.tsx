import { Feather } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useNetworkState } from 'expo-network';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DatePickerSheet } from '@/components/date-picker-sheet';
import { PrimaryButton } from '@/components/primary-button';
import { TimePickerSheet } from '@/components/time-picker-sheet';
import {
  Font,
  Layout,
  PlaceholderColor,
  Radius,
  Shadows,
  Surfaces,
  Type,
} from '@/constants/design';
import { AuraColors, IconTones } from '@/constants/theme';
import { ApiError } from '@/services/api-client';
import {
  estimateMealFromPhoto,
  summarise,
  withoutItem,
  MAX_PHOTO_BASE64_LENGTH,
  type PhotoConfidence,
  type PhotoEstimateItem,
  type PhotoMealEstimate,
} from '@/services/meal-photo';
import { logMeal } from '@/services/meal-service';
import { composeEatenAt, isInFuture, nowAsWheelTime } from '@/services/nutrition-history';
import { shiftIsoDate, todayIsoDate } from '@/services/recovery-service';

/**
 * How sure the model says it is, in words.
 *
 * Deliberately not a percentage. The model's own read of its own answer is not a measured
 * accuracy, and a figure like "72%" would be read as one.
 */
const ConfidenceWording: Record<PhotoConfidence, string> = {
  high: 'It says the foods were clear and the portions visible.',
  medium: 'It says it recognised the food but not how much of it there is.',
  low: 'It says this one was hard to read — treat the numbers as a starting point.',
};

/**
 * Capture quality.
 *
 * Low enough that a modern phone's photo fits comfortably inside the endpoint's ceiling and
 * uploads over mobile data in a few seconds; high enough that the food is still identifiable,
 * which is the only thing the model needs from it. Resizing properly would mean a native
 * image module, and this screen has to keep working in Expo Go.
 */
const CAPTURE_QUALITY = 0.4;

/**
 * How far back a meal can be logged.
 *
 * The same month `log-night.tsx` allows, for the same reason it is offered at all: people
 * remember yesterday's dinner and last weekend's, and a diary that only accepts what you
 * are eating right now is a diary with holes in it. Beyond a month the recollection is
 * worse than the gap it fills.
 */
const EARLIEST_DAYS_BACK = 30;

export default function LogMealScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const network = useNetworkState();
  const isOffline = network.isInternetReachable === false;

  const today = todayIsoDate();
  const earliest = shiftIsoDate(today, -EARLIEST_DAYS_BACK);

  // When it was eaten, which is not the same as when it is being typed in. Opens on now,
  // so logging a meal as you eat it is still no taps, and backfilling is two.
  const [eatenOn, setEatenOn] = useState(today);
  const [eatenTime, setEatenTime] = useState(nowAsWheelTime());
  const [isPickingDate, setIsPickingDate] = useState(false);
  const [isPickingTime, setIsPickingTime] = useState(false);


  const camera = useRef<CameraView | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<PhotoMealEstimate | null>(null);
  const [items, setItems] = useState<PhotoEstimateItem[]>([]);
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  const [name, setName] = useState('');
  const [kcal, setKcal] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function clearPhoto() {
    setPhotoUri(null);
    setEstimate(null);
    setItems([]);
    setIsPanelOpen(false);
  }

  async function openCamera() {
    setError(null);

    if (permission?.granted !== true) {
      const granted = await requestPermission();
      if (!granted.granted) return;
    }

    setIsCameraOpen(true);
  }

  /** Fills the editable fields from a set of items — on arrival, and after one is removed. */
  function applyItems(next: PhotoEstimateItem[]) {
    const totals = summarise(next);

    setItems(next);
    setName(totals.name);
    setKcal(String(totals.kcal));
    setProtein(totals.protein_g === null ? '' : String(totals.protein_g));
    setCarbs(totals.carbs_g === null ? '' : String(totals.carbs_g));
    setFat(totals.fat_g === null ? '' : String(totals.fat_g));
  }

  async function capture() {
    let photo;

    try {
      photo = await camera.current?.takePictureAsync({
        quality: CAPTURE_QUALITY,
        base64: true,
        shutterSound: false,
      });
    } catch {
      // Tapping the shutter before the preview is ready throws rather than returning
      // nothing, and an unhandled rejection here would leave the camera open on a dead
      // button.
      photo = null;
    }

    setIsCameraOpen(false);

    if (!photo?.base64) {
      setError('That photo did not come out — try again.');
      return;
    }

    if (photo.base64.length > MAX_PHOTO_BASE64_LENGTH) {
      // Caught here rather than uploaded and refused: the round trip would cost several
      // megabytes of someone's data allowance to learn nothing.
      setError('That photo is too large to send. Move back a little and try again.');
      return;
    }

    setPhotoUri(photo.uri);
    setIsReading(true);

    try {
      const read = await estimateMealFromPhoto(photo.base64);
      setEstimate(read);
      applyItems(read.items);
    } catch (e) {
      setPhotoUri(null);

      if (e instanceof ApiError && e.status === 0) {
        // Not queued, and deliberately so. Recognising a photo is a question, not a write:
        // there is nothing to replay later, the answer would be stale by the time it came,
        // and the outbox only carries writes that are safe to send twice.
        setError("Reading a photo needs a connection — you can still type the meal in below.");
      } else if (e instanceof ApiError && e.status === 429) {
        // The server's own words here are "Too Many Attempts", which tells someone holding
        // a phone nothing about what to do. The limit is per minute, so waiting is the
        // whole remedy and the message should say so.
        setError('That is a lot of photos in a row — wait a minute, or type the meal in below.');
      } else {
        setError(e instanceof ApiError ? e.message : 'Could not read that photo.');
      }
    } finally {
      setIsReading(false);
    }
  }

  function removeItem(index: number) {
    const next = withoutItem(items, index);

    if (next.length === 0) {
      clearPhoto();
      setName('');
      setKcal('');
      setProtein('');
      setCarbs('');
      setFat('');
      return;
    }

    // The totals are recomputed rather than left alone, which does overwrite a hand-edited
    // figure — but striking an item off and watching the calories not move is worse.
    applyItems(next);
  }

  const macroOrNothing = (value: string) => {
    const grams = Number(value);
    return Number.isFinite(grams) && value.trim() !== '' && grams > 0 ? Math.round(grams) : null;
  };

  function pickDate(iso: string) {
    if (iso > today || iso < earliest) return;

    setEatenOn(iso);
    setError(null);
  }

  /** The stepper is for nudging a day either way; the calendar is for the rest. */
  function stepDate(days: number) {
    pickDate(shiftIsoDate(eatenOn, days));
  }

  async function save() {
    setError(null);

    // Checked here rather than left to the 422, because the server's answer names a field
    // the user cannot see and this one names the wheel they just turned.
    if (isInFuture(eatenOn, eatenTime)) {
      setError('That time has not come round yet — pick a moment already past.');
      return;
    }

    setIsSaving(true);

    const typed = {
      name: name.trim(),
      kcal: Number(kcal) || 0,
      protein_g: macroOrNothing(protein),
      carbs_g: macroOrNothing(carbs),
      fat_g: macroOrNothing(fat),
    };

    /*
     * One shape now. The barcode field is gone from this screen, so nothing here can
     * produce a `lookup` row -- the endpoint, the source and the history that reads it all
     * remain, ready for the camera scan that replaces the field.
     */
    const payload = {
            name: typed.name,
            kcal: typed.kcal,
            // The row remembers a model started this, even after the user has corrected
            // every number on the screen. Editing a guess does not turn it into a
            // measurement, and a week from now the list has no other way to know.
            source: estimate !== null ? ('photo' as const) : ('estimate' as const),
            ...(typed.protein_g !== null ? { protein_g: typed.protein_g } : {}),
            ...(typed.carbs_g !== null ? { carbs_g: typed.carbs_g } : {}),
            ...(typed.fat_g !== null ? { fat_g: typed.fat_g } : {}),
          };

    if (payload.name === '' || payload.kcal <= 0) {
      setError('Give it a name and a calorie figure.');
      setIsSaving(false);
      return;
    }

    try {
      // The offset travels with the moment. Without it the server would file a late supper
      // under the day before for anyone east of Greenwich.
      await logMeal({ ...payload, eaten_at: composeEatenAt(eatenOn, eatenTime) });
      router.back();
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        // Not queued. The outbox may only carry writes that are safe to send twice, and
        // POST /meals has no key to dedupe on — a replay would add the meal again. This
        // previously enqueued an empty snapshot for today and navigated back, which threw
        // the meal away while telling the user it had been saved.
        setError("Can't reach AuraFlow — this meal isn't saved yet. Try again once you're back online.");
      } else {
        setError(e instanceof ApiError ? e.message : 'Something went wrong.');
      }
    } finally {
      setIsSaving(false);
    }
  }

  const isEarliest = eatenOn <= earliest;
  const isLatest = eatenOn >= today;

  if (isCameraOpen) {
    return (
      <View style={styles.cameraScreen}>
        <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" />

        <View style={[styles.cameraTop, { paddingTop: insets.top + 14 }]}>
          <Text style={styles.cameraHint}>
            Fill the frame with the plate. AuraFlow can only guess at the portion, so what
            comes back is a starting point you correct.
          </Text>
        </View>

        <View style={[styles.cameraBottom, { paddingBottom: Math.max(insets.bottom, 24) }]}>
          <Pressable
            onPress={() => setIsCameraOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            hitSlop={10}
            style={styles.cameraCancel}>
            <Text style={styles.cameraCancelLabel}>Cancel</Text>
          </Pressable>

          <Pressable
            onPress={capture}
            accessibilityRole="button"
            accessibilityLabel="Take the photo"
            style={styles.shutter}>
            <View style={styles.shutterInner} />
          </Pressable>

          <View style={styles.cameraCancel} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 14 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={Type.screenTitle}>Log a meal</Text>
              <Text style={Type.meta}>
                {eatenOn === today ? 'Something you ate today' : 'A meal from an earlier day'}
              </Text>
            </View>

            <Pressable
              onPress={() => router.back()}
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={10}
              style={styles.close}>
              <Feather name="x" size={18} color={AuraColors.content.default} />
            </Pressable>
          </View>

          {/* When, before what. A meal is an event with a time on it, and four of them land
              on a normal day — so the form asks when rather than assuming the moment the
              save button was pressed. The same shape as the night log's date row, because
              backfilling should feel like one thing across the app. */}
          <Animated.View entering={FadeInUp.duration(360)} style={styles.whenCard}>
            <View style={styles.dateRow}>
              <Pressable
                onPress={() => stepDate(-1)}
                disabled={isEarliest}
                accessibilityRole="button"
                accessibilityLabel="The day before"
                hitSlop={10}
                style={[styles.step, isEarliest && styles.stepDisabled]}>
                <Feather
                  name="chevron-left"
                  size={18}
                  color={isEarliest ? AuraColors.surface.selected : AuraColors.content.default}
                />
              </Pressable>

              <Pressable
                onPress={() => setIsPickingDate(true)}
                accessibilityRole="button"
                accessibilityLabel="Pick a different day"
                style={styles.dateText}>
                <Text style={Type.eyebrow}>Eaten on</Text>
                <View style={styles.dateLine}>
                  <Text style={styles.date}>
                    {eatenOn === today
                      ? 'Today'
                      : new Date(`${eatenOn}T00:00:00`).toLocaleDateString(undefined, {
                          weekday: 'long',
                          day: 'numeric',
                          month: 'long',
                        })}
                  </Text>
                  <Feather name="calendar" size={13} color={AuraColors.content.muted} />
                </View>
              </Pressable>

              <Pressable
                onPress={() => stepDate(1)}
                disabled={isLatest}
                accessibilityRole="button"
                accessibilityLabel="The day after"
                hitSlop={10}
                style={[styles.step, isLatest && styles.stepDisabled]}>
                <Feather
                  name="chevron-right"
                  size={18}
                  color={isLatest ? AuraColors.surface.selected : AuraColors.content.default}
                />
              </Pressable>
            </View>

            <Pressable
              onPress={() => setIsPickingTime(true)}
              accessibilityRole="button"
              accessibilityLabel={`Eaten at ${eatenTime}`}
              style={styles.timeField}>
              <View style={styles.timeIcon}>
                <Feather name="clock" size={15} color={IconTones.brand.color} />
              </View>
              <Text style={Type.fieldLabel}>Eaten at</Text>
              <Text style={styles.timeValue}>{eatenTime}</Text>
            </Pressable>
          </Animated.View>

          {/* The photograph leads now that the barcode field is gone from this screen. It
              reads a picture with no scale in it, so the disclosure below it does the work
              the barcode's provenance used to. */}
          {estimate === null ? (
            <Animated.View entering={FadeInUp.delay(60).duration(400)}>
              <Pressable
                onPress={openCamera}
                disabled={isReading || isOffline}
                accessibilityRole="button"
                accessibilityLabel="Photograph the meal"
                accessibilityState={{ disabled: isReading || isOffline }}
                style={[styles.photoCta, (isReading || isOffline) && styles.photoCtaDim]}>
                <View style={[styles.resultIcon, { backgroundColor: IconTones.stage.bg }]}>
                  {isReading ? (
                    <ActivityIndicator size="small" color={IconTones.stage.color} />
                  ) : (
                    <Feather name="camera" size={18} color={IconTones.stage.color} />
                  )}
                </View>
                <View style={styles.resultText}>
                  <Text style={Type.cardTitle}>
                    {isReading ? 'Reading your photo…' : 'Photograph the meal'}
                  </Text>
                  <Text style={Type.caption}>
                    {isOffline
                      ? 'Needs a connection — the photo is read on our server, not on this phone'
                      : 'AuraFlow suggests what is on the plate. Always an estimate.'}
                  </Text>
                </View>
                {!isReading && !isOffline ? (
                  <Feather name="chevron-right" size={18} color={AuraColors.content.muted} />
                ) : null}
              </Pressable>
            </Animated.View>
          ) : null}

          {estimate !== null ? (
            <Animated.View entering={FadeInUp.duration(300)} style={styles.card}>
              <View style={styles.resultRow}>
                {photoUri !== null ? (
                  <Image source={{ uri: photoUri }} style={styles.thumb} />
                ) : null}
                <View style={styles.resultText}>
                  <Text style={Type.rowTitle}>What AuraFlow sees</Text>
                  <Text style={Type.caption}>a guess from the photo, not a measurement</Text>
                </View>
                <Pressable
                  onPress={clearPhoto}
                  accessibilityRole="button"
                  accessibilityLabel="Discard this photo estimate"
                  hitSlop={10}
                  style={styles.close}>
                  <Feather name="x" size={16} color={AuraColors.content.default} />
                </Pressable>
              </View>

              {items.map((item, index) => (
                <View key={`${item.name}-${index}`} style={styles.itemRow}>
                  <Text style={styles.itemName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.itemKcal}>≈ {item.kcal} kcal</Text>
                  <Pressable
                    onPress={() => removeItem(index)}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${item.name}`}
                    hitSlop={10}>
                    <Feather name="x" size={14} color="#94a3b8" />
                  </Pressable>
                </View>
              ))}

              {/* The same disclosure shape the focus forecast uses: a one-line claim about
                  the claim, and the detail behind it a tap away. */}
              <Pressable
                onPress={() => setIsPanelOpen((open) => !open)}
                accessibilityRole="button"
                accessibilityState={{ expanded: isPanelOpen }}
                accessibilityLabel="How this estimate was worked out"
                style={styles.disclosure}>
                <Feather name="info" size={12} color={AuraColors.content.muted} />
                <Text style={styles.disclosureLabel}>
                  An estimate from a photograph — check it before saving
                </Text>
                <Feather
                  name={isPanelOpen ? 'chevron-up' : 'chevron-down'}
                  size={14}
                  color={AuraColors.content.muted}
                />
              </Pressable>

              {isPanelOpen ? (
                <View style={styles.panel}>
                  <Text style={styles.panelText}>
                    A vision model looked at your photo. It had no scale, no packet and
                    nothing in shot to judge size against, so the portion — and therefore
                    every calorie figure here — is inferred from what the dish usually looks
                    like, not from your plate.
                  </Text>
                  <Text style={styles.panelText}>
                    {ConfidenceWording[estimate.confidence]} That is the model&apos;s own read
                    of its own answer, not a measured accuracy.
                  </Text>
                  <Text style={styles.panelText}>
                    Correct anything below before saving. The meal is stored as a photo
                    estimate and shown with a ≈, the way your own estimates are — a barcode
                    lookup is the only figure in AuraFlow that someone actually measured.
                  </Text>
                  <Text style={styles.panelText}>
                    The photo is sent to AuraFlow&apos;s server, passed to a vision model,
                    and kept by neither. It is never saved to your photos.
                  </Text>
                </View>
              ) : null}
            </Animated.View>
          ) : null}

          <Animated.View entering={FadeInUp.delay(80).duration(400)} style={styles.card}>
              <View style={styles.estimateHead}>
                <View
                  style={[
                    styles.resultIcon,
                    { backgroundColor: estimate !== null ? IconTones.stage.bg : IconTones.caution.bg },
                  ]}>
                  <Feather
                    name="edit-3"
                    size={16}
                    color={estimate !== null ? IconTones.stage.color : IconTones.caution.color}
                  />
                </View>
                <View style={styles.resultText}>
                  <Text style={styles.estimateTitle}>
                    {estimate !== null ? 'Correct anything that looks wrong' : 'Enter it yourself'}
                  </Text>
                  <Text style={Type.caption}>
                    {estimate !== null
                      ? 'Saved as a photo estimate, shown with a ≈'
                      : 'Saved as your estimate, shown with a ≈'}
                  </Text>
                </View>
              </View>

              <View style={styles.field}>
                <Text style={Type.fieldLabel}>What was it?</Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Rice and curry"
                  placeholderTextColor={PlaceholderColor}
                  style={styles.textField}
                />
              </View>

              <View style={styles.field}>
                <Text style={Type.fieldLabel}>Roughly how many calories?</Text>
                <TextInput
                  value={kcal}
                  onChangeText={setKcal}
                  placeholder="620"
                  placeholderTextColor={PlaceholderColor}
                  keyboardType="number-pad"
                  style={styles.textField}
                />
              </View>

              {/* Only for a photo estimate. A blank form asking someone to guess their own
                  macros to the gram would collect worse data than no data. */}
              {estimate !== null ? (
                <View style={styles.macroRow}>
                  {(
                    [
                      ['Protein', protein, setProtein],
                      ['Carbs', carbs, setCarbs],
                      ['Fat', fat, setFat],
                    ] as const
                  ).map(([label, value, setValue]) => (
                    <View key={label} style={styles.macroField}>
                      <Text style={Type.fieldLabel}>{label}</Text>
                      <View style={styles.macroInputWrap}>
                        <TextInput
                          value={value}
                          onChangeText={setValue}
                          placeholder="—"
                          placeholderTextColor={PlaceholderColor}
                          keyboardType="number-pad"
                          style={styles.macroInput}
                        />
                        <Text style={Type.caption}>g</Text>
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}
          </Animated.View>

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>

        <View style={[styles.commit, { paddingBottom: Math.max(insets.bottom, 20) }]}>
          <PrimaryButton label="Save meal" onPress={save} loading={isSaving} />
          {/* It does not queue. `save` says so on failure, and this line used to promise
              the opposite of what the code beneath it does. */}
          <Text style={styles.commitNote}>Saved straight away — needs a connection</Text>
        </View>
      </KeyboardAvoidingView>

      <DatePickerSheet
        visible={isPickingDate}
        value={eatenOn}
        earliest={earliest}
        latest={today}
        onSelect={pickDate}
        onClose={() => setIsPickingDate(false)}
      />

      <TimePickerSheet
        visible={isPickingTime}
        label="Eaten at"
        value={eatenTime}
        fallback={nowAsWheelTime()}
        onSelect={setEatenTime}
        onClose={() => setIsPickingTime(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: AuraColors.surface.sunken },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: Layout.gutter, paddingBottom: 24, gap: Layout.gapCards },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  headerText: { flex: 1, gap: 4 },
  close: {
    width: 36,
    height: 36,
    borderRadius: Radius.iconSquare,
    backgroundColor: AuraColors.surface.default,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadows.chip,
  },
  whenCard: { ...Surfaces.card, gap: 12 },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dateText: { flex: 1, alignItems: 'center', gap: 3 },
  dateLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  date: { fontFamily: Font.bold, fontSize: 15, color: AuraColors.content.default },
  step: {
    width: 34,
    height: 34,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: AuraColors.surface.sunken,
  },
  stepDisabled: { backgroundColor: 'transparent' },
  timeField: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 8,
    paddingRight: 14,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: AuraColors.surface.selected,
    backgroundColor: AuraColors.surface.default,
  },
  timeIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: IconTones.brand.bg,
  },
  timeValue: {
    marginLeft: 'auto',
    fontFamily: Font.semibold,
    fontSize: 16,
    color: AuraColors.content.default,
    fontVariant: ['tabular-nums'],
  },
  photoCta: { ...Surfaces.card, flexDirection: 'row', alignItems: 'center', gap: 12 },
  photoCtaDim: { opacity: 0.55 },
  card: { ...Surfaces.card, gap: 12 },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  resultIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.iconMedium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumb: { width: 46, height: 46, borderRadius: Radius.iconMedium },
  resultText: { flex: 1, gap: 2 },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: Radius.field,
    backgroundColor: AuraColors.surface.sunken,
  },
  itemName: { flex: 1, fontFamily: Font.semibold, fontSize: 13, color: AuraColors.content.default },
  itemKcal: {
    fontFamily: Font.regular,
    fontSize: 12,
    color: AuraColors.content.muted,
    fontVariant: ['tabular-nums'],
  },
  disclosure: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 28 },
  disclosureLabel: {
    flex: 1,
    fontFamily: Font.regular,
    fontSize: 10,
    color: AuraColors.content.muted,
  },
  panel: { ...Surfaces.panel, gap: 8 },
  panelText: {
    fontFamily: Font.regular,
    fontSize: 10,
    lineHeight: 15,
    color: AuraColors.content.muted,
  },
  portionRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  portionInputWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  portionInput: {
    width: 70,
    height: 40,
    paddingHorizontal: 12,
    borderRadius: Radius.field,
    backgroundColor: AuraColors.surface.sunken,
    textAlign: 'center',
    ...Type.input,
  },
  portionTotal: {
    flex: 1,
    textAlign: 'right',
    fontFamily: Font.semibold,
    fontSize: 14,
    color: AuraColors.content.default,
    fontVariant: ['tabular-nums'],
  },
  noteBlock: { ...Surfaces.panel, flexDirection: 'row', gap: 9, alignItems: 'flex-start' },
  noteText: {
    flex: 1,
    fontFamily: Font.regular,
    fontSize: 10,
    lineHeight: 15,
    color: AuraColors.content.muted,
  },
  estimateHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  estimateTitle: { fontFamily: Font.bold, fontSize: 14, color: AuraColors.content.default },
  field: { gap: 6 },
  textField: {
    height: 46,
    paddingHorizontal: 14,
    borderRadius: Radius.field,
    backgroundColor: AuraColors.surface.sunken,
    ...Type.input,
  },
  macroRow: { flexDirection: 'row', gap: 10 },
  macroField: { flex: 1, gap: 6 },
  macroInputWrap: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  macroInput: {
    flex: 1,
    height: 42,
    paddingHorizontal: 10,
    borderRadius: Radius.field,
    backgroundColor: AuraColors.surface.sunken,
    textAlign: 'center',
    ...Type.input,
  },
  error: { ...Type.caption, color: AuraColors.danger, textAlign: 'center' },
  commit: {
    paddingHorizontal: Layout.gutter,
    paddingTop: 12,
    gap: 10,
    backgroundColor: AuraColors.surface.default,
    borderTopWidth: 1,
    borderTopColor: 'rgba(15,23,42,0.06)',
  },
  commitNote: { ...Type.caption, textAlign: 'center' },
  cameraScreen: { flex: 1, backgroundColor: '#000000' },
  cameraTop: { paddingHorizontal: Layout.gutter, paddingBottom: 14 },
  cameraHint: {
    fontFamily: Font.regular,
    fontSize: 12,
    lineHeight: 18,
    color: 'rgba(255,255,255,0.9)',
    textAlign: 'center',
  },
  cameraBottom: {
    marginTop: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Layout.gutter,
  },
  cameraCancel: { width: 72, justifyContent: 'center' },
  cameraCancelLabel: { fontFamily: Font.semibold, fontSize: 14, color: '#ffffff' },
  shutter: {
    width: 74,
    height: 74,
    borderRadius: 999,
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: { width: 58, height: 58, borderRadius: 999, backgroundColor: '#ffffff' },
});
