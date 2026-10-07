# Accessibility baseline (plan 4, AC-15)

Tool: `node tools/a11y/audit.mjs` (after `npm run build`). It loads the game on the mid-game sample save `store/sim/saves-v6/e30-seed1.json`
(written into a throw-away Chrome profile, never a real save) at 375x667, 390x844 and 430x932 with text scales 1.1, 1.4 and 1.6, and audits
the bare HUD, the welcome dialog, the four bottom-nav sheets and the five menu tabs. JSON goes to `store/compare/a11y/<tag>.json` (not
committed, `store/compare/` is ignored), a summary to stdout. Never blocks (exit 0) unless `--strict`. `--quick` = 390x844 at 1.1 only.
Related checks: `tools/a11y/flash-check.mjs` (flash budget, virtual clock), `tools/a11y/semantics.mjs` (roles, focus, inert, keys),
`tools/a11y/shots.mjs` (Accessibility tab and toasts in the four colour modes).

Offenders are unique selectors (contrast: selector + text), counted per configuration; the number is the same in every viewport, so the
table shows the extremes. Machine: heavily loaded, so only structure and computed styles are measured, never timings.

## Baseline (start of wave 1, branch plan4/wave0)

| Category | 1.1 (all 3 viewports) | 1.4 / 1.6 |
|---|---|---|
| Targets < 44x44 | 18 | 15 |
| Text contrast < 4.5 (3 for large) | 25 | 25 |
| Buttons / inputs without accessible name | 1 | 1 |
| Images without alt | 0 | 0 |
| Horizontal overflow | 0 | 0 |
| Dialogs / sheets with the last action outside the viewport | 0 | 0 |

### Targets (18 at 1.1)
HUD: `res-more` 46x24, `era-chip` 79x32, season / supply / inbox / journal buttons 32x32. Welcome dialog: both actions 324x39. People sheet:
tab buttons 171x37, "?" 29x34, "assign" 45x34. Menu: small buttons 49x34 ("open"), volume sliders 28 high, coupon field and "apply" 34 high.
(At 1.4 and above the HUD buttons grow past 44, hence 15.) These belong to UX-5 (hit areas), not to this wave.

### Contrast (25)
* Research sheet (`tier-chip` T1..T4 11px and 12 `build-item-desc` lines): 4.15:1 on the card, `--text-dim`. The fix in the plan (lighten `--text-dim`) is AC-3, not done here.
* `info-arrival.negative` "!" (the full-bunker door warning): reads 2.1-2.3:1 because the audit samples it while its pulse animation has the element at 45% opacity; with reduced motion it is steady. Treat as a probable false positive of the sampler.
* 24 of the 25 sit over a translucent layer on top of the canvas, so the backdrop is approximated by the page colour (marked `~` in the report).
* False positive found and fixed in the tool during this wave: a gradient plate was judged against the page behind it (1.04:1 on the primary button).

### Names (1)
`textarea.save-area` (save code field) in the Settings tab. Also found on the first pass and fixed in this wave: the close button of the surface map.

## After wave 1 (same tool, same matrix, full build of this branch)

| Category | 1.1 | 1.4 / 1.6 |
|---|---|---|
| Targets < 44x44 | 16 (the 2 dialog actions were fixed; Accessibility tab and list view buttons are 44) | 15 |
| Contrast | 25 (unchanged, see above) | 25 |
| No accessible name | 0 | 0 |
| No alt | 0 | 0 |
| Overflow | 0 | 0 |
| Dialog action outside viewport | 0 | 0 |

(The full 9-configuration after-run was taken one small CSS commit earlier, with 18 / 25 / 0; the final `--quick` run at 390x844 @1.1 gives 16 / 25 / 0.)

## What is still open (not in this wave's scope)
AC-3 contrast tokens (`--text-dim`, tier chips), UX-5 hit areas of the HUD buttons and the People sheet, AC-12 per-button sizes outside the
Accessibility tab, and the modal `inert` fallback on browsers without `inert` (uses `aria-hidden`).
