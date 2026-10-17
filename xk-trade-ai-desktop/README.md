# XK Trade AI for Windows

Desktop Electron application with Arabic UI:
- Finnhub quote, company profile and recent news.
- DeepSeek V4.1 Flash via Token Harbor's OpenAI-compatible Chat Completions API.
- Arabic market commentary with customizable analysis style and instructions.
- API keys are stored encrypted locally through Electron safeStorage; never committed in source.

## Run locally
Install Node.js 22 or later, open this directory in PowerShell, then run:
```powershell
npm install
npm start
```

## Build Windows installer
```powershell
npm run build:win
```
Installer and portable EXE files are written to `release`.

## Credentials
The first launch opens Settings. Enter Finnhub and Token Harbor keys separately. Keys are not embedded in source or EXE because anyone could extract them. Saved keys are encrypted locally on Windows.

Token Harbor endpoint: https://tokenharbor.ai/v1/chat/completions
Model ID: `deepseek-v4.1-flash:free`
Finnhub API base: https://finnhub.io/api/v1

Analysis is informational only and does not place trades or constitute investment advice.
