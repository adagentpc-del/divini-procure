# iOS App Store Runbook (Divini Partners and Divini Procure)

This runbook covers Apple App Store submission for BOTH Capacitor-wrapped apps.
Both use the managed-webview strategy: the native iOS shell loads the hosted
HTTPS site (no bundled SPA). An identical copy of this file lives in each repo.

| App | Bundle ID (appId) | Hosted URL (server.url) |
| --- | --- | --- |
| Divini Partners | com.divinigroup.divinipartners | https://app.divinipartners.com |
| Divini Procure | com.divinigroup.procure | https://app.diviniprocure.com |

IMPORTANT for Procure: app.diviniprocure.com does NOT exist yet. Provision DNS
plus a TLS cert (Caddy) and confirm it serves the SPA over HTTPS BEFORE building
the native app, or the webview will load nothing.

Steps marked [MAC ONLY] require macOS with Xcode and an Apple Developer account.
Do NOT attempt them on this (non-Mac) environment. Everything not marked
[MAC ONLY] has already been prepared in-repo.

---

## 0. Already done in-repo (non-Mac prep)

- Partners and Procure both have @capacitor/* dependencies and cap:* + app:build
  + assets:generate scripts in package.json.
- Both capacitor.config.ts files use the managed-webview pattern: correct appId,
  appName, HTTPS server.url, cleartext false, no http origins. ATS stays strict.
- Both repos have mobile/PrivacyInfo.xcprivacy (privacy manifest template) and
  mobile/README-ICONS.md.
- @capacitor/assets is a devDependency in both repos.

You still need to run npm install and the native build on a Mac (below).

---

## 1. Apple Developer enrollment [MAC ONLY-adjacent, account work]

1. Enroll in the Apple Developer Program (99 USD/year) at developer.apple.com
   under the Divini Group organization (or the chosen legal entity).
2. In App Store Connect, create two app records, one per bundle ID:
   - Divini Partners -> com.divinigroup.divinipartners
   - Divini Procure -> com.divinigroup.procure
3. Register both App IDs (Explicit, not wildcard) in Certificates, Identifiers
   and Profiles so the bundle IDs match capacitor.config.ts exactly.

---

## 2. Build the native iOS project [MAC ONLY]

Run these from each repo root, once per app.

```
npm install                  # installs @capacitor/* + @capacitor/assets
npm run build                # produces dist/ (web build the shell expects)
npx cap add ios              # creates the ios/ native project (first time only)
npx cap sync                 # copies web + native config into ios/
```

Notes:
- npm run build is required even in managed-webview mode: cap needs a webDir
  (dist) to exist, and Capacitor injects its runtime there.
- ios/ is generated here and is intentionally absent from the repo until now.

---

## 3. App icons and splash [MAC ONLY]

See mobile/README-ICONS.md in the repo. In short:

1. Put assets/icon.png (1024x1024) and assets/splash.png (2732x2732) at repo root.
2. Run:

```
npm run assets:generate      # capacitor-assets generate
npx cap sync
```

This writes the AppIcon set and LaunchScreen images into ios/.

---

## 4. Add the privacy manifest to the Xcode target [MAC ONLY]

Apple requires a privacy manifest (PrivacyInfo.xcprivacy) in the app bundle.

1. Open the workspace: `npx cap open ios` (opens ios/App/App.xcworkspace).
2. In Xcode, drag mobile/PrivacyInfo.xcprivacy into the App target group so the
   built path is ios/App/App/PrivacyInfo.xcprivacy. Ensure "App" is checked
   under Target Membership and "Copy items if needed" is selected.
3. Review the declared data types and required-reason API codes against what the
   app actually collects. The template declares: name, email address, payment
   info, user content, identifiers (user ID), and usage data (product
   interaction), all marked NOT used for tracking (NSPrivacyTracking = false).
   Required-reason APIs declared: UserDefaults (CA92.1) and File timestamp
   (C617.1). Trim anything the app does not use.
4. The App Store Connect privacy nutrition label (Section 9) MUST match this
   manifest.

---

## 5. Signing and provisioning [MAC ONLY]

1. In Xcode, select the App target > Signing and Capabilities.
2. Enable Automatically manage signing and select the Divini Group team.
3. Confirm the Bundle Identifier matches the table at the top exactly.
4. Xcode will create the distribution signing certificate and provisioning
   profile. For CI later, switch to manual signing with an explicit App Store
   distribution profile.

---

## 6. App Transport Security stays strict [MAC ONLY verification]

1. Do NOT add NSAllowsArbitraryLoads or any ATS exception to Info.plist.
2. Both sites are HTTPS only and capacitor.config.ts sets cleartext false, so
   the default strict ATS posture is correct. Leave it.
3. If a future feature needs a non-HTTPS resource, find an HTTPS alternative
   instead of weakening ATS (reviewers scrutinize ATS exceptions).

---

## 7. In-app account deletion (Guideline 5.1.1(v)) [requirement]

Apps that let users create an account MUST offer in-app account deletion, not
just deactivation, and not a "email us to delete" flow.

1. Confirm both hosted apps expose an in-app "Delete my account" path that
   actually deletes the account and associated data (or starts an auditable
   deletion). Because these are managed-webview apps, the deletion UI lives in
   the hosted web app and must be reachable from inside the native shell.
2. This is a common rejection reason. Verify it works end to end before
   submitting. Note the path for the App Review notes.

---

## 8. Payments: IAP vs external purchase [decision]

Apple requires In-App Purchase for digital goods/subscriptions consumed in the
app, and forbids steering to external payment for those.

1. Paid placements, listing fees, subscriptions, and the grandfathered 2 percent
   fee (Procure): determine whether each is a digital good consumed in-app
   (likely IAP territory) or a real-world service / B2B transaction (likely
   exempt, may use your own payment rail).
2. B2B marketplace transactions between businesses for real-world services are
   generally NOT required to use IAP, but Apple reviews case by case. Document
   the rationale in the App Review notes.
3. If anything is borderline, consider gating paid flows behind the web app and
   shipping the iOS app as a lighter companion for the first review, then
   iterate. Do NOT add deceptive external-purchase links.

---

## 9. Store listing assets and privacy label [MAC ONLY-adjacent]

1. Screenshots: provide required iPhone sizes (6.7-inch and 6.5-inch at minimum,
   plus iPad if you mark the app iPad-compatible). Capture from the running
   build or a simulator.
2. App description, keywords, support URL, marketing URL, and privacy policy URL
   (must be a working HTTPS link).
3. Fill the App Privacy "nutrition label" in App Store Connect so it matches
   mobile/PrivacyInfo.xcprivacy exactly (data types, linkage, tracking = no).

---

## 10. Archive, TestFlight, submit [MAC ONLY]

1. In Xcode: Product > Archive (build for "Any iOS Device", Release config).
2. Distribute App > App Store Connect > Upload.
3. The build appears in App Store Connect after processing. Add it to TestFlight
   and run an internal test on a real device (verify login, the managed webview
   loads the hosted site, account deletion, and any payment flow).
4. Complete the version metadata, attach screenshots, set the privacy label,
   and add App Review notes (test account credentials, account-deletion path,
   payment rationale).
5. Submit for Review. Repeat the whole flow for the second app.

---

## Per-app quick reference

Divini Partners
- Bundle ID: com.divinigroup.divinipartners
- Hosted URL: https://app.divinipartners.com (live)
- Config: capacitor.config.ts (managed webview, ATS strict)
- Privacy manifest: mobile/PrivacyInfo.xcprivacy
- Icons guide: mobile/README-ICONS.md

Divini Procure
- Bundle ID: com.divinigroup.procure
- Hosted URL: https://app.diviniprocure.com (MUST be provisioned first)
- Config: capacitor.config.ts (managed webview, ATS strict)
- Privacy manifest: mobile/PrivacyInfo.xcprivacy
- Icons guide: mobile/README-ICONS.md
