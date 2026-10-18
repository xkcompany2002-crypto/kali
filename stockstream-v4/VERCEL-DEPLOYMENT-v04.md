# Deploy StockStream Global to Vercel

## What the app provides
- Arabic dashboard: market heatmap, global screener, watchlist/live tab.
- Server-side Finnhub REST endpoints: `/api/v1/quote?symbol=NVDA` and `/api/research?symbol=NVDA`.
- Core instruction page: `/core-instructions.html`.
- Optional WebSocket relay at `/ws` for deployments where Vercel WebSocket support is enabled. The UI includes a REST polling fallback; quote freshness depends on Finnhub entitlements.

## Recommended: deploy from this directory with the Vercel CLI
1. Install Node.js 20+ from https://nodejs.org/.
2. Open PowerShell in the extracted project folder.
3. Run `npx vercel login` and complete the browser authentication.
4. Run `npx vercel deploy --prod`. On first use the CLI will ask you to link or create a project. Give it a clear name such as `xk-stockstream-global` if available.
5. Copy the real production HTTPS URL from the CLI output. Do not assume a domain until Vercel prints or displays it.
6. In Vercel Dashboard → Project → Settings → Environment Variables, add `FINNHUB_API_KEY` for Production (and Preview if desired) using a newly rotated Finnhub key. Save, then redeploy production.
7. Test `/api/health`, `/core-instructions.html`, `/api/v1/quote?symbol=NVDA`, and `/api/research?symbol=NVDA` on that exact origin.
8. Edit `prompts/XK-WEB-RESEARCH-CONTROLLER-QWEN-v04.txt` and replace `CORE_PAGE_URL` with `<REAL_SITE_ORIGIN>/core-instructions.html`, then paste the instructions into Qwen's custom instructions.

## Verify API output
- `marketProviderConfigured` should be `true` at `/api/health` after configuring the environment variable.
- `/api/research?symbol=NVDA` should return JSON with ticker `NVDA`, retrieved_at, quote, company_profile, news, sources, missing_fields, and data_delay_note.
- A missing/invalid key or a provider restriction should produce an explicit error, not fake market data.

## Important constraints
- The original user-provided HTML contained a Finnhub token. Treat that token as exposed and revoke/rotate it; this project intentionally does not contain it.
- The current tool session did not expose an actionable Vercel deployment operation, so the files have not been published from this session. Deploy with the CLI steps above, or connect the project through the Vercel dashboard.
- Web pages/Widgets are not a substitute for the machine-readable JSON endpoint.
- The public JSON API is unauthenticated in this prototype. Add authentication, quotas, abuse monitoring, and billing controls before selling this as a paid multi-user service.
- This project is research only and does not place trades or provide personalized investment advice.
