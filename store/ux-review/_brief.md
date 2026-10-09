# UX / player-experience review (2026-10-09): shared brief

Game: "The Last Bunker" (הבונקר האחרון), mobile idle/strategy bunker game, TS + Vite + PixiJS v8, Hebrew/English (RTL).
Repo: `C:\Users\eitan\Desktop\משחק לשרוד` (branch `feat/airy-bunker`, gameplay code is the same as `main`, which is live).

## Goal
The owner asked: "check what can be improved and fixed in the game in terms of gameplay experience, strategy,
convenience, addictiveness (important!), understanding, and user experience".
This is a REVIEW ONLY pass. Do not edit anything under `src/`, `tools/`, `public/`. Write only your own report file.

## Rules
- Read-only on code. Do NOT start dev servers on 5173/5174 (the lead uses them). No `pkill`/killing node.
- Do not repeat findings already covered and FIXED in `store/qa/REPORT.md`, `store/qa/11-missing-and-ideas.md`,
  `store/BALANCE-REVIEW.md`, `store/plan-2026-10/*-DONE.md`, `store/plan-2026-10/4-redesign/STATUS.md`. Skim them first.
  If an old finding is still open and still matters for player experience, you may list it, marked "(still open from QA)".
- Every finding needs evidence: `file:line`, a data table, or a measured sim number. Mark confidence: High (seen/measured),
  Medium (from code), Hypothesis.
- Think like a player on a phone in the first 10 minutes, the first day, the first week, and month 2.
  Compare with what good games in the genre do (Fallout Shelter, Egg Inc., AdVenture Capitalist, Frostpunk, Clash of Clans,
  Idle Miner, Melvor, Kittens Game) but recommend only what fits this game.
- For each finding: problem, why it hurts the player, evidence, concrete fix (what to change, where), effort S/M/L, impact 1-5.
- End with your TOP 10 ranked by impact/effort.
- Write the report in Hebrew (code identifiers and paths stay in English). Keep it tight: max ~350 lines.
- Your final message to the lead: a 15-line summary + the path of your report.

Sample saves for the sim (if you need a developed bunker): `store/sim/saves-v6/` and `store/sim/saves-v4/`.
Sim runner: `tools/sim/README.md` (Node, headless). Short runs only (<= 10 min each), run them in the background.
