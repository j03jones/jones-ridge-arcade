# Jones Ridge Arcade — Swarm Work-in-Progress & Handoff Brief

**Generated:** November 16, 2026  
**Target Assistant:** Claude (or incoming agent picking up the session)  
**Project Location:** `/home/j03jones/Documents/jones-ridge-arcade`  

---

## 1. Executive Summary

During previous autonomous swarm sessions, multiple agents branched out to add new games and add audiovisual "juice", physics, and polish to existing games. Because the work was performed across git worktrees, these changes were never merged into the main `site/` tree and remained uncommitted in isolated worktrees.

Everything has been located and preserved intact. This document provides the exact file locations, diff descriptions, and the integration checklist needed to finish the project.

---

## 2. Location of In-Progress Worktrees

The worktrees are located under `~/.gemini/antigravity-cli/worktrees/`:

| Worktree Name | Associated Conversation ID | Absolute Path |
|---|---|---|
| `swarm-chomp-d4b66322` | `e01e6662-37e1-421a-9f7f-cd5142741300` | `/home/j03jones/.gemini/antigravity-cli/worktrees/e01e6662-37e1-421a-9f7f-cd5142741300/swarm-chomp-d4b66322` |
| `swarm-stack-e418ae3f` | `e01e6662-37e1-421a-9f7f-cd5142741300` | `/home/j03jones/.gemini/antigravity-cli/worktrees/e01e6662-37e1-421a-9f7f-cd5142741300/swarm-stack-e418ae3f` |
| `swarm-drift-e736bf78` | `e01e6662-37e1-421a-9f7f-cd5142741300` | `/home/j03jones/.gemini/antigravity-cli/worktrees/e01e6662-37e1-421a-9f7f-cd5142741300/swarm-drift-e736bf78` |
| `swarm-rush-hop-531348dc` | `e01e6662-37e1-421a-9f7f-cd5142741300` | `/home/j03jones/.gemini/antigravity-cli/worktrees/e01e6662-37e1-421a-9f7f-cd5142741300/swarm-rush-hop-531348dc` |
| `swarm-nova-worker-05ec69a3` | `c1c39cba-9c8d-4a42-a8d1-2b84eb15672a` | `/home/j03jones/.gemini/antigravity-cli/worktrees/c1c39cba-9c8d-4a42-a8d1-2b84eb15672a/swarm-nova-worker-05ec69a3` |
| `swarm-hero-dev-4b533645` | `d08276d8-9497-40d0-b274-5b5fff55c6b9` | `/home/j03jones/.gemini/antigravity-cli/worktrees/d08276d8-9497-40d0-b274-5b5fff55c6b9/swarm-hero-dev-4b533645` |
| `swarm-pinball-dev-5134b76d` | `d08276d8-9497-40d0-b274-5b5fff55c6b9` | `/home/j03jones/.gemini/antigravity-cli/worktrees/d08276d8-9497-40d0-b274-5b5fff55c6b9/swarm-pinball-dev-5134b76d` |

---

## 3. Inventory of Changes by Component

### A. New Games Ready for Integration

1. **Chomper (`site/chomp/`)**
   - **Source:** `/home/j03jones/.gemini/antigravity-cli/worktrees/e01e6662-37e1-421a-9f7f-cd5142741300/swarm-chomp-d4b66322/site/chomp/`
   - **Files:** `index.html` (71 KB, complete standalone game), `manifest.webmanifest`.
   - **Theme/Style:** 1950s diner-themed Pac-Man/maze arcade game. Includes canvas rendering, custom maze algorithms, ghost/patrol logic, arcade initials prompt, touch & keyboard input, and sound effects.

2. **Stack House (`site/stack/`)**
   - **Source:** `/home/j03jones/.gemini/antigravity-cli/worktrees/e01e6662-37e1-421a-9f7f-cd5142741300/swarm-stack-e418ae3f/site/stack/`
   - **Files:** `index.html` (54 KB, complete standalone game), `manifest.webmanifest`.
   - **Theme/Style:** Burger/ingredient timing & stacking arcade game. Includes burger ingredient physics, combo multipliers, scoring overlays, responsive canvas layout.

3. **Drift (`site/drift/`)**
   - **Source:** `/home/j03jones/.gemini/antigravity-cli/worktrees/e01e6662-37e1-421a-9f7f-cd5142741300/swarm-drift-e736bf78/site/drift/`
   - **Files:** `manifest.webmanifest` (started, needs `index.html` if user wishes to complete it, or skip for now).

---

### B. Upgrades & "Juice" for Existing Games

1. **Short Order Hero (`site/hero/game.js`)**
   - **Source:** `/home/j03jones/.gemini/antigravity-cli/worktrees/d08276d8-9497-40d0-b274-5b5fff55c6b9/swarm-hero-dev-4b533645/site/hero/game.js`
   - **Enhancements (+113 lines / -7 lines):**
     - Jump squash & stretch (`P.squashX = 0.85; P.squashY = 1.15`).
     - Landing impacts with horizontal directional dust puffs and landing squash (`P.squashX = 1.2; P.squashY = 0.8`).
     - Damage effects: hit flash (`P.hitFlash = 0.05`), freeze frames (`G.freezeT`), screen shake enhancements.

2. **Flipside Diner Pinball (`site/pinball/game.js`)**
   - **Source:** `/home/j03jones/.gemini/antigravity-cli/worktrees/d08276d8-9497-40d0-b274-5b5fff55c6b9/swarm-pinball-dev-5134b76d/site/pinball/game.js`
   - **Enhancements (+107 lines / -11 lines):**
     - Table Nudging & TILT mechanics: keypress impulse nudges live balls, logs nudge history over 2s window.
     - 2 quick nudges = "DANGER / TILT WARNING".
     - 3 nudges = full "TILT!" lock out: flippers cut out, callout triggered, balls drained.
     - Extra ball awards at 500,000 pt intervals.
     - Dot-Matrix Display (DMD) message queue (`queueDMD`), rainbow flasher light shows.

3. **Nova Swarm (`site/nova/index.html`)**
   - **Source:** `/home/j03jones/.gemini/antigravity-cli/worktrees/c1c39cba-9c8d-4a42-a8d1-2b84eb15672a/swarm-nova-worker-05ec69a3/site/nova/index.html`
   - **Enhancements (+483 lines / -42 lines):**
     - Complete synthesized Web Audio synthwave soundtrack:
       - Sawtooth 8th-note bassline (A1, D2, C2, E2 with lowpass filter).
       - Procedural noise hi-hats.
       - 4-bar square wave melody loop.
       - Boss intensity layer dynamically activated during boss encounters.

4. **Hop Across (`site/hop/index.html`)**
   - **Source:** `/home/j03jones/.gemini/antigravity-cli/worktrees/e01e6662-37e1-421a-9f7f-cd5142741300/swarm-rush-hop-531348dc/site/hop/index.html`
   - **Enhancements (+371 lines / -14 lines):**
     - Fast-hop combo system with visual floating multiplier tags.
     - Collectible bonus coins spawning across lanes.
     - Dynamic weather effects: rain particle system and nighttime starfield.
     - Player squash & stretch with directional landing dust.
     - Dual-oscillator jump audio, coin pickup, and combo celebration chimes.

5. **Blue Plate Rush (`site/rush/index.html`)**
   - **Source:** `/home/j03jones/.gemini/antigravity-cli/worktrees/e01e6662-37e1-421a-9f7f-cd5142741300/swarm-rush-hop-531348dc/site/rush/index.html`
   - **Enhancements (+50 lines):**
     - Upbeat 1950s diner background music: 32-note ragtime melody with walking bass accompaniment.
     - Rush Hour acceleration: music automatically speeds up from 120 BPM to 140 BPM when Rush Hour activates.
     - Custom sound effects for register cash-in (`caching`) and rush start.

---

## 4. Current Working Copy Anomalies & Cleanup

In the project root (`/home/j03jones/Documents/jones-ridge-arcade/`):
- A redundant nested subfolder exists: `jones-ridge-arcade/` (contains `.bak` files from an earlier script run).
- Staging/setup scripts: `prepare-arcade.sh` (deleted from git index but present in untracked files), `apply-arcade-updates.sh`, `setup-arcade.sh`.
- The active website files served to Cloudflare Pages are located strictly in `site/`.

---

## 5. Integration Plan for Claude

To complete the arcade updates:

1. **Copy updated game files into `site/`:**
   ```bash
   # 1. New Games
   cp -r /home/j03jones/.gemini/antigravity-cli/worktrees/e01e6662-37e1-421a-9f7f-cd5142741300/swarm-chomp-d4b66322/site/chomp site/
   cp -r /home/j03jones/.gemini/antigravity-cli/worktrees/e01e6662-37e1-421a-9f7f-cd5142741300/swarm-stack-e418ae3f/site/stack site/

   # 2. Game Enhancements
   cp /home/j03jones/.gemini/antigravity-cli/worktrees/d08276d8-9497-40d0-b274-5b5fff55c6b9/swarm-hero-dev-4b533645/site/hero/game.js site/hero/game.js
   cp /home/j03jones/.gemini/antigravity-cli/worktrees/d08276d8-9497-40d0-b274-5b5fff55c6b9/swarm-pinball-dev-5134b76d/site/pinball/game.js site/pinball/game.js
   cp /home/j03jones/.gemini/antigravity-cli/worktrees/c1c39cba-9c8d-4a42-a8d1-2b84eb15672a/swarm-nova-worker-05ec69a3/site/nova/index.html site/nova/index.html
   cp /home/j03jones/.gemini/antigravity-cli/worktrees/e01e6662-37e1-421a-9f7f-cd5142741300/swarm-rush-hop-531348dc/site/hop/index.html site/hop/index.html
   cp /home/j03jones/.gemini/antigravity-cli/worktrees/e01e6662-37e1-421a-9f7f-cd5142741300/swarm-rush-hop-531348dc/site/rush/index.html site/rush/index.html
   ```

2. **Register New Games in `site/_worker.js`:**
   - In `const GAMES = [...]`, add `'chomp'` and `'stack'` so their high scores can be persisted via Cloudflare KV.

3. **Register New Games on Arcade Lobby (`site/index.html`):**
   - Add cards for Chomper and Stack House to the arcade cabinet grid.
   - Ensure icons or arcade badges are properly set.

4. **Verify & Clean Up:**
   - Test that pages load cleanly without console errors.
   - Delete/clean obsolete worktrees with `git worktree prune` or remove stale branches if no longer needed.
   - Commit cleanly to `main`.
