# AuraFlow — mobile

React Native (Expo SDK 57) + TypeScript strict, file-based routing via expo-router,
styling with **NativeWind** (Tailwind for React Native).

## Styling

Utility classes, with the design tokens defined once in `tailwind.config.js`:

```tsx
<Text className="text-sm font-semibold text-content-muted">Recovery</Text>
```

Colours are **semantic, not literal** — `caution`, `danger`, `brand`, `content-muted`.
A caution that later needs to be orange changes in one file rather than in every screen
that mentioned amber. `h-touch` is the 44dp WCAG target size, so accessibility is a token
rather than a number to remember.

Avoid arbitrary values (`bg-[#1f6feb]`): scattering them through screens is how a design
system stops being one. If a value is missing, add it to the config.

> **NativeWind v4 pins Tailwind v3.** The peer range says `>3.3.0`, which would let npm
> pull Tailwind 4, but NativeWind's config and PostCSS pipeline are written for v3 —
> hence the explicit `tailwindcss@^3.4` in devDependencies.

## Running it

```bash
npm install
cp .env.example .env.local     # point EXPO_PUBLIC_API_URL at your API
npm start
```

The API must be running separately:

```bash
cd ../api && php artisan serve
```

> `localhost` from a phone or emulator means the device itself, not your machine.
> Android emulators reach the host at `10.0.2.2`; a physical device needs your LAN
> address. `src/constants/api-config.ts` guesses per platform if the variable is unset.

### Running on a physical phone

Three things have to line up, and each fails differently:

```bash
# 1. Bind the API to all interfaces. The default is 127.0.0.1, which the phone cannot reach.
cd ../api && php artisan serve --host=0.0.0.0 --port=8000

# 2. Point the app at this machine's LAN address, not localhost.
#    .env.local:  EXPO_PUBLIC_API_URL=http://192.168.1.x:8000

# 3. Start Metro on the LAN (the default).
npm start
```

If the phone loads the app but every request fails, it is almost always (1) or the
Windows firewall blocking port 8000 for private networks.

**`--tunnel` does not help here.** It exposes *Metro* through ngrok so a phone on another
network can download the bundle — it does not expose the API. With a tunnel the host
inferred by `api-config.ts` becomes an ngrok address, and `http://…ngrok.io:8000` is not
serving anything. Use a tunnel only when the device cannot reach this machine at all, and
then tunnel the API separately and set `EXPO_PUBLIC_API_URL` to that URL.

## Layout

```
src/
├─ app/              expo-router routes
│  ├─ (auth)/        signed out — login
│  └─ (app)/         signed in  — today
├─ components/       presentational, no data fetching
├─ constants/        theme tokens, api config
├─ context/          auth-context
├─ hooks/
├─ services/         api-client + one module per resource
└─ types/
```

Routing is decided in one place — the auth gate in `src/app/_layout.tsx` reacts to the
user appearing or disappearing. Screens never navigate after signing in or out; two
sources of routing decisions race.

## Expo Go vs a development build

Everything here runs in **Expo Go** today — but use the right command:

```bash
npm run start:go     # Expo Go
npm start            # development build
```

> **`npm start` alone will not work with Expo Go.** `expo-dev-client` is installed (the AR
> work needs it), and its presence makes `expo start` default to development-build mode.
> Scanning that QR with Expo Go fails. In a running session, pressing **`s`** switches
> between the two without restarting.

`expo-dev-client` is installed now rather than later because
`react-native-vision-camera` and `react-native-fast-tflite` are native modules that Expo
Go cannot load at all. When the AR work starts:

```bash
npx expo run:android
```

The camera also does not work in an emulator — AR needs a physical device.

## Tokens

The session token is held in **`expo-secure-store`**, not AsyncStorage. AsyncStorage is a
plaintext file in the app sandbox, readable on a rooted device and present in any backup
that includes app data; SecureStore uses the Android Keystore / iOS Keychain. For an app
whose token unlocks health data, that is the whole argument. See report §4.6.

`EXPO_PUBLIC_*` variables are inlined into the bundle and readable from the APK, so they
carry configuration only — never keys.

## Checks

```bash
npm run typecheck   # tsc --noEmit
npm test            # jest
npx expo export --platform android   # proves the NativeWind/babel/metro wiring compiles
```

The export step matters: a typecheck passes whether or not NativeWind is wired correctly.
Only a real bundle proves the babel preset and metro transformer are in place.

### Known audit exception

`npm audit` reports **high**-severity advisories in `image-size` (infinite loops in the
ICNS/JXL/HEIF parsers, a denial of service). It is **not fixed**, deliberately:

- `npm audit fix --force` resolves it by downgrading `expo` from 57 to 53 — a breaking
  change that would undo the SDK the project is built on.
- `image-size` is reached through Expo's **build-time** asset pipeline, not shipped in the
  app bundle, and the attack requires feeding a malicious image to the bundler. On a
  developer machine processing the project's own assets, that is not a live exposure.

Re-check when Expo ships a release that bumps the transitive dependency. Recorded here
rather than silently ignored, because "npm audit clean" is a project acceptance
criterion (W6.17) and this is the reason it currently is not.
