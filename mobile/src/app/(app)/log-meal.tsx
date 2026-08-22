import { Feather } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { LinearGradient } from 'expo-linear-gradient';
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

import { PrimaryButton } from '@/components/primary-button';
import {
  Font,
  GradientAxis,
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
import { logMeal, lookupBarcode, type FoodProduct } from '@/services/meal-service';

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

export default function LogMealScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const network = useNetworkState();
  const isOffline = network.isInternetReachable === false;

  const [barcode, setBarcode] = useState('');
  const [product, setProduct] = useState<FoodProduct | null>(null);
  const [portion, setPortion] = useState('100');
  const [isLooking, setIsLooking] = useState(false);
  const [lookupMissed, setLookupMissed] = useState(false);

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

  async function search() {
    const code = barcode.trim();
    if (!/^\d{6,14}$/.test(code)) {
      setError('A barcode is 6 to 14 digits.');
      return;
    }

    setError(null);
    setLookupMissed(false);
    setIsLooking(true);

    const found = await lookupBarcode(code);

    if (found !== null) {
      // A scanned product is a better claim than a photograph of one, and a screen holding
      // both would have to decide which the save meant. It clears rather than competes.
      clearPhoto();
    }

    setProduct(found);
    // Not an error — most products simply are not in an open, volunteer-edited database.
    setLookupMissed(found === null);
    setIsLooking(false);
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
    setProduct(null);
    setLookupMissed(false);
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

  const portionG = Number(portion) || 0;
  const lookedUpKcal =
    product !== null ? Math.round((product.kcal_per_100g * portionG) / 100) : null;

  const macroOrNothing = (value: string) => {
    const grams = Number(value);
    return Number.isFinite(grams) && value.trim() !== '' && grams > 0 ? Math.round(grams) : null;
  };

  async function save() {
    setError(null);
    setIsSaving(true);

    const typed = {
      name: name.trim(),
      kcal: Number(kcal) || 0,
      protein_g: macroOrNothing(protein),
      carbs_g: macroOrNothing(carbs),
      fat_g: macroOrNothing(fat),
    };

    const payload =
      product !== null && lookedUpKcal !== null
        ? {
            name: product.brand ? `${product.brand} ${product.name}` : product.name,
            kcal: lookedUpKcal,
            source: 'lookup' as const,
            barcode: product.barcode,
            portion_g: portionG,
            ...(product.protein_per_100g !== null
              ? { protein_g: Math.round((product.protein_per_100g * portionG) / 100) }
              : {}),
            ...(product.carbs_per_100g !== null
              ? { carbs_g: Math.round((product.carbs_per_100g * portionG) / 100) }
              : {}),
            ...(product.fat_per_100g !== null
              ? { fat_g: Math.round((product.fat_per_100g * portionG) / 100) }
              : {}),
          }
        : {
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
      await logMeal(payload);
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
                {new Date().toLocaleDateString(undefined, {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                })}
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

          {/* Barcode first: a looked-up figure is a better claim than a guess, so the
              flow leads with it and keeps the estimate as a fallback. */}
          <Animated.View entering={FadeInUp.duration(400)}>
            <View style={styles.scanRow}>
              <LinearGradient
                colors={[AuraColors.brand.default, AuraColors.accent.default]}
                start={GradientAxis.deg120.start}
                end={GradientAxis.deg120.end}
                style={StyleSheet.absoluteFill}
              />
              <View style={styles.scanIcon}>
                <Feather name="maximize" size={22} color="#ffffff" />
              </View>
              <View style={styles.scanText}>
                <Text style={styles.scanTitle}>Look up a barcode</Text>
                <Text style={styles.scanSubtitle}>
                  Type the digits under the barcode — scanning arrives with the camera build
                </Text>
              </View>
            </View>

            <View style={styles.barcodeRow}>
              <TextInput
                value={barcode}
                onChangeText={setBarcode}
                placeholder="5000168001234"
                placeholderTextColor={PlaceholderColor}
                keyboardType="number-pad"
                style={styles.barcodeInput}
              />
              <Pressable
                onPress={search}
                disabled={isLooking}
                accessibilityRole="button"
                accessibilityLabel="Look up barcode"
                style={styles.searchButton}>
                <Feather name="search" size={18} color="#ffffff" />
              </Pressable>
            </View>
          </Animated.View>

          {/* Second, not first. It reads a photograph with no scale in it, so it belongs
              below the barcode and above the blank form. */}
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
                  <Text style={Type.caption}>a guess from the photo · {estimate.model}</Text>
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
                    The photo is sent to AuraFlow&apos;s server, passed to {estimate.model},
                    and kept for neither. It is never saved to your photos.
                  </Text>
                </View>
              ) : null}
            </Animated.View>
          ) : null}

          {product !== null ? (
            <Animated.View entering={FadeInUp.duration(300)} style={styles.card}>
              <View style={styles.resultRow}>
                <View style={[styles.resultIcon, { backgroundColor: IconTones.success.bg }]}>
                  <Feather name="check-circle" size={17} color={IconTones.success.color} />
                </View>
                <View style={styles.resultText}>
                  <Text style={Type.rowTitle}>
                    {product.brand ? `${product.brand} ${product.name}` : product.name}
                  </Text>
                  <Text style={Type.caption}>{product.source} · per 100 g</Text>
                </View>
                <View style={styles.resultValue}>
                  <Text style={styles.resultKcal}>{product.kcal_per_100g}</Text>
                  <Text style={Type.caption}>kcal</Text>
                </View>
              </View>

              <View style={styles.portionRow}>
                <Text style={Type.fieldLabel}>Portion</Text>
                <View style={styles.portionInputWrap}>
                  <TextInput
                    value={portion}
                    onChangeText={setPortion}
                    keyboardType="number-pad"
                    style={styles.portionInput}
                  />
                  <Text style={Type.caption}>g</Text>
                </View>
                <Text style={styles.portionTotal}>{lookedUpKcal} kcal</Text>
              </View>

              <View style={styles.noteBlock}>
                <Feather name="info" size={12} color={AuraColors.content.muted} />
                <Text style={styles.noteText}>
                  Figures come from Open Food Facts, an open database edited by its users.
                </Text>
              </View>
            </Animated.View>
          ) : null}

          {product === null && (
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
                    {estimate !== null
                      ? 'Correct anything that looks wrong'
                      : lookupMissed
                        ? 'Not in the database'
                        : 'Or enter it yourself'}
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
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>

        <View style={[styles.commit, { paddingBottom: Math.max(insets.bottom, 20) }]}>
          <PrimaryButton label="Add to today" onPress={save} loading={isSaving} />
          {/* It does not queue. `save` says so on failure, and this line used to promise
              the opposite of what the code beneath it does. */}
          <Text style={styles.commitNote}>Saved straight away — needs a connection</Text>
        </View>
      </KeyboardAvoidingView>
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
  scanRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: Radius.row,
    overflow: 'hidden',
    ...Shadows.cta,
  },
  scanIcon: {
    width: 46,
    height: 46,
    borderRadius: Radius.iconLarge,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanText: { flex: 1, gap: 3 },
  scanTitle: { fontFamily: Font.bold, fontSize: 15, color: '#ffffff' },
  scanSubtitle: {
    fontFamily: Font.regular,
    fontSize: 11,
    lineHeight: 16,
    color: 'rgba(255,255,255,0.84)',
  },
  barcodeRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  barcodeInput: {
    flex: 1,
    height: 48,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: AuraColors.surface.default,
    borderWidth: 1,
    borderColor: AuraColors.surface.selected,
    ...Type.input,
  },
  searchButton: {
    width: 48,
    height: 48,
    borderRadius: 999,
    backgroundColor: AuraColors.brand.default,
    alignItems: 'center',
    justifyContent: 'center',
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
  resultValue: { alignItems: 'flex-end' },
  resultKcal: {
    fontFamily: Font.bold,
    fontSize: 15,
    color: AuraColors.content.default,
    fontVariant: ['tabular-nums'],
  },
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
