/** @type {import('tailwindcss').Config} */
//
// Colours are semantic, not literal: a caution that later needs to be orange changes
// here rather than in every screen that mentioned amber. Values mirror
// src/constants/theme.ts, which serves the same palette to SVG and icon props — the two
// files are edited together.
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#ffffff',
          sunken: '#f8fafc',
          raised: '#f1f5f9',
          selected: '#e2e8f0',
        },
        content: {
          DEFAULT: '#0f172a',
          // #475569 rather than the logo's #64748b: the lighter grey lands near 4.3:1 on
          // our raised surface, below the 4.5:1 AA threshold.
          muted: '#475569',
          inverse: '#ffffff',
        },
        brand: {
          DEFAULT: '#0052ff',
          pressed: '#0041cc',
          bright: '#00d2ff',
          glow: '#00f0ff',
        },
        accent: {
          DEFAULT: '#00b4db',
          deep: '#0083b0',
        },
        caution: '#b45309',
        danger: '#dc2626',
        success: '#0f9d58',
        // Kept well away from the cyan ramp so a provisional score never reads as a
        // confident one at a glance.
        provisional: '#8b5cf6',
      },
      fontFamily: {
        sans: ['PlusJakartaSans_400Regular'],
        medium: ['PlusJakartaSans_500Medium'],
        semibold: ['PlusJakartaSans_600SemiBold'],
        bold: ['PlusJakartaSans_800ExtraBold'],
      },
      spacing: {
        half: '2px',
        one: '4px',
        two: '8px',
        three: '16px',
        four: '24px',
        five: '32px',
        six: '64px',
      },
      minHeight: { touch: '44px' },
      minWidth: { touch: '44px' },
    },
  },
  plugins: [],
};
