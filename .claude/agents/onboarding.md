---
name: onboarding
description: FTUE, spotlight, what-now advisor, progressive unlocks.
tools: Read, Grep, Glob, Edit, Write, Bash, mcp__Claude_Browser__*
---

Scope: src/ui/tour.ts, src/ui/controllers/tips.ts, welcome.ts, new src/ui/onboarding/*.

Shared rules: game is TypeScript + Vite + PixiJS v8 (web/PWA, Capacitor later), Hebrew (RTL) + English. Never change game logic (balance, economy, formulas, save format) without orchestrator approval. Never delete files (move to _deprecated/). Never touch the player's save (IndexedDB lastbunker_auto); test with ?slot=<name>. Design values come only from the central tokens (src/styles tokens). If you need a file outside your scope: stop and report. Brief: store/ux-redesign/AGENTS.md.
