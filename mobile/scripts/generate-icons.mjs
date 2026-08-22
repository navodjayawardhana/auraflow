#!/usr/bin/env node
/**
 * Renders the AuraFlow mark into every launcher and splash asset the app needs.
 *
 * The source artwork (`new-logo.svg` at the repo root) carries a Google Fonts @import,
 * CSS keyframe animations and an SVG filter — none of which a rasteriser handles, and
 * none of which belong in a static icon anyway. So the glyph is rebuilt here as plain
 * geometry: the same path, the same gradient stops, no text and no motion.
 *
 * Run after changing the brand: `node scripts/generate-icons.mjs`
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../assets/images');

/** The mark, traced from the brand artwork and cropped to the glyph's own bounds. */
const GLYPH =
  'M 90 230 C 130 230 155 210 185 100 C 198 50 215 50 228 100 C 242 165 195 195 160 185 C 220 185 245 185 265 240 C 285 280 305 240 330 200';

/**
 * @param {object} options
 * @param {string} options.background  CSS colour, or 'none' for transparency
 * @param {string} [options.stroke]    Flat colour; omit to use the brand gradient
 * @param {number} [options.padding]   Fraction of the canvas to leave clear
 */
function markSvg({ background, stroke, padding = 0.18 }) {
  // Measured bounds of the stroked path in the source coordinate space: the curve spans
  // x 90-330 and y 50-280, and the widest stroke (the glow copy at 26) adds half its
  // width all round. Centring on *these* rather than on the original 800x450 artboard is
  // what stops the mark sitting off to one side inside a square icon.
  const bounds = { minX: 77, maxX: 343, minY: 37, maxY: 293 };

  const centreX = (bounds.minX + bounds.maxX) / 2;
  const centreY = (bounds.minY + bounds.maxY) / 2;

  // Square, so the aspect never distorts, and inset so Android's adaptive mask has room
  // to crop without biting into the glyph.
  const content = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  const side = content * (1 + padding * 2);

  const viewBox = `${centreX - side / 2} ${centreY - side / 2} ${side} ${side}`;

  const paint = stroke ?? 'url(#markStroke)';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="1024" height="1024">
  <defs>
    <linearGradient id="markStroke" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0052FF"/>
      <stop offset="0.5" stop-color="#00D2FF"/>
      <stop offset="1" stop-color="#00F0FF"/>
    </linearGradient>
  </defs>
  ${background === 'none' ? '' : `<rect x="-1000" y="-1000" width="3000" height="3000" fill="${background}"/>`}
  <path d="${GLYPH}" fill="none" stroke="${stroke ?? '#00D2FF'}" stroke-opacity="0.18" stroke-width="26" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="${GLYPH}" fill="none" stroke="${stroke ?? '#0052FF'}" stroke-opacity="0.12" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="${GLYPH}" fill="none" stroke="${paint}" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="213" cy="72" r="7" fill="${stroke ?? '#00F0FF'}"/>
</svg>`;
}

const ASSETS = [
  // Launcher icon: opaque, because iOS composites no background of its own.
  { file: 'icon.png', size: 1024, svg: markSvg({ background: '#ffffff' }) },

  // Splash: drawn on the dark backgroundColor set in app.json, so the mark is inverted
  // to white and the canvas stays transparent.
  { file: 'splash-icon.png', size: 512, svg: markSvg({ background: 'none', stroke: '#ffffff', padding: 0.1 }) },

  // Android adaptive icon: the system masks this to whatever shape the launcher wants,
  // so it needs generous padding and a transparent canvas over the brand-blue background
  // declared in app.json.
  { file: 'android-icon-foreground.png', size: 1024, svg: markSvg({ background: 'none', stroke: '#ffffff', padding: 0.42 }) },
  { file: 'android-icon-background.png', size: 1024, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#0052FF"/></svg>` },
  { file: 'android-icon-monochrome.png', size: 1024, svg: markSvg({ background: 'none', stroke: '#ffffff', padding: 0.42 }) },

  { file: 'favicon.png', size: 96, svg: markSvg({ background: '#ffffff', padding: 0.12 }) },
];

await mkdir(outDir, { recursive: true });

for (const asset of ASSETS) {
  const path = resolve(outDir, asset.file);

  await sharp(Buffer.from(asset.svg))
    .resize(asset.size, asset.size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path);

  console.log(`wrote ${asset.file} (${asset.size}px)`);
}

// The mark as a standalone SVG, for the report and any slide that needs it.
await writeFile(resolve(outDir, 'logo-mark.svg'), markSvg({ background: 'none' }), 'utf8');
console.log('wrote logo-mark.svg');
