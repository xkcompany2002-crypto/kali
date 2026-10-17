# Deploying XK-TRADE-BOT

This is a Node.js server with headless Chromium, so it needs a container-capable host. GitHub Pages and other static-only hosts cannot run the research browser.

## Render (Docker)

1. Push the repository to GitHub.
2. In Render, choose **New → Blueprint** and connect the repository; Render will read `render.yaml`. Alternatively create a Web Service from the repository with runtime **Docker** and health-check path `/health`.
3. In the Render service's environment settings, add `TOKEN_HARBOR_API_KEY` and `FINNHUB_API_KEY` as secrets. Never paste either key into source code, `render.yaml`, issues, screenshots, or commits. If a key was shared in a chat or public place, revoke it and generate a new one before deployment. `TOKEN_HARBOR_MODEL` defaults to `deepseek-v4.1-flash:free`; `TOKEN_HARBOR_URL` is optional.
4. Let the first Docker build complete, then check `/health` and open the service URL. Budget enough memory for Chromium (about 1 GB or more is recommended). The free instance may sleep after inactivity or be memory-constrained; a paid instance is more appropriate for dependable production traffic.
5. Verify the selected model with a simple chat and a ticker analysis. Free-route capacity and identifiers can change; the app will show a provider error if a route is unavailable.
6. Conversation history is local to each browser. Images are not stored in the saved history.

The chat starts in demo mode when `TOKEN_HARBOR_API_KEY` is missing. Market-data lookups require a separate `FINNHUB_API_KEY`. A configured key does not guarantee provider quota or model availability; HTTP 402 can indicate insufficient quota or an unavailable route. Live AI responses and public-browser navigation must be verified after deployment before sharing the site widely. Add authentication or another access control before exposing a provider key on a public endpoint; free-model quota can still be exhausted by abuse even when the route is not billed.

## Other container hosts

Use the included `Dockerfile`, set the start command to `npm start` if the platform asks for one, expose `$PORT` (default `3000`), and configure `/health` as the health check. Add the same environment variables through the provider's secret manager.

## Local check

```bash
npm ci
npm test
npm start
```

Without `TOKEN_HARBOR_API_KEY`, the server responds with clearly labeled demo replies. Without `FINNHUB_API_KEY`, market-data lookups cannot query Finnhub. The live browser needs Chromium; Docker installs it automatically.
