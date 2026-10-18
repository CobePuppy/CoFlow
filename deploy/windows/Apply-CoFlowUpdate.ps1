param([switch]$Force)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskArchive=Join-Path $PSScriptRoot 'team-registration.zip'
if (-not (Test-Path -LiteralPath $taskArchive)) { return }
$taskExpected=(Get-Content -LiteralPath ($taskArchive+'.sha256') -Raw).Trim()
$taskMarker=Join-Path $taskRoot '.coflow-update-applied'
if (-not $Force -and (Test-Path -LiteralPath $taskMarker) -and (Get-Content -LiteralPath $taskMarker -Raw).Trim() -eq $taskExpected) { return }
if ((Get-FileHash -LiteralPath $taskArchive -Algorithm SHA256).Hash -ne $taskExpected) { throw 'Update checksum mismatch.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$taskZip=[IO.Compression.ZipFile]::OpenRead($taskArchive)
try {
    foreach ($taskEntry in $taskZip.Entries) {
        $taskResolved=[IO.Path]::GetFullPath((Join-Path $taskRoot $taskEntry.FullName))
        if (-not $taskResolved.StartsWith($taskRoot+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid update path.' }
        if ($taskEntry.FullName -notmatch '^(apps/|node_modules/\.prisma/client/|prisma/|deploy/windows/|scripts/bootstrap\.js$)') { throw 'Unexpected update file.' }
    }
} finally { $taskZip.Dispose() }
Write-Host 'Applying CoFlow team registration update. Existing accounts and data are preserved.'
Expand-Archive -LiteralPath $taskArchive -DestinationPath $taskRoot -Force
[IO.File]::WriteAllText($taskMarker,$taskExpected,[Text.Encoding]::ASCII)
