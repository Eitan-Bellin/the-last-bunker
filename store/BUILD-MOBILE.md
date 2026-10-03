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

## Store assets

- Listing text (Hebrew + English): `store/listing.md`
- Icon 1024: `store/icon-1024.png`; feature graphic 1024×500: `store/feature-graphic.png`
- Phone screenshots 1080×1920: `store/screenshots/` (`*-he.png`, `*-en.png`)
