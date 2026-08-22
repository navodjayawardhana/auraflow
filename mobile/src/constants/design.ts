import { Platform, type TextStyle, type ViewStyle } from 'react-native';

import { AuraColors } from '@/constants/theme';

/**
 * The design system, as code.
 *
 * Every number here comes from `docs/design/ui-spec.md`, which was written against the
 * design canvas. Screens compose these rather than inventing their own values — that is
 * the whole reason the previous UI read as assembled rather than designed.
 */

// ---------------------------------------------------------------- layout

export const Layout = {
  /** One gutter, every screen, no exceptions. Fixed px, never a percentage. */
  gutter: 20,
  /** Deliberately outside the gutter, so the bar reads as floating over content. */
  navInset: 16,
  /** Nav (66) + bottom inset (22) + clearance (22). */
  scrollBottom: 110,
  gapCards: 14,
  gapTiles: 12,
  gapHeaderToCard: 18,
} as const;

export const Radius = {
  card: 22,
  tile: 18,
  sheet: 30,
  nav: 26,
  plus: 20,
  fab: 18,
  row: 20,
  iconLarge: 16,
  iconMedium: 13,
  iconSquare: 12,
  iconSmall: 10,
  navPill: 9,
  panel: 14,
  field: 14,
  pill: 999,
} as const;

// ---------------------------------------------------------------- shadows

/**
 * Android's `elevation` only draws downward and only over an opaque background, and it
 * doubles as z-order — so the raised ＋ needs a higher elevation than the bar it sits on
 * or it draws underneath. The two-stop canvas shadows collapse to their larger stop here;
 * the 1px contact shadow has no fallback worth the extra View.
 */
function shadow(
  offsetY: number,
  opacity: number,
  radius: number,
  elevation: number,
  color = '#0f172a',
): ViewStyle {
  return Platform.select<ViewStyle>({
    ios: {
      shadowColor: color,
      shadowOffset: { width: 0, height: offsetY },
      shadowOpacity: opacity,
      shadowRadius: radius,
    },
    default: { elevation, shadowColor: color },
  }) as ViewStyle;
}

export const Shadows = {
  card: shadow(10, 0.1, 13, 3),
  tile: shadow(8, 0.09, 10, 2),
  nav: shadow(10, 0.16, 17, 8),
  plus: shadow(12, 0.42, 13, 10, AuraColors.brand.default),
  fab: shadow(10, 0.2, 13, 6),
  cta: shadow(11, 0.32, 13, 8, AuraColors.brand.default),
  dark: shadow(10, 0.25, 14, 6),
  chip: shadow(1, 0.08, 2, 1),
} as const;

// ---------------------------------------------------------------- gradients

/** expo-linear-gradient takes unit vectors; these are the canvas angles converted. */
export const GradientAxis = {
  deg158: { start: { x: 0.298, y: 0 }, end: { x: 0.702, y: 1 } },
  deg150: { start: { x: 0.212, y: 0 }, end: { x: 0.788, y: 1 } },
  deg140: { start: { x: 0.081, y: 0 }, end: { x: 0.919, y: 1 } },
  deg135: { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } },
  deg120: { start: { x: 0, y: 0.212 }, end: { x: 1, y: 0.788 } },
  deg100: { start: { x: 0, y: 0.412 }, end: { x: 1, y: 0.588 } },
  deg90: { start: { x: 0, y: 0.5 }, end: { x: 1, y: 0.5 } },
} as const;

export const Gradients = {
  hero: ['#0b2f8f', AuraColors.brand.default, '#00a5db'] as const,
  brand: [AuraColors.brand.default, AuraColors.brand.bright] as const,
  dark: ['#0f172a', '#1e293b'] as const,
} as const;

// ---------------------------------------------------------------- type

/**
 * Named families, never numeric weights.
 *
 * Android does not reliably resolve `fontWeight: '800'` against a multi-file family — it
 * silently falls back to Regular, and the result looks like a spacing problem rather than
 * a font problem. Every text style below names its file explicitly.
 */
export const Font = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_800ExtraBold',
} as const;

/** Non-tabular numerals make a dashboard jitter on every tick. */
const tabular: TextStyle = { fontVariant: ['tabular-nums'] };

export const Type = {
  heroMetric: { fontFamily: Font.bold, fontSize: 60, lineHeight: 60, color: '#fff', ...tabular },
  deviceMetric: { fontFamily: Font.bold, fontSize: 46, lineHeight: 46, color: '#fff', ...tabular },
  headlineMetric: {
    fontFamily: Font.bold,
    fontSize: 34,
    lineHeight: 34,
    color: AuraColors.content.default,
    ...tabular,
  },
  screenTitle: {
    fontFamily: Font.bold,
    fontSize: 28,
    lineHeight: 28,
    letterSpacing: -0.6,
    color: AuraColors.content.default,
  },
  greeting: {
    fontFamily: Font.bold,
    fontSize: 26,
    lineHeight: 28.6,
    letterSpacing: -0.6,
    color: '#fff',
  },
  summaryMetric: {
    fontFamily: Font.bold,
    fontSize: 26,
    color: AuraColors.content.default,
    ...tabular,
  },
  sheetTitle: {
    fontFamily: Font.bold,
    fontSize: 20,
    letterSpacing: -0.4,
    color: AuraColors.content.default,
  },
  tileMetric: {
    fontFamily: Font.bold,
    fontSize: 24,
    lineHeight: 24,
    letterSpacing: -0.5,
    color: AuraColors.content.default,
    ...tabular,
  },
  button: { fontFamily: Font.semibold, fontSize: 16, color: '#fff' },
  cardTitle: { fontFamily: Font.bold, fontSize: 15, color: AuraColors.content.default },
  input: { fontFamily: Font.regular, fontSize: 15, color: AuraColors.content.default },
  body: {
    fontFamily: Font.regular,
    fontSize: 14,
    lineHeight: 21,
    color: AuraColors.content.default,
  },
  prose: { fontFamily: Font.regular, fontSize: 13, lineHeight: 20, color: '#334155' },
  rowTitle: {
    fontFamily: Font.semibold,
    fontSize: 13,
    lineHeight: 16.9,
    color: AuraColors.content.default,
  },
  chip: { fontFamily: Font.semibold, fontSize: 13 },
  fieldLabel: { fontFamily: Font.semibold, fontSize: 12, color: AuraColors.content.muted },
  meta: { fontFamily: Font.semibold, fontSize: 12, color: AuraColors.content.muted, ...tabular },
  eyebrow: {
    fontFamily: Font.semibold,
    fontSize: 11,
    letterSpacing: 2.4,
    textTransform: 'uppercase',
    color: '#94a3b8',
  },
  eyebrowOnHero: {
    fontFamily: Font.semibold,
    fontSize: 11,
    letterSpacing: 2.4,
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.6)',
  },
  tileLabel: { fontFamily: Font.regular, fontSize: 11, color: AuraColors.content.muted },
  caption: {
    fontFamily: Font.regular,
    fontSize: 10,
    lineHeight: 14,
    color: AuraColors.content.muted,
  },
  badge: { fontFamily: Font.semibold, fontSize: 10 },
  navActive: { fontFamily: Font.semibold, fontSize: 9.5, color: AuraColors.brand.default },
  navInactive: { fontFamily: Font.medium, fontSize: 9.5, color: '#94a3b8' },
} satisfies Record<string, TextStyle>;

/**
 * Units are always a separate Text baseline-aligned with the value, never appended to the
 * number string — a suffix inside the numeral breaks tabular alignment.
 */
export const Unit: TextStyle = {
  fontFamily: Font.regular,
  fontSize: 11,
  color: AuraColors.content.muted,
};

// ---------------------------------------------------------------- surfaces

export const Surfaces = {
  card: {
    backgroundColor: AuraColors.surface.default,
    borderRadius: Radius.card,
    padding: 16,
    ...Shadows.card,
  },
  tile: {
    backgroundColor: AuraColors.surface.default,
    borderRadius: Radius.tile,
    padding: 14,
    ...Shadows.tile,
  },
  /** An inset block inside a card — used for quotes, results, disclosures. */
  panel: {
    backgroundColor: AuraColors.surface.sunken,
    borderRadius: Radius.panel,
    padding: 12,
  },
} satisfies Record<string, ViewStyle>;

export const PlaceholderColor = '#94a3b8';
