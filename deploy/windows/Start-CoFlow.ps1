$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
Set-Location -LiteralPath $taskRoot
$taskUpdate=Join-Path $taskRoot 'updates\Apply-CoFlowUpdate.ps1'
if (Test-Path -LiteralPath $taskUpdate) { & $taskUpdate }
if (-not (Test-Path -LiteralPath (Join-Path $taskRoot '.env'))) { throw 'Missing .env. Configure the dedicated server database first.' }
# Fail before migrations or service startup when the website port is in use.
$taskConfiguredPort = '3001'
foreach ($taskEnvLine in Get-Content -LiteralPath (Join-Path $taskRoot '.env')) {
    if ($taskEnvLine -match '^\s*PORT\s*=\s*(.*?)\s*$') {
        $taskConfiguredPort = $Matches[1].Trim().Trim('"', "'")
    }
}
if ($env:PORT) { $taskConfiguredPort = $env:PORT }
$taskWebPort = 0
if (-not [int]::TryParse($taskConfiguredPort, [ref]$taskWebPort) -or $taskWebPort -lt 1 -or $taskWebPort -gt 65535) {
    throw 'Invalid PORT in .env. Set a port between 1 and 65535.'
}
$taskListeners = @(Get-NetTCPConnection -State Listen -LocalPort $taskWebPort -ErrorAction SilentlyContinue)
if ($taskListeners.Count -gt 0) {
    $taskPortOwners = @($taskListeners | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
        $taskOwnerProcess = Get-Process -Id $_ -ErrorAction SilentlyContinue
        '{0} (PID {1})' -f $(if ($taskOwnerProcess) { $taskOwnerProcess.ProcessName } else { 'unknown process' }), $_
    })
    throw ('Website port {0} is already in use by {1}. No process was stopped. If CoFlow is already running, use the existing instance. Otherwise choose a free PORT in this deployment folder''s .env, and update APP_ORIGIN when its URL includes this port. Update the tunnel target or LAN access port as needed, then restart.' -f $taskWebPort, ($taskPortOwners -join ', '))
}
if (-not (Test-Path -LiteralPath (Join-Path $taskRoot 'apps\web\dist\index.html'))) { throw 'Missing frontend build. Run pnpm build first.' }
foreach ($taskEdition in @('enterprise','student')) {
    if (-not (Test-Path -LiteralPath (Join-Path $taskRoot ('apps\web\dist\' + $taskEdition + '\index.html')))) { throw ('Missing ' + $taskEdition + ' frontend build. Rebuild the complete v3 package.') }
}
if (-not (Test-Path -LiteralPath (Join-Path $taskRoot 'apps\api\dist\main.js'))) { throw 'Missing API build. Run pnpm build first.' }
$taskNode = Join-Path $taskRoot 'runtime\node.exe'
if (-not (Test-Path -LiteralPath $taskNode)) { throw 'Bundled Node runtime is missing.' }
$taskPg = Join-Path $taskRoot 'runtime\postgres\bin\pg_ctl.exe'
$taskData = Join-Path $taskRoot '.data\postgres'
& $taskPg -D $taskData status *> $null
if ($LASTEXITCODE -ne 0) {
    & $taskPg -D $taskData -l (Join-Path $taskRoot '.data\postgres.log') -w start
    if ($LASTEXITCODE -ne 0) { throw 'Cannot start the dedicated PostgreSQL instance; inspect .data\postgres.log.' }
}
& $taskNode (Join-Path $taskRoot 'node_modules\prisma\build\index.js') migrate deploy --schema (Join-Path $taskRoot 'prisma\schema.prisma')
if ($LASTEXITCODE -ne 0) { throw 'Database migration failed. Existing data is preserved; inspect output.' }
& $taskNode (Join-Path $taskRoot 'apps\api\dist\main.js')
exit $LASTEXITCODE
