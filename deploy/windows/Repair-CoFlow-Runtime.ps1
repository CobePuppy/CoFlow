$ErrorActionPreference='Stop'
$taskRoot=$PSScriptRoot
$taskInstaller=Join-Path $taskRoot 'runtime\prerequisites\vc_redist.x64.exe'
$taskSignature=Get-AuthenticodeSignature -LiteralPath $taskInstaller
if ($taskSignature.Status -ne 'Valid' -or $taskSignature.SignerCertificate.Subject -notmatch 'Microsoft Corporation') { throw 'Microsoft runtime installer signature verification failed.' }
Write-Host 'Updating Microsoft Visual C++ x64 runtime. Please accept the Windows administrator prompt.'
$taskLog=Join-Path $taskRoot 'vc-runtime-install.log'
$taskResult=Start-Process -FilePath $taskInstaller -ArgumentList @('/install','/passive','/norestart','/log',('"'+$taskLog+'"')) -Verb RunAs -WindowStyle Hidden -Wait -PassThru
if ($taskResult.ExitCode -eq 3010) {
    Write-Host 'Runtime installed. Windows requires a restart. Restart this computer, then double-click CoFlow.exe.'
    exit 0
}
if ($taskResult.ExitCode -notin @(0,1638)) { throw ('Runtime installation failed. Exit code: '+$taskResult.ExitCode+'. See vc-runtime-install.log.') }
$taskDll=Join-Path $env:WINDIR 'System32\msvcp140.dll'
$taskVersion=[Diagnostics.FileVersionInfo]::GetVersionInfo($taskDll)
Write-Host ('Installed MSVCP140.dll version: '+$taskVersion.FileVersion)
if ($taskVersion.FileMajorPart -lt 14 -or ($taskVersion.FileMajorPart -eq 14 -and $taskVersion.FileMinorPart -lt 40)) { throw 'Runtime is still old. Restart Windows and run this repair again; inspect vc-runtime-install.log if it persists.' }
Write-Host 'Runtime update completed. Starting CoFlow...'
Start-Process -FilePath (Join-Path $taskRoot 'CoFlow.exe') -WorkingDirectory $taskRoot
