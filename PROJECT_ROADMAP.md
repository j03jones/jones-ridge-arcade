# Jones Ridge Arcade — Future Session Roadmap & Handoff

**Saved:** November 16, 2026  
**Status:** 8 of 9 games integrated on `main` (commit `9a6a9dd`). Session paused for quota/usage reset.  
**Repository Working Directory:** `/home/j03jones/Documents/jones-ridge-arcade`  

---

## 1. What Has Been Completed & Committed (`main` @ `9a6a9dd`)

All previously scattered swarm work was collected, integrated, and committed to git:

- [x] **Game 07: Chomper (`site/chomp/`)** — Full 71KB diner-themed maze/pac-man game added.
- [x] **Game 08: Stack House (`site/stack/`)** — Full 54KB burger/ingredient stacking arcade game added.
- [x] **Audio & Music Additions**:
  - Nova Swarm (`site/nova/index.html`): Procedural Web Audio synthwave soundtrack (bassline, hats, lead melody, dynamic boss layer).
  - Blue Plate Rush (`site/rush/index.html`): 1950s diner background ragtime + walking bass with Rush Hour tempo acceleration.
  - Hop Across (`site/hop/index.html`): Dual-oscillator jump tones, coin chime, combo celebrations.
- [x] **Game Feel & Juice**:
  - Short Order Hero (`site/hero/game.js`): Squash/stretch jumping, horizontal landing dust particles, hit flash & freeze-frames.
  - Flipside Diner Pinball (`site/pinball/game.js`): Nudge & TILT mechanics, 500k extra ball awards, DMD message queue, flasher light shows.
  - Hop Across (`site/hop/index.html`): Fast-hop combo system, collectible coins, rain/night weather.
- [x] **Lobby & Scoreboard**:
  - `site/_worker.js`: Registered `chomp` and `stack` in KV scoreboard.
  - `site/index.html`: Added neon cabinet cards for Chomper and Stack House; updated game counter to `08`.

---

## 2. Outstanding Scope for Next Session

The user's goal is to have **9 total games**, make all games easy and intuitive to play, and upgrade the sprites/visuals to be detailed, polished, and fun.

### Task 1: Complete Game 09 — Turbo Drift (`site/drift/`)
- **Manifest:** Already exists at `/home/j03jones/.gemini/antigravity-cli/worktrees/e01e6662-37e1-421a-9f7f-cd5142741300/swarm-drift-e736bf78/site/drift/manifest.webmanifest`.
- **Target:** Create `site/drift/index.html` (self-contained HTML5 Canvas game, portrait-friendly):
  - Theme: Retro arcade top-down/isometric diner delivery drifting game (sliding around curves, delivering hot food before it cools, dodging traffic and oil slicks).
  - Controls: Left/Right steer (or touch steer/drift button), automatic or hold-to-accelerate.
  - High score integration with `/api/scores/drift`.
- **Registration**:
  - Add `drift: { key: 'top10:drift', maxScore: 10000000 }` to `GAMES` in `site/_worker.js`.
  - Add cabinet card `GAME 09: TURBO DRIFT` to `site/index.html`.
  - Update top bar game counter to `09` in `site/index.html`.

### Task 2: Sprite & Visual Art Polish (Detailed & Fun)
Currently, several games rely on plain geometric canvas shapes (rectangles and circles). Upgrade the sprite rendering functions:

1. **Boing Breaker (`site/boing/index.html`)**:
   - **Bricks**: Beveled 3D borders, glossy top highlights, cracked state variants on multi-hit.
   - **Paddle**: Polished chrome bar with metallic gradient and curved end caps.
   - **Ball**: Subtle glow trail, rotating specular highlight.
   - **Juice**: Colored shard explosion particles on break; screen shake on multi-brick streaks.
   - **Audio & UI**: Web Audio SFX (bounce, break, powerup, death); on-screen pause button; initial control tutorial overlay.

2. **Hop Across (`site/hop/index.html`)**:
   - **Vehicles**: Replace solid blocks with detailed canvas-drawn classic cars, pickup trucks, delivery vans, and semi-trucks (headlights, bumpers, windshields, spinning wheel hubs).
   - **Logs/Turtles**: Wood grain texture, bark edges, water wake ripples.
   - **Train**: Detailed locomotive engine with animated smoke puff particles.
   - **Hero**: Frankie the Chef character with animated toque, apron, and hop squash/stretch.

3. **Chomper (`site/chomp/index.html`)**:
   - **Hero**: Chomper with animated pie-slice mouth, eye blink, and eating animations.
   - **Ghosts**: Diner health inspector / dish monster shapes with flowing wavy skirts, pupils tracking player position, and blue flickering "scared" sprites during power pellets.
   - **Food Pellets**: Cherry, fries, milkshake, and burger bonus pickups with distinct sprite art.

4. **Stack House (`site/stack/`)**:
   - **Ingredients**: Detailed rendering for toasted sesame bun, seared grill-mark burger patty, melted cheddar drips, wavy bacon strips, crinkle-cut pickles, red tomato slices, ruffled lettuce leaves.
   - **Animations**: Juicier squash on drop impact, ketchup/mustard splash particles.

5. **Nova Swarm (`site/nova/index.html`)**:
   - **Player Ship**: Wing thruster plasma glows, banking tilts when moving left/right.
   - **Alien Swarm**: Insectoid alien sprites with fluttering wings and glowing stingers.

6. **Flipside Diner Pinball (`site/pinball/`)**:
   - Visual enhancements to 3D table textures, bumper lighting, and flipper decals.

### Task 3: PWA Icons Generation
Generate or update icons in `site/icons/` (`180x180`, `192x192`, `512x512`) for:
- `chomp-180.png`, `chomp-192.png`, `chomp-512.png`
- `stack-180.png`, `stack-192.png`, `stack-512.png`
- `drift-180.png`, `drift-192.png`, `drift-512.png`

### Task 4: Deployment
When all 9 games are polished and verified:
```bash
git add site/
git commit -m "Complete 9-game arcade: add Turbo Drift, detailed sprite artwork and gameplay polish across all games"
git push origin main
```
This triggers the GitHub Action `.github/workflows/deploy.yml` which deploys directly to Cloudflare Pages.

---

## 3. Important Repository Notes
- All active website files live in **`site/`**. Cloudflare Pages deploys the contents of `site/`.
- Do not edit the redundant subfolder `jones-ridge-arcade/` (it is an old staging artifact).
- Local commits on `main` are currently ahead of `origin/main` by 1 commit (`9a6a9dd`).
