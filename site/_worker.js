// Jones Ridge Arcade — shared scoreboard for Cloudflare Pages (advanced mode).
// Serves the site's files as normal and adds one API route per game:
//   GET  /api/scores/<game>            -> that game's all-time top 10 as JSON
//   GET  /api/scores/<game>?board=week -> this week's top 10 (weeks start Monday, UTC)
//   POST /api/scores/<game>            -> { name, score, level } ; returns the updated all-time top 10
//   POST /api/scores/<game>?v=2        -> returns { all, week, rank: { all, week } } (rank is 1-10, or 0 if not on the board)
// Requires a KV namespace bound to this Pages project with the variable name SCORES.
//
// To add a game: put it in its own folder (e.g. /newgame/index.html), add an entry
// to GAMES below, and have the game fetch /api/scores/newgame.

const GAMES = {
  // Boing Breaker keeps the original 'top10' key so its existing scores carry over.
  boing: { key: 'top10', maxScore: 5000000 },
  hop:   { key: 'top10:hop', maxScore: 2000000 },
  nova:  { key: 'top10:nova', maxScore: 9000000 },
  pin:   { key: 'top10:pin', maxScore: 500000000 },
  rush:  { key: 'top10:rush', maxScore: 20000000 },
};

const MAX_ENTRIES = 10;
const POSTS_PER_WINDOW = 6;      // per IP address, per game
const WINDOW_SECONDS = 600;      // 10 minutes
const WEEK_TTL = 60 * 60 * 24 * 15; // weekly boards delete themselves after ~2 weeks

// Key for the current week's board, e.g. "week:hop:2026-11-09" (the Monday that starts the week).
function weekKey(gameId, now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return 'week:' + gameId + ':' + d.toISOString().slice(0, 10);
}
function addToBoard(board, entry) {
  board.push(entry);
  board.sort((a, b) => b.score - a.score || String(a.date).localeCompare(String(b.date)));
  const top = board.slice(0, MAX_ENTRIES);
  return { top, rank: top.indexOf(entry) + 1 };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

async function loadBoard(env, key) {
  try {
    const list = await env.SCORES.get(key, 'json');
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

async function handleScores(request, env, gameId) {
  const game = GAMES[gameId];
  if (!game) return json({ error: 'Unknown game' }, 404);
  if (!env.SCORES) return json({ error: 'Scoreboard storage is not connected (missing SCORES binding).' }, 503);

  const url = new URL(request.url);
  if (request.method === 'GET') return json(await loadBoard(env, url.searchParams.get('board') === 'week' ? weekKey(gameId) : game.key));

  if (request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'Invalid JSON' }, 400); }

    const name = String(body.name || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
    const score = Math.floor(Number(body.score));
    const level = Math.floor(Number(body.level));
    if (!name || !Number.isFinite(score) || score <= 0 || score > game.maxScore ||
        !Number.isFinite(level) || level < 1 || level > 999) {
      return json({ error: 'Invalid score' }, 400);
    }

    // Light rate limit so one connection can't flood a board.
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const rlKey = 'rl:' + gameId + ':' + ip;
    const count = parseInt((await env.SCORES.get(rlKey)) || '0', 10);
    if (count >= POSTS_PER_WINDOW) return json({ error: 'Too many submissions' }, 429);
    await env.SCORES.put(rlKey, String(count + 1), { expirationTtl: WINDOW_SECONDS });

    const date = new Date().toISOString().slice(0, 10);
    const all = addToBoard(await loadBoard(env, game.key), { name, score, level, date });
    const wk = weekKey(gameId);
    const week = addToBoard(await loadBoard(env, wk), { name, score, level, date });
    if (all.rank) await env.SCORES.put(game.key, JSON.stringify(all.top));
    if (week.rank) await env.SCORES.put(wk, JSON.stringify(week.top), { expirationTtl: WEEK_TTL });
    if (url.searchParams.get('v') === '2') return json({ all: all.top, week: week.top, rank: { all: all.rank, week: week.rank } });
    return json(all.top);
  }

  return json({ error: 'Method not allowed' }, 405);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Old address of the scoreboard (Boing Breaker before the arcade menu).
    if (path === '/api/scores') return handleScores(request, env, 'boing');

    const m = path.match(/^\/api\/scores\/([a-z0-9-]+)\/?$/);
    if (m) return handleScores(request, env, m[1]);

    // Any other /api/ path is not a page.
    if (path.startsWith('/api/')) return json({ error: 'Not found' }, 404);

    return env.ASSETS.fetch(request);
  },
};
