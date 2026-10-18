XK-TRADE-BOT v04 — Qwen + StockStream setup

DEPLOY FIRST
1. Run deploy-to-vercel.bat from this directory, or follow VERCEL-DEPLOYMENT-v04.md.
2. In Vercel project settings, add FINNHUB_API_KEY as a Production and Preview environment variable using a newly rotated Finnhub credential. Do not reuse the token from the original HTML; it must be revoked/rotated because it appeared in browser source.
3. Redeploy after setting the environment variable.
4. Copy the real production URL printed by Vercel. Confirm that these endpoints work:
   <SITE_ORIGIN>/api/health
   <SITE_ORIGIN>/core-instructions.html
   <SITE_ORIGIN>/api/research?symbol=NVDA
5. If /api/research returns 503, FINNHUB_API_KEY is not configured. If it returns a provider error, check credential validity and Finnhub plan/entitlements.

CUSTOMIZE QWEN
6. Open prompts/XK-WEB-RESEARCH-CONTROLLER-QWEN-v04.txt. Replace CORE_PAGE_URL with the exact deployed URL <SITE_ORIGIN>/core-instructions.html.
7. Copy the full Controller text into Qwen Chat custom instructions, or send it as the first message if custom instructions are unavailable. Enable web search/browser tools if available.
8. Ask: “Analyze NVDA using XK-TRADE-BOT. Open the Core instructions first, then retrieve the documented StockStream JSON endpoint, verify timestamps and sources, search for recent official news, and produce the full report.”

ACCEPTANCE TESTS
- /api/health returns JSON.
- /core-instructions.html loads and links to /api/research?symbol=NVDA.
- /api/research?symbol=NVDA returns JSON with quote/source/timestamp fields or an explicit useful error.
- Qwen actually opens the Core page and JSON endpoint and cites the returned source URLs. If it cannot access them, it must say so.

Never paste a Finnhub API key into Qwen custom instructions, HTML, public GitHub, or the Controller prompt.
