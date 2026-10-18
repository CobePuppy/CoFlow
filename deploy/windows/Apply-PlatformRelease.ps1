$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskRelease=Join-Path $taskRoot 'updates\platform-20261017'
$taskNode=Join-Path $taskRoot 'runtime\node.exe'
if (-not (Test-Path -LiteralPath $taskNode)) { throw 'Bundled Node runtime missing.' }
& $taskNode (Join-Path $taskRelease 'platform-update.mjs') --root $taskRoot
if ($LASTEXITCODE -ne 0) { throw 'Platform release failed. The website was not started. Preserve the output for diagnosis.' }
