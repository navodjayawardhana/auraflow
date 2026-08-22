/**
 * The single source of truth for colour.
 *
 * Tailwind classNames cover most of the app, but SVG stroke/fill, Feather icon colours,
 * the tab bar's tints and LinearGradient stops all take literal values. Those read from
 * here, so a hex hardcoded anywhere else in src/ is a bug -- the palette must be
 * changeable in one place.
 *
 * Values mirror tailwind.config.js exactly; the two are edited together.
 */
export const AuraColors = {
  surface: {
    default: '#ffffff',
    sunken: '#f8fafc',
    raised: '#f1f5f9',
    selected: '#e2e8f0',
  },
  content: {
    default: '#0f172a',
    muted: '#475569',
    inverse: '#ffffff',
  },
  brand: {
    default: '#0052ff',
    pressed: '#0041cc',
    bright: '#00d2ff',
    glow: '#00f0ff',
  },
  accent: {
    default: '#00b4db',
    deep: '#0083b0',
  },
  caution: '#b45309',
  danger: '#dc2626',
  success: '#0f9d58',
  provisional: '#8b5cf6',
} as const;

/** The logo's diagonal ramp, reused anywhere the brand gradient appears. */
export const BrandGradient = [
  AuraColors.brand.default,
  AuraColors.brand.bright,
  AuraColors.brand.glow,
] as const;

/** The wordmark's "Flow" ramp — flatter and deeper than the mark's. */
export const FlowGradient = [AuraColors.accent.default, AuraColors.accent.deep] as const;

/**
 * The auth screens' hero. Runs light-to-deep rather than the mark's light-to-bright, so
 * white type over it clears contrast at every point of the sweep.
 */
export const HeroGradient = [
  AuraColors.brand.bright,
  AuraColors.brand.default,
  '#0a2a80',
] as const;

/** A tint of the provisional violet, for the far end of that ring's ramp. */
export const ProvisionalTint = '#c4b5fd';

/** Shadows are neutral black at low opacity, never a tinted brand colour. */
export const ShadowColor = '#000000';

/**
 * Icon badge pairs. The tint carries meaning — heart-rate fields are the danger red
 * because that is the vital-sign colour throughout, sleep is brand blue — so the pairing
 * is defined once rather than re-picked per screen.
 */
export const IconTones = {
  brand: { color: AuraColors.brand.default, bg: '#0052ff14' },
  accent: { color: AuraColors.accent.deep, bg: '#0083b014' },
  vital: { color: AuraColors.danger, bg: '#dc262614' },
  stage: { color: AuraColors.provisional, bg: '#8b5cf614' },
  success: { color: AuraColors.success, bg: '#0f9d5814' },
  caution: { color: AuraColors.caution, bg: '#b4530914' },
  disabled: { color: AuraColors.content.muted, bg: AuraColors.surface.selected },
} as const;

/** Placeholder text: muted enough to read as a hint, dark enough to be legible. */
export const PlaceholderColor = '#94a3b8';

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

/** WCAG 2.2 minimum touch target. */
export const TouchTarget = 44;
