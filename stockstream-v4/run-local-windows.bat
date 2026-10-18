@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 or newer is required. Install it from https://nodejs.org/ and retry.
  pause
  exit /b 1
)
if not exist node_modules\ (
  echo Installing application dependencies...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo Dependency installation failed. Check your internet connection and retry.
    pause
    exit /b 1
  )
)
echo.
echo The Finnhub key will be requested with hidden input and will not be saved to a file.
echo Use a rotated key. The key shown in your original HTML must be revoked.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$secure = Read-Host 'Enter rotated Finnhub API key (hidden)' -AsSecureString; $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure); try { $env:FINNHUB_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr); Start-Process 'http://localhost:3000'; node server.js } finally { $env:FINNHUB_API_KEY = $null; [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }"
if errorlevel 1 (
  echo The server exited with an error.
  pause
)
