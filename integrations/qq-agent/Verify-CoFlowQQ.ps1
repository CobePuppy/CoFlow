param([Parameter(Mandatory=$true)][string]$CoFlowRoot,[int]$AgentPort=3210)
$ErrorActionPreference='Stop'
$taskNode=Join-Path $CoFlowRoot 'runtime\node.exe'
if (-not (Test-Path -LiteralPath $taskNode)) { $taskNode=(Get-Command node -ErrorAction Stop).Source }
& $taskNode (Join-Path $PSScriptRoot 'verify.mjs') $CoFlowRoot $AgentPort
if ($LASTEXITCODE -ne 0) { throw 'Verification failed.' }
