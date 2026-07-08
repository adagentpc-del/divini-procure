# 30 UI/UX Guidelines

Conventions distilled from `src/theme.css`, `src/components/`, and the page set.
The product reads as a **premium, calm, editorial** procurement workspace, not a
loud SaaS dashboard.

## Layout

- **App shell:** fixed left sidebar (230px, deep-emerald `--emerald-deep`) with a
  brand mark + grouped nav, a 58px topbar, and a content area (max-width ~1180px,
  24px padding). See `.app / .sidebar / .topbar / .content` in `theme.css` and
  `src/components/Shell.tsx`.
- **Mobile:** a sticky top bar (`.mtop`) replaces the sidebar; keep the same
  emerald chrome.
- **Cards over chrome:** content sits in white cards (`.card`, 1px `--line`
  border, 13px radius). Use `.cards2` / `.cards3` grids for metric rows.

## Patterns

- **Metrics:** `.metric` blocks - uppercase label (`.k`), large serif value
  (`.v`), small caption (`.d`).
- **Tables:** uppercase, muted, letter-spaced headers; 12px cell padding; bottom
  hairline rows; `.row-click` for navigable rows.
- **Badges / chips:** pill badges (`.badge` + `.b-green/-amber/-red/-neutral`) for
  status (verification, fee, featured). Chips (`.chip` / `.chip.on`) for filters.
- **Buttons:** `.btn` (outline) and `.btn.primary` (emerald fill). Primary action
  is always emerald.
- **Feedback:** `.ok` (green) and `.err` (red) inline message blocks; `.note` for
  muted helper text.

## V2-specific UX rules

- **Bid wall:** free vendors see "X of 5 bids left this quarter." At 0, block the
  submit and show the Pro upsell. Pro = unlimited (no counter).
- **Verification gate:** an unverified vendor sees a sandbox state ("Get verified
  to start bidding") and bid/match/message actions are disabled, not hidden, with
  a clear path to upload credentials.
- **Verified-only RFPs:** developer RFQ flows default to "verified vendors only";
  surface vendor status, coverage limits, and expiry at a glance.
- **Fee transparency:** show the success fee plainly ("2% capped at $2,500";
  grandfathered "1% capped at $1,000") via `FeeBadge.tsx`. Never bury it.
- **Badges:** Verified / Verified+ / Featured render on vendor cards
  (`VendorBadges.tsx`).
- **Compliance disclaimer:** the verification badge is "checked + tracked as of
  [date]," not a guarantee (`ComplianceDisclaimer.tsx`).

## Tone of the interface

- Free-first: never show a paywall to post a project, claim a profile, or get
  matched. Upgrades (Pro, Featured, Verified+) are clearly optional, never gates.
- Concrete numbers over vague hype ("$10M -> $50,000", "2% capped $2,500").
- Calm density: editorial serif headings, generous whitespace, restrained color.

> TODO(owner): there is no formal accessibility audit (contrast, focus states,
> keyboard nav). Add one before launch; the emerald-on-emerald nav and muted text
> need a contrast pass.
