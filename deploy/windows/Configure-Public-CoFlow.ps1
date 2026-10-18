$ErrorActionPreference='Stop'
$taskRoot=$PSScriptRoot
$taskEnv=Join-Path $taskRoot '.env'
if (-not (Test-Path -LiteralPath $taskEnv)) { throw 'Initialize CoFlow first.' }
$taskDir=Join-Path $taskRoot 'runtime\natapp'
New-Item -ItemType Directory -Path $taskDir -Force | Out-Null
if (-not (Test-Path -LiteralPath (Join-Path $taskDir 'natapp.exe'))) {
    Add-Type -AssemblyName System.Windows.Forms
    $taskDialog=[Windows.Forms.OpenFileDialog]::new()
    $taskDialog.Title='Select the official NATAPP Windows x64 ZIP or natapp.exe downloaded from natapp.cn'
    $taskDialog.Filter='NATAPP download (*.zip;natapp.exe)|*.zip;natapp.exe'
    if ($taskDialog.ShowDialog() -ne 'OK') { throw 'No NATAPP download selected. Download the Windows x64 client from https://natapp.cn/download.' }
    $taskSource=$taskDialog.FileName
    $taskDialog.Dispose()
    if ([IO.Path]::GetExtension($taskSource) -eq '.zip') {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $taskZip=[IO.Compression.ZipFile]::OpenRead($taskSource)
        try {
            $taskEntries=@($taskZip.Entries | Where-Object { $_.Name -eq 'natapp.exe' })
            if ($taskEntries.Count -ne 1) { throw 'Expected exactly one natapp.exe in the official download.' }
            [IO.Compression.ZipFileExtensions]::ExtractToFile($taskEntries[0],(Join-Path $taskDir 'natapp.exe'),$false)
        } finally { $taskZip.Dispose() }
    } else {
        if ([IO.Path]::GetFileName($taskSource) -ne 'natapp.exe') { throw 'Select the official natapp.exe.' }
        Copy-Item -LiteralPath $taskSource -Destination (Join-Path $taskDir 'natapp.exe')
    }
}
Write-Host 'Paste the authtoken of your workspace.coflow.top tunnel. Input is hidden.'
$taskSecure=Read-Host 'NATAPP authtoken' -AsSecureString
$taskCredential=[pscredential]::new('natapp',$taskSecure)
$taskToken=$taskCredential.GetNetworkCredential().Password
if ($taskToken -notmatch '^[A-Za-z0-9_-]{8,256}$') { throw 'Invalid token format.' }
$taskCredential | Export-Clixml -LiteralPath (Join-Path $taskRoot '.data\natapp-token.xml')
$taskToken=$null
$taskCredential=$null
$taskPowerShell=Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
Start-Process -FilePath $taskPowerShell -ArgumentList @('-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+(Join-Path $taskRoot 'Start-NATAPP.ps1')+'"')) -WorkingDirectory $taskRoot
Write-Host 'Checking HTTPS and CoFlow health. Enable domain HTTPS and configure its certificate in NATAPP first.'
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
$taskReady=$false
for ($taskAttempt=0; $taskAttempt -lt 10; $taskAttempt++) {
    try {
        $taskResponse=Invoke-WebRequest -Uri 'https://workspace.coflow.top/api/v1/health' -UseBasicParsing -TimeoutSec 4
        if ($taskResponse.StatusCode -eq 200 -and ($taskResponse.Content | ConvertFrom-Json).ok -eq $true) { $taskReady=$true; break }
    } catch {}
    Start-Sleep -Seconds 1
}
if (-not $taskReady) { throw 'HTTPS health check failed. CoFlow .env was NOT changed. Check the NATAPP window, domain binding and HTTPS certificate, keep CoFlow running, then run this configuration again.' }
$taskConfig=[IO.File]::ReadAllText($taskEnv)
if ($taskConfig -notmatch '(?m)^APP_ORIGIN=' -or $taskConfig -notmatch '(?m)^COOKIE_SECURE=') { throw 'Missing application origin or cookie configuration; refusing to rewrite .env.' }
Copy-Item -LiteralPath $taskEnv -Destination ($taskEnv+'.before-public-'+(Get-Date -Format 'yyyyMMdd-HHmmss'))
$taskConfig=$taskConfig -replace '(?m)^APP_ORIGIN=[^\r\n]*','APP_ORIGIN=https://workspace.coflow.top'
$taskConfig=$taskConfig -replace '(?m)^COOKIE_SECURE=[^\r\n]*','COOKIE_SECURE=true'
[IO.File]::WriteAllText($taskEnv,$taskConfig,[Text.UTF8Encoding]::new($false))
Write-Host 'HTTPS health check passed. Public origin configured; original .env backed up.'
Write-Host 'Close the old CoFlow server window, then double-click Start-Public-CoFlow.cmd.'
Write-Host 'The token is encrypted for this Windows user on this PC. Keep the NATAPP window open.'
