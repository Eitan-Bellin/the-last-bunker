# The Last Bunker: design system (Wave 1)

Branch `ux-redesign-ds`. One token source, a small DOM component kit, and formatting helpers. Everything new in the
interface reads from these; older stylesheets keep working through the legacy names.

| Piece | File |
|---|---|
| Tokens (the only `:root`) | `src/styles/tokens.css` (imported first, from the top of `src/style.css`) |
| Kit styles | `src/styles/kit.css` (imported second, from `src/style.css`) |
| Kit (TypeScript) | `src/ui/kit/` (`index.ts` barrel; `Button.ts`, `Tooltip.ts`, `Display.ts`, `tokens.ts` mirror) |
| Formatting | `src/ui/format.ts` (`dom.ts` `costAmount` / `rateText` now delegate here, same output) |
| Fonts | `public/fonts/` (woff2 + `fonts.css` + `LICENSE.txt`), linked from `index.html` |
| Tests | `tools/sim/tokens-test.mjs`, `tools/sim/format-test.mjs` (+ `.ts`), both in `npm run check:full` |

## Rules

1. **No raw values in new code.** Colours, spacing, sizes, radii, shadows, layers, durations and easings are tokens.
   `tokens-test` fails on any hex/rgb or px/ms literal in `kit.css`.
2. **Text scales.** `font-size: calc(var(--type-body) * var(--fs, 1))`. `--fs` is the Text size setting.
3. **RTL first.** Logical properties only (`inset-inline-start`, `margin-inline-end`, `padding-inline`). Numbers and timers sit in
   `unicode-bidi: isolate` so "+1.2 /s" and "12:05" keep their order in Hebrew.
4. **Accessibility layers win.** `a11y.css` (colour-vision modes, reduced motion), the high-contrast block in `touch.css` and
   large targets (`--tap`) come later in the cascade and override tokens on purpose.
5. **Never colour alone.** Every state that is colour-coded also has a shape: dashed edge for disabled / danger, an icon, or text.

## Tokens

### Colour

| Token | Value | Use |
|---|---|---|
| `--surface-0` | `#14161A` | page, sheet base |
| `--surface-1` | `#1F2329` | cards, rows |
| `--surface-2` | `#2A3038` | raised: chips, inputs, tooltips |
| `--border` | `#3A424C` | hairlines (decorative) |
| `--overlay` / `--overlay-soft` | `rgba(0,0,0,.7)` / `.5` | behind a dialog / a bottom sheet |
| `--text-primary` | `#ECE6D8` | body text (warm paper) |
| `--text-secondary` | `#A8A194` | hints, meta |
| `--text-tertiary` | `#9C9689` | dimmest readable text (legacy `--text-dim`) |
| `--text-disabled` | `#807B71` | locked / disabled (see contrast note) |
| `--text-on-primary` | `#14161A` | text on amber |
| `--terminal` | `#9DFFB4` | CRT phosphor green (legacy `--phosphor`): terminal titles, never body text |
| `--primary` / `--primary-pressed` / `--primary-glow` | `#E8A33D` / `#C7862A` / amber 28 % | the one main action |
| `--success` `--danger` `--warning` `--info` | `#6FBF73` `#E5533D` `#F2C14E` `#5BA4CF` | status |
| `--danger-text` | `#F27A63` | danger as running text (passes 4.5:1 everywhere) |
| `--power` `--water` `--food` `--scrap` `--radiation` `--currency-premium` | `#F5D547` `#4FB3E8` `#8CC152` `#B0866A` `#9BE15D` `#7FD3E8` | brief resource colours |

Every resource id in `src/data/resources.ts` has `--res-<id>` (the test enforces it):

| Resource | Token value | Resource | Token value |
|---|---|---|---|
| food | `var(--food)` | components | `#C3CAD3` |
| water | `var(--water)` | alloys | `#93A9C2` |
| power | `var(--power)` | data | `#63D2BE` |
| materials | `#C9A27A` | influence | `#E2A6F2` |
| medicine | `#E9798B` | seedCores | `#B7DB6A` |
| knowledge | `#A99CF0` | isotope7 | `var(--radiation)` |
| scrap | `var(--scrap)` | blueprints | `#7FB2EA` |
| credits | `var(--currency-premium)` | vaultCoins | `#D9B54A` |

In TypeScript: `resourceColor('water')` returns `'var(--res-water)'`.

### Contrast (WCAG 2.1, computed by `tokens-test`)

| Foreground | on surface-0 | on surface-1 | on surface-2 | Needs | Result |
|---|---|---|---|---|---|
| `--text-primary` | 14.56 | 12.68 | 10.69 | 4.5 | pass |
| `--text-secondary` | 7.06 | 6.16 | 5.19 | 4.5 | pass |
| `--text-tertiary` | 6.16 | 5.36 | 4.52 | 4.5 | pass |
| `--danger-text` | 6.68 | 5.82 | 4.90 | 4.5 | pass |
| `--text-disabled` | 4.30 | 3.75 | 3.16 | exempt (kept at 3) | documented exception |
| `--primary` | 8.40 | 7.32 | 6.17 | 3 (UI) | pass |
| `--primary-pressed` | 5.93 | 5.16 | 4.35 | 3 | pass |
| `--success` | 8.09 | 7.05 | 5.94 | 3 | pass |
| `--danger` | 4.86 | 4.24 | 3.57 | 3 | pass (UI only: use `--danger-text` for text) |
| `--warning` | 10.79 | 9.40 | 7.93 | 3 | pass |
| `--info` | 6.60 | 5.75 | 4.85 | 3 | pass |
| `--power` / `--water` / `--food` | 12.50 / 7.72 / 8.51 | 10.89 / 6.72 / 7.41 | 9.18 / 5.67 / 6.25 | 3 | pass |
| `--scrap` / `--radiation` / `--currency-premium` | 5.58 / 11.49 / 10.68 | 4.86 / 10.01 / 9.31 | 4.10 / 8.44 / 7.85 | 3 | pass |
| all `--res-*` | >= 5.58 | >= 4.86 | >= 4.10 | 3 | pass |
| `--text-on-primary` on `--primary` / `--primary-pressed` | 8.40 / 5.93 | | | 4.5 | pass |

Adjustments to the brief: `--text-disabled` is `#807B71` instead of `#6B675F` (which was 3.2 / 2.8 / 2.4:1). Disabled text is exempt from
1.4.3, but the game's earlier accessibility pass (plan4 AC-3) made locked labels readable on purpose, so it stays at 3:1 or more and is
always paired with a dashed edge. `--text-tertiary` and `--danger-text` are additions so dim text and red text have an AA-passing token.
`--border` (1.3 to 1.8:1) is decorative: no information depends on seeing it.

### Space, radius, elevation, touch

| Token | Value |
|---|---|
| `--sp-1` .. `--sp-8` | 4, 8, 12, 16, 24, 32, 48, 64 px |
| `--r-panel` / `--r-card` / `--r-full` | 6 / 12 / 999 px |
| `--border-w` / `--ring-w` / `--spinner-w` | 1 / 3 / 2 px |
| `--elev-btn` / `--elev-btn-pressed` | `0 5px 0 var(--btn-edge)` / `0 1px 0` (the button sinks `--elev-btn-lift` = 4 px) |
| `--elev-1` / `--elev-2` / `--elev-3` | small / toast / dialog shadows |
| `--hit-min` | 48 px (kit hit area; large-targets `--tap` 52 px wins when bigger) |
| `--icon-s` / `-m` / `-l` | 16 / 20 / 24 px |

### Layers (z-index)

The numbers are the ones the game already used, so nothing changes its stacking. The brief's order "popups, toasts" is the
other way round in the game (toasts 30 under dialogs 40); that order was kept.

| Token | Value | What |
|---|---|---|
| `--z-world` | 0 | Pixi canvas |
| `--z-hud` | 10 | HUD |
| `--z-panels` | 20 | bottom sheets |
| `--z-nav` | 22 | nav console (above sheets) |
| `--z-toasts` | 30 | toasts |
| `--z-popups` | 40 | modal dialogs |
| `--z-tooltip` | 50 | kit tooltip |
| `--z-story` | 60 | story dialog, depth overlays |
| `--z-tutorial` | 90 | intro, spotlights |
| `--z-system` | 100000 | share picture, turn-phone card |
| `--z-splash` | 100001 | splash |

### Type

| Token | px | | Token | Value |
|---|---|---|---|---|
| `--type-caption` | 12 | | `--font-body` | Rubik |
| `--type-body` | 14 | | `--font-title` | Secular One (titles and buttons under 28 px) |
| `--type-body-l` | 16 | | `--font-display` | Karantina (28 px and up only) |
| `--type-subtitle` | 18 | | `--font-mono` | ui-monospace stack (timers) |
| `--type-title` | 22 | | `--num-tabular` | `tabular-nums` for counters |
| `--type-headline` | 28 | | `--lh-tight` / `--lh-body` | 1.2 / 1.45 |
| `--type-hero` | 40 | | `--weight-regular/medium/bold` | 400 / 500 / 700 |

Fonts are self-hosted woff2 (Hebrew + Latin subsets): Rubik as one variable file per subset (weights 400 to 800, so the 600 / 800 the
older CSS uses still render), Secular One 400, Karantina 400 / 700. Rubik is preloaded. The whole set
is precached with the shell at install (`FONTS` in `public/sw.js`).

### Motion

| Token | Value | | Token | Value |
|---|---|---|---|---|
| `--dur-press` | 60 ms | | `--ease-out-back` | `cubic-bezier(.34,1.56,.64,1)` |
| `--dur-release` | 150 ms | | `--ease-in` | `cubic-bezier(.32,0,.67,0)` |
| `--dur-popup-in` / `-out` | 250 / 180 ms | | `--ease-in-out` | `cubic-bezier(.65,0,.35,1)` |
| `--dur-screen` | 300 ms | | `--ease-out` | `cubic-bezier(.33,1,.68,1)` |
| `--dur-toast` | 200 ms | | `--press-scale` / `--press-darken` | 0.93 / brightness 0.9 |
| `--toast-hold` | 2500 ms | | `--popup-from-scale` | 0.92 |
| `--stagger` | 40 ms | | `--breathe-scale` / `--dur-breathe` | 1.04 / 1.8 s |
| `--dur-shake` | 200 ms | | `--shake-distance` | 6 px |
| `--debounce` | 350 ms | | `--long-press` | 450 ms |

Reduced motion (`<html data-motion="reduced">`, and `prefers-reduced-motion` before the script runs) sets every movement duration to 0,
the press / breathe / popup scales to 1 and the shake distance to 0. `src/ui/kit/tokens.ts` mirrors the millisecond values TypeScript
needs (`MS`), and `tokens-test` fails if they drift.

### Legacy names

`tokens.css` keeps every variable the older sheets read: `--bg-dark`, `--bg-panel`, `--bg-card(-hi)`, `--accent` (= `--primary`),
`--amber`, `--accent-glow`, `--text-dim` (= `--text-tertiary`), `--positive` (= `--success`), `--negative` (= `--danger`), `--radius`,
and the Bunker OS skin (`--steel-*`, `--rivet`, `--crt-bg(-2)`, `--phosphor*` with `--phosphor` = `--terminal`, `--r-s/m/l`).
The two drifting `:root` blocks are gone: `--text-primary` is now the warm `#ECE6D8` everywhere (bunker-os.css used to override it with
phosphor `#dcffe6`), and `--text-secondary` / `--border` follow the brief.

## Kit API

```ts
import { kButton, setKButtonDisabled, kResourceChip, setResourceChip, kProgress, setProgress, kBadge, setBadge,
  kCard, kRow, kTabs, kEmpty, kTimer, kTooltip, showTip } from '../kit';
```

### kButton

```ts
kButton({
  variant?: 'primary' | 'secondary' | 'tertiary' | 'icon' | 'close' | 'purchase', // default 'primary'
  label?: string,            // [[icon]] tokens allowed
  icon?: string,             // icons.ts name, drawn before the label
  onPress: () => void,
  disabledReason?: string | null,   // non-null = disabled; '' = generic "not available"
  ariaLabel?: string,        // required for icon / close without label
  detail?: HTMLElement,      // appended after the label (cost row...)
  className?: string,        // skin classes; default btn-primary / btn-secondary / btn-ghost by variant
  haptics?: boolean,         // 'tap' haptic on press, default true
  sound?: Sfx | null,        // sound on press, default none
  stopPropagation?: boolean, // default true
  debounceMs?: number,       // default 350 (--debounce); 0 turns it off
}): HTMLButtonElement
bindPress(el, onPress, { debounceMs?, haptics?, sound?, stopPropagation?, state?, onDeny? }) // the same press behaviour for any element
setKButtonDisabled(b, reason | null); setKButtonLoading(b, on); setKButtonHighlighted(b, on); setKButtonLabel(b, text); isKButtonDisabled(b)
```

Behaviour: pressed = scale 0.93 + 10 % darker in 60 ms, back in 150 ms out-back, the 5 px key edge sinks to 1 px. The action fires on
release inside the hit area (keyboard Enter / Space too); a press dragged out does not fire. 350 ms debounce. Disabled buttons stay
focusable (`aria-disabled`); pressing one shakes it 200 ms, plays the 'error' haptic + sound (there is no 'deny' sound in `audio/sfx.ts`),
and shows the reason in a tooltip. Loading ignores presses and shows a spinner (`aria-busy`). Highlighted breathes 1.0 to 1.04 every 1.8 s;
under reduced motion it is a static amber ring. The hit area is at least 48 px (`.k-hit`).

```ts
const go = kButton({ label: i18n.t('build.place'), icon: 'build', onPress: place });
setKButtonDisabled(go, canAfford ? null : i18n.t('build.needs', { what }));
footer.appendChild(go);
```

### Display parts

| Builder | Updater | Notes |
|---|---|---|
| `kResourceChip({ resource?, icon?, amount, rate?, max?, state?, label? })` | `setResourceChip(chip, {...})` | colour from `--res-<id>`; state `normal` / `low` (< 30 % of `max`) / `danger` (< 15 %: dashed red edge + pulse, static under reduced motion); amount via `fmtNum`, rate via `fmtRate` |
| `kProgress(value, max, label?)` | `setProgress(track, value, max)` | `role=progressbar`; on a drop the fill jumps and a ghost bar follows after `--dur-popup-in` |
| `kBadge(count)` | `setBadge(b, count)` | hidden at 0, `99+` above 99 |
| `kCard({ title?, body?, children?, onPress?, className? })` | | a `<button>` when pressable; presses go through `bindPress` (same feel, release-inside, debounce as kButton) |
| `kRow({ icon?, label, value?, trailing?, onPress? })` | | one list line, 48 px tall; pressable rows use `bindPress` |
| `kTabs(tabs, active, onChange, label?, panel?)` | | `.tab-row` look + `a11yDom.enhanceTabs` (roles, roving tabindex, RTL-aware arrows); tabs may carry a badge |
| `kEmpty(icon, text, cta?)` | | icon, sentence, optional secondary button |
| `kTimer({ endsAt, now?, onDone?, doneText? })` | | `role=timer`, mono + tabular, ticks every second; stops when done, when removed from the page, or if never attached within 5 ticks; `onDone` runs once |
| `kTooltip(anchor, text \| () => text)` | `showTip(anchor, text, holdMs?)`, `hideTip()` | long press 450 ms on touch (the click that ends it is swallowed), hover / focus-visible with a mouse / keyboard |

```ts
const water = kResourceChip({ resource: 'water', amount: s.water, max: cap.water, rate: perSec.water });
// each tick:
setResourceChip(water, { amount: s.water, max: cap.water, rate: perSec.water });

list.appendChild(people.length ? rows : kEmpty('people', i18n.t('people.none'), { label: i18n.t('people.find'), onPress: openSurface }));
```

### Shared primitives

* **Modal**: action buttons are `kButton`s (skin classes as before, same sounds, no haptic, no stopPropagation: unchanged behaviour). New
  optional `ModalAction.disabledReason`. A disabled choice is now focusable and explains itself instead of being inert.
* **Sheet / Modal / Toast CSS**: layer, overlay, radius, shadow and motion come from tokens (`--z-panels`, `--z-popups`, `--z-toasts`,
  `--overlay(-soft)`, `--r-card`, `--r-panel`, `--elev-*`, `--dur-screen`, `--dur-popup-in/out`, `--dur-toast`, `--dur-crt-on`).
  `Toast.ts` reads its remove delay from `MS['dur-screen']` (300 ms, as before).

## Formatting (`src/ui/format.ts`)

| Function | Examples |
|---|---|
| `fmtNum(n)` | `9,999` · `15.2K` · `152K` · `1.52M` · `3.40B` · `1.20T` · `−5`. Exact with separators to 9,999, then 3 significant digits, always cut down (never shows more than there is) |
| `fmtCost(n)` | the old `costAmount` (prices round UP, 2 significant digits): `470K`, `2.4M`. Differs from `fmtNum` on purpose: a price must never look smaller than what is asked (rounded up, short), an amount owned must never look bigger than what is there (cut down, 3 digits). Do not swap one for the other |
| `fmtRate(perSec)` | the old `rateText`: `+1.2 /s`, trickles per hour |
| `fmtDuration(sec)` | en `2d 4h` · `4h 12m` · `12:05` · `45s`; he `2י 4ש` · `4ש 12ד` · `12:05` · `45שנ׳` (seconds `שנ׳` so they never read as hours `ש`). Zero second unit dropped (`1h`), rounds up |
| `plural(key, n, params?)` | `Intl.PluralRules` category → `<key>.one` / `.two` / `.other` (falls back to `.other`); `{n}` gets the separated number. he: `שורד אחד` / `שני שורדים` / `5 שורדים` |

New strings live under `kit.*` in both `he.json` and `en.json` (flat keys like the rest of the tables): duration units, `kit.unavailable`,
`kit.loading`, `kit.timer.done`, `kit.badge.label`, `kit.close`, and two plural examples (`kit.survivors.*`, `kit.minutes.*`).
Every plural key needs all three forms in both languages (the i18n parity lint enforces the same keys and placeholders).

## Open items for later waves

* `a11y.css` still declares its own `:root` with `--ok / --warn / --bad / --info` (AC-6 colour-vision palettes). Because it loads last its
  `--info: #6fc3ff` shadows the token value `#5BA4CF`. Folding `--ok/--warn/--bad` into `--success/--warning/--danger` belongs to the
  l10n-a11y pass (file outside this wave's scope).
* `touch.css` declares `:root { --fs; --fs-hud; --tap; --chip-h }` and the high-contrast overrides (outside scope; they still work).
* Roughly 340 hex and 380 rgba literals remain in the older sheets; Wave 2 screen work should replace them as each screen is rebuilt.
