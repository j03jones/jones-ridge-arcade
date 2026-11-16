#!/usr/bin/env bash
    set -euo pipefail

    # -------------------------------------------------
    # 1️⃣ Clean up any old Wrangler v1 leftovers
    # -------------------------------------------------
    echo "🧹 Removing old Wrangler binary (if it exists)…"
    rm -f "$HOME/.nvm/versions/node/v22.23.5/bin/wrangler" || true

    echo "🔧 Uninstalling deprecated @cloudflare/wrangler package…"
    npm uninstall -g @cloudflare/wrangler || true

    # -------------------------------------------------
    # 2️⃣ Install the current Wrangler (v2)
    # -------------------------------------------------
    echo "📦 Installing latest Wrangler (v2)…"
    npm install -g wrangler || {
      echo "⚠️ npm install failed – you may need sudo:"
      echo "    sudo npm install -g wrangler"
      exit 1
    }

    # -------------------------------------------------
    # 3️⃣ Verify the install
    # -------------------------------------------------
    WRANGLER_VER=$(wrangler --version)
    echo "✅ Wrangler installed: $WRANGLER_VER"

    # -------------------------------------------------
    # 4️⃣ Log in to Cloudflare (opens a browser)
    # -------------------------------------------------
    echo "🔐 Logging into Cloudflare – a browser window will open."
    wrangler login

    # -------------------------------------------------
    # 5️⃣ Create (or reuse) a KV namespace for scores
    # -------------------------------------------------
    echo "🗂️  Listing existing KV namespaces…"
    wrangler kv:namespace list

    read -rp $'\nIf you already have a KV namespace you want to use, paste its ID here (or press ENTER to
    create a new one): ' KV_ID

    if [[ -z "$KV_ID" ]]; then
      echo "🚀 Creating a new KV namespace called \"arcade-scores\"…"
      KV_CREATE_OUTPUT=$(wrangler kv:namespace create "arcade-scores")
      echo "$KV_CREATE_OUTPUT"
      KV_ID=$(echo "$KV_CREATE_OUTPUT" | grep -i '^id:' | awk '{print $2}')
      echo "✅ New KV ID: $KV_ID"
    else
      echo "📋 Using provided KV ID: $KV_ID"
    fi

    # -------------------------------------------------
    # 6️⃣ Inject the KV ID into wrangler.toml
    # -------------------------------------------------
    WRANGLER_TOML="wrangler.toml"
    if [[ ! -f "$WRANGLER_TOML" ]]; then
      echo "❌ $WRANGLER_TOML not found in the current directory."
      exit 1
    fi

    echo "✏️  Updating $WRANGLER_TOML with the KV ID…"
    sed -i.bak -E "s|id *= *\"[^\"]*\"|id = \"$KV_ID\"|g" "$WRANGLER_TOML"
    echo "✅ $WRANGLER_TOML updated (backup saved as $WRANGLER_TOML.bak)."

    # -------------------------------------------------
    # 7️⃣ Quick local test of the worker
    # -------------------------------------------------
    echo "🤖 Starting local dev server (wrangler dev)…"
    wrangler dev &
    DEV_PID=$!
    sleep 5   # give the dev server a moment to start

    echo -e "\n🔎 Submitting a test score…"
    curl -s -X POST http://127.0.0.1:8787/score \
         -H "Content-Type: application/json" \
         -d '{"game":"pixel-runner","name":"alice","score":1234}' | jq .

    echo -e "\n📊 Fetching the leaderboard for that game…"
    curl -s "http://127.0.0.1:8787/leaderboard?game=pixel-runner" | jq .

    kill $DEV_PID 2>/dev/null || true
    echo -e "\n✅ Local test completed."

    # -------------------------------------------------
    # 8️⃣ Deploy to Cloudflare (optional)
    # -------------------------------------------------
    read -rp $'\nDo you want to publish the worker now? (y/N): ' PUBLISH
    if [[ "$PUBLISH" =~ ^[Yy]$ ]]; then
      echo "🚀 Publishing to Cloudflare…"
      wrangler publish
      echo "✅ Publish finished."
    else
      echo "📦 Skipping publish. Run \"wrangler publish\" later when you’re ready."
    fi

    echo -e "\n🎉 All done! Your arcade now has a working KV‑backed score API."