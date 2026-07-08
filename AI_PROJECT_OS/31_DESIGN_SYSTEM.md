# 31 Design System

Source of truth: `src/theme.css` (tokens + component classes) and
`src/components/`. The system is CSS-class based (no CSS-in-JS, no UI library).

## Tokens (CSS variables, `:root` in `theme.css`)

### Color
```
--emerald:       #1E5D4A   /* primary brand green */
--emerald-deep:  #123c2e   /* sidebar, headings, dark surfaces */
--emerald-mid:   #174838
--champagne:     #D9CCB0   /* accent / brand mark */
--ink:           #2c2a26   /* body text */
--muted:         #7d776c   /* secondary text */
--line:          #e7e1d6   /* borders/hairlines */
--ivory:         #f7f4ee   /* hover surfaces */
--bg:            #f3efe6   /* app background */
--white:         #fff
--green:         #2f8f5b   /* success */
--amber:         #b8860b   /* warning */
--red:           #b3413a   /* error/danger */
```
Status badge fills: green `#e7f3ec`/`#1f7a4d`, amber `#fbf2dc`/`#8a6d1a`,
red `#fbe9e7`/`#a3382f`, neutral `#eee9df`/`#6b6358`.

### Typography
- **Display/headings:** `'Cormorant Garamond'`, serif (weights 500/600/700) in
  `--emerald-deep`. Used for h1/h2/h3, brand name, and metric values.
- **Body/UI:** `Inter`, system-ui fallback (weights 400-700).
- Both loaded from Google Fonts in `theme.css`.

### Shape + spacing
- `--radius: 13px` (cards). Buttons/inputs use ~10px radius; badges/chips use
  20px (pill).
- Card padding 18px; content padding 24px; max content width ~1180px; sidebar
  230px; topbar 58px.

## Component classes

- **Surfaces:** `.card`, `.app`, `.sidebar`, `.topbar`, `.content`, `.main`.
- **Nav/brand:** `.brand` (`.mk` mark, `.nm` name, `.tg` tagline), `.nav` /
  `.nav-label` / `.nav a.active`.
- **Headings:** `.page-head` + `.sub`, `.sectitle` (uppercase section label),
  `.serif`.
- **Metrics:** `.metric` (`.k` label, `.v` serif value, `.d` caption).
- **Tables:** plain `table/th/td`, `.row-click`.
- **Badges/chips:** `.badge` + `.b-green/-amber/-red/-neutral`; `.chip` / `.chip.on`.
- **Buttons:** `.btn`, `.btn.primary`.
- **Forms:** `.field` + `label`, `input/select/textarea` (focus = emerald border).
- **Feedback:** `.ok`, `.err`, `.note`.
- **Mobile:** `.mtop` sticky bar.

## Reusable React components (`src/components/`)

- `Shell.tsx` - app shell (sidebar + topbar + content).
- `VendorBadges.tsx` - Verified / Verified+ / Featured badges.
- `FeeBadge.tsx` - success-fee / grandfathered fee display.
- `ExistingRelationshipCheckbox.tsx` - developer attests a pre-existing pair
  (drives the grandfathered 1% fee).
- `ComplianceDisclaimer.tsx` - "checked + tracked, not a guarantee" notice.
- `DocumentPanel.tsx` - file upload/list/signed-download panel.
- `MatchCard.tsx` - vendor/opportunity match card.

## Rules for new UI

- Reuse the tokens and classes above; do not introduce a new color or a UI
  dependency without a decision (`14_DECISIONS.md`).
- Headings serif, body Inter. Primary action emerald. Status via the badge classes.
- Keep the premium, editorial, free-first feel (`30_UI_UX_GUIDELINES.md`,
  `32_BRAND_GUIDELINES.md`).

> TODO(owner): tokens are duplicated as raw classes rather than a documented
> component library; consider a lightweight Storybook or component index if the UI
> grows.
