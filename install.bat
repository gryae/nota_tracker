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
::   ^ Port MySQL (tanya ke client / cek XAMPP)

set MYSQL_USER=root
::   ^ Username MySQL

set MYSQL_PASS=
::   ^ Password MySQL (kosongkan jika tidak ada password)

set DB_NAME=nota_tracker
::   ^ Nama database (sesuaikan dengan server.js)

set HTTP_PORT=3000
::   ^ Port HTTP (sesuaikan dengan server.js)

set HTTPS_PORT=3443
::   ^ Port HTTPS (sesuaikan dengan server.js)

set XAMPP_PATH=C:\xampp
::   ^ Path instalasi XAMPP

set CERT_DAYS=730
::   ^ Masa berlaku SSL cert dalam hari (730 = 2 tahun)

:: ============================================================
::  JANGAN UBAH DI BAWAH INI
:: ============================================================

set ERRORS=0
set REPORT_FILE=%~dp0install_report.txt
set STEP_LOG=

cls
echo.
echo  =====================================================
echo    NOTA TRACKER ^| AUTO INSTALLER
echo  =====================================================
echo.

:: ---- Check Administrator ----
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Script harus dijalankan sebagai Administrator^^!
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
    echo  [ERROR] Node.js tidak ditemukan^^!
    echo          Download dan install dari: https://nodejs.org
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do set NODE_VER=%%v
echo  [OK] Node.js %NODE_VER% ditemukan

:: ---- Check npm ----
where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] npm tidak ditemukan^^! Reinstall Node.js.
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
if not exist "%XAMPP_PATH%\apache\bin\openssl.exe" (
    echo  [WARN] OpenSSL tidak ditemukan. SSL cert tidak akan dibuat.
    set NO_OPENSSL=1
) else (
    echo  [OK] OpenSSL ditemukan di %XAMPP_PATH%\apache\bin\
    set NO_OPENSSL=0
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
call npm install --production 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] npm install gagal^^!
    set /a ERRORS+=1
    set STEP_LOG=!STEP_LOG!STEP 1 - npm install       : GAGAL^
)
) else (
    echo  [OK]  Dependencies berhasil diinstall
    set STEP_LOG=!STEP_LOG!STEP 1 - npm install       : BERHASIL^
)
)

:: ===========================================================
:: STEP 2 — Generate SSL Certificate
:: ===========================================================
echo.
echo  [2/6] Membuat SSL Certificate...
if "%NO_OPENSSL%"=="1" (
    echo  [SKIP] OpenSSL tidak tersedia, melewati pembuatan cert.
    set STEP_LOG=!STEP_LOG!STEP 2 - SSL Certificate    : DILEWATI (OpenSSL tidak ada)^
)
) else (
    if not exist "cert" mkdir cert
    set OPENSSL_CONF=%XAMPP_PATH%\apache\conf\openssl.cnf
    "%XAMPP_PATH%\apache\bin\openssl.exe" req -x509 -newkey rsa:2048 ^
        -keyout cert\key.pem ^
        -out cert\cert.pem ^
        -days %CERT_DAYS% -nodes ^
        -subj "/C=ID/O=NotaTracker/CN=%SERVER_IP%" 2>&1
    if %errorlevel% neq 0 (
        echo  [ERROR] Gagal membuat SSL cert^^!
        set /a ERRORS+=1
        set STEP_LOG=!STEP_LOG!STEP 2 - SSL Certificate    : GAGAL^
)
    ) else (
        echo  [OK]  SSL cert dibuat untuk IP: %SERVER_IP% (berlaku %CERT_DAYS% hari)
        set STEP_LOG=!STEP_LOG!STEP 2 - SSL Certificate    : BERHASIL (IP: %SERVER_IP%, %CERT_DAYS% hari)^
)
    )
)

:: ===========================================================
:: STEP 3 — Create Database
:: ===========================================================
echo.
echo  [3/6] Membuat database MySQL '%DB_NAME%'...
if "%MYSQL_PASS%"=="" (
    "%XAMPP_PATH%\mysql\bin\mysql.exe" --port=%MYSQL_PORT% -u %MYSQL_USER% ^
        -e "CREATE DATABASE IF NOT EXISTS %DB_NAME% CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" 2>&1
) else (
    "%XAMPP_PATH%\mysql\bin\mysql.exe" --port=%MYSQL_PORT% -u %MYSQL_USER% -p%MYSQL_PASS% ^
        -e "CREATE DATABASE IF NOT EXISTS %DB_NAME% CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" 2>&1
)
if %errorlevel% neq 0 (
    echo  [ERROR] Gagal membuat database^^! Cek koneksi MySQL dan konfigurasi.
    set /a ERRORS+=1
    set STEP_LOG=!STEP_LOG!STEP 3 - Buat Database      : GAGAL (cek MySQL port/password)^
)
) else (
    echo  [OK]  Database '%DB_NAME%' siap
    set STEP_LOG=!STEP_LOG!STEP 3 - Buat Database      : BERHASIL^
)
)

:: ===========================================================
:: STEP 4 — Import Schema
:: ===========================================================
echo.
echo  [4/6] Mengimport schema (tabel: divisi, proses, scan_log)...
if "%MYSQL_PASS%"=="" (
    "%XAMPP_PATH%\mysql\bin\mysql.exe" --port=%MYSQL_PORT% -u %MYSQL_USER% %DB_NAME% < schema.sql 2>&1
) else (
    "%XAMPP_PATH%\mysql\bin\mysql.exe" --port=%MYSQL_PORT% -u %MYSQL_USER% -p%MYSQL_PASS% %DB_NAME% < schema.sql 2>&1
)
if %errorlevel% neq 0 (
    echo  [ERROR] Gagal import schema^^!
    set /a ERRORS+=1
    set STEP_LOG=!STEP_LOG!STEP 4 - Import Schema      : GAGAL^
)
) else (
    echo  [OK]  Schema berhasil diimport
    set STEP_LOG=!STEP_LOG!STEP 4 - Import Schema      : BERHASIL^
)
)

:: ===========================================================
:: STEP 5 — Install PM2 & Start App
:: ===========================================================
echo.
echo  [5/6] Setup PM2 dan menjalankan aplikasi...
call npm install -g pm2 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Gagal install PM2^^!
    set /a ERRORS+=1
    set STEP_LOG=!STEP_LOG!STEP 5 - PM2 Install        : GAGAL^
)
    goto :step6
)
echo  [OK]  PM2 berhasil diinstall

:: Stop existing instance if running
call pm2 delete nota-tracker >nul 2>&1

:: Start app
call pm2 start server.js --name "nota-tracker" 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Gagal menjalankan app dengan PM2^^!
    set /a ERRORS+=1
    set STEP_LOG=!STEP_LOG!STEP 5 - PM2 Start App      : GAGAL^
)
    goto :step6
)
echo  [OK]  App berjalan via PM2 (nama: nota-tracker)

call pm2 save 2>&1
call pm2 startup 2>&1
call pm2 save 2>&1
echo  [OK]  PM2 dikonfigurasi auto-start saat Windows boot
set STEP_LOG=!STEP_LOG!STEP 5 - PM2                 : BERHASIL^
)

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
    echo  [WARN] Ada masalah saat membuka firewall. Buka manual jika perlu.
    set STEP_LOG=!STEP_LOG!STEP 6 - Firewall           : PERINGATAN (cek manual)^
)
) else (
    echo  [OK]  Port %HTTP_PORT% (HTTP) dan %HTTPS_PORT% (HTTPS) dibuka di firewall
    set STEP_LOG=!STEP_LOG!STEP 6 - Firewall           : BERHASIL^
)
)

:: ===========================================================
:: GENERATE REPORT
:: ===========================================================

echo.
echo.
echo  =====================================================
echo   INSTALLATION REPORT
echo  =====================================================

(
    echo =====================================================
    echo  NOTA TRACKER ^| Installation Report
    echo  %date% %time%
    echo =====================================================
    echo.
    echo  KONFIGURASI YANG DIGUNAKAN:
    echo    Server IP    : %SERVER_IP%
    echo    MySQL Port   : %MYSQL_PORT%
    echo    MySQL User   : %MYSQL_USER%
    echo    Database     : %DB_NAME%
    echo    HTTP Port    : %HTTP_PORT%
    echo    HTTPS Port   : %HTTPS_PORT%
    echo    XAMPP Path   : %XAMPP_PATH%
    echo    Cert berlaku : %CERT_DAYS% hari
    echo.
    echo  HASIL PER LANGKAH:
    echo    %STEP_LOG%
    echo.
) > "%REPORT_FILE%"

if %ERRORS%==0 (
    (
        echo  STATUS AKHIR: INSTALASI BERHASIL SEMPURNA ^^!
        echo.
        echo  -------------------------------------------------------
        echo  AKSES APLIKASI:
        echo    Dari PC/Laptop : http://localhost:%HTTP_PORT%
        echo    Dari HP/Mobile : https://%SERVER_IP%:%HTTPS_PORT%
        echo  -------------------------------------------------------
        echo.
        echo  CATATAN UNTUK PENGGUNA HP:
        echo    Browser akan menampilkan warning "Not Secure" karena
        echo    menggunakan self-signed certificate. Ini normal.
        echo    Langkah: tap Advanced - Proceed anyway
        echo    Setelah itu kamera HP bisa digunakan normal.
        echo    (Chrome Android: ketik 'thisisunsafe' di halaman warning)
        echo.
        echo  ADMIN PANEL:
        echo    URL  : https://%SERVER_IP%:%HTTPS_PORT%
        echo    Login sesuai konfigurasi di server.js
        echo.
        echo  PM2 STATUS:
    ) >> "%REPORT_FILE%"
    call pm2 list >> "%REPORT_FILE%" 2>&1
    (
        echo.
        echo  Untuk cek status app: pm2 status
        echo  Untuk lihat log app : pm2 logs nota-tracker
        echo =====================================================
    ) >> "%REPORT_FILE%"
) else (
    (
        echo  STATUS AKHIR: SELESAI DENGAN %ERRORS% ERROR
        echo.
        echo  Periksa output terminal di atas untuk detail error.
        echo  Perbaiki konfigurasi lalu jalankan ulang install.bat
        echo.
        echo  KEMUNGKINAN PENYEBAB:
        echo    - MySQL belum jalan / port salah / password salah
        echo    - Node.js belum diinstall dengan benar
        echo    - Koneksi internet tidak ada (untuk npm install)
        echo =====================================================
    ) >> "%REPORT_FILE%"
)

type "%REPORT_FILE%"

echo.
echo  Report disimpan di: %REPORT_FILE%
echo.

if %ERRORS%==0 (
    echo  =====================================================
    echo   INSTALASI BERHASIL^^!
    echo   Laptop   : http://localhost:%HTTP_PORT%
    echo   HP/Mobile: https://%SERVER_IP%:%HTTPS_PORT%
    echo  =====================================================
) else (
    echo  =====================================================
    echo   ADA %ERRORS% ERROR - Cek install_report.txt
    echo  =====================================================
)

echo.
pause
endlocal
