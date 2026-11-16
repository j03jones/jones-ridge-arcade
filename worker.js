// Cloudflare Workers script for arcade score handling
// Uses the KV binding named "SCORES" (defined in wrangler.toml)

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method.toUpperCase();

    // CORS headers – allow requests from your arcade site
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // Handle preflight requests
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (pathname === "/score" && method === "POST") {
      // Expect JSON: { game, name, score }
      let payload;
      try {
        payload = await request.json();
      } catch (e) {
        return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } });
      }

      const { game, name, score } = payload;
      if (!game || !name || typeof score !== "number") {
        return new Response(JSON.stringify({ error: "Missing or invalid fields" }), { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } });
      }

      // Build a composite key: game:name
      const kvKey = `${game}:${name}`;
      // Store the score as a string (KV only stores strings)
      await env.SCORES.put(kvKey, String(score));

      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    if (pathname === "/leaderboard" && method === "GET") {
      const game = url.searchParams.get("game");
      if (!game) {
        return new Response(JSON.stringify({ error: "Missing 'game' query param" }), { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } });
      }

      // List all keys for this game (KV does not have prefix listing, so we fetch all keys and filter).
      // For a low‑traffic personal arcade this is acceptable.
      const listResponse = await env.SCORES.list();
      const entries = [];
      for (const key of listResponse.keys) {
        if (key.name.startsWith(`${game}:`)) {
          const [, player] = key.name.split(":");
          const scoreStr = await env.SCORES.get(key.name);
          const score = Number(scoreStr);
          if (!isNaN(score)) {
            entries.push({ name: player, score });
          }
        }
      }
      // Sort descending by score and keep top 10
      entries.sort((a, b) => b.score - a.score);
      const top = entries.slice(0, 10);
      return new Response(JSON.stringify(top), { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    // Default 404
    return new Response("Not found", { status: 404, headers: corsHeaders });
  },
};
