@echo off
start "CoFlow NATAPP" powershell.exe -NoLogo -NoProfile -NoExit -ExecutionPolicy Bypass -File "%~dp0Start-NATAPP.ps1"
start "CoFlow" "%~dp0CoFlow.exe"
