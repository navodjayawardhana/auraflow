# AuraFlow mobile — UI build spec

Source of truth: the design canvas (10 artboards + component sheet).
Target: Expo SDK 54 / React Native 0.81.5, `react-native-svg` 15.12.1, `expo-linear-gradient` 15.0.8, `react-native-safe-area-context` 5.6.0.

All artboards are drawn at **390 × 844** (iPhone 14/15 logical size). Every number below is a
logical px at that width. Horizontal values are fixed, not proportional — see §1.2.

---

## 1. Layout system

### 1.1 Page

| Token | Value | Notes |
|---|---|---|
| Page background | `#f8fafc` | `AuraColors.surface.sunken`. **Every** screen except Sign in. |
| Sign in background | `#ffffff` | The only white page; its hero supplies the contrast instead. |
| Content colour | `#0f172a` | Set on the screen root so text inherits. |

The page moved to sunken specifically so white cards read as *lifted*. Do not put a white card
on a white page — that was the flaw in the previous UI and the whole card recipe depends on the
contrast.

### 1.2 Gutter and rhythm

| Rule | Value |
|---|---|
| Horizontal gutter | **20px**, every screen, every section, no exceptions |
| Nav bar inset | 16px (deliberately 4px outside the gutter, so the bar reads as floating over content) |
| Top padding, plain screens | 58px (`insets.top + 14`) |
| Top padding, hero screens | 60px (Today), 74px (Sign in) |
| Gap between sibling cards | **14px** |
| Gap between tiles inside a 2-col grid | **12px** |
| Gap between rows inside a card | 9–14px (see per-component) |
| Header block → first card | 18px (Nutrition, Log a meal, Device), 20px (Insights) |
| Scroll content bottom padding | **110px** (66 nav + 22 bottom + 22 clearance) |

Do not use percentage gutters. The 20px gutter is a constant on every device width; cards flex
to fill. On a 360px-wide device the cards simply get narrower.

### 1.3 Card recipe

Three surface classes only. Radius is what tells them apart.

```ts
// section card — the default container
card: {
  backgroundColor: '#ffffff',
  borderRadius: 22,
  // CSS: 0 1px 2px rgba(15,23,42,.04), 0 10px 26px rgba(15,23,42,.07)
}

// tile — the smaller unit inside a 2-column grid
tile: {
  backgroundColor: '#ffffff',
  borderRadius: 18,
  // CSS: 0 1px 2px rgba(15,23,42,.04), 0 8px 20px rgba(15,23,42,.06)
}

// control — anything tappable that isn't a card
control: { borderRadius: 999 }
```

### 1.4 Radii, per element class

| Element | Radius |
|---|---|
| Section card | 22 |
| Metric tile / summary tile | 18 |
| Bottom sheet (top corners only) | 30 |
| Floating nav bar | 26 |
| Raised ＋ button | 20 |
| Chat FAB | 18 |
| Action-sheet row / live-node strip / gradient CTA row | 20 |
| Icon tile 46px | 16 |
| Icon tile 38–40px | 13 |
| Icon tile 36px (square) | 12 |
| Icon tile 30px | 10 |
| Nav active pill | 9 |
| Inset panel inside a card (`#f8fafc` block) | 12–16 |
| Estimate input field (rectangular) | 14 |
| Bars, dots, pills, buttons, text fields | 999 |
| Chart bar (recovery) | `8 8 4 4` |
| Chat bubble, assistant | `4 18 18 18` |
| Chat bubble, user | `18 4 18 18` |

### 1.5 Shadows

RN 0.81 on the New Architecture supports the `boxShadow` string prop, which is the closest
match to the canvas. **Verify it renders on an Android device before committing** — if
`newArchEnabled` is false, fall back to the `shadow*`/`elevation` column.

| Name | CSS (canvas) | iOS fallback | Android `elevation` |
|---|---|---|---|
| `card` | `0 1px 2px rgba(15,23,42,.04), 0 10px 26px rgba(15,23,42,.07)` | color `#0f172a`, offset `{0,10}`, opacity `.10`, radius `13` | 3 |
| `tile` | `0 1px 2px rgba(15,23,42,.04), 0 8px 20px rgba(15,23,42,.06)` | offset `{0,8}`, opacity `.09`, radius `10` | 2 |
| `nav` | `0 10px 34px rgba(15,23,42,.15), 0 2px 8px rgba(15,23,42,.06)` | offset `{0,10}`, opacity `.16`, radius `17` | 8 |
| `plus` | `0 12px 26px rgba(0,82,255,.42)` | color `#0052ff`, offset `{0,12}`, opacity `.42`, radius `13` | 10 |
| `fab` | `0 10px 26px rgba(15,23,42,.18), 0 2px 6px rgba(15,23,42,.08)` | offset `{0,10}`, opacity `.20`, radius `13` | 6 |
| `cta` (gradient button/row) | `0 10–12px 24–28px rgba(0,82,255,.30–.34)` | color `#0052ff`, offset `{0,11}`, opacity `.32`, radius `13` | 8 |
| `sheetUp` (Today sheet) | `0 -14px 44px rgba(11,47,143,.20)` | color `#0b2f8f`, offset `{0,-14}`, opacity `.20`, radius `22` | — see below |
| `dark` (live-node / device hero) | `0 10px 28px rgba(15,23,42,.22–.28)` | offset `{0,10}`, opacity `.25`, radius `14` | 6 |
| `chip` | `0 1px 3–4px rgba(15,23,42,.06–.07)` | offset `{0,1}`, opacity `.08`, radius `2` | 1 |

**RN shadow conversion rule:** `shadowRadius ≈ cssBlur / 2`. Two-stop shadows cannot be
expressed in the fallback API — take the larger stop and drop the 1px contact shadow.

**Android caveats you will hit:**
- `elevation` only draws a *downward* shadow. `sheetUp` has no Android equivalent — substitute
  `borderTopWidth: 1, borderTopColor: 'rgba(15,23,42,0.06)'` on the sheet, or lay a 16px
  `LinearGradient` from `rgba(11,47,143,0.12)` to `transparent` directly above it.
- `elevation` needs an opaque `backgroundColor` on the same View or nothing renders.
- `elevation` also controls Android z-order. The raised ＋ must have a **higher** elevation
  than the nav bar or it draws underneath.

### 1.6 Touch targets

44px minimum, per the component sheet. Where a visual element is smaller (nav slots are 62×~46,
brightness buttons are 40 tall), wrap it in a `Pressable` with `hitSlop` to reach 44.

---

## 2. Type scale

Font: **Plus Jakarta Sans**, weights 400 / 500 / 600 / 800.

> **Load it as named families, not numeric weights.** Android does not reliably resolve
> `fontWeight: '800'` against a variable or multi-file family. Use
> `@expo-google-fonts/plus-jakarta-sans` and set `fontFamily: 'PlusJakartaSans_800ExtraBold'`
> etc. explicitly on every text style. Numeric `fontWeight` alone will silently render Regular
> on Android and the whole design collapses.

| Role | Size | Weight | Colour | Extra |
|---|---|---|---|---|
| Hero metric (score) | 60 | 800 | `#ffffff` | lineHeight 60, tabular |
| Device live metric | 46 | 800 | `#ffffff` | lineHeight 46, tabular |
| Nutrition headline metric | 34 | 800 | `#0f172a` | lineHeight 34, tabular |
| Sign-in headline | 30 | 800 | `#ffffff` | ls −0.7, lineHeight 34.5 |
| Screen title | 28 | 800 | `#0f172a` | ls −0.6 to −0.7, lineHeight 28 |
| Wordmark | 26–27 | 800 + 400 | `Aura` 800 / `Flow` 400 | ls −0.5 |
| Greeting (hero) | 26 | 800 | `#ffffff` | ls −0.6, lineHeight 28.6 |
| Live-node metric | 26 | 800 | `#ffffff` | tabular |
| Summary-tile metric | 26 | 800 | `#0f172a` | tabular |
| Sheet title (quick actions) | 20 | 800 | `#0f172a` | ls −0.4 |
| Metric value (tile) | 24 | 800 | `#0f172a` | lineHeight 24, tabular |
| Assistant header title | 17 | 800 | `#0f172a` | lineHeight 20.4 |
| Button label | 16 | 700 | `#ffffff` | |
| Card title | 15 | 800 | `#0f172a` | |
| Field value / input text | 15 | 400 | `#0f172a` | placeholder `#94a3b8` |
| Body | 14 | 400 | `#0f172a` | lineHeight 21 |
| Brief / chat body | 13 | 400 | `#334155` | lineHeight 20 |
| Row title (meal, result) | 13 | 700 | `#0f172a` | lineHeight 16.9 |
| Chip label | 13 | 600 | context | |
| Inline emphasis in body | 13 | 700 | `#0f172a` | e.g. `1h 27m` inside a legend |
| Field label | 12 | 600 | `#475569` | |
| Metadata / secondary value | 12 | 600–700 | `#475569` | tabular where numeric |
| Eyebrow (light bg) | 11–12 | 600 | `#94a3b8` or `#475569` | ls +2.4, uppercase |
| Eyebrow (on gradient) | 11 | 600 | `rgba(255,255,255,0.6)` | ls +2.4, uppercase |
| Small eyebrow (in-card) | 10 | 600 | `#94a3b8` | ls +1.6, uppercase |
| Tile label | 11 | 400 | `#475569` | |
| Caption | 10 | 400 | `#475569` | lineHeight 14–15 |
| Badge / status label | 10 | 600 | context | |
| Nav label, active | 9.5 | 700 | `#0052ff` | |
| Nav label, inactive | 9.5 | 500 | `#94a3b8` | |
| Cited-figure chip | 9.5 | 400 | `#475569` | |
| AR badge | 9 | 700 | `#ffffff` | ls +0.6 |
| Chart hour label | 8 | 400 | `#94a3b8` / transparent | |

**Numerals:** every metric, count, time and measurement uses `fontVariant: ['tabular-nums']`
plus `letterSpacing: -0.02em` equivalent (≈ `-0.5` at 24px). Non-tabular numerals make the
dashboard jitter on every tick.

**Unit suffixes** (`kcal`, `bpm`, `ml`, `g`) are always a separate `<Text>` at 10–12/400
`#475569`, baseline-aligned with the value — never part of the number string.

---

## 3. The Today hero

### 3.1 Gradient and decoration

```
height: 404
background: linear-gradient(158deg, #0b2f8f 0%, #0052ff 46%, #00a5db 100%)
overflow: hidden
```

`expo-linear-gradient` takes unit vectors, not degrees. Conversions used across the app:

| CSS angle | `start` | `end` | Where |
|---|---|---|---|
| 158° | `{x:0.298, y:0}` | `{x:0.702, y:1}` | Today + Sign-in hero |
| 150° | `{x:0.212, y:0}` | `{x:0.788, y:1}` | Today-scrolled header |
| 140° | `{x:0.081, y:0}` | `{x:0.919, y:1}` | Device live card |
| 135° | `{x:0, y:0}` | `{x:1, y:1}` | ＋ button, sparkle badges, send button |
| 120° | `{x:0, y:0.212}` | `{x:1, y:0.788}` | Live-node strip, user chat bubble, AR row |
| 100° | `{x:0, y:0.412}` | `{x:1, y:0.588}` | Primary buttons |
| 90° | `{x:0, y:0.5}` | `{x:1, y:0.5}` | Horizontal progress fills |

**Orbs** (two soft radial glows):
- top `-80`, right `-60`, 240×240, `radial-gradient(circle, rgba(0,240,255,0.32) 0%, transparent 70%)`
- bottom `-70`, left `-50`, 200×200, `radial-gradient(circle, rgba(255,255,255,0.15) 0%, transparent 70%)`

RN has no radial gradient. Substitute `react-native-svg`:
`<Svg><Defs><RadialGradient id="orb" cx="50%" cy="50%" r="50%"><Stop offset="0" stopColor="#00f0ff" stopOpacity="0.32"/><Stop offset="0.7" stopColor="#00f0ff" stopOpacity="0"/></RadialGradient></Defs><Circle cx="120" cy="120" r="120" fill="url(#orb)"/></Svg>`

**ECG trace:** absolute, `bottom: 46`, full width, height 120, `opacity 0.2`, stroke `#ffffff`
width 2, round caps/joins, `preserveAspectRatio="none"`, viewBox `0 0 390 120`:
`M0 78 H92 L106 46 L120 104 L134 62 L146 78 H390`

### 3.2 Hero content stack

1. `paddingTop: 60`, gutter 20 — row, `space-between`, gap 16
   - Left column, gap 5: eyebrow (date) → greeting
   - Right: 44×44, radius 15, `rgba(255,255,255,0.14)`, border 1 `rgba(255,255,255,0.22)`, logo mark 24
2. `marginTop: 16` — context chips row, gap 8
   - Chip: height 32, paddingH 12, radius 999, `rgba(255,255,255,0.15)`, gap 7, icon 14, value 13/700 white, label 13/400 `rgba(255,255,255,0.76)`
3. `marginTop: 16` — the ring stack, centred

### 3.3 The three concentric rings

Rendered 200×200 inside `viewBox="0 0 220 220"`. Centre `(110,110)`. Whole group
`transform="rotate(-90 110 110)"` so every ring starts at 12 o'clock and fills clockwise.

| Ring | Metric | `r` | strokeWidth | Circumference | Track | Fill |
|---|---|---|---|---|---|---|
| Outer | **Recovery** | 96 | 13 | 603.2 | `rgba(255,255,255,0.16)` | gradient (below) |
| Middle | **Steps** | 77 | 9 | 483.8 | `rgba(255,255,255,0.14)` | `#00f0ff` |
| Inner | **Water** | 60 | 9 | 377.0 | `rgba(255,255,255,0.14)` | `#7dd3fc` |

- Gap between ring edges: **8px** on both sides (96−6.5=89.5 vs 77+4.5=81.5; 77−4.5=72.5 vs 60+4.5=64.5).
- `strokeLinecap="round"` on fills only; tracks are butt-capped full circles.
- `strokeDashoffset = circumference × (1 − progress)`. Canvas values: recovery 75% → 150.8,
  steps 7,314/10,000 → 130.2, water 1,250/2,000 → 141.4.
- Outer fill gradient, **established**: `#7ef9ff → #ffffff`, `x1=0 y1=0 x2=1 y2=1`.
- Outer fill gradient, **provisional**: `#c4b5fd → #ede9fe`, same vector.
- Middle and inner rings never change hue with state.

Centre stack (absolutely centred over the SVG, gap 2):
- score 60/800 white, lineHeight 60
- `RECOVERY` 10/600, ls +2.2, uppercase, `rgba(255,255,255,0.68)`
- provisional pill only when provisional: marginTop 7, height 22, paddingH 10, radius 999,
  `rgba(196,181,253,0.24)`, label 10/600 `#ede9fe`

Animate `strokeDashoffset` from `circumference` to target over ~900ms ease-out on mount.
Use `react-native-reanimated` with `createAnimatedComponent(Circle)`.

### 3.4 The sheet over the gradient

```
position: absolute
top: 378          // overlaps the 404px hero by 26px — this overlap is the whole effect
left: 0; right: 0; bottom: 0
background: #f8fafc
borderTopLeftRadius / borderTopRightRadius: 30
shadow: sheetUp
padding: 10 20 0
```

Grab handle: 38 × 4, radius 999, `#cbd5e1`, centred, `marginBottom: 16`.

The sheet is a static overlay on Today, not a gesture sheet. Its content scrolls inside it.

---

## 4. Components

### 4.1 Metric tile — three states

Container: `tile`, padding 14, column, gap 9.

Row 1 (`space-between`, centred): icon tile 30×30 radius 10 + label 11/400 `#475569`.

Icon tile backgrounds (`IconTones`, 10% alpha = `14` hex suffix):

| Tone | Icon | Background |
|---|---|---|
| brand | `#0052ff` | `#0052ff14` |
| accent | `#0083b0` | `#0083b014` |
| vital | `#dc2626` | `#dc262614` |
| stage | `#8b5cf6` | `#8b5cf614` |
| success | `#0f9d58` | `#0f9d5814` |
| caution | `#b45309` | `#b4530914` |
| disabled | `#475569` | `#e2e8f0` |

Icons are 15px, `strokeWidth 2`, round cap/join.

| State | Value row | Third row | Caption |
|---|---|---|---|
| `measured` | `24/800` value + optional unit | 4px progress bar, track `#e2e8f0`, fill `#0052ff`, radius 999 | provenance, e.g. "counted while AuraFlow is open" |
| `estimated` | **`≈` at 18/600 `#475569`**, gap 4, then `24/800` value + unit | empty 4px spacer (keeps tiles the same height) | must name the estimate, e.g. "estimated from steps, not measured" |
| `unavailable` | **em dash `—` at 20/400 `#475569`** — never `0` | empty 4px spacer | why, e.g. "no step sensor on this phone" |

`unavailable` also swaps the icon tile to `#e2e8f0` / `#475569`.

The `≈` and the caption are not decoration — they are the app's honesty contract. Do not let a
"cleaner" variant drop them.

Variants seen on Today: sparkline (12px tall `Polyline`, stroke `#dc2626` width 2, opacity 0.7)
replaces the progress bar; the water tile replaces it with 8 glass segments, `flex: 1` each,
height 14, radius 4, gap 3, filled `#0083b0` / empty `#e2e8f0`.

### 4.2 Chips

| Chip | Height | Padding | Background | Border | Text |
|---|---|---|---|---|---|
| Selected (mode) | min 44 | 0 14 | `#0052ff` | none | 13/600 `#ffffff`, dot `#00f0ff` |
| Unselected (mode) | min 44 | 0 14 | `#ffffff` | 1 `#e2e8f0` | 13/600 `#475569`, dot `#cbd5e1` |
| Neutral value | min 44 | 0 16 | `#f1f5f9` | none | 13/600 `#475569` |
| Suggestion (assistant) | 32 | 0 13 | `#ffffff` + `chip` shadow | none | 12/600 `#0052ff` |
| Cited figure | 22 | 0 8 | `#ffffff` + `chip` shadow | none | 9.5/400 `#475569` |
| On-gradient context | 32 | 0 12 | `rgba(255,255,255,0.15)` | none | 13 white / 76% white |

Mode chips carry a 7px dot at gap 6. All chips are radius 999.

### 4.3 Badges

| Badge | Background | Dot / icon | Text |
|---|---|---|---|
| Live (light) | `#dcfce7` | 6px `#0f9d58` | 11/600 `#166534` |
| Live (on dark) | `rgba(74,222,128,0.2)` | 6px `#4ade80` | 10/600 `#bbf7d0` |
| Provisional | `#ede9fe` | — | 11/600 `#6d28d9` |
| Offline | `#f1f5f9` | wifi-off icon 12 `#475569` | 11/400 `#475569` |
| Caution | `#fef3c7` | triangle icon 12 `#b45309` | 11/600 `#92400e` |
| Status (in-card) | `#f1f5f9` | — | 10/600 `#475569`, height 22, paddingH 9 |
| AR | `rgba(255,255,255,0.24)` | — | 9/700 `#ffffff`, ls +0.6, height 18, paddingH 7 |

Light badges: padding `6 12`, radius 999, gap 6.

### 4.4 Buttons

| Variant | Height | Radius | Background | Label | Shadow |
|---|---|---|---|---|---|
| Primary | min 56 | 999 | `linear-gradient(100deg, #0052ff, #00b4db)` | 16/700 `#ffffff` | `cta` |
| Destructive | min 56 | 999 | `#dc2626` | 16/700 `#ffffff` | `0 8px 20px rgba(220,38,38,.26)` |
| Disabled | min 56 | 999 | primary gradient at `opacity: 0.45` | 16/700 `#ffffff` | none |
| Inline secondary | 36 | 999 | `#f8fafc`, border 1 `#e2e8f0` | 12/700 `#0052ff` | none |
| Header pill (`＋ Log`) | 34 | 999 | `#ffffff` | 12/700 `#0052ff`, icon 13 | `0 2px 8px rgba(15,23,42,.07)` |
| Icon button (close/back) | 36×36 | 12 | `#ffffff` or `#f1f5f9` | icon 18 `#475569` | `0 2px 8px rgba(15,23,42,.07)` |

Pressed state (not on the canvas, define it now): scale `0.97`, and for gradient buttons drop
shadow opacity to `0.18`. Use `Pressable` + Reanimated, `android_ripple` disabled — the ripple
fights the rounded gradient.

### 4.5 Text fields

Base: min height **54**, radius 999, background `#ffffff`, padding `0 18 0 8`, row, gap 11.
The left icon tile is 36×36 radius 999 with a tone background, icon 16.

| State | Border | Extra |
|---|---|---|
| Rest | 1px `#e2e8f0` | placeholder 15/400 `#94a3b8` |
| Focused | **1.5px `#0052ff`** | focus ring `0 0 0 4px rgba(0,82,255,0.08)` |
| Error | 1.5px `#dc2626` | icon tone → vital; message below at 12/400 `#dc2626`, paddingLeft 18, gap 5 |
| Filled | as rest/focused | value 15/400 `#0f172a` |

Password field: value 17/400, `letterSpacing: 3`, eye toggle 18px `#94a3b8` on the right.

**RN has no `box-shadow` spread**, so the focus ring cannot be a shadow. Wrap the field in an
outer `View` with `padding: 4`, `borderRadius: 999`,
`backgroundColor: 'rgba(0,82,255,0.08)'`, toggled with focus. Animate its opacity, not its
layout, or the field will jump 4px on focus.

Search field variant (Log a meal): height 52, radius 999, no border, `0 2px 10px rgba(15,23,42,.06)`,
left icon tile 36 `#0052ff14`, trailing clear ✕ 16 `#94a3b8`.

Estimate field variant (rectangular): height 48, radius 14, `#f8fafc`, border 1 `#e2e8f0`,
paddingH 14, text 14. Two side by side: name `flex: 1`, kcal fixed **92** wide, gap 10.

### 4.6 Score ring, standalone (component sheet)

120×120 in `viewBox="0 0 140 140"`, centre 70,70, `rotate(-90 70 70)`, `r=60`, strokeWidth 11,
circumference 377, track `#f1f5f9`. Established stroke `#0052ff`; provisional stroke `#8b5cf6`.
Score label 30/800 centred.

Provisional is **violet, never a muted blue and never a severity colour** — it means *less
certain*, not *worse*. This distinction is load-bearing for the assignment's honesty argument.

---

## 5. Navigation

### 5.1 The floating bar

```
position: absolute
left: 16; right: 16
bottom: 22            // use max(insets.bottom + 4, 22)
height: 66
background: #ffffff
borderRadius: 26
shadow: nav
flexDirection: row; alignItems: center; justifyContent: space-between
paddingHorizontal: 8
```

Five slots, each **62px** wide, laid out `Today · Insights · [＋] · Device · Profile`.

| Slot part | Active | Inactive |
|---|---|---|
| Icon frame | 38 × 26, radius 9, background `#0052ff14` | 38 × 26, transparent |
| Icon | 19px, stroke `#0052ff`, width 2.2 | 19px, stroke `#94a3b8`, width 2.2 |
| Label | 9.5/700 `#0052ff` | 9.5/500 `#94a3b8` |
| Column gap | 3 | 3 |

Only the pill background and the two colours change between states. Do not scale the icon or
swap to a filled variant — the pill is the signal.

### 5.2 The raised ＋

```
width: 56; height: 56
marginTop: -30        // protrudes 30px above the bar's top edge
borderRadius: 20
background: linear-gradient(135deg, #0052ff, #00b4db)
shadow: plus
icon: 24px plus, stroke #ffffff, strokeWidth 2.6, round cap
```

**This is the piece most likely to break on Android.** A child with a negative margin is clipped
by the parent on Android regardless of `overflow: 'visible'`, and `elevation` shadows never
render outside parent bounds. Build it as a **sibling** of the bar, absolutely positioned in the
screen container:

```
plus: { position:'absolute', bottom: 22 + 66 - 26, alignSelf:'center', width:56, height:56, elevation:10 }
```

…and give the middle nav slot an empty 62px spacer so the `space-between` layout still holds.

Rotation to close: animate `rotate` 0° → 45° over 200ms and cross-fade the background from the
gradient to `#0f172a`. The canvas draws the open state as a 56×56 radius-20 `#0f172a` square
with an ✕ at strokeWidth 2.6 and shadow `0 10px 24px rgba(15,23,42,.3)`.

### 5.3 Chat FAB

Only on Today. `right: 20`, `bottom: 108` (clears the nav by 20), 52×52, radius 18, `#ffffff`,
shadow `fab`. Icon 22px message outline stroked with a `#0052ff → #00d2ff` SVG gradient (use
`react-native-svg` `Defs`/`LinearGradient` + `stroke="url(#id)"` — this works on both platforms).
Unread dot: 7px `#00d2ff`, top 8, right 8.

### 5.4 Quick-actions sheet

Presented over a dimmed Today.

- Backdrop: `rgba(8,22,54,0.55)`, full screen, fades in 180ms. **No blur** — `expo-blur` on
  Android is expensive and inconsistent; the solid scrim is the design.
- Sheet: anchored bottom, full width, background `#ffffff`, top radius 30, padding `12 20 30`,
  shadow `0 -18px 50px rgba(8,22,54,0.35)` (Android: top hairline substitute as in §1.5).
- Sheet content, column gap 16: grab handle (38×4 `#cbd5e1`, marginBottom 2) → title block
  (gap 3: 20/800 title, 12/400 `#475569` subtitle) → rows (column, gap 10) → centred close button.
- Height is intrinsic (~460px with four rows). Do not fix it.

**Row anatomy** — padding 16, radius 20, row, gap 14, `alignItems: center`:
- icon tile 46×46 radius 16, icon 21–22
- text column `flex: 1`, gap 3: title 15/800, subtitle 11/400 lineHeight 16
- chevron 18px, strokeWidth 2.5

| Row | Background | Icon tile | Title colour | Subtitle colour | Chevron |
|---|---|---|---|---|---|
| **Movement session (AR)** | `linear-gradient(120deg,#0052ff,#00b4db)` + `cta` shadow | `rgba(255,255,255,0.2)` | `#ffffff` | `rgba(255,255,255,0.84)` | `#ffffff` |
| Log a meal | `#f8fafc` | `#0f9d5814` / `#0f9d58` | `#0f172a` | `#475569` | `#94a3b8` |
| Log last night | `#f8fafc` | `#8b5cf614` / `#8b5cf6` | `#0f172a` | `#475569` | `#94a3b8` |
| Add water | `#f8fafc` | `#0083b014` / `#0083b0` | `#0f172a` | `#475569` | `#94a3b8` |

The AR row carries the `AR` badge inline after its title (gap 7) and a recovery-aware subtitle
("Camera counts your reps · recovery 75, you're clear for a full set"). This row **is** AR's
home in the IA — there is no AR tab.

---

## 6. Screen composition

### 6.1 Today (`Main`)

Vertical order:
1. **Hero**, 404 tall — see §3. Header row (pt 60) → chips (+16) → rings (+16).
2. **Sheet**, absolute from y=378 — grab handle (mb 16) → ring legend (mb 14) → metric grid → live-node strip (mt 12).
3. **Chat FAB**, absolute.
4. **Nav**, absolute.

**Ring legend** — 2 columns, gap 12. Each: 8px dot + column (gap 1) of value 14/800 lineHeight
15.4 and `of 10,000 steps` at 10/400 `#475569`. It exists so the middle and inner rings are
readable without a tap; drop it and the rings are decoration.

**Metric grid** — 2 columns, gap 12: Steps (measured), Active energy (estimated, `≈292`),
Resting HR (measured + sparkline), Water (measured + 8 glasses).

**Live-node strip** (only when the ESP32 is connected) — padding `14 16`, radius 20,
`linear-gradient(120deg,#0f172a,#14306b)`, shadow `dark`:
icon tile 38 radius 13 `rgba(220,38,38,0.2)` with a **filled** `#fda4af` heart 19 → `flex: 1`
baseline row gap 14 (`113` 26/800 white + `bpm` 11 at 58% white; `99%` 18/700 + `SpO₂`) →
Live badge (dark variant).

### 6.2 Today, scrolled (`TodayScrolled`)

1. **Condensed header**, absolute top, height **100**, `linear-gradient(150deg,#0b2f8f,#0052ff)`,
   padding `58 20 0`, `zIndex: 2`: logo 20 + `Today` 15/800 white on the left; `75` 18/800 +
   `RECOVERY` 10 ls+1.4 uppercase 62% white on the right. This is the collapsed state of the
   hero — drive it off scroll offset, cross-fading at ~180px.
2. **Scroll body**, top 100 → bottom 100, padding `16 20 0`, column **gap 14**:
   daily brief → sleep → focus forecast.

**Daily brief card** — `card`, padding 16, gap 12:
- header row gap 10: 30×30 radius 10 gradient(135°) sparkle badge → column (gap 1) `Your brief`
  15/800 + `written 06:12 · Gemini` 10/400 `#475569` → status pill (height 22, paddingH 9,
  `#f1f5f9`, 10/600 `#475569`)
- two paragraphs, 13/400 lineHeight 20 `#334155`
- footer row gap 6, paddingTop 2: info icon 12 + `Written from your own figures. Not medical
  advice.` 10/400 lineHeight 15

**Sleep card** — `card`, padding 16, gap 12:
- title row: stage-tone icon tile + `Last night` 15/800; right `9h 20m` 15/800 tabular
- stage bar: height 14, radius 999, `overflow: hidden`, row gap 2, children by `flex` =
  minutes — deep `flex: 87` `#0052ff`, REM `flex: 112` `#8b5cf6`, light `flex: 361` `#e2e8f0`
- legend row gap 16: 8px dot + `Deep ` 11/400 `#475569` with the duration inline at 700 `#0f172a`

**Focus forecast card** — `card`, padding 16, gap 12:
- title row: brand icon tile + column `Focus forecast` 15/800 / `experimental · runs on this
  device` 10/400
- chart, height 86: a best-window band absolutely positioned behind the bars
  (`top 0, bottom 16, left 10.6%, width 17.6%`, radius 10, `rgba(0,82,255,0.07)`,
  **1px dashed** `rgba(0,82,255,0.32)`), then 17 hourly bars, `flex: 1`, gap 3, radius 999,
  bottom-aligned, with an 8px label every 4th hour (others `transparent` to hold the height)
- best-window row: padding `12 14`, radius 16, `#f8fafc`, 30px solid `#0052ff` icon tile,
  `Best deep-work window · 09:00–11:00` 13/700 + `Likely a good window` 11/400
- disclosure row: info icon 12 + `17 of 25 inputs are your data` 10/400 + chevron pushed right

> **Bar ranking (do not "fix" this).** The model's hourly output sits in a narrow band, so bar
> height and colour are ranked against **the day's own min/max**, not an absolute 0–1 scale:
> `rank = (v − min) / (max − min)`, `height = 12 + rank × 52`, and fill by rank —
> `≥0.75 → #00d2ff`, `≥0.5 → #0052ff`, `≥0.25 → #00b4db`, else `#e2e8f0`.
> On an absolute scale every hour paints the same and the chart says nothing.
>
> **RN dashed borders:** Android renders `borderStyle: 'dashed'` inconsistently with a
> `borderRadius`. If it looks wrong, draw the band with `react-native-svg` `Rect`
> (`strokeDasharray="4 4"`, `rx="10"`).

### 6.3 Nutrition (`Meals`)

1. Header, padding `58 20 0`, row `alignItems: flex-end`, gap 12: column (gap 4) eyebrow date
   11/600 `#94a3b8` ls+2.4 uppercase + `Nutrition` 28/800; right the `＋ Log` header pill.
2. Body, padding `18 20 0`, column **gap 14**:

**In-vs-out card** — `card`, padding `18 16 16`, gap 14:
- row `space-between`, gap 16 — left column (gap 3): `EATEN` 10/600 ls+1.6 `#94a3b8`, then
  baseline row `1,420` 34/800 + `kcal` 12/400; right column mirrored, right-aligned, with
  `≈` 20/600 `#475569` before `292`
- proportional bar, row gap 4: eaten `flex: 1420`, height 10, radius 999,
  `linear-gradient(90deg,#0f9d58,#34d399)`; active `flex: 292`, height 10, `#0083b0`
- note block: padding `11 12`, radius 14, `#f8fafc`, info icon 13 + 10/400 lineHeight 15:
  *"No net figure — AuraFlow doesn't know your basal metabolic rate, and a balance computed
  without it would be wrong by roughly 1,500 kcal."*

> **There is deliberately no net-calories number.** Do not add one, and do not let the card
> imply a deficit. The absence plus its explanation is the point.

**Macros card** — `card`, padding 16, gap 12: title row `Macros` 15/800 + `from 3 of 4 items`
10/400 → stacked bar height 12 radius 999 gap 2 (protein `flex:72` `#0052ff`, carbs `flex:168`
`#00b4db`, fat `flex:48` `#b45309`) → 3-column grid gap 10, each: dot 8 + label 11/400, then
`72` 16/800 with an inline ` g` at 11/500 `#475569` → caption *"One item was logged as an
estimate and carries no macro breakdown."*

**Today's meals card** — `card`, padding 16, gap 13: title 15/800, then meal rows (§4 / §7.4).

3. Nav.

### 6.4 Log a meal (`LogMeal`)

Presented as a full screen (modal push).

1. Header, padding `58 20 0`, row `alignItems: flex-start`: column (gap 4) `Log a meal` 28/800 +
   `Lunch · Thursday 21 August` 12/400 `#475569`; right 36×36 radius 12 close button.
2. Body, padding `18 20 0`, column gap 14:
   - **Scan a barcode** — the same gradient row as the AR row (§5.4), barcode icon 22
   - divider row gap 12: two `flex: 1` 1px `#e2e8f0` rules around `or search by name` 11/400 `#94a3b8`
   - search field (§4.5 variant)
   - **results card** — `card`, padding `6 16`; each row padding `13 0`, `borderBottomWidth: 1`
     `#f1f5f9`, gap 12: 40×40 radius 13 `#0f9d5814` barcode icon 17 → column name 13/700 +
     `Open Food Facts · per 100 g` 10/400 → `588` 15/800 + `kcal` 10/400.
     Last row keeps its divider because the provenance note sits under it: info icon 12 +
     *"Figures come from Open Food Facts, an open database edited by its users."*
   - **estimate escape hatch** — `card`, padding 16, gap 12: caution icon tile 30 + column
     `Not in the database?` 14/800 / `Saved as your estimate, shown with a ≈` 10/400, then the
     two rectangular fields (§4.5).
3. Commit block, absolute `left/right 20, bottom 34`, column gap 10: primary button
   `Add to lunch` + centred `Queues and syncs later if you're offline` 10/400 `#475569`.

No nav bar on this screen.

### 6.5 Assistant

1. **Header**, absolute top, padding `56 20 14`, background `#ffffff`,
   shadow `0 2px 14px rgba(15,23,42,.06)`, `zIndex: 2`, row gap 12:
   36×36 radius 12 `#f1f5f9` back button → column `Assistant` 17/800 + status row
   (6px dot + 10/400 `#475569`) → 36×36 radius 12 gradient(135°) sparkle badge.
2. **Conversation**, top 106 → bottom 96, padding `16 20 0`, column gap 12:
   - grounding note (once, at the top): padding `12 14`, radius 16, `#eef4ff`, shield icon 14
     `#0052ff`, text 10/400 lineHeight 15 `#1e3a8a`
   - offline banner when applicable (§7.5)
   - assistant turn: row gap 9, 28×28 radius 10 gradient avatar (marginTop 2) + bubble
     `maxWidth: 268`, padding `12 14`, radius `4 18 18 18`, `#ffffff`,
     shadow `0 1px 2px .04 / 0 6px 18px .06`, text 13/400 lineHeight 20 `#334155`
   - user turn: right-aligned bubble `maxWidth: 258`, padding `12 14`, radius `18 4 18 18`,
     `linear-gradient(120deg,#0052ff,#00a5db)`, shadow `0 6px 18px rgba(0,82,255,.22)`,
     text 13/400 lineHeight 20 `#ffffff`
   - cited-figure chips under the bubble they belong to, gap 5, wrap (§4.2)
   - suggestion chips, gap 7, wrap, paddingTop 2
3. **Composer**, absolute bottom, padding `12 20 30`, `#ffffff`,
   shadow `0 -4px 20px rgba(15,23,42,.07)`, row gap 10: input `flex: 1` height 48 radius 999
   `#f8fafc` border 1 `#e2e8f0` paddingH 18 → send 48×48 radius 999.

The list is inverted in practice — use `FlatList inverted` and keep the grounding note as a
footer so it lands at the visual top.

### 6.6 Insights

1. Header, padding `58 20 0`, column gap 4: `LAST 7 DAYS` 12/600 ls+2.4 uppercase `#475569`,
   `Insights` 28/800.
2. Body, padding `20 20 0`, column gap 14:
   - **Recovery trend** — `card`, padding `18 16 14`, gap 14. Title row `Recovery` 15/800 +
     trend `↗ +6 this week` 12/700 `#0f9d58` with a 14px icon. Chart height 176: four
     gridlines absolutely positioned `inset: 0 0 22px 0`, `space-between` (top three
     `#f1f5f9`, baseline `#e2e8f0`), then 7 bars `flex: 1` gap 9, bottom-aligned, each a
     column of value 11/700 → bar (radius `8 8 4 4`, `height = score/100 × 130`) → day label
     10/400 height 12. Today's bar `#0052ff` with `#0f172a` labels; other days `#93c5fd` with
     `#475569`; **provisional days `#8b5cf6`**. Legend row gap 16, `borderTopWidth: 1`
     `#f1f5f9`, paddingTop 10: 10×4 radius-999 swatch + 11/400 label.
   - **Summary tiles** — 2 columns gap 12, `tile` padding 14 gap 6: 30px round icon tile
     (radius 999 here, not 10) + label 11/400, value 26/800, caption 10/400. The `7/7` tile
     renders the denominator inline at 16/400 `#475569`.
   - **Sleep this week** — `card`, padding 16, gap 12. Title + `7h 48m avg` 13/700 `#475569`.
     Chart height 62, 7 stacked columns `flex: 1` gap 9, each bottom-aligned with gap 2:
     deep `#0052ff` (radius `4 4 0 0`), REM `#8b5cf6`, light `#e2e8f0` (radius `0 0 4 4`);
     heights scaled by `62 / max(total)`. Footer note: padding `10 12`, radius 12, `#f8fafc`,
     caution icon 14 + 11/400 lineHeight 16 with the figure inline at 600 `#0f172a`.
3. Nav (Insights active).

### 6.7 Device

1. Header, padding `58 20 0`, row `flex-start`: column `Device` 28/800 + `auraflow-node-01`
   12/400 tabular `#475569`; right a connection pill (padding `7 12`, radius 999, `#f1f5f9`,
   7px `#0f9d58` dot, 11/600, bluetooth icon 12).
2. Body, padding `18 20 0`, column gap 14:
   - **Live biometrics** — radius 22, padding 20, `linear-gradient(140deg,#0f172a,#12306e 58%,#0052ff)`,
     shadow `dark`, column gap 16: header row (`LIVE BIOMETRICS` 13/600 ls+1.6 uppercase 60%
     white + Streaming badge) → metrics row gap 28 (filled heart 22 `#fda4af` + `113` 46/800,
     with `BPM` 11 ls+1.4 uppercase 55% white indented `paddingLeft: 31`; `99%` 28/800 +
     `SpO₂`) → live PPG trace (`viewBox="0 0 330 40"`, `preserveAspectRatio="none"`, height 40,
     stroke `#00f0ff` width 2, opacity 0.85) → footer with a 1px `rgba(255,255,255,0.12)` top
     rule, clock icon 13 + `Finger on sensor · updated 1s ago` 11/400 60% white.
   - **Lamp** — `card`, padding 16, gap 14: title `Lamp` 15/800 + `Focus · 90%` 11/400; mode
     chips wrap gap 8 (§4.2); brightness block gap 8 with label 11/400 and four `flex: 1`
     buttons, min height 40, radius 12, inactive `#f1f5f9` 13/600 `#475569`, active `#0052ff`
     13/700 `#ffffff`.
   - **Diagnostics** — `card`, padding 16, gap 11: icon 15 + `Diagnostics` 13/700, then
     label/value rows `space-between`, label 12/400 `#475569`, value 12/600 `#0f172a` tabular.
3. Nav (Device active).

### 6.8 Sign in

Page background `#ffffff`.

1. **Hero**, height 372, `linear-gradient(158deg,#0b2f8f,#0052ff 46%,#00a5db)`, same orbs
   (bottom orb at `bottom: 20`) and ECG trace (`bottom: 56`).
   Content padding `74 20 0`, column gap 26:
   - brand lockup, row gap 12: mark 46px drawn **twice** — a `rgba(255,255,255,0.22)`
     strokeWidth-26 halo under a `#ffffff` strokeWidth-18 path, plus a 7px `#00f0ff` dot —
     then column gap 3: `Aura`(800 white)`Flow`(400 `#7ef9ff`) at 27 ls−0.5, and
     `WORK WITH YOUR BODY` 10/600 ls+3 at 60% white
   - column gap 8: `Welcome back` 30/800 ls−0.7 lineHeight 34.5, and a 14/400 lineHeight 21
     subtitle at 76% white, `maxWidth: 268`
2. **The curve**: the hero does not end in a straight edge. An SVG at `bottom: -1`, full width,
   height 44, `preserveAspectRatio="none"`, `viewBox="0 0 390 44"`, filled `#ffffff`:
   `M0,18 C104,50 292,-6 390,18 L390,44 L0,44 Z`
3. **Form**, padding `22 20 0`, column gap 16: Email field (label + field, gap 7) → Password
   field (drawn focused) → primary `Sign in` (marginTop 4) → privacy row (shield 13 +
   `Your health data is encrypted and private` 11/400, centred, marginTop 4) → `Don't have an
   account? **Sign up**` 14/400 centred, marginTop 2.

No nav bar.

---

## 7. States

### 7.1 Daily brief — pending / ready / failed

| | Badge icon tile | Status pill | Body | Action |
|---|---|---|---|---|
| **pending** | 28×28 radius 9 `#f1f5f9`, sparkle `#94a3b8` | `Writing…` | three skeleton bars, height 9, radius 999, `#f1f5f9`, widths **100% / 86% / 62%**, gap 10 | none |
| **ready** | 28×28 radius 9 gradient(135°), sparkle `#ffffff` | `Ready` | paragraphs 13/400 lineHeight 20 `#334155` + provenance footer | none |
| **failed** | 28×28 radius 9 `#b4530914`, triangle `#b45309` | *(no pill)* | *"Couldn't be written this morning. Your figures below are unaffected."* | `Try again` — height 36, radius 999, `#f8fafc`, border 1 `#e2e8f0`, 12/700 `#0052ff` |

Pending is a state real users will see every morning — animate the skeletons with a subtle
opacity pulse (0.6 → 1.0, 1200ms), not a shimmer sweep. Failed must say what still works; never
blank the screen or show a red error.

### 7.2 Provisional vs established

Applies to the recovery score wherever it appears.

| | Ring stroke | Pill | Insights bar |
|---|---|---|---|
| established | gradient `#7ef9ff → #ffffff` (hero) / `#0052ff` (standalone) | none | `#0052ff` (today) or `#93c5fd` |
| provisional | gradient `#c4b5fd → #ede9fe` (hero) / `#8b5cf6` (standalone) | `Provisional`, `rgba(196,181,253,0.24)` bg, `#ede9fe` text, height 22 | `#8b5cf6` |

Violet only. Never amber, never red, never a greyed-out blue.

### 7.3 Node connected vs not

Connected → the dark live-node strip renders at the bottom of the Today sheet (§6.1) with the
`Live` badge. Not connected → **the strip is removed entirely**, not shown empty or greyed. The
Device screen's connection pill and `Streaming` badge follow the same rule; when disconnected,
swap to the neutral `Offline · updated 2h ago` badge (`#f1f5f9`, wifi-off icon).

### 7.4 Open Food Facts value vs user estimate

The two are different kinds of number and the row must say which without a tap.

| | Time badge | Provenance line | Value |
|---|---|---|---|
| **looked up** | 38×38 radius 13, `#0f9d5814`, time 10/700 `#0f9d58` | 10px barcode glyph (5 vertical strokes, `#0f9d58`, strokeWidth 2.4) + `Open Food Facts` 10/400 `#0f9d58` | `640` 15/800, no prefix |
| **user estimate** | 38×38 radius 13, `#b4530914`, time 10/700 `#b45309` | `your estimate` 10/400 `#b45309` | **`≈` 13/600 `#475569`** then `120` 15/800 |

Portion follows the provenance after a `·` separator at 10/400 `#cbd5e1`.
Macros aggregate only over items that carry them, and the count is stated (`from 3 of 4 items`).

### 7.5 Assistant online vs offline

| | Status dot | Status text | Banner | Composer placeholder | Send button |
|---|---|---|---|---|---|
| online | `#0f9d58` | `Grounded on your data` | none | `Ask about your figures…` | gradient(135°) + `0 8px 20px rgba(0,82,255,.32)` |
| offline | `#94a3b8` | `Unavailable offline` | amber `#fef3c7`, padding `12 14`, radius 16, wifi-off 14 `#b45309`, text 11/400 lineHeight 16 `#92400e`: *"You're offline. Your dashboard still works — the assistant needs a connection."* | `Reconnect to ask a question` | flat `#cbd5e1`, **no shadow** |

---

## 8. React Native substitutions — summary

| Canvas construct | RN approach |
|---|---|
| `box-shadow` (two-stop) | `boxShadow` string on New Arch; otherwise larger stop → `shadow*` + `elevation` (§1.5) |
| Upward shadow (`0 -14px …`) | No Android equivalent — top hairline `rgba(15,23,42,0.06)` or a `LinearGradient` fade |
| `box-shadow: 0 0 0 4px` (focus ring) | Outer padded `View` with a translucent background; animate opacity |
| `display: grid` 2-col | `flexDirection: 'row'`, two children `flex: 1`, `gap: 12` (RN 0.71+ supports `gap`) |
| `display: grid` 3-col | Same with three `flex: 1` children |
| `linear-gradient(Ndeg, …)` | `expo-linear-gradient` with the `start`/`end` vectors in §3.1 |
| `radial-gradient` | `react-native-svg` `RadialGradient` + `Circle` |
| Gradient text/stroke | `react-native-svg` `Defs` + `stroke="url(#id)"` — works on both platforms |
| `backdrop-filter` | Not used. Keep the solid `rgba(8,22,54,0.55)` scrim; do not add `expo-blur` |
| `font-variant-numeric: tabular-nums` | `fontVariant: ['tabular-nums']` on every numeric `Text` |
| `text-wrap: pretty` | No equivalent — ignore |
| `borderStyle: 'dashed'` + radius | Unreliable on Android — draw with `react-native-svg` `Rect` + `strokeDasharray` |
| `overflow: hidden` on a gradient parent | Works, but Android clips shadows of children — see §5.2 |
| `flex-grow: 1420` proportional bars | `flexGrow` accepts any number; this maps 1:1 |
| Fixed `top`/`bottom` insets | `useSafeAreaInsets()`: `paddingTop = insets.top + 14`, `navBottom = Math.max(insets.bottom + 4, 22)` |

---

## 9. Things that are not negotiable

These carry the assignment's argument, not just its look:

1. **`≈` on every estimated figure**, with a caption naming the estimate. Never silently
   present a modelled number as a measurement.
2. **Em dash for unavailable**, never `0`.
3. **No net-calorie figure** on Nutrition, with the BMR explanation kept visible.
4. **Provenance on every meal row** — barcode/green for looked-up, amber/`≈` for user-typed.
5. **Provisional is violet**, meaning *less certain*, not *worse*.
6. **Coverage is stated** wherever a figure aggregates (`from 3 of 4 items`,
   `17 of 25 inputs are your data`, `across 7 scored days`).
7. **The brief says it is not medical advice**, on the card, every time.
8. **The assistant cites the figures it used** and states what it cannot see.
