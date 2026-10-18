# Acceptance tests

1. `node --check server.js` passes.
2. `npm start` with FINNHUB_API_KEY unset: `/api/health` says market provider is not configured, and `/api/research?symbol=NVDA` returns an explicit 503 setup error without exposing a token.
3. Configure a rotated key locally (never commit it). `/api/research?symbol=NVDA` returns valid JSON or a clear provider error.
4. Browser DevTools page source contains no Finnhub token and no `token=` URL.
5. UI requests `/api/v1/quote?symbol=...`, not Finnhub directly.
6. WebSocket connects to same-origin `/ws`, and the server uses the token to connect upstream.
7. Test malformed symbols, unknown symbols, missing key and provider rate-limit errors.
8. In Qwen, verify the exact deployed `/api/research?symbol=NVDA` URL is actually opened and the JSON values are cited faithfully.
