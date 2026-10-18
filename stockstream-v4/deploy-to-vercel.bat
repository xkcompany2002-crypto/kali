@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 or newer is required. Install it from https://nodejs.org/ and retry.
  pause
  exit /b 1
)
echo.
echo This will upload StockStream Global to your Vercel account.
echo No Finnhub key is embedded in this project. Add a newly rotated key in Vercel Project Environment Variables after deployment.
echo.
call npx vercel login
if errorlevel 1 (
  echo Vercel login failed. Resolve the sign-in issue and rerun this file.
  pause
  exit /b 1
)
call npx vercel deploy --prod
if errorlevel 1 (
  echo Deployment failed. Review the Vercel CLI error above.
  pause
  exit /b 1
)
echo.
echo Deployment command completed. Copy the production HTTPS URL shown above.
echo Then follow VERCEL-DEPLOYMENT-v04.md to configure FINNHUB_API_KEY and customize Qwen.
pause
