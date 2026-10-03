# GFX audit: People / Characters

Reviewed `src/rendering/people.ts`, `src/data/portraits.ts`, the portraits and the people code in `BunkerRenderer.ts`. I also looked at `store/compare/final/zoom-people.png` and took fresh close-ups of `?slot=gfx` at 430x932 (workshop, gym, medbay, canteen, farm). Motion is judged from those shots plus the pose code. Other agents kept bringing their tabs to the front, which froze my tab, so I have no live motion sample.

## 1. What exists

- **Rig.** `Person` (`people.ts:112`) is a cut-out skeleton of 10 Pixi `Graphics` parts (thighs, shins, upper arms, forearms, torso, head), about 31 display objects per person. Proportions are at `:12-17`. Adults are 56 units in the painted style (`:184`); children are the same body at x0.74 (`:185`).
- **Drawing.** Each limb is a rounded rectangle with a 20% dark strip, a 12% light line and a 0.55 px outline (`:97-106`). The torso is a box (`:233-249`), the hand a circle (`:259`), the boot a small rectangle (`:225`). The head has 7 hair styles, beard, glasses and 7 hats (`:267-325`).
- **Face.** One dot eye, a brow line and a mouth line, with 3 moods and a blink (`:389-400`, `:534-542`).
- **Outfits.** 19 job outfits with tools (`:51-72`), 8 saturated casual tops for idle people (`:47`), 3 shade variants per person (`:209`).
- **Animation.**
  - Walk: a sine cycle (`:568-578`).
  - Work: 10 activities, each 1-2 joints rotating on sine waves (`:479-527`).
  - Position: walk to a random x, then work or idle (`:446-449`, `:533-566`).
  - Turning: instant mirror (`:567`).
  - Drag: a dangle pose (`:543`).
- **Scene** (`BunkerRenderer.ts:863-929`).
  - Light: tint from the room's light, power, flicker and depth (`:908-917`), plus a two-layer contact shadow (`people.ts:196`).
  - Tags: shown in close view only (`:918`).
  - Sleepers: hidden behind a "Zzz" (`:899-902`).
  - Missions: people on a mission are not drawn (`:869`).
  - Changing rooms: an instant teleport (`:903-906`).
- **Portraits.** 14 semi-realistic painted busts, 11 usable by random survivors (`portraits.ts:20-35`). The sprite copies only the portrait's skin, hair and beard colours and glasses (`:47-61`).

## 2. Strengths

- Each person's job reads at a glance (hats, tools, uniforms).
- True scale against the rooms.
- Room lighting carries onto the people, and the soft contact shadow grounds them.
- Small life touches: blinks, mood faces, a sad slump, look kept per id, the drag dangle, children growing into a new body.
- Nearly free at runtime.

## 3. Problems, ranked by visual impact

1. **The bodies are paper dolls (the core of the "puppet" complaint).** Every limb is a constant-width capsule: no taper, knee, elbow or calf. The torso is a rectangle, and there is no neck, shoulder, pelvis, real hand or foot. In close-up the legs are two parallel stilts. Next to the photo-painterly rooms it reads as vector clip-art.
2. **Arms on sine waves.**
   - Every task is `sin(t*k)` on a shoulder (`:483-516`), with no anticipation, impact, hold or follow-through. The torso barely moves (lean 0.05-0.12), and there is no secondary motion.
   - Walk-to-work poses snap because nothing blends them (`:550-556`). Turning is a one-frame mirror.
   - The walk has no heel strike or foot plant, and the stride rate and walking speed are scaled separately (`:558`/`:568`), so the feet slide.
3. **Actions don't touch the world.** Workers stand at random x (`:447`). In my shots:
   - the chef stirs with her back to the stove;
   - two workshop workers hammer into each other's chests and overlap;
   - the medic stands away from the bed;
   - the farmers water the air.

   Nothing keeps people apart, so bodies pass through each other.
4. **Portrait and sprite don't match.** The busts are detailed paintings (p02 has goggles and stubble; p04 has braids, a scarf and a gas mask). The sprite has a dot eye and a line mouth, and none of the gear. When the player taps someone, the two look like they come from different games.
5. **Flat shading.** The shadow strip is fixed whatever the lamp position. There is no lamp rim light, no occlusion, no cloth folds, and the even outlines read as vector art.
6. **Little variety.**
   - One body build. Children are shrunken adults when they need a bigger head and shorter limbs. No elderly, heavy or tall people.
   - Identical uniforms per job, and 11 portraits for 28+ survivors, so twins are visible.
   - Hurt is shown only as a white bar on the head (`:288`).
   - Casual and gym/hazmat colours are more saturated than the art bible allows.
7. **Missing life states.** Sleepers vanish, nobody rides the elevator (people teleport), expeditions just disappear. No sitting, eating, talking, child play or families together.
8. **Name tags collide** (the gym and the farm).

## 4. Options

| Option | 3D / quality look | Runtime (50 people, mobile) | Cost | Main risk |
|---|---|---|---|---|
| **a. Spine** (`@esotericsoftware/spine-pixi-v8`) with painted parts | Good: mesh deformation, IK | Medium: CPU skinning about 3-6 ms | L: about 15 painted parts per outfit, animated by hand. Spine Pro is about $369, and its runtime licence requires one. | Still reads 2D; depends on animator skill |
| **b. Pre-rendered 3D sheets** (Mixamo + Blender, fixed 3/4 side camera) | **Best for the cost**: real volume, light, natural motion | **Lowest**: 3-5 batched sprites per person | L-XL. Can be scripted headless; Blender 4.5 is installed here. | Atlas memory (about 50 MB RGBA, about 12 MB with KTX2); new animations need a re-render |
| **c. Real-time three.js layer** | True 3D (the actual Fallout Shelter approach) | Medium-high: second renderer, +170 KB gzip, battery | XL: layer order against room fronts and labels, lighting match, hit-testing | Style clash, integration bugs |
| **d. Better procedural rig** with normal maps | Modest: still a puppet | Low | M-L | Doesn't answer the complaint |
| **e. AI frame-by-frame** | Inconsistent | Low | High cleanup cost; the Canva/Moda tools make one image at a time | Identity drift, flicker. OK for concepts and heads only. |

**Recommendation: (b), layered.**

- **Why.** It is the cheapest real "3D, realistic" look, and runtime stays plain Pixi sprites. The rigged GLB and Mixamo assets carry over to (c) later.
- **Assets.**
  - Bodies: adult male, adult female, child and elder bases from MPFB2/MakeHuman (output is CC0) or Mixamo characters.
  - Rigging and animations: Mixamo's auto-rigger and library. Free with an Adobe ID and royalty-free for games; the user must sign in and download the files personally.
  - Backup animations: Quaternius' CC0 library.
- **Render.** A headless `blender -b -P` script:
  - camera: orthographic, turned about 20° toward the viewer;
  - lighting: top key lamp, rim light, painterly toon ramp;
  - frames: 12 fps, 128 px tall cells (default zoom about 70 device px; maximum zoom of 3 about 330, slightly soft);
  - output: colour, normal map, per-frame head/hand/foot bone JSON.
- **Keeping the frame count down.**
  - Bake the full body only per (build × job outfit), with just the animations that job uses (about 60 frames).
  - Attach head, hair, hat and tool sprites at the exported bone positions.
  - This keeps the total near 2,000 frames.
- **Tooling.** Pack the atlases in the existing tools-page flow (`/__art/save`).
- **Prototype first.** One workshop worker (idle, walk, hammer) placed in a room as a go/no-go check.

## 5. Improvements

| # | Change | Effort | Impact | Depends on |
|---|---|---|---|---|
| 1 | Work spots per room type that face the prop, with spacing so people don't overlap | M | 4 | anchor data per room art |
| 2 | Pose cross-fade (about 0.2 s) plus turn-in-place | S | 3 | – |
| 3 | Keyed, eased task poses with torso/head follow-through, hair/coat spring, stride tied to speed | M | 3 | – |
| 4 | Muted casual palette; child proportions | S | 2 | – |
| 5 | Name-tag de-collision | S | 2 | signage owner |
| 6 | Visible sleepers, elevator riders, expedition walk-out, sitting and eating | M-L | 3 | shaft and surface owners |
| 7 | Hurt/sick body language (limp, hunch, sling) | S-M | 2 | – |
| 8 | Tapered limbs, hands, feet, neck, a 3/4 head (option d) | M | 2-3 | throwaway if #10 lands |
| 9 | Painted side-profile heads matched to each portrait (AI generation plus Adobe background removal) on the head bone | M | 4 | #10 or the current rig |
| 10 | **Pre-rendered 3D character pipeline** | XL | 5 | Mixamo downloads by the user; Blender (installed) |
| 11 | Lamp-driven normal-map lighting | L | 3 | #10 |
| 12 | More portraits (ages, builds; 25+) | M | 2 | image quota |

## 6. Quick wins vs big moves

- **Quick wins** (days): #1, #2, #4, #5, #7. These stop people "doing nothing at random spots" and remove the cheapest tells, **but they won't remove the puppet feel**. Skip #8 if #10 is approved.
- **Big moves:** #10 is the real answer, followed by #9 (portrait match), #11 (lamp lighting) and #6 (a living bunker).
- **Order:** prototype of #10, then #1 and #2 (they carry over to sprites), then the full #10 rollout.
