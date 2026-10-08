# Building the Android and iOS apps

The game is a PWA built with Vite. The native apps wrap the same build with Capacitor.
Nothing below has been installed yet: it downloads packages from npm and Gradle/Maven (several hundred MB).

## One-time setup

```bash
npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios
npx cap add android
```

`capacitor.config.json` (already in the project) sets the app id `com.lastbunker.game`, the name and the dark background.

## Android (this PC has Android Studio and the SDK)

```bash
npm run build
npx cap sync android
npx cap open android
```

In Android Studio: Build → Generate Signed Bundle / APK → Android App Bundle (for Google Play).
Icons: use `store/icon-1024.png` with Android Studio's Image Asset tool (Foreground = the icon, background `#0e0b08`).

## iOS

Needs a Mac with Xcode:

```bash
npx cap add ios
npm run build && npx cap sync ios
npx cap open ios
```

## What the code already does for the native shell (plan 4, UX-12)

- `src/utils/platform.ts` is the one place that asks where the game runs: `isNative()` (Capacitor injects `window.Capacitor`; no package is imported by the web build), `isIOS()`, `isStandalone()`, `nativePlugin('Haptics')`, `shareFile()`.
- Haptics (`utils/haptics.ts`) use `Capacitor.Plugins.Haptics` when it exists; nothing to change in code, only `npm i @capacitor/haptics`.
- The service worker is not registered inside the shell (`initServiceWorker` in `ui/pwa.ts` returns early on `isNative()`).
- Notifications: on iPhone outside the shell the switch is hidden (`webNotificationsHonest()`); when the shell is added, implement a `NotifyBackend` with `@capacitor/local-notifications` in `ui/notifications.ts` (the `NotifyBackend` interface is already there) and it will show the switch again.
- Save sharing: the web build uses `navigator.share({files})`; in the shell use `@capacitor/share` + `@capacitor/filesystem` inside `shareFile()`.
- A home-screen PWA on iOS has its own, empty storage: the install card tells players to export a backup first and import it in the app.

## Store assets

- Listing text (Hebrew + English): `store/listing.md`
- Icon 1024: `store/icon-1024.png`; feature graphic 1024×500: `store/feature-graphic.png`
- Phone screenshots 1080×1920: `store/screenshots/` (`*-he.png`, `*-en.png`)
