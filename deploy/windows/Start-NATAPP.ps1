$ErrorActionPreference='Stop'
$taskRoot=$PSScriptRoot
$taskDir=Join-Path $taskRoot 'runtime\natapp'
$taskSecretFile=Join-Path $taskRoot '.data\natapp-token.xml'
if (-not (Test-Path -LiteralPath $taskSecretFile)) { throw 'Run Configure-Public-CoFlow.cmd first.' }
$taskMutex=[Threading.Mutex]::new($false,'Local\CoFlowNATAPP')
if (-not $taskMutex.WaitOne(0)) { Write-Host 'NATAPP is already running for CoFlow.'; exit 0 }
$taskConfig=Join-Path $taskDir 'config.ini'
try {
    $taskToken=(Import-Clixml -LiteralPath $taskSecretFile).GetNetworkCredential().Password
    if ($taskToken -notmatch '^[A-Za-z0-9_-]{8,256}$') { throw 'Invalid saved NATAPP token.' }
    New-Item -ItemType File -Path $taskConfig -Force | Out-Null
    $taskAcl=[Security.AccessControl.FileSecurity]::new()
    $taskAcl.SetAccessRuleProtection($true,$false)
    $taskIdentity=[Security.Principal.WindowsIdentity]::GetCurrent().User
    $taskAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($taskIdentity,'FullControl','Allow'))
    Set-Acl -LiteralPath $taskConfig -AclObject $taskAcl
    [IO.File]::WriteAllText($taskConfig,"[default]`r`nauthtoken=$taskToken`r`nlog=none`r`nloglevel=ERROR`r`nhttp_proxy=`r`n",[Text.Encoding]::ASCII)
    $taskToken=$null
    Write-Host 'CoFlow NATAPP tunnel. Keep this window open. Do not run another tunnel with the same token.'
    & (Join-Path $taskDir 'natapp.exe') ('-config='+$taskConfig)
    if ($LASTEXITCODE -ne 0) { throw 'NATAPP stopped with an error. Inspect the message above.' }
} finally {
    $taskToken=$null
    Remove-Item -LiteralPath $taskConfig -ErrorAction SilentlyContinue
    $taskMutex.ReleaseMutex()
    $taskMutex.Dispose()
}
