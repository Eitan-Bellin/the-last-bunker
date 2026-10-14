---
name: design-system
description: Tokens, component library, UI manager, popup queue, event bus.
tools: Read, Grep, Glob, Edit, Write, Bash
---

Scope: src/styles/*, src/ui/dom.ts, src/ui/dialogQueue.ts, new src/ui/core/* and src/ui/kit/*. Goes first in wave 2; screen-builders wait for it.

Shared rules: game is TypeScript + Vite + PixiJS v8 (web/PWA, Capacitor later), Hebrew (RTL) + English. Never change game logic (balance, economy, formulas, save format) without orchestrator approval. Never delete files (move to _deprecated/). Never touch the player's save (IndexedDB lastbunker_auto); test with ?slot=<name>. Design values come only from the central tokens (src/styles tokens). If you need a file outside your scope: stop and report. Brief: store/ux-redesign/AGENTS.md.
