# Stage B — perspective decision

The user was asleep and said "don't stop, no questions", so the orchestrator decided. Date: 2026-10-15.

| | A: 2.5D deep section | B: isometric | C: 3D angled |
|---|---|---|---|
| Wow | 8 | 8 | 8 |
| Readability | 7 | 6 | 6 |
| Explorability | 7 | 8 | 9 |
| Reuse of existing art (45 paintings, 3D people, PostFX) | 8 | 2 | 3 |
| Phone perf (lower risk = higher) | 6 | 5 | 5 |
| Effort (higher = cheaper) | 6 (~36 agent-days) | 3 (~36-48) | 3 (~41, plus a three.js install) |

**Decision: A, the deep 2.5D side cross-section, plus two borrowings.**
- From C: the lighting language. Real light pools with falloff in deep darkness, darkness that deepens with depth, lit dust, and light culling per cell.
- From B: warm/cool contrast and crisp cut-away edges.

Why:
1. The save stores rooms as (floor, slot) and holds no world coordinates (A1). A is a new projection of the same grid, so the save can stay, game logic is untouched, and migration is additive.
2. A keeps the painted room art, the 3D people atlases, the camera, PostFX and the quality governor. B and C throw most of that away.
3. Phone heat is a known user complaint. A does the least GPU work per frame and stays within the existing quality tiers.
4. A keeps the side-view readability that an idle game needs, since rooms are where you work.

Risks we accept, and their mitigations:
- **Painted rooms beside procedural structure look like two styles.** The style guide sets a shared grade, edge treatment and contact shadows.
- **Darkness hurts readability.** Working rooms get a lighting floor and survivors get rim light.
- **Mobile perf is unmeasured** (the pane was hidden during Stage B). The rock and structure are baked into textures per chunk, the lightmap renders at half resolution, and qa-perf measures on the real build.

Screens: proto/b/shots and proto/c/shots. Prototype A opens live at http://localhost:5176/store/world-redesign/proto/a/index.html (world server).
