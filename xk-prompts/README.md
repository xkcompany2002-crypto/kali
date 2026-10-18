# XK-TRADE-BOT Prompt Pack — v01

## Files
- `XK-WEB-RESEARCH-CONTROLLER-QWEN-v01.txt`: paste into Qwen Chat custom instructions.
- `XK-TRADE-BOT-CORE-v01.md`: core research prompt referenced by URL.
- `TEST-CHECKLIST-v01.md`: quick acceptance tests.

## Current core URL
https://raw.githubusercontent.com/xkcompany2002-crypto/kali/build-xk-trade-ai-desktop/xk-prompts/XK-TRADE-BOT-CORE-v01.md

This raw GitHub URL is a temporary public test endpoint on the `build-xk-trade-ai-desktop` branch. It is not hidden or access-controlled. When ready, move the core prompt to a route on the XK Technologies website and update the controller's URL. A page being unlinked from navigation does not make its contents private.

## How to use
1. Open https://chat.qwen.ai/.
2. Paste the controller file into its custom instructions/personalization field if the current account exposes such a feature. If it does not, paste it as the first message in a new chat.
3. Ensure Qwen's web search/browser is enabled.
4. Send `Analyze NVDA using XK-TRADE-BOT.`
5. Confirm the model retrieved the core URL and cites actual source URLs. If it could not access the core URL, it must say so.
6. Run the test cases in the checklist.

## Important limitation
A prompt cannot grant tools or browser access that Qwen Chat does not provide. In particular, arbitrary website extraction can vary by current UI, model, account, and enabled tools. Custom instructions do not guarantee that the core prompt is fetched before each response, or that the model will never reveal it. The prompt pack is a prototype for behavioral testing, not a secure production deployment.

## Stock data disclaimer
This is a research workflow only; it does not place trades and is not individualized financial advice.
