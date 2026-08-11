/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      /*
       * The design tokens live here, so `constants/theme.ts` and the utility classes
       * cannot drift apart. Anything used in a className should exist as a token rather
       * than an arbitrary value -- `bg-[#1f6feb]` scattered through screens is how a
       * design system stops being one.
       */
      colors: {
        surface: {
          DEFAULT: '#ffffff',
          raised: '#f0f0f3',
          selected: '#e0e1e6',
        },
        content: {
          DEFAULT: '#000000',
          muted: '#60646c',
        },
        brand: {
          DEFAULT: '#1f6feb',
          pressed: '#1a5fd0',
        },
        // Semantic, not literal. A "caution" that later needs to be orange changes here
        // rather than in every screen that mentioned amber.
        caution: '#8a5300',
        danger: '#b3261e',
      },
      spacing: {
        // Matches the scale in constants/theme.ts.
        half: '2px',
        one: '4px',
        two: '8px',
        three: '16px',
        four: '24px',
        five: '32px',
        six: '64px',
      },
      minHeight: {
        // WCAG 2.2 target size. Every interactive element should reach this.
        touch: '44px',
      },
    },
  },
  plugins: [],
};
