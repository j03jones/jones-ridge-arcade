# Jones Ridge Arcade

Browser arcade (Boing Breaker, Hop, Nova, Pinball, Rush) with a shared scoreboard.

- `site/` is the whole website. `site/_worker.js` serves it and adds the `/api/scores/<game>` routes (Cloudflare Pages advanced mode, KV binding `SCORES`).
- Every push to `main` that touches `site/` deploys to Cloudflare Pages via `.github/workflows/deploy.yml`.

## One-time setup (GitHub → Settings → Secrets and variables → Actions)

| Kind | Name | Value |
|---|---|---|
| Secret | `CLOUDFLARE_API_TOKEN` | Cloudflare API token with **Account → Cloudflare Pages → Edit** |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |
| Variable | `CF_PAGES_PROJECT` | The existing Pages project name |

To add a game: put it in `site/<game>/index.html`, add it to `GAMES` in `site/_worker.js`, and link it from `site/index.html`.
