$ErrorActionPreference = 'Stop'
$base = Split-Path -Parent $MyInvocation.MyCommand.Path
$template = Join-Path $base 'prompts\XK-WEB-RESEARCH-CONTROLLER-QWEN-v04.txt'
$output = Join-Path $base 'QWEN-CUSTOM-INSTRUCTIONS-FINAL.txt'
if (!(Test-Path $template)) { throw "Controller template not found: $template" }

Write-Host ''
Write-Host 'XK-TRADE-BOT — Qwen Controller Setup' -ForegroundColor Cyan
Write-Host 'Paste the exact Production URL printed by Vercel after deployment.'
Write-Host 'Example format: https://your-real-project.vercel.app'
$origin = (Read-Host 'Vercel Production URL').Trim().TrimEnd('/')
$uri = $null
if (![Uri]::TryCreate($origin, [UriKind]::Absolute, [ref]$uri)) { throw 'Invalid URL.' }
if ($uri.Scheme -ne 'https' -or $uri.AbsolutePath -ne '/' -or $uri.Query -or $uri.Fragment) {
  throw 'Use only the HTTPS site origin, without a path, query, or fragment.'
}

$text = Get-Content -LiteralPath $template -Raw -Encoding UTF8
$text = $text.Replace('CORE_PAGE_URL = REPLACE_WITH_THE_REAL_HTTPS_CORE_PAGE_URL_AFTER_DEPLOYMENT', "CORE_PAGE_URL = $origin/core-instructions.html")
$text = $text.Replace('REPLACE_WITH_THE_REAL_HTTPS_ORIGIN_PRINTED_BY_VERCEL_AFTER_DEPLOYMENT', $origin)
Set-Content -LiteralPath $output -Value $text -Encoding UTF8
Write-Host ''
Write-Host "Created: $output" -ForegroundColor Green
Write-Host 'Now paste the entire QWEN-CUSTOM-INSTRUCTIONS-FINAL.txt into Qwen custom instructions.'
Write-Host 'This script stores no API keys.'
