@echo off
setlocal
title Nota Tracker - Startup
chcp 65001 >nul

:: Pindah ke folder app (lokasi startup.bat ini berada)
cd /d "%~dp0"

:: ============================================================
::  Tunggu beberapa detik agar MySQL/XAMPP sempat ready dulu
::  (penting saat boot — MySQL perlu waktu untuk start)
:: ============================================================
echo [Nota Tracker] Menunggu sistem siap...
timeout /t 15 /nobreak >nul

:: ============================================================
::  Cek apakah MySQL sudah running
::  (retry sampai 5x dengan jeda 5 detik)
:: ============================================================
set XAMPP_PATH=C:\xampp
set MYSQL_USER=root
set MYSQL_PASS=
set RETRY=0

:wait_mysql
set /a RETRY+=1
if %RETRY% gtr 5 (
    echo [ERROR] MySQL tidak bisa diakses setelah 5x percobaan. App tidak dijalankan.
    echo %date% %time% - GAGAL: MySQL tidak ready >> startup_log.txt
    exit /b 1
)

if "%MYSQL_PASS%"=="" (
    "%XAMPP_PATH%\mysql\bin\mysqladmin.exe" -u %MYSQL_USER% ping >nul 2>&1
) else (
    "%XAMPP_PATH%\mysql\bin\mysqladmin.exe" -u %MYSQL_USER% -p%MYSQL_PASS% ping >nul 2>&1
)

if %errorlevel% neq 0 (
    echo [Nota Tracker] MySQL belum ready, tunggu 5 detik... ^(percobaan %RETRY%/5^)
    timeout /t 5 /nobreak >nul
    goto :wait_mysql
)

echo [Nota Tracker] MySQL ready!

:: ============================================================
::  Jalankan aplikasi via PM2
:: ============================================================
echo [Nota Tracker] Memulai server...

:: Hentikan instance lama jika ada
call pm2 delete nota-tracker >nul 2>&1

:: Start server
call pm2 start server.js --name nota-tracker

if %errorlevel% neq 0 (
    echo [ERROR] Gagal menjalankan server via PM2.
    echo %date% %time% - GAGAL: PM2 start error >> startup_log.txt
    exit /b 1
)

call pm2 save >nul 2>&1

echo [Nota Tracker] Server berhasil dijalankan!
echo %date% %time% - OK: Server started >> startup_log.txt

endlocal
