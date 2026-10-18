param([int]$WebPort=8080, [int]$DatabasePort=55439, [switch]$NoStart)
$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
Set-Location -LiteralPath $taskRoot
$taskEnv=Join-Path $taskRoot '.env'
$taskData=Join-Path $taskRoot '.data\postgres'
if ((Test-Path -LiteralPath $taskEnv) -or (Test-Path -LiteralPath $taskData)) { throw 'CoFlow is already configured or partially initialized. Use Start-CoFlow.cmd; do not overwrite its database.' }
$taskNode=Join-Path $taskRoot 'runtime\node.exe'
$taskPg=Join-Path $taskRoot 'runtime\postgres\bin'
foreach ($taskPort in @($WebPort,$DatabasePort)) {
    $taskListener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,$taskPort)
    try { $taskListener.Start() } finally { $taskListener.Stop() }
}
$taskEmail=Read-Host 'Administrator email (default admin@coflow.local)'
if ([string]::IsNullOrWhiteSpace($taskEmail)) { $taskEmail='admin@coflow.local' }
$taskSecure=Read-Host 'Choose administrator password (8+ characters)' -AsSecureString
$taskAdminPassword=[pscredential]::new('bootstrap',$taskSecure).GetNetworkCredential().Password
if ($taskAdminPassword.Length -lt 8) { throw 'Administrator password must have at least 8 characters.' }
$taskBytes=New-Object byte[] 32
$taskRng=[Security.Cryptography.RandomNumberGenerator]::Create()
try { $taskRng.GetBytes($taskBytes) } finally { $taskRng.Dispose() }
$taskDbPassword=[Convert]::ToBase64String($taskBytes).Replace('+','-').Replace('/','_').TrimEnd('=')
New-Item -ItemType Directory -Path (Join-Path $taskRoot '.data') -Force | Out-Null
$taskPasswordFile=Join-Path $taskRoot '.data\init-password.tmp'
try {
    [IO.File]::WriteAllText($taskPasswordFile,$taskDbPassword,[Text.UTF8Encoding]::new($false))
    $taskStamp=Get-Date -Format 'yyyyMMdd-HHmmss'
    $taskStdout=Join-Path $taskRoot ('.data\initdb-'+$taskStamp+'.log')
    $taskStderr=Join-Path $taskRoot ('.data\initdb-'+$taskStamp+'-error.log')
    $taskInit=Start-Process -FilePath (Join-Path $taskPg 'initdb.exe') -ArgumentList @('--debug','-D',('"'+$taskData+'"'),'-U','coflow','--encoding=UTF8','--locale=C','--auth=scram-sha-256',('--pwfile="'+$taskPasswordFile+'"')) -NoNewWindow -Wait -PassThru -RedirectStandardOutput $taskStdout -RedirectStandardError $taskStderr
    Get-Content -LiteralPath $taskStdout
    if ($taskInit.ExitCode -ne 0) {
        Get-Content -LiteralPath $taskStderr -Tail 60
        $taskEvents=Join-Path $taskRoot ('.data\windows-crash-'+$taskStamp+'.log')
        try {
            Get-WinEvent -FilterHashtable @{LogName='Application'; Id=1000,1001; StartTime=(Get-Date).AddMinutes(-15)} -MaxEvents 30 -ErrorAction Stop |
                Where-Object { $_.Message -match 'postgres|initdb' } |
                Select-Object TimeCreated,Id,Message | Format-List | Out-String -Width 250 | Set-Content -LiteralPath $taskEvents -Encoding UTF8
        } catch { 'Windows event log unavailable: '+$_.Exception.Message | Set-Content -LiteralPath $taskEvents -Encoding UTF8 }
        throw "PostgreSQL initialization failed. Diagnostic logs saved in .data: initdb-$taskStamp*.log and windows-crash-$taskStamp.log. No website account has been created."
    }
} finally { Remove-Item -LiteralPath $taskPasswordFile -ErrorAction SilentlyContinue }
[IO.File]::WriteAllText((Join-Path $taskData 'postgresql.auto.conf'),"listen_addresses='127.0.0.1'`r`nport=$DatabasePort`r`n",[Text.UTF8Encoding]::new($false))
& (Join-Path $taskPg 'pg_ctl.exe') -D $taskData -l (Join-Path $taskRoot '.data\postgres.log') -w start
if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL startup failed. Inspect .data\postgres.log.' }
try {
    $env:PGPASSWORD=$taskDbPassword
    & (Join-Path $taskPg 'createdb.exe') -h 127.0.0.1 -p $DatabasePort -U coflow coflow
    if ($LASTEXITCODE -ne 0) { throw 'Cannot create the dedicated CoFlow database.' }
} finally { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
$taskConfig="DATABASE_URL=postgresql://coflow:$taskDbPassword@127.0.0.1:$DatabasePort/coflow`r`nNODE_ENV=production`r`nHOST=0.0.0.0`r`nPORT=$WebPort`r`nAPP_ORIGIN=http://10.16.7.124:$WebPort`r`nSERVE_WEB=true`r`nCOOKIE_SECURE=false`r`nSTORAGE_DIR=./storage`r`n"
[IO.File]::WriteAllText($taskEnv,$taskConfig,[Text.UTF8Encoding]::new($false))
& $taskNode (Join-Path $taskRoot 'node_modules\prisma\build\index.js') migrate deploy --schema (Join-Path $taskRoot 'prisma\schema.prisma')
if ($LASTEXITCODE -ne 0) { throw 'Database migration failed. Do not reset or delete the database.' }
try {
    $env:BOOTSTRAP_EMAIL=$taskEmail
    $env:BOOTSTRAP_PASSWORD=$taskAdminPassword
    & $taskNode (Join-Path $taskRoot 'scripts\bootstrap.js')
    if ($LASTEXITCODE -ne 0) { throw 'Administrator creation failed; inspect output before retrying.' }
} finally { Remove-Item Env:BOOTSTRAP_EMAIL,Env:BOOTSTRAP_PASSWORD -ErrorAction SilentlyContinue; $taskAdminPassword=$null }
Write-Host "Initialized. Login: $taskEmail"
Write-Host "Website: http://10.16.7.124:$WebPort"
if (-not $NoStart) { & (Join-Path $PSScriptRoot 'Start-CoFlow.ps1') }
