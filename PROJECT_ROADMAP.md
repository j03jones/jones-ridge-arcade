# Jones Ridge Arcade — Roadmap & Handoff

**Last saved:** November 16, 2026 (Claude session)
**Status:** All 9 games are in the arcade, and art polish is done for 5 of 6 games; **only Pinball is left**. Everything so far is pushed to `origin/main`, so it is live on Cloudflare Pages once the deploy workflow finishes.
**Repository:** `/home/j03jones/Documents/jones-ridge-arcade` (all live files are in `site/`)

---

## Where to pick up

1. **Pinball art polish** (`site/pinball/game.js`, the last item in Task 2 below).
2. Optional: **update the Chomper lobby card** in `site/index.html`. It still shows a yellow Pac-Man-style wedge; the game and icon now use a lattice-crust pie with a chef's hat.
3. **Deploy after further changes:** `git push origin main`. This runs `.github/workflows/deploy.yml` and publishes `site/` to Cloudflare Pages. Everything up to the Nova polish has been pushed.

**How the work has been tested:** a local server (`python3 -m http.server 8787 --directory site`, saved as the `arcade` entry in `.claude/launch.json`) and the in-app browser at phone size (about 480×820).
- The browser pane is often hidden, which pauses `requestAnimationFrame`. Each game was tested by temporarily adding a `window.__x = { G, step(n) {...} }` hook at the end of its script, stepping the simulation by hand, cropping and magnifying the canvas, then **removing the hook**.
- The 404s for `/api/scores/...` locally are expected. The scoreboard worker only runs on Cloudflare, and the games fall back to a scoreboard stored on the device.

---

## Done

### Before this session (commit `9a6a9dd`)
- Chomper (game 07) and Stack House (game 08) added, plus the earlier audio and game-feel upgrades (Nova music, Rush music, Hop combos/coins/weather, Hero squash/stretch, Pinball nudge/TILT).

### Task 1 — Turbo Drift, game 09 (`site/drift/`) ✅
- A new top-down night delivery driving game. Hold left/right (or the arrow keys / A and D) to steer; the car speeds up on its own. Hold both sides (or press down / Space) to brake. Steering assist straightens the car when you let go.
- A "food heat" timer, green drop zones next to houses, coffee pickups, traffic (3 crashes allowed), oil slicks from level 2, drift scoring up to ×5, and a level up every 3 deliveries.
- Registered in `site/_worker.js` (`drift`), with a GAME 09 lobby card; the counter reads `09`.
- Difficulty was tuned with a bot: a careful driver survives 80+ seconds.

### Task 2 — Art polish
- [x] **Boing Breaker:** beveled glossy bricks with shadows, crack stages on steel, glowing fuse and hazard stripes on explosive bricks, a shine on gold. A chrome paddle that squashes on hits, with glowing end caps. A ball with glow, trail and a spinning highlight. Spinning triangle shards, and screen shake on 3+ brick streaks and explosions. (It already had sound effects, a pause button and a how-to screen.)
- [x] **Hop Across:** spinning spoked wheels, chrome bumpers, drivers, door seams and exhaust puffs. Logs with bark edges, knots and two cut ends. A roof vent with diesel haze on the train (a steam stack looked wrong on the modern train). A striped apron and swaying toque on the chef.
  - *Not done:* pickups, vans, semis and turtles. These would change lane gameplay, not just the art.
- [x] **Chomper:** the chomper is now a lattice-crust pie with a cherry mouth, a blinking eye, a toque and a bite pop; the old version looked too much like Pac-Man. The pests have shaded bodies, flowing skirts and pupils that track the player, and turn blue with a sweat drop when scared. Bonus fruit became cherries, fries, a milkshake, a burger and a pie slice. Lives icons are pies.
- [x] **Stack House:** this is a falling-block puzzle, not burger stacking, so each piece colour got a food texture: amber cheese, green lettuce, red tomato, orange sesame bun, purple onion, blue blueberry, teal mint shake. Blocks squash on landing, with ketchup/mustard splashes (bigger on a hard drop).
  - Also fixed: the HOLD/NEXT side panels were clipped off-canvas, so cell size is now capped by width.
  - Also fixed: the initials prompt showed after every game (the check used 20 instead of 10).
  - The lobby blurb now describes the game correctly.
- [x] **Nova Swarm:** the ship banks and tilts with sideways speed, with layered plasma engines and wingtip pods. Drones have legs and veined wings; stingers have legs, faceted eyes and a pulsing glowing stinger; wardens have mandibles.
- [ ] **Flipside Diner Pinball (`site/pinball/`):** better table textures, bumper lighting and flipper decals. **← next**

### Task 3 — App icons ✅
- `site/icons/{drift,chomp,stack}-{180,192,512}.png`, rendered from SVG with Playwright's headless Chromium (`~/.cache/ms-playwright/chromium_headless_shell-1254/...`) and resized with PIL.

### Task 4 — Deployment
- [x] Pushed to `origin/main` on 2026-11-16: Turbo Drift, icons, and the polish for 5 games.
- [ ] Push again once Pinball is done.

---

## Repository notes
- Cloudflare Pages deploys `site/`. The `jones-ridge-arcade/` subfolder is an old staging leftover; don't edit it.
- Each game is a self-contained page; all art is drawn in code and all sound is synthesized.
- Every game also keeps a top 10 on the device (`<game>.top10` in localStorage) as a fallback for the online scoreboard.
