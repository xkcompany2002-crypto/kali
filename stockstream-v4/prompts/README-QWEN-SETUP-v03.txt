XK-TRADE-BOT v03 — Qwen setup

1) Deploy the StockStream Node app to a public HTTPS host. Render creation in the linked workspace previously failed because billing details were required, so no live site URL exists yet.
2) Set FINNHUB_API_KEY as a server-side environment secret using a newly rotated Finnhub credential. Do not use or commit the token from the original HTML upload; it must be treated as exposed.
3) Test these URLs on the deployed site:
   /api/health
   /core-instructions.html
   /api/research?symbol=NVDA
4) In XK-WEB-RESEARCH-CONTROLLER-QWEN-v03.txt, replace STOCKSTREAM SITE ORIGIN with the real HTTPS origin, and change the Core Instructions link to https://YOUR-REAL-HOST/core-instructions.html.
5) Paste the full Controller text into Qwen Chat custom instructions. Ensure Qwen's web search/extraction tools are actually available.
6) Ask: "Analyze NVDA using XK-TRADE-BOT. Open the Core instructions first, retrieve /api/research?symbol=NVDA, validate its timestamps and source links, then produce the report."
7) Acceptance tests are in TESTS.md.

Current state: Vercel-compatible REST routes and WebSocket entrypoint are included in this version; deployment and live Finnhub credential validation still need to happen. The site is NOT publicly deployed yet.
