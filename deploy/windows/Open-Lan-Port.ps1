$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$taskEnv=Join-Path $taskRoot '.env'
if (-not (Test-Path -LiteralPath $taskEnv)) { throw 'Initialize CoFlow first.' }
$taskPortLine=Get-Content -LiteralPath $taskEnv | Where-Object { $_ -match '^PORT=\d+$' } | Select-Object -First 1
if (-not $taskPortLine) { throw 'No valid CoFlow PORT in .env.' }
$taskPort=[int]($taskPortLine -replace '^PORT=','')
if (-not (Get-NetFirewallRule -Name 'CoFlow-LAN' -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -Name 'CoFlow-LAN' -DisplayName 'CoFlow LAN website' -Direction Inbound -Protocol TCP -LocalPort $taskPort -RemoteAddress LocalSubnet -Program (Join-Path $taskRoot 'runtime\node.exe') -Action Allow | Out-Null
}
Write-Host "CoFlow LAN port $taskPort configured."
