param([Parameter(Mandatory=$true)][string]$CoFlowRoot,[Parameter(Mandatory=$true)][string]$BackupDir,[string]$AgentRoot='C:\Users\hp-pcz\AppData\Local\Programs\QQ Agent',[string]$AgentDataDir='')
$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath($CoFlowRoot).TrimEnd('\')
$taskAgent=[IO.Path]::GetFullPath($AgentRoot).TrimEnd('\')
$taskBackup=[IO.Path]::GetFullPath($BackupDir).TrimEnd('\')
if (-not $taskBackup.StartsWith((Join-Path $taskRoot 'backups')+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Backup must be inside CoFlow/backups.' }
$taskAllowed=@($taskRoot,$taskAgent)
if ($AgentDataDir) { $taskAllowed+=[IO.Path]::GetFullPath($AgentDataDir).TrimEnd('\') }
$taskRunning=Get-CimInstance Win32_Process | Where-Object {
  ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($taskAgent+'\',[StringComparison]::OrdinalIgnoreCase)) -or
  ($_.CommandLine -and $_.CommandLine.Contains($taskRoot) -and $_.CommandLine -match 'apps[\\/]api[\\/]dist[\\/]main\.js')
}
if ($taskRunning) { throw 'Close QQ Agent and stop the CoFlow API before rollback.' }
$taskEntries=Get-Content -LiteralPath (Join-Path $taskBackup 'restore.json') -Raw | ConvertFrom-Json
foreach ($taskEntry in $taskEntries) {
  $taskTarget=[IO.Path]::GetFullPath($taskEntry.target)
  $taskValid=$false
  foreach ($taskBase in $taskAllowed) { if ($taskTarget.StartsWith($taskBase+'\',[StringComparison]::OrdinalIgnoreCase)) { $taskValid=$true } }
  if (-not $taskValid) { throw 'Restore target outside configured installation directories.' }
  if ($taskEntry.backup) {
    $taskCopy=[IO.Path]::GetFullPath($taskEntry.backup)
    if (-not $taskCopy.StartsWith($taskBackup+'\',[StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $taskCopy -PathType Leaf)) { throw 'Invalid backup source.' }
  }
}
foreach ($taskEntry in $taskEntries) {
  if ($taskEntry.backup) { Copy-Item -LiteralPath $taskEntry.backup -Destination $taskEntry.target -Force }
  elseif (Test-Path -LiteralPath $taskEntry.target -PathType Leaf) { Remove-Item -LiteralPath $taskEntry.target -Force }
}
Write-Host 'Files and previous configuration restored. Additive QQ database tables are retained. Restart both applications.'
