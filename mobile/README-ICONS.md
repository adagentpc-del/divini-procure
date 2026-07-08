# App Icons and Splash (Divini Procure)

This app uses `@capacitor/assets` to generate the full iOS icon and splash set
from two source images. All of this runs on a Mac (see IOS-APP-STORE-RUNBOOK.md).

## What to provide

Create an `assets/` folder at the repo root and drop in:

- `assets/icon.png` - 1024 x 1024 px, square, no transparency, no rounded
  corners (Apple applies the mask). This is the App Store / home-screen icon.
- `assets/splash.png` - 2732 x 2732 px, square. Keep the logo centered inside
  the middle ~50 percent so it survives cropping on every device aspect ratio.
  Background should be the brand emerald-deep (#123c2e) to match the splash
  config in capacitor.config.ts.

Optional (for a dark-mode splash):

- `assets/splash-dark.png` - 2732 x 2732 px.

## Generate (Mac only)

After `npx cap add ios` has created the `ios/` project:

```
npm run assets:generate
```

This runs `capacitor-assets generate`, which produces the iOS AppIcon set and
the LaunchScreen / splash images and writes them into the native `ios/` project.
Re-run it any time the source `icon.png` or `splash.png` changes, then
`npx cap sync` and rebuild in Xcode.

## Notes

- `@capacitor/assets` is already listed as a devDependency in package.json.
- Do not commit anything into `ios/` from a non-Mac machine; the native project
  is generated on the Mac.
