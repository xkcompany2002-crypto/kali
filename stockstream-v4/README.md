# StockStream Global — Qwen-ready deployment bundle

This bundle adapts the user's original HTML dashboard into a website with a machine-readable Finnhub endpoint suitable for the XK Web Research Controller.

## What changed
- Preserved the Arabic dashboard and TradingView widgets.
- Removed the Finnhub API key from browser JavaScript.
- Added a Node/Express backend with a server-side `FINNHUB_API_KEY`.
- Added `GET /api/research?symbol=NVDA`, returning JSON with quote, profile, news, daily candles, sources, retrieval timestamp and missing-data markers.
- Added `GET /api/v1/quote?symbol=NVDA` to keep the current dashboard API calls working.
- Added a WebSocket relay at `/ws`, so the Finnhub token is not sent to visitors' browsers.
- Made fallback polling rotate through symbols and reduced its frequency.
- Added controller/core prompt templates that include the new JSON endpoint.

## Security note about the original upload
The original pasted HTML contains a Finnhub credential directly in JavaScript. Treat it as exposed and rotate/revoke that token in Finnhub. This bundle deliberately does not copy it. Set only a rotated key as the server environment variable `FINNHUB_API_KEY`.

## Run locally
On Windows, double-click `run-local-windows.bat`. It prompts for a rotated Finnhub key using hidden input and does not save the key to a file. The browser opens at `http://localhost:3000`. Qwen cannot access your localhost URL; public Qwen testing requires a deployed HTTPS URL.

Alternatively, install Node.js 20 or newer:
```sh
npm install
```
Set a server environment variable:
- Windows PowerShell: `$env:FINNHUB_API_KEY="YOUR_ROTATED_KEY"; npm start`
- macOS/Linux: `FINNHUB_API_KEY="YOUR_ROTATED_KEY" npm start`

Open:
- Dashboard: http://localhost:3000
- Browser-readable core instructions: http://localhost:3000/core-instructions.html
- Health check: http://localhost:3000/api/health
- Qwen-readable JSON: http://localhost:3000/api/research?symbol=NVDA

A valid `/api/research` response can include:
- `quote`
- `company_profile`
- `news`
- `daily_candles`
- `sources`
- `retrieved_at`
- `missing_fields`
- `data_delay_note`

## Deploy
Deploy as a Node web service (not a static site):
- Build/install command: `npm install`
- Start command: `npm start`
- Runtime environment variable: `FINNHUB_API_KEY` (use the rotated token)
- Node version: 20+

After deployment, copy the actual site URL into both prompt templates under `prompts/`. Then paste the controller text into Qwen's custom instructions. Qwen must have an actual web/browser tool that can open the JSON endpoint; otherwise use a backend agent or a tool/API integration.

## Important limitations
- I have not deployed this site or tested live credentials in the actual user's Finnhub account.
- Finnhub coverage, quote freshness, historical candles and websocket trades depend on the user's plan and entitlements.
- Public JSON endpoints can be called by other users; this bundle applies a simple per-IP rate limiter, but it is not a full commercial abuse-prevention system. Add authentication, quotas, monitoring and stricter limits before a public paid release.
- TradingView widgets are display widgets. Their iframe content isn't the same as a first-party JSON API endpoint; use `/api/research` for machine-readable evidence.

Research only; this app does not place trades or provide individualized investment advice.


See `DEPLOYMENT-STATUS.md` for exact verification results and the remaining hosting blockers.


## Vercel deployment and Qwen customization
Read `VERCEL-DEPLOYMENT-v04.md` or run `deploy-to-vercel.bat` on Windows. After Vercel prints the actual production URL, add the server-side `FINNHUB_API_KEY` environment variable (using a rotated token), redeploy, test the health and research endpoints, then put the real `/core-instructions.html` URL in `prompts/XK-WEB-RESEARCH-CONTROLLER-QWEN-v04.txt` before pasting it into Qwen custom instructions. The Vercel domain is intentionally not guessed in this source package.


## Finalize Qwen custom instructions
After you deploy and copy the actual Vercel production URL, run `configure-qwen-controller.ps1` in PowerShell. It will create `QWEN-CUSTOM-INSTRUCTIONS-FINAL.txt` with your exact `https://<real-host>/core-instructions.html` and `/api/research?symbol={TICKER}` origin reference. Paste that generated file into Qwen custom instructions. The script does not ask for or save any API keys.
