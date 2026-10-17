# XK-TRADE-BOT · Market Lens

A read-only, evidence-led market research assistant with an isolated public-web browser. It combines historical daily price indicators, a transparent directional technical score, recent public-source research, three scenarios, and a limited walk-forward historical check. The browser blocks local/private network destinations, sign-in flows, form submissions, and transaction-like actions. Saved conversations remain in the current browser. It is a research helper, not a broker or trading execution system.

## Requirements

- Node.js 22+
- Chromium (or use the included Docker image)
- `TOKEN_HARBOR_API_KEY` for live AI responses
- `FINNHUB_API_KEY` for market data
- The default model is DeepSeek V4.1 Flash Free (`deepseek-v4.1-flash:free`); Claude Haiku 5.5 Free, DeepSeek V4 Flash Free, and MiMo V2.6 Flash Free remain selectable. Free model identifiers, allowance, and availability can change; confirm the current Token Harbor catalog before relying on a route.

## Run locally

```bash
npm ci
cp .env.example .env
# Add fresh TOKEN_HARBOR_API_KEY and FINNHUB_API_KEY values to .env. Keep them secret.
npm start
```

Open `http://localhost:3000`. Without TOKEN_HARBOR_API_KEY, the chat uses clearly labeled demo responses. Without FINNHUB_API_KEY, ticker market-data lookups will explain that Finnhub is not configured. The isolated browser starts on demand and needs a working Chromium binary.

## Test

```bash
npm test
node --check server.js
node --check browser.js
node --check network-proxy.js
node --check public/app.js
node --check public/browser-view.js
```

## Deploy

Use a container-capable Node host (for example, Render Web Service with Docker, Railway, Fly.io, Koyeb, or a VPS). GitHub Pages/static hosting is not sufficient because browser automation needs a Node server and Chromium. Configure `/health` as the health-check path and set both `TOKEN_HARBOR_API_KEY` and `FINNHUB_API_KEY` in the host's secret/environment settings—not in source files. See [DEPLOY.md](DEPLOY.md).

## Evidence score and historical check

- The technical score is a deterministic, weighted heuristic from -100 (bearish) to +100 (bullish), based on moving-average structure, 5/20/60-session momentum, RSI14, and relative volume. It is not a probability of success.
- A separate 5-session walk-forward check calculates a historical directional hit rate using only bars available at each signal date. It reports the observation count and a sample-quality label. One year of data is limited; the metric ignores fees, spread, slippage, taxes, market regime changes and survivorship, and must not be described as future accuracy.
- The app intentionally does not promise 91% accuracy. That claim would require strong, independently repeatable out-of-sample tests across many symbols and time periods.
- AI-generated conclusions must include confirmed evidence, links and timestamps when available; bullish, sideways and bearish scenarios; invalidation conditions; missing data; and a watch/wait/insufficient-evidence stance.

## Privacy and public deployment

- When a live API key is configured, chat text and attached images are sent to the configured Token Harbor-compatible endpoint and processed by the selected model provider. Review the provider terms before enabling live mode.
- The included Render Blueprint prompts for `TOKEN_HARBOR_API_KEY` and `FINNHUB_API_KEY` as secrets; never commit them. A deployment without the secret starts in demo mode. Free routes avoid usage billing according to Token Harbor, but an unrestricted public app can still exhaust its shared free allowance, so add access controls and monitoring before wider launch.
- Conversation history is stored in localStorage in the current browser, not on the server; images are intentionally excluded from saved history. Clearing browser data will remove it. This is not an authenticated private workspace.
- Browser sessions are temporary and public browsing is restricted to read-only access to public HTTPS pages.

## Important limits

- Live model output depends on Token Harbor credentials, available quota, and model availability.
- Public browsing is read-only by design; sites that require login, challenge pages, or block automated access may not work.
- No trading, order placement, account modification, or payment execution is provided.
- Saved conversations are local to the device/browser and are not synchronized across devices. For multi-device or team use, add authentication and encrypted server-side storage. The current browser-local history is not an account-level workspace. Browser sessions are capped per server process, and the service should be deployed with enough memory for Chromium.
