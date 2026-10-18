# XK StockStream Vercel deployment linkage

Use the Vercel CLI from the root of the downloaded XK-StockStream-Qwen-Ready-v3.zip project:
1. npx vercel login
2. npx vercel deploy --prod
3. Copy the real production HTTPS URL printed by the CLI.
4. In Vercel Project Settings > Environment Variables, set FINNHUB_API_KEY to a newly rotated Finnhub key. Save and redeploy.
5. Replace STOCKSTREAM PRODUCTION ORIGIN in the Qwen Controller with that actual origin and set CORE INSTRUCTIONS URL to <origin>/core-instructions.html.
6. Test <origin>/api/health, <origin>/core-instructions.html, and <origin>/api/research?symbol=NVDA before using it in Qwen.

No production domain has been generated yet. Do not treat a guessed vercel.app URL as a working link.
