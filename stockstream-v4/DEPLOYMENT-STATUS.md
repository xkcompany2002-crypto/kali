# XK StockStream deployment status

## Verified locally in this work session
- `node --check server.js` passed.
- The inline JavaScript in `public/index.html` passed `node --check`.
- The dashboard source contains no hard-coded Finnhub credential.
- Static smoke tests using mocked dependency modules passed: `/api/health` returned JSON; an invalid ticker returned HTTP 400; with no server key, `/api/research?symbol=NVDA` returned HTTP 503 and an explicit setup message; `/core-instructions.html` returned HTTP 200.
- `unzip -t XK-StockStream-Qwen-Ready.zip` passed for the packaged source at time of validation.

## Not yet verified
- npm installation could not complete in the build environment due a network timeout, so live Express/WebSocket runtime dependencies were not installed here.
- No real Finnhub request was made with a user's API key.
- The site has not been published to a public web URL.
- Qwen has not yet been tested against a deployed `/api/research` endpoint.

## Deployment blockers
1. The existing Render integration reported HTTP 402 when attempting to create a hosting resource: payment information is required. Add billing details in the Render dashboard if you want to deploy through that account.
2. Before managing Render resources, confirm which Render workspace should be used. The available workspace shown by the connection is called `My Workspace`; this must be explicitly confirmed before creating or listing resources.
3. After deploying, set the rotated Finnhub credential as a server-side secret named `FINNHUB_API_KEY`.
4. Replace `REPLACE-WITH-YOUR-DEPLOYED-SITE-URL` in `prompts/XK-WEB-RESEARCH-CONTROLLER-QWEN-v02.txt` with the real HTTPS URL, then paste the controller into Qwen custom instructions.
5. Test these public URLs after deployment: `/api/health`, `/core-instructions.html`, and `/api/research?symbol=NVDA`.

## Security
The Finnhub token embedded in the originally uploaded HTML must be considered exposed and revoked/rotated. Do not commit API keys or `.env` files. A publicly accessible research endpoint also needs authentication/quotas/monitoring before commercial use.


## v04 follow-up (2026-10-18)
- Added Qwen Controller/Core v04 and explicit deployment/customization steps.
- Added `deploy-to-vercel.bat` to authenticate and run `npx vercel deploy --prod`.
- Updated `public/core-instructions.html` to show the v04 Core methodology and the same-origin `/api/research` endpoint.
- Re-ran `npm run check` and ZIP integrity checks successfully.
- Tried dependency installation in this environment, but npm timed out before completion, so live runtime/API testing remains unavailable here.
- No real Vercel domain was generated in this session; do not put a guessed domain into Qwen. After deployment, replace `CORE_PAGE_URL` with the exact URL printed by Vercel.
