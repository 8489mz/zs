@echo off
setlocal
title Z-Systems Hardware Bridge - Compiler
echo ============================================================
echo   Compiling Z-Systems Hardware Bridge (Windows Tray Microservice)
echo ============================================================
echo.

set CSC=C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe

if not exist "%CSC%" (
    set CSC=C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe
)

if not exist "%CSC%" (
    echo [ERROR] DotNet Framework csc compiler was not found.
    exit /b 1
)

echo Using compiler: %CSC%
"%CSC%" /nologo /target:winexe /optimize+ /r:System.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll /r:System.Web.Extensions.dll /resource:src\ui\diagnostics.html,diagnostics.html /out:z-systems-bridge.exe Program.cs

if %ERRORLEVEL% equ 0 (
    where node >nul 2>nul
    if %ERRORLEVEL% equ 0 (
        node ..\..\scripts\sync-bridge-downloads.cjs
    )
    echo.
    echo ============================================================
    echo   BUILD SUCCESSFUL: z-systems-bridge.exe created!
    echo ============================================================
    echo   Single Executable - Auto-Starts with Windows on first click
    echo   Runs in System Tray next to clock - Zero Console Windows
) else (
    echo.
    echo [ERROR] Compilation failed.
)
