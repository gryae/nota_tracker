@echo off
setlocal enabledelayedexpansion
title Nota Tracker - Installer
chcp 65001 >nul

:: ============================================================
::  KONFIGURASI — SESUAIKAN INI SEBELUM JALANKAN!
:: ============================================================

set SERVER_IP=192.168.1.100
::   ^ IP server ini (jalankan 'ipconfig' untuk cek)

set MYSQL_PORT=3306
::   ^ Port MySQL (default XAMPP)

set MYSQL_USER=root
::   ^ Username MySQL

set MYSQL_PASS=
::   ^ Password MySQL (kosongkan jika tidak ada password)

set DB_NAME=nota_tracker
::   ^ Nama database

set HTTP_PORT=3000
::   ^ Port HTTP

set HTTPS_PORT=3443
::   ^ Port HTTPS (untuk akses HP/kamera)

set XAMPP_PATH=C:\xampp
::   ^ Path instalasi XAMPP

set CERT_DAYS=730
::   ^ Masa berlaku SSL cert (730 = 2 tahun)

:: ============================================================
::  JANGAN UBAH DI BAWAH INI
:: ============================================================

set ERRORS=0

cls
echo.
echo  =====================================================
echo    NOTA TRACKER ^| AUTO INSTALLER
echo  =====================================================
echo.

:: ---- Check Administrator ----
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Script harus dijalankan sebagai Administrator!
    echo.
    echo  Cara: Klik kanan file install.bat ^> Run as administrator
    echo.
    pause
    exit /b 1
)
echo  [OK] Berjalan sebagai Administrator

:: ---- Check Node.js ----
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js tidak ditemukan!
    echo          Download dari: https://nodejs.org
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do set NODE_VER=%%v
echo  [OK] Node.js %NODE_VER% ditemukan

:: ---- Check npm ----
where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] npm tidak ditemukan! Reinstall Node.js.
    pause
    exit /b 1
)
echo  [OK] npm ditemukan

:: ---- Check XAMPP MySQL ----
if not exist "%XAMPP_PATH%\mysql\bin\mysql.exe" (
    echo  [ERROR] MySQL tidak ditemukan di: %XAMPP_PATH%\mysql\bin\
    echo          Periksa variabel XAMPP_PATH di bagian konfigurasi.
    pause
    exit /b 1
)
echo  [OK] MySQL ditemukan di %XAMPP_PATH%\mysql\bin\

:: ---- Check OpenSSL ----
set NO_OPENSSL=1
if exist "%XAMPP_PATH%\apache\bin\openssl.exe" (
    echo  [OK] OpenSSL ditemukan di %XAMPP_PATH%\apache\bin\
    set NO_OPENSSL=0
) else (
    echo  [WARN] OpenSSL tidak ditemukan. SSL cert tidak akan dibuat.
)

echo.
echo  =====================================================
echo   Memulai instalasi...
echo  =====================================================
echo.

:: ===========================================================
:: STEP 1 — npm install
:: ===========================================================
echo  [1/6] Menginstall dependencies Node.js...
call npm install --production
if %errorlevel% neq 0 (
    echo  [ERROR] npm install gagal!
    set /a ERRORS+=1
    echo  STEP 1 - npm install: GAGAL >> install_report.txt
) else (
    echo  [OK]  Dependencies berhasil diinstall
    echo  STEP 1 - npm install: BERHASIL >> install_report.txt
)

:: ===========================================================
:: STEP 2 — Generate SSL Certificate
:: ===========================================================
echo.
echo  [2/6] Membuat SSL Certificate...
if "%NO_OPENSSL%"=="1" (
    echo  [SKIP] OpenSSL tidak tersedia, melewati pembuatan cert.
    echo  STEP 2 - SSL Certificate: DILEWATI (OpenSSL tidak ada) >> install_report.txt
) else (
    if not exist "cert" mkdir cert
    set OPENSSL_CONF=%XAMPP_PATH%\apache\conf\openssl.cnf
    "%XAMPP_PATH%\apache\bin\openssl.exe" req -x509 -newkey rsa:2048 -keyout cert\key.pem -out cert\cert.pem -days %CERT_DAYS% -nodes -subj "/C=ID/O=NotaTracker/CN=%SERVER_IP%" 2>nul
    if !errorlevel! neq 0 (
        echo  [ERROR] Gagal membuat SSL cert!
        set /a ERRORS+=1
        echo  STEP 2 - SSL Certificate: GAGAL >> install_report.txt
    ) else (
        echo  [OK]  SSL cert dibuat untuk IP: %SERVER_IP% ^(berlaku %CERT_DAYS% hari^)
        echo  STEP 2 - SSL Certificate: BERHASIL >> install_report.txt
    )
)

:: ===========================================================
:: STEP 3 — Create Database
:: ===========================================================
echo.
echo  [3/6] Membuat database MySQL '%DB_NAME%'...
if "%MYSQL_PASS%"=="" (
    "%XAMPP_PATH%\mysql\bin\mysql.exe" --port=%MYSQL_PORT% -u %MYSQL_USER% -e "CREATE DATABASE IF NOT EXISTS %DB_NAME% CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
) else (
    "%XAMPP_PATH%\mysql\bin\mysql.exe" --port=%MYSQL_PORT% -u %MYSQL_USER% -p%MYSQL_PASS% -e "CREATE DATABASE IF NOT EXISTS %DB_NAME% CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
)
if %errorlevel% neq 0 (
    echo  [ERROR] Gagal membuat database! Cek apakah MySQL sudah Running di XAMPP.
    set /a ERRORS+=1
    echo  STEP 3 - Buat Database: GAGAL >> install_report.txt
) else (
    echo  [OK]  Database '%DB_NAME%' siap
    echo  STEP 3 - Buat Database: BERHASIL >> install_report.txt
)

:: ===========================================================
:: STEP 4 — Import Schema
:: ===========================================================
echo.
echo  [4/6] Mengimport schema tabel...
if "%MYSQL_PASS%"=="" (
    "%XAMPP_PATH%\mysql\bin\mysql.exe" --port=%MYSQL_PORT% -u %MYSQL_USER% %DB_NAME% < schema.sql
) else (
    "%XAMPP_PATH%\mysql\bin\mysql.exe" --port=%MYSQL_PORT% -u %MYSQL_USER% -p%MYSQL_PASS% %DB_NAME% < schema.sql
)
if %errorlevel% neq 0 (
    echo  [ERROR] Gagal import schema!
    set /a ERRORS+=1
    echo  STEP 4 - Import Schema: GAGAL >> install_report.txt
) else (
    echo  [OK]  Schema berhasil diimport
    echo  STEP 4 - Import Schema: BERHASIL >> install_report.txt
)

:: ===========================================================
:: STEP 5 — Install PM2 & Start App
:: ===========================================================
echo.
echo  [5/6] Setup PM2 dan menjalankan aplikasi...
call npm install -g pm2
if %errorlevel% neq 0 (
    echo  [ERROR] Gagal install PM2!
    set /a ERRORS+=1
    echo  STEP 5 - PM2: GAGAL >> install_report.txt
    goto :step6
)
echo  [OK]  PM2 berhasil diinstall

:: Stop existing instance if running
call pm2 delete nota-tracker >nul 2>&1

:: Start app
call pm2 start server.js --name "nota-tracker"
if %errorlevel% neq 0 (
    echo  [ERROR] Gagal menjalankan app dengan PM2!
    set /a ERRORS+=1
    echo  STEP 5 - PM2 Start: GAGAL >> install_report.txt
    goto :step6
)
echo  [OK]  App berjalan via PM2

call pm2 save
call pm2 startup
call pm2 save
echo  [OK]  PM2 dikonfigurasi auto-start saat Windows boot
echo  STEP 5 - PM2: BERHASIL >> install_report.txt

:step6
:: ===========================================================
:: STEP 6 — Open Firewall Ports
:: ===========================================================
echo.
echo  [6/6] Membuka port di Windows Firewall...
netsh advfirewall firewall delete rule name="Nota Tracker HTTP"  >nul 2>&1
netsh advfirewall firewall delete rule name="Nota Tracker HTTPS" >nul 2>&1
netsh advfirewall firewall add rule name="Nota Tracker HTTP"  protocol=TCP dir=in localport=%HTTP_PORT%  action=allow >nul 2>&1
netsh advfirewall firewall add rule name="Nota Tracker HTTPS" protocol=TCP dir=in localport=%HTTPS_PORT% action=allow >nul 2>&1
if %errorlevel% neq 0 (
    echo  [WARN] Ada masalah saat membuka firewall.
    echo  STEP 6 - Firewall: PERINGATAN >> install_report.txt
) else (
    echo  [OK]  Port %HTTP_PORT% ^(HTTP^) dan %HTTPS_PORT% ^(HTTPS^) dibuka
    echo  STEP 6 - Firewall: BERHASIL >> install_report.txt
)

:: ===========================================================
:: HASIL AKHIR
:: ===========================================================
echo.
echo.
echo  =====================================================
echo   HASIL INSTALASI
echo  =====================================================
echo.

if %ERRORS%==0 (
    echo  STATUS: INSTALASI BERHASIL SEMPURNA!
    echo.
    echo  -------------------------------------------------------
    echo  AKSES APLIKASI:
    echo    Dari Laptop  : http://localhost:%HTTP_PORT%
    echo    Dari HP      : https://%SERVER_IP%:%HTTPS_PORT%
    echo  -------------------------------------------------------
    echo.
    echo  CATATAN HP - Saat buka di HP akan ada warning "Not Secure":
    echo    Klik Advanced ^> Proceed anyway
    echo    Atau ketik 'thisisunsafe' di Chrome Android
    echo.
    echo  ADMIN LOGIN:
    echo    Sesuai konfigurasi di server.js
    echo.
    echo  PM2 STATUS:
    call pm2 list
    echo.
    echo  Tips: pm2 logs nota-tracker  ^(untuk lihat log error^)
    echo  =====================================================
) else (
    echo  STATUS: SELESAI DENGAN %ERRORS% ERROR
    echo.
    echo  Cek pesan error di atas.
    echo  Kemungkinan penyebab:
    echo    - MySQL belum Running di XAMPP
    echo    - Node.js belum diinstall
    echo    - Tidak ada koneksi internet ^(untuk npm install^)
    echo    - Konfigurasi SERVER_IP atau MYSQL_PASS salah
    echo.
    echo  Perbaiki, lalu jalankan install.bat lagi sebagai Administrator.
    echo  =====================================================
)

echo.
echo  Detail log disimpan di: install_report.txt
echo.
pause
endlocal
