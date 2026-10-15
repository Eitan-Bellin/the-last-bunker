# Shared brief for ux-redesign agents

Game: THE LAST BUNKER, TypeScript + Vite + PixiJS v8 world, DOM overlay UI, Hebrew (RTL, default) + English, mobile-first PWA.
Read first: 01-scout.md (map), 02-audit.md (issues by #), 03-plan.md (waves), DESIGN-SYSTEM.md (tokens + kit, after wave 1).

## Hard rules
1. Work only in your own git worktree/branch and only in the files your brief lists. Need another file? Stop and report.
2. No game-logic changes: balance, economy, formulas, rates, save format. UI may read state, never change rules.
3. Never delete files (move to `_deprecated/`). Never touch the player's save (IndexedDB `lastbunker_auto`);
   browser tests use `?slot=<yourname>&debug` (port: start your own vite on the port in your brief).
4. Every colour/space/size/duration/easing comes from `src/styles/tokens.css`. No new literals.
5. Use the kit (`src/ui/kit`) for new buttons/chips/bars/cards; replace legacy markup in your files when touched.
6. Touch targets >= 48 px hit area (visual may be smaller), 8 px between targets, 24 px between buy and close.
7. Action on release; blocked buttons say why ("Need 10 Knowledge: build a Laboratory").
8. RTL: logical CSS properties; isolate numbers/Latin with `bidi`/`setRich`. New strings: add to both
   `src/i18n/he.json` and `en.json` inside ONE top-level block named in your brief (key parity is linted).
   Hebrew copy: short verbs, warm survival tone, follow store/ux-review/GLOSSARY.md (glossary lint runs in check).
9. Respect a11y settings: reduced motion, text scale (`--fs`), large targets, high contrast.
10. Done = `npm run check:full` + `npx vite build` green in your worktree, a quick look in the browser at 375x812
    he + en, commits in Conventional Commits style ending with
    `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push. Final message: <= 25 lines, commits,
    an ASCII wireframe of each changed screen, anything not done.
11. If the same action fails twice the same way, stop and report.
