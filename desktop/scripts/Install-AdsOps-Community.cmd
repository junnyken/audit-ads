@echo off
title AdsOps Desktop Pro - Community Installer
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-AdsOps-Community.ps1"
if errorlevel 1 pause
