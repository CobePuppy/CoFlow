$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$taskRoot=[IO.Path]::GetFullPath($PSScriptRoot)
if ((Test-Path -LiteralPath (Join-Path $taskRoot '.env')) -or (Test-Path -LiteralPath (Join-Path $taskRoot '.data\postgres'))) { throw 'CoFlow is already initialized or contains a database. Use deploy\windows\Start-CoFlow.cmd; do not delete existing data.' }
$taskZip=Join-Path $taskRoot 'CoFlow-server-20261016.zip'
$taskExpected=(Get-Content -LiteralPath ($taskZip+'.sha256') -Raw).Trim()
if ((Get-FileHash -LiteralPath $taskZip -Algorithm SHA256).Hash -ne $taskExpected) { throw 'Package checksum mismatch. Do not continue.' }
Write-Host 'Package verified. Extracting bundled runtime and application...'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$taskReadZip=[IO.Compression.ZipFile]::OpenRead($taskZip)
try {
    foreach ($taskEntry in $taskReadZip.Entries) {
        $taskResolved=[IO.Path]::GetFullPath((Join-Path $taskRoot $taskEntry.FullName))
        if (-not $taskResolved.StartsWith($taskRoot+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid archive entry.' }
    }
} finally { $taskReadZip.Dispose() }
Expand-Archive -LiteralPath $taskZip -DestinationPath $taskRoot -Force
$taskFiles=Get-Content -LiteralPath (Join-Path $taskRoot 'deployment-manifest.json') -Encoding UTF8 -Raw | ConvertFrom-Json
$taskCount=0
foreach ($taskEntry in $taskFiles) {
    $taskFile=[IO.Path]::GetFullPath((Join-Path $taskRoot $taskEntry.File))
    if (-not $taskFile.StartsWith($taskRoot+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid manifest entry.' }
    if ((Get-FileHash -LiteralPath $taskFile -Algorithm SHA256).Hash -ne $taskEntry.SHA256) { throw ('File checksum mismatch: '+$taskEntry.File) }
    $taskCount++
}
Write-Host "Verified $taskCount files. Starting first-time initialization."
$taskUpdate=Join-Path $taskRoot 'updates\Apply-CoFlowUpdate.ps1'
if (Test-Path -LiteralPath $taskUpdate) { & $taskUpdate -Force }
foreach ($taskPatch in @('scripts\bootstrap.js','deploy\windows\Initialize-CoFlow.ps1')) {
    $taskPatchSource=Join-Path (Join-Path $taskRoot 'updates') $taskPatch
    if (Test-Path -LiteralPath $taskPatchSource) { Copy-Item -LiteralPath $taskPatchSource -Destination (Join-Path $taskRoot $taskPatch) -Force }
}
& (Join-Path $taskRoot 'deploy\windows\Initialize-CoFlow.ps1')
