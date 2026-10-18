@echo off
setlocal
set "COFLOW_QQ_ROOT=%~dp0.."
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%COFLOW_QQ_ROOT%\updates\qq-agent-1.0.0\package\Install-CoFlowQQ.ps1" -CoFlowRoot "%COFLOW_QQ_ROOT%" -AgentRoot "%LOCALAPPDATA%\Programs\QQ Agent" -AgentDataDir "%LOCALAPPDATA%\Programs\QQ Agent\data"
if errorlevel 1 (
  echo Installation failed. Keep this output for diagnosis.
  pause
  exit /b 1
)
echo Installation complete. Start CoFlow.exe and QQ Agent, then run Verify-CoFlowQQ.cmd.
pause
