@echo off
setlocal
set "COFLOW_PLATFORM_ROOT=%~dp0.."
"%COFLOW_PLATFORM_ROOT%\runtime\node.exe" "%COFLOW_PLATFORM_ROOT%\updates\platform-20261017\platform-update.mjs" --root "%COFLOW_PLATFORM_ROOT%"
if errorlevel 1 (
  echo Update failed. Preserve the output for diagnosis.
  pause
  exit /b 1
)
echo Update complete. Start CoFlow.exe.
pause
