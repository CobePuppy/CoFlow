param(
  [Parameter(Mandatory=$true)][string]$CoFlowRoot,
  [string]$AgentRoot='C:\Users\hp-pcz\AppData\Local\Programs\QQ Agent',
  [string]$WorkspaceId='',
  [string]$AgentDataDir='',
  [string]$WebUrl='',
  [switch]$VerifyOnly
)
$ErrorActionPreference='Stop'
$taskCoFlow=[IO.Path]::GetFullPath($CoFlowRoot)
$taskAgent=[IO.Path]::GetFullPath($AgentRoot)
$taskNode=Join-Path $taskCoFlow 'runtime\node.exe'
if (-not (Test-Path -LiteralPath $taskNode)) { $taskNode=(Get-Command node -ErrorAction Stop).Source }
if (-not $VerifyOnly) {
  $taskRunning=@(Get-CimInstance Win32_Process | Where-Object {
    $_.ProcessId -ne $PID -and (
      ($_.ExecutablePath -and $_.ExecutablePath.Equals((Join-Path $taskAgent 'QQ Agent.exe'),[StringComparison]::OrdinalIgnoreCase)) -or
      ($_.Name -match '^node(\.exe)?$' -and $_.CommandLine -and (
        ($_.CommandLine.Contains($taskCoFlow) -and $_.CommandLine -match 'apps[\\/]api[\\/]dist[\\/]main\.js') -or
        ($_.CommandLine.Contains($taskAgent) -and $_.CommandLine -match 'src[\\/]server\.js')
      ))
    )
  })
  if ($taskRunning.Count) {
    Write-Host 'These application processes are still running (PID / name / executable):'
    $taskRunning | Select-Object ProcessId,Name,ExecutablePath | Format-List | Out-Host
    throw 'Exit QQ Agent from its tray menu and close the CoFlow service window, then retry. PostgreSQL and the separate QQ protocol client may remain running.'
  }
}
$taskArgs=@((Join-Path $PSScriptRoot 'install.mjs'),'--coflow',$taskCoFlow,'--agent',$taskAgent)
if ($WorkspaceId) { $taskArgs+=@('--workspace',$WorkspaceId) }
if ($AgentDataDir) { $taskArgs+=@('--data',$AgentDataDir) }
if ($WebUrl) { $taskArgs+=@('--web-url',$WebUrl) }
if ($VerifyOnly) { $taskArgs+='--verify-only' }
else { $taskArgs+='--interactive' }
& $taskNode @taskArgs
if ($LASTEXITCODE -ne 0) { throw 'CoFlow QQ installation failed. See the error and backup directory above.' }
