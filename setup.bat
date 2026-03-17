@echo off
chcp 65001 >nul
title Jakarta Max Owners — KAS System Setup

echo.
echo ╔══════════════════════════════════════════╗
echo ║   Jakarta Max Owners — KAS System Setup  ║
echo ╚══════════════════════════════════════════╝
echo.

:: --- Cek Node.js ---
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js tidak ditemukan!
    echo         Install dari: https://nodejs.org ^(versi 18 ke atas^)
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo [OK] Node.js %NODE_VER% ditemukan

:: --- Cek npm ---
where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] npm tidak ditemukan!
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('npm -v') do set NPM_VER=%%v
echo [OK] npm %NPM_VER% ditemukan

:: --- Cek PostgreSQL ---
where psql >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] psql ^(PostgreSQL^) tidak ditemukan!
    echo         Install dari: https://www.postgresql.org/download/windows/
    echo         Pastikan folder bin PostgreSQL ada di PATH
    pause
    exit /b 1
)
echo [OK] PostgreSQL ditemukan
echo.

:: --- Cek file .env ---
if exist backend\.env (
    echo [OK] File backend\.env sudah ada, melewati konfigurasi
    goto :install_deps
)

:: --- Input konfigurasi ---
echo [INFO] Membuat file konfigurasi backend\.env ...
echo.

set /p DB_HOST=   PostgreSQL host [localhost]: 
if "%DB_HOST%"=="" set DB_HOST=localhost

set /p DB_PORT=   PostgreSQL port [5432]: 
if "%DB_PORT%"=="" set DB_PORT=5432

set /p DB_USER=   PostgreSQL username [postgres]: 
if "%DB_USER%"=="" set DB_USER=postgres

set /p DB_PASSWORD=   PostgreSQL password: 
set /p DB_NAME=   Nama database [jakarta_max_kas]: 
if "%DB_NAME%"=="" set DB_NAME=jakarta_max_kas

:: Generate simple JWT secret
for /f "tokens=*" %%t in ('powershell -command "[System.Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(48))"') do set JWT_SECRET=%%t

:: Write .env file
(
echo PORT=5700
echo DB_HOST=%DB_HOST%
echo DB_PORT=%DB_PORT%
echo DB_NAME=%DB_NAME%
echo DB_USER=%DB_USER%
echo DB_PASSWORD=%DB_PASSWORD%
echo JWT_SECRET=%JWT_SECRET%
echo JWT_EXPIRES_IN=8h
echo CLOUDFLARE_TURNSTILE_SECRET=your_cloudflare_turnstile_secret_here
echo NODE_ENV=production
) > backend\.env

echo [OK] File .env berhasil dibuat
echo.

:: --- Buat database ---
:create_db
echo [INFO] Membuat database PostgreSQL '%DB_NAME%' ...
psql -U %DB_USER% -h %DB_HOST% -p %DB_PORT% -c "CREATE DATABASE %DB_NAME%;" 2>nul
if %errorlevel% equ 0 (
    echo [OK] Database '%DB_NAME%' berhasil dibuat
) else (
    echo [WARN] Database mungkin sudah ada atau gagal dibuat.
    echo        Jika belum ada, buat manual dengan perintah:
    echo        createdb -U %DB_USER% %DB_NAME%
)
echo.

:: --- Install dependencies ---
:install_deps
echo [INFO] Menginstall dependencies Node.js ...
cd backend
call npm install
if %errorlevel% neq 0 (
    echo [ERROR] Gagal install dependencies!
    pause
    exit /b 1
)
echo [OK] Dependencies terinstall
echo.

:: --- Migrasi ---
echo [INFO] Menjalankan migrasi database ...
node db\migrate.js
if %errorlevel% neq 0 (
    echo [ERROR] Migrasi gagal! Periksa koneksi PostgreSQL dan konfigurasi .env
    pause
    exit /b 1
)
echo.

:: --- Seed ---
echo [INFO] Mengisi data awal ...
node db\seed.js
echo.

cd ..

:: --- Selesai ---
echo.
echo ╔══════════════════════════════════════════╗
echo ║         SETUP SELESAI!                   ║
echo ╠══════════════════════════════════════════╣
echo ║  Jalankan server:                        ║
echo ║    cd backend                            ║
echo ║    npm start                             ║
echo ║                                          ║
echo ║  Buka browser:                           ║
echo ║    http://localhost:5700                 ║
echo ║                                          ║
echo ║  Login default:                          ║
echo ║    Admin     : admin / Admin@12345       ║
echo ║    Bendahara : bendahara1 / User@12345   ║
echo ║    Approver  : approver1 / User@12345    ║
echo ╚══════════════════════════════════════════╝
echo.
echo PENTING: Ganti semua password default setelah login pertama!
echo PENTING: Daftarkan Cloudflare Turnstile dan update SITE KEY
echo          di file frontend\index.html
echo.

set /p RUN_NOW=Jalankan server sekarang? (y/n) [y]: 
if /i "%RUN_NOW%"=="" set RUN_NOW=y
if /i "%RUN_NOW%"=="y" (
    echo.
    echo Menjalankan server di http://localhost:5700 ...
    cd backend
    npm start
)

pause
