# XK-TRADE-BOT Evidence Edition — upgrade notes

## What changed

- Added a transparent technical evidence score from -100 to +100 based on moving-average structure, 5/20/60-session momentum, RSI14 and relative volume.
- Added a five-session rolling walk-forward historical directional check with hit rate, count, recent observations and explicit limitations.
- Strengthened the analyst instructions: fetch historical market data before ticker forecasts, verify time-sensitive news through public sources, cite only observed source URLs, compare bullish/base/bearish scenarios, state invalidation conditions, and never invent a 91% success claim.
- Updated the selectable model list to Claude Haiku 5.5 Free (default), DeepSeek V4.1 Flash Free, MiMo V2.6 Flash Free and DeepSeek V4 Flash Free. Token Harbor currently positions Claude Haiku 5.5 as the strongest general option and DeepSeek V4.1 Flash for tool-driven agent tasks; availability and free allowances can change.
- Added browser-local conversation history with restore, per-conversation delete, delete-all, and a mobile history drawer. Images are not written to conversation history.
- Improved Markdown rendering for headings, bold/italic text, ordered/unordered lists, links, blockquotes and tables without inserting model output as HTML.
- Loaded `.env` using a small built-in parser so the documented local setup works without an extra dependency; hosting environment values take precedence.
- Reduced response temperature to encourage more consistent evidence synthesis.
- Added browser-local persistence for model choice, and fixed initial model selection to respect the server default.
- Raised per-process browser-session and concurrent-chat limits modestly to reduce cross-user interference while retaining explicit resource ceilings.
- Made Playwright a guarded import so health checks and demo mode can start in constrained test environments; production Docker still installs Playwright Core and Chromium.
- Updated Render Blueprint defaults for Frankfurt, the free plan, health checking, auto-deploy, and a secret prompt for `TOKEN_HARBOR_API_KEY`.

## Accuracy expectations

The score is a heuristic, not a probability. The historical check is a small diagnostic, not a promise of future accuracy. It ignores fees, spreads, slippage, taxes, market regime changes, corporate actions and many real-world execution details. A claimed 91% predictive success rate would require extensive repeatable out-of-sample validation across many instruments and time periods. This project does not claim that accuracy.

## Configure the model key safely

The API key is read from `TOKEN_HARBOR_API_KEY`. Do not hard-code a key in source, include it in a ZIP, or commit it to Git. Any key shared in a conversation should be revoked and replaced before use. Set the replacement through the host's secret manager or in a private local `.env` file.

## Conversation storage

Conversation history lives only in `localStorage` in the current browser. It is not encrypted or synchronized and is not available across devices. User-attached images are intentionally excluded. Anyone with access to the same browser profile can access these saved text conversations; clear them on shared devices.

## Verification notes

Run `npm ci` and `npm test`; this environment verified all 19 tests with `npm test`. The local test pass during the current build ran without the `playwright-core` package because package registry access timed out; the guarded import allows app health/demo mode to start, but this does not validate actual browser automation. It validates server routes, analytical calculations and static UI integrity, but does not validate a real Chromium install, live Token Harbor credentials, real market-data network access, or an actual hosted deployment.
