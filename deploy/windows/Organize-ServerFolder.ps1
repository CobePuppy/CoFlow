param([Parameter(Mandatory=$true)][string]$Root)
$ErrorActionPreference='Stop'
$taskRoot=(Resolve-Path -LiteralPath $Root).ProviderPath.TrimEnd('\')
if ($taskRoot -ne '\\10.16.7.124\Users\hp-pcz\AppData\Local\Programs\CoFlow') { throw 'Unexpected server folder.' }
function TaskPath([string]$Relative) {
    $taskPath=[IO.Path]::GetFullPath((Join-Path $taskRoot $Relative))
    if (-not $taskPath.StartsWith($taskRoot+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Path outside CoFlow folder.' }
    return $taskPath
}
foreach ($taskFolder in @('tools','archives\installers','archives\logs','archives\config-backups','archives\docs')) {
    New-Item -ItemType Directory -Path (TaskPath $taskFolder) -Force | Out-Null
}
$taskMoves=@()
function MoveTaskFile([string]$Name,[string]$Folder) {
    $taskSource=TaskPath $Name
    if (-not (Test-Path -LiteralPath $taskSource -PathType Leaf)) { return }
    $taskTarget=TaskPath ($Folder+'\'+$Name)
    if (Test-Path -LiteralPath $taskTarget) { throw ('Destination exists: '+$taskTarget) }
    $taskHash=(Get-FileHash -LiteralPath $taskSource).Hash
    Move-Item -LiteralPath $taskSource -Destination $taskTarget
    if ((Get-FileHash -LiteralPath $taskTarget).Hash -ne $taskHash) { throw 'Moved file hash mismatch.' }
    $script:taskMoves += [pscustomobject]@{From=$Name;To=$Folder+'\'+$Name;SHA256=$taskHash}
}
# Files only: do not relocate running application, database, or client directories.
foreach ($taskFile in Get-ChildItem -LiteralPath $taskRoot -File -Force) {
    if ($taskFile.Name -like 'CoFlow-server-*.zip*') { MoveTaskFile $taskFile.Name 'archives\installers' }
    elseif ($taskFile.Name -like 'vc-runtime-install*.log') { MoveTaskFile $taskFile.Name 'archives\logs' }
    elseif ($taskFile.Name -like '.env.before-*') { MoveTaskFile $taskFile.Name 'archives\config-backups' }
}
$taskScriptNames=@('Configure-Public-CoFlow.ps1','Start-NATAPP.ps1','Repair-CoFlow-Runtime.ps1')
MoveTaskFile '服务器使用说明.md' 'archives\docs'
foreach ($taskName in $taskScriptNames) {
    $taskSource=TaskPath $taskName
    if (-not (Test-Path -LiteralPath $taskSource)) { continue }
    $taskText=[IO.File]::ReadAllText($taskSource)
    $taskText=$taskText.Replace('$taskRoot=$PSScriptRoot', '$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot ''..''))')
    if ($taskName -eq 'Configure-Public-CoFlow.ps1') {
        $taskText=$taskText.Replace("(Join-Path `$taskRoot 'Start-NATAPP.ps1')", "(Join-Path `$PSScriptRoot 'Start-NATAPP.ps1')")
        $taskText=$taskText.Replace('double-click Start-Public-CoFlow.cmd','double-click tools\Start-Public-CoFlow.cmd')
    }
    if ($taskName -eq 'Repair-CoFlow-Runtime.ps1') { $taskText=$taskText.Replace("'vc-runtime-install.log'", "'archives\logs\vc-runtime-install.log'") }
    $taskTokens=$null; $taskErrors=$null
    [Management.Automation.Language.Parser]::ParseInput($taskText,[ref]$taskTokens,[ref]$taskErrors) | Out-Null
    if ($taskErrors.Count) { throw ('Invalid updated script: '+$taskName) }
    Copy-Item -LiteralPath $taskSource -Destination (TaskPath ('archives\installers\'+$taskName+'.before-organize'))
    [IO.File]::WriteAllText($taskSource,$taskText,[Text.UTF8Encoding]::new($false))
    MoveTaskFile $taskName 'tools'
}
foreach ($taskName in @('Configure-Public-CoFlow.cmd','Repair-CoFlow-Runtime.cmd')) { MoveTaskFile $taskName 'tools' }
$taskPublic=TaskPath 'Start-Public-CoFlow.cmd'
if (Test-Path -LiteralPath $taskPublic) {
    $taskText=[IO.File]::ReadAllText($taskPublic).Replace('"%~dp0CoFlow.exe"','"%~dp0..\CoFlow.exe"')
    [IO.File]::WriteAllText($taskPublic,$taskText,[Text.Encoding]::ASCII)
    MoveTaskFile 'Start-Public-CoFlow.cmd' 'tools'
}
# Keep original first-install entry paths for launcher compatibility.
$taskInstaller=TaskPath 'Install-From-Package.ps1'
if (Test-Path -LiteralPath $taskInstaller) {
    $taskText=[IO.File]::ReadAllText($taskInstaller)
    $taskText=$taskText.Replace("`$taskZip=Join-Path `$taskRoot 'CoFlow-server-20261016.zip'", "`$taskZip=Join-Path `$taskRoot 'archives\installers\CoFlow-server-20261016.zip'")
    [IO.File]::WriteAllText($taskInstaller,$taskText,[Text.UTF8Encoding]::new($false))
}
foreach ($taskName in @('.data','apps','deploy','node_modules','prisma','runtime','scripts','updates','.env','.coflow-update-applied','deployment-manifest.json','package.json','pnpm-lock.yaml','pnpm-workspace.yaml','Install-From-Package.ps1','Install-From-Package.cmd','archives\config-backups')) {
    $taskPath=TaskPath $taskName
    if (Test-Path -LiteralPath $taskPath) { $taskItem=Get-Item -LiteralPath $taskPath -Force; $taskItem.Attributes=$taskItem.Attributes -bor [IO.FileAttributes]::Hidden }
}
$taskMoves | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (TaskPath ('archives\organization-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.json')) -Encoding UTF8
foreach ($taskName in @('CoFlow.exe','.env','.data\postgres\PG_VERSION','apps\api\dist\main.js','apps\web\dist\index.html','deploy\windows\Start-CoFlow.ps1','tools\Start-NATAPP.ps1')) {
    if (-not (Test-Path -LiteralPath (TaskPath $taskName))) { throw ('Required file missing: '+$taskName) }
}
'SERVER_FOLDER_ORGANIZED_AND_VERIFIED'
Get-ChildItem -LiteralPath $taskRoot | Select-Object Name,Mode
