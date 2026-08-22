import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
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
import { logMeal, lookupBarcode, type FoodProduct } from '@/services/meal-service';

export default function LogMealScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [barcode, setBarcode] = useState('');
  const [product, setProduct] = useState<FoodProduct | null>(null);
  const [portion, setPortion] = useState('100');
  const [isLooking, setIsLooking] = useState(false);
  const [lookupMissed, setLookupMissed] = useState(false);

  const [name, setName] = useState('');
  const [kcal, setKcal] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

    setProduct(found);
    // Not an error — most products simply are not in an open, volunteer-edited database.
    setLookupMissed(found === null);
    setIsLooking(false);
  }

  const portionG = Number(portion) || 0;
  const lookedUpKcal =
    product !== null ? Math.round((product.kcal_per_100g * portionG) / 100) : null;

  async function save() {
    setError(null);
    setIsSaving(true);

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
            name: name.trim(),
            kcal: Number(kcal) || 0,
            source: 'estimate' as const,
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

          {(lookupMissed || product === null) && (
            <Animated.View entering={FadeInUp.delay(80).duration(400)} style={styles.card}>
              <View style={styles.estimateHead}>
                <View style={[styles.resultIcon, { backgroundColor: IconTones.caution.bg }]}>
                  <Feather name="edit-3" size={16} color={IconTones.caution.color} />
                </View>
                <View style={styles.resultText}>
                  <Text style={styles.estimateTitle}>
                    {lookupMissed ? 'Not in the database' : 'Or enter it yourself'}
                  </Text>
                  <Text style={Type.caption}>Saved as your estimate, shown with a ≈</Text>
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
            </Animated.View>
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>

        <View style={[styles.commit, { paddingBottom: Math.max(insets.bottom, 20) }]}>
          <PrimaryButton label="Add to today" onPress={save} loading={isSaving} />
          <Text style={styles.commitNote}>Queues and syncs later if you&apos;re offline</Text>
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
  card: { ...Surfaces.card, gap: 12 },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  resultIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.iconMedium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultText: { flex: 1, gap: 2 },
  resultValue: { alignItems: 'flex-end' },
  resultKcal: {
    fontFamily: Font.bold,
    fontSize: 15,
    color: AuraColors.content.default,
    fontVariant: ['tabular-nums'],
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
});
