#!/usr/bin/env bash
    set -euo pipefail

    # ------------------------------------------------------------------
    # 1️⃣  Prompt for credentials (you can also export them as env vars)
    # ------------------------------------------------------------------
    read -rp "GitHub username / org (e.g. j03jones): " GH_USERNAME
    read -rp "GitHub repository name (e.g. jones-ridge-arcade): " GH_REPO
    read -rp "GitHub Personal Access Token (repo + workflow scopes): " -s GH_TOKEN
    echo    # newline after secret
    read -rp "Cloudflare API token (edit DNS + Workers): " -s CF_TOKEN
    echo
    read -rp "Cloudflare Zone ID for jonesridgekitchen.com: " CF_ZONE_ID

    # ------------------------------------------------------------------
    # 2️⃣  Create shared assets (theme, utils, sound, header)
    # ------------------------------------------------------------------
    ASSETS_DIR="assets"
    mkdir -p "$ASSETS_DIR"

    # ---- theme.css ----------------------------------------------------
    cat > "$ASSETS_DIR/theme.css" <<'EOF'
    /* Shared theme for the Arcade */
    :root {
      --bg: #021;
      --fg: #cfd8ff;
      --accent: #5a7dff;
      --accent-dark: #1c2350;
    }
    body {
      background: var(--bg);
      color: var(--fg);
      margin: 0;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
      overflow: hidden;
    }
    .arcade-header {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 48px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 12px;
      backdrop-filter: blur(6px);
      background: rgba(0,0,20,.7);
      z-index: 5;
    }
    .arcade-title {
      margin: 0;
      font-size: 1.2rem;
      color: var(--accent);
    }
    .arcade-btn {
      font: 600 14px system-ui, sans-serif;
      padding: 6px 12px;
      border: 1.5px solid rgba(170,195,255,.55);
      border-radius: 22px;
      background: rgba(0,0,20,.7);
      color: var(--fg);
      text-decoration: none;
      cursor: pointer;
    }
    #hud {
      font-size: 0.9rem;
      color: var(--fg);
    }
    EOF

  	# ---- utils.js ----------------------------------------------------
    cat > "$ASSETS_DIR/utils.js" <<'EOF'
    // Shared utilities used by every game
    (function () {
  	// -----------------------------------------------------------------
      // Layout helpers (similar to the ones in boing)
      // -----------------------------------------------------------------
      const W = 640,
            SS = 2,
            IS_TOUCH = ("ontouchstart" in window) || navigator.maxTouchPoints > 0;

      function layout(cv, newH) {
	const TALL = newH >= 760,
              UI = TALL ? 1.5 : 1,
              HUD_H = TALL ? 44 : 24,
              BH = TALL ? Math.min(24, 16 + Math.round((newH - 760) / 60)) : 16,
  	      TOP = HUD_H + 16 + (TALL ? Math.round((newH - 480) * 0.12) : 0),
  	      PAD_Y = TALL ? newH - Math.max(70, Math.round(newH * 0.13)) : newH - 36;
        cv.width = W * SS;
        cv.height = newH * SS;
        const ctx = cv.getContext("2d");
        ctx.setTransform(SS, 0, 0, SS, 0, 0);
        // expose some values for games that need them
  	window.__ARCADE_LAYOUT = {W, H:newH,TALL,UI,HUD_H,BH,TOP,PAD_Y,SS,IS_TOUCH};
      }

      // -----------------------------------------------------------------
      // Simple pointer‑lock helper
      // -----------------------------------------------------------------
      let locked = false;
  	const cv = document.getElementById("c");
      if (cv) {
        document.addEventListener("pointerlockchange", () => {
          locked = document.pointerLockElement === cv;
	});
        window.tryLock = () => {
          if (locked || !cv.requestPointerLock) return;
          try {
            const p = cv.requestPointerLock();
            if (p && p.catch) p.catch(() => {});
          } catch (_) {}
        };
      }

      // expose a few globals the games already expect
      window.tryLock = window.tryLock || (() => {});
      window.IS_TOUCH = IS_TOUCH;
      window.layout = layout;
    })();
    EOF

    # ---- sound.js ----------------------------------------------------
    cat > "$ASSETS_DIR/sound.js" <<'EOF'
  	// Tiny sound helper – shared across all games
    (function () {
      let ac = null,
          muted = false;

      function audio() {
        if (!ac) {
          try {
            ac = new (window.AudioContext || window.webkitAudioContext)();
          } catch (_) {
            ac = null;
          }
        }
        if (ac && ac.state === "suspended") ac.resume().catch(() => {});
        return ac;
      }

      function tone(f, dur, type = "square", vol = 0.12, f2 = null, delay = 0) {
        if (muted || !ac) return;
        const t = ac.currentTime + delay,
              o = ac.createOscillator(),
              g = ac.createGain();
        o.type = type;
        o.frequency.setValueAtTime(f, t);
        if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
        o.connect(g).connect(ac.destination);
        o.start(t);
        o.stop(t + dur + 0.02);
      }

      function noise(dur, vol = 0.25, freq = 1200) {
        if (muted || !ac) return;
        if (!window.__noiseBuf) {
          const buf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
          const data = buf.getChannelData(0);
          for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
          window.__noiseBuf = buf;
        }
        const t = ac.currentTime,
              src = ac.createBufferSource(),
              g = ac.createGain(),
              fl = ac.createBiquadFilter();
        src.buffer = window.__noiseBuf;
        fl.type = "lowpass";
        fl.frequency.setValueAtTime(freq, t);
        fl.frequency.exponentialRampToValueAtTime(80, t + dur);
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        src.connect(fl).connect(g).connect(ac.destination);
        src.start(t);
        src.stop(t + dur);
      }

      // Export a tiny sfx collection (games can add more later)
      window.sfx = {
        click: () => tone(800, 0.03, "square", 0.05),
        boom: () => noise(0.45, 0.35, 2500),
        // …other sounds can be added by each game if needed
      };

      // expose toggle
      window.toggleMute = (state) => { muted = !!state; };
    })();
    EOF

  	# ---- header fragment (HTML) ---------------------------------------
    cat > "$ASSETS_DIR/header.html" <<'EOF'
    <header class="arcade-header">
      <a id="home" href="/" class="arcade-btn">← ARCADE</a>
      <h1 class="arcade-title">Jones Ridge Arcade</h1>
      <button id="darkToggle" class="arcade-btn">🌓</button>
      <div id="hud">
        Score: <span id="hudScore">0</span> |
        Lives: <span id="hudLives">3</span> |
        Level: <span id="hudLevel">1</span>
      </div>
    </header>

    <script>
      // Dark‑mode toggle (persisted in localStorage)
      const root = document.documentElement;
      const saved = localStorage.getItem('arcadeTheme') || 'dark';
      root.dataset.theme = saved;
      document.getElementById('darkToggle').addEventListener('click', () => {
        const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
        root.dataset.theme = next;
        localStorage.setItem('arcadeTheme', next);
      });
    </script>
    EOF

    # ------------------------------------------------------------------
    # 3️⃣  Patch every game folder to include the shared assets
    # ------------------------------------------------------------------
    # Find all directories that contain an index.html (the game roots)
    for game_dir in $(find . -type f -name "index.html" -printf "%h\n" | sort -u); do
      echo "🔧 Patching $game_dir …"

      # 1) Insert the shared header (if not already there)
      if ! grep -q '<!--#include virtual="/assets/header.html" -->' "$game_dir/index.html"; then
        # Insert immediately after <body> opening tag
        sed -i.bak '0,/<body>/s#<body>#<body>\n<!--#include virtual="/assets/header.html" -->#'
        "$game_dir/index.html"
      fi

      # 2) Add link to theme.css (if missing)
      if ! grep -q 'href="/assets/theme.css"' "$game_dir/index.html"; then
        # Insert before the first <style> tag or after </title>
        sed -i.bak '/<\/title>/a <link rel="stylesheet" href="/assets/theme.css">' "$game_dir/index.html"
      fi

      # 3) Add script tags for utils.js and sound.js (if missing)
      if ! grep -q 'src="/assets/utils.js"' "$game_dir/index.html"; then
        # Insert before the closing </body> tag, after any existing <script> blocks
        sed -i.bak '/<\/body>/i <script src="/assets/utils.js"></script>\n<script
        src="/assets/sound.js"></script>' "$game_dir/index.html"
      fi
    done

    # ------------------------------------------------------------------
    # 4️⃣  Initialise Git (if needed) and push to GitHub
    # ------------------------------------------------------------------
    if [ ! -d ".git" ]; then
      echo "🗃️  Initialising a new Git repository …"
      git init
    fi

    git add .
    git commit -m "Initial commit – shared theme, utils, and CI workflow"

    # Create the remote repo via GitHub API
    echo "🚀 Creating GitHub repository \"$GH_USERNAME/$GH_REPO\" …"
    curl -s -X POST \
      -H "Authorization: token $GH_TOKEN" \
      -H "Accept: application/vnd.github+json" \
      https://api.github.com/user/repos \
      -d "{\"name\":\"$GH_REPO\",\"private\":false}" > /tmp/gh-create.json

    REPO_SSH_URL=$(jq -r .ssh_url /tmp/gh-create.json)

    if [ "$REPO_SSH_URL" = "null" ]; then
      echo "❌  GitHub repository creation failed. Response:"
      cat /tmp/gh-create.json
      exit 1
    fi

    git remote add origin "$REPO_SSH_URL"
    git branch -M main
    git push -u origin main

    # ------------------------------------------------------------------
    # 5️⃣  Add GitHub Actions secret for Cloudflare (if you have gh-cli)
    # ------------------------------------------------------------------
    if command -v gh &>/dev/null; then
      echo "🔐 Storing Cloudflare token as a GitHub Actions secret …"
      gh secret set CF_API_TOKEN -b"$CF_TOKEN" -R "$GH_USERNAME/$GH_REPO"
      gh secret set CF_ZONE_ID -b"$CF_ZONE_ID" -R "$GH_USERNAME/$GH_REPO"
    else
      echo "⚠️  gh CLI not installed – you’ll need to add the Cloudflare secrets manually:"
      echo "   Repository → Settings → Secrets and variables → Actions → New repository secret"
      echo "   Name: CF_API_TOKEN   Value: $CF_TOKEN"
      echo "   Name: CF_ZONE_ID     Value: $CF_ZONE_ID"
    fi

    # ------------------------------------------------------------------
    # 6️⃣  Final note
    # ------------------------------------------------------------------
    echo -e "\n✅  All done!\n"
    echo "Your arcade source is now at: https://github.com/$GH_USERNAME/$GH_REPO"
    echo "A GitHub Actions workflow will run on every push, execute ./setup-arcade.sh and publish the
    Worker."
    echo "Make sure the Cloudflare token you supplied has permission to edit the DNS record for"
    echo "arcade.jonesridgekitchen.com (or use a Workers route). After the first CI run you should see"
    echo "the site live at that domain."