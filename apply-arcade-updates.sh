#!/usr/bin/env bash
# ------------------------------------------------------------
# apply-arcade-updates.sh
#   • Adds shared theme / utils / sound files
#   • Inserts a common header/HUD into every game page
#   • Sets up .gitignore and a GitHub Actions workflow
#   • Commits everything and pushes to the existing GitHub repo
# ------------------------------------------------------------
set -euo pipefail

# ------------------------------------------------------------------
# 0️⃣  Basic sanity checks
# ------------------------------------------------------------------
if ! command -v git >/dev/null; then
  echo "❌  git not found – aborting."
  exit 1
fi

# Ensure we are in the project root (where setup-arcade.sh lives)
if [ ! -f "setup-arcade.sh" ]; then
  echo "❌  This script must be run from the arcade repo root."
  exit 1
fi

# ------------------------------------------------------------------
# 1️⃣  Create shared assets directory
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
  const W = 640,
        SS = 2,
        IS_TOUCH = ("ontouchstart" in window) || navigator.maxTouchPoints > 0;

  // Layout helper – same API as the original Boing code
  window.layout = function (cv, newH) {
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
    window.__ARCADE_LAYOUT = {W, H:newH,TALL,UI,HUD_H,BH,TOP,PAD_Y,SS,IS_TOUCH};
  };

  // Pointer‑lock helper (used by Boing, Rush, etc.)
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
  } else {
    window.tryLock = () => {};
  }

  // expose for games that already read these globals
  window.IS_TOUCH = IS_TOUCH;
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
      } catch (_) { ac = null; }
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

  // Export a minimal sfx collection – games can extend it later
  window.sfx = {
    click: () => tone(800, 0.03, "square", 0.05),
    boom:  () => noise(0.45, 0.35, 2500)
  };

  // Global mute toggle (wired to the header button)
  window.toggleMute = (state) => { muted = !!state; };
})();
EOF

# ---- header.html ----------------------------------------------------
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
  // Simple dark‑mode toggle (saved in localStorage)
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
# 2️⃣  Patch every game’s index.html
# ------------------------------------------------------------------
echo "🔧 Updating game pages …"
for game_dir in $(find . -type f -name "index.html" -printf "%h\n" | sort -u); do
  echo "   → $game_dir"

  # Insert header include (once) – use a simple append after <body>
  if ! grep -q '<!--#include virtual="/assets/header.html" -->' "$game_dir/index.html"; then
    sed -i.bak '/<body>/a <!--#include virtual="/assets/header.html" -->' "$game_dir/index.html"
  fi

  # Add theme stylesheet (if missing)
  if ! grep -q 'href="/assets/theme.css"' "$game_dir/index.html"; then
    sed -i.bak '/<\/title>/a <link rel="stylesheet" href="/assets/theme.css">' "$game_dir/index.html"
  fi

  # Add utils.js (if missing)
  if ! grep -q 'src="/assets/utils.js"' "$game_dir/index.html"; then
    sed -i.bak '/<\/body>/i <script src="/assets/utils.js"></script>' "$game_dir/index.html"
  fi

  # Add sound.js (if missing)
  if ! grep -q 'src="/assets/sound.js"' "$game_dir/index.html"; then
    sed -i.bak '/<\/body>/i <script src="/assets/sound.js"></script>' "$game_dir/index.html"
  fi
done

# ------------------------------------------------------------------
# 3️⃣  .gitignore (add missing entries if the file already existed)
# ------------------------------------------------------------------
if [ -f ".gitignore" ]; then
  echo "🗂️  Updating existing .gitignore …"
  for line in node_modules/ dist/ scratch/ .env *.log .env.local .DS_Store .idea/ .vscode/ *.pem *.key; do
    grep -qxF "$line" .gitignore || echo "$line" >> .gitignore
done
else
  echo "🗂️  Creating .gitignore …"
  cat > .gitignore <<'EOF'
node_modules/
Dist/
scratch/
.env
*.log
.env.local
.DS_Store
.idea/
.vscode/
*.pem
*.key
EOF
fi

# ------------------------------------------------------------------
# 4️⃣  GitHub Actions workflow
# ------------------------------------------------------------------
mkdir -p .github/workflows
cat > .github/workflows/deploy.yml <<'EOF'
name: Deploy Arcade to Cloudflare

on:
  push:
    branches: [ main ]

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install Wrangler (v2)
        run: npm install -g wrangler

      - name: Run project setup script
        run: ./setup-arcade.sh

      - name: Deploy to Cloudflare Workers
        env:
          CF_API_TOKEN: ${{ secrets.CF_API_TOKEN }}
          CF_ZONE_ID: ${{ secrets.CF_ZONE_ID }}
        run: wrangler publish
EOF

# ------------------------------------------------------------------
# 5️⃣  Initialise (or re‑initialise) the Git repo and push
# ------------------------------------------------------------------
if [ ! -d ".git" ]; then
  echo "🗂️  Initialising a new Git repository …"
  git init
fi

git checkout -B main

if ! git remote | grep -q '^origin$'; then
  echo "🔗  Adding remote pointing to the existing GitHub repo …"
  git remote add origin https://github.com/j03jones/jones-ridge-arcade.git
fi

git add .
 git commit -m "Add shared assets, common header/HUD, .gitignore and CI workflow"

echo "🚀  Pushing to GitHub …"
 git push -u origin main

# ------------------------------------------------------------------
# 6️⃣  Final user instructions
# ------------------------------------------------------------------
cat <<'EOF'

✅  All local changes have been committed and pushed.

🛠️  Next steps (manual, because the sandbox cannot reach the internet):

1️⃣  **Add Cloudflare secrets** to the repository:
   - GitHub → Settings → Secrets and variables → Actions → New repository secret
   - Create secret `CF_API_TOKEN` with your Cloudflare API token (Edit Workers + DNS)
   - Create secret `CF_ZONE_ID` with the Zone ID for `jonesridgekitchen.com`

2️⃣  **Verify the GitHub Actions run**:
   - Open the *Actions* tab of the repo.
   - You should see the workflow `Deploy Arcade to Cloudflare` triggered on the push you just made.
   - It will run `setup-arcade.sh` and then `wrangler publish`.

3️⃣  **Ensure a Workers route** exists that points the domain
   `arcade.jonesridgekitchen.com/*` to the Worker you just published.
   - Cloudflare dashboard → Workers → Routes → add `arcade.jonesridgekitchen.com/*`.

4️⃣  **Visit the site**:
   https://arcade.jonesridgekitchen.com
   You should now see the unified header, dark‑mode toggle, HUD and all games sharing the same CSS/JS.

That’s it! 🎉 If you add new games later, just drop a folder with an `index.html`; the shared assets will be included automatically.

Happy coding! 🚀

EOF
