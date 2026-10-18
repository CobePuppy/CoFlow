@echo off
setlocal
set "COFLOW_QQ_ROOT=%~dp0.."
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%COFLOW_QQ_ROOT%\updates\qq-agent-1.0.0\package\Verify-CoFlowQQ.ps1" -CoFlowRoot "%COFLOW_QQ_ROOT%" -AgentPort 3210
pause
