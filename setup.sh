#!/usr/bin/env bash
# ============================================================
#  Jakarta Max Owners — KAS System
#  Setup Script untuk Linux / macOS
#
#  Cara jalankan:
#    bash setup.sh
#  JANGAN jalankan dengan: sh setup.sh
# ============================================================

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

pr() { printf "${1}${2}${NC}\n"; }

printf "\n"
printf "${BLUE}╔══════════════════════════════════════════╗${NC}\n"
printf "${BLUE}║   Jakarta Max Owners — KAS System Setup  ║${NC}\n"
printf "${BLUE}╚══════════════════════════════════════════╝${NC}\n"
printf "\n"

# ── Load nvm jika ada (Node.js via nvm tidak ada di PATH default) ──
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && source "$NVM_DIR/bash_completion"

# ── Cari node di lokasi umum jika belum di PATH ──
for candidate in \
    "$(which node 2>/dev/null)" \
    "$NVM_DIR/versions/node/$(ls $NVM_DIR/versions/node 2>/dev/null | sort -V | tail -1)/bin/node" \
    /usr/local/bin/node \
    /usr/bin/node \
    /opt/homebrew/bin/node; do
    if [ -x "$candidate" ]; then
        NODE_BIN="$candidate"
        NPM_BIN="$(dirname "$candidate")/npm"
        break
    fi
done

if [ -z "$NODE_BIN" ]; then
    pr "$RED" "ERROR: Node.js tidak ditemukan!"
    echo "  Install dari: https://nodejs.org (versi 18 ke atas)"
    echo "  Atau jika pakai nvm: nvm install 20"
    exit 1
fi

NODE_VER=$("$NODE_BIN" -v)
pr "$GREEN" "OK  Node.js $NODE_VER  ($NODE_BIN)"

NPM_VER=$("$NPM_BIN" -v 2>/dev/null || echo "?")
pr "$GREEN" "OK  npm $NPM_VER"

# ── Cek PostgreSQL ──
PSQL_BIN=$(which psql 2>/dev/null || which psql 2>/dev/null)
if [ -z "$PSQL_BIN" ]; then
    # Cari di lokasi umum Debian/Ubuntu/Postgres installs
    for p in /usr/bin/psql /usr/local/bin/psql /usr/lib/postgresql/*/bin/psql; do
        [ -x "$p" ] && PSQL_BIN="$p" && break
    done
fi

if [ -z "$PSQL_BIN" ]; then
    pr "$RED" "ERROR: psql (PostgreSQL client) tidak ditemukan!"
    echo "  Ubuntu/Debian : sudo apt install postgresql postgresql-client"
    echo "  macOS         : brew install postgresql"
    exit 1
fi
pr "$GREEN" "OK  PostgreSQL ($PSQL_BIN)"
printf "\n"

# ── Buat file .env ──
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if [ -f "backend/.env" ]; then
    pr "$GREEN" "OK  File backend/.env sudah ada, melewati konfigurasi"
    set -a; source backend/.env; set +a
    DB_NAME="${DB_NAME:-jakarta_max_kas}"
    DB_USER="${DB_USER:-postgres}"
    DB_HOST="${DB_HOST:-localhost}"
    DB_PORT="${DB_PORT:-5432}"
else
    pr "$YELLOW" "  Membuat file konfigurasi backend/.env ..."

    read -rp "  PostgreSQL host     [localhost] : " DB_HOST
    DB_HOST="${DB_HOST:-localhost}"

    read -rp "  PostgreSQL port     [5432]      : " DB_PORT
    DB_PORT="${DB_PORT:-5432}"

    read -rp "  PostgreSQL username [postgres]  : " DB_USER
    DB_USER="${DB_USER:-postgres}"

    read -rsp "  PostgreSQL password             : " DB_PASSWORD
    printf "\n"

    read -rp "  Nama database [jakarta_max_kas] : " DB_NAME
    DB_NAME="${DB_NAME:-jakarta_max_kas}"

    JWT_SECRET=$("$NODE_BIN" -e "console.log(require('crypto').randomBytes(48).toString('hex'))" 2>/dev/null \
                 || echo "jmo_$(date +%s)_change_this_secret_in_production_$(od -An -N8 -tx1 /dev/urandom 2>/dev/null | tr -d ' \n')")

    cat > backend/.env <<ENVEOF
PORT=5700
DB_HOST=${DB_HOST}
DB_PORT=${DB_PORT}
DB_NAME=${DB_NAME}
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASSWORD}
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_IN=8h
CLOUDFLARE_TURNSTILE_SECRET=your_cloudflare_turnstile_secret_here
NODE_ENV=production
ENVEOF
    pr "$GREEN" "  OK  File .env berhasil dibuat"
fi

printf "\n"

# ── Buat database PostgreSQL ──
pr "$YELLOW" "  Membuat database PostgreSQL '${DB_NAME}' ..."
if PGPASSWORD="$DB_PASSWORD" "$PSQL_BIN" -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" -lqt 2>/dev/null \
   | cut -d'|' -f1 | grep -qw "$DB_NAME"; then
    pr "$GREEN" "  OK  Database '${DB_NAME}' sudah ada"
else
    if PGPASSWORD="$DB_PASSWORD" "$PSQL_BIN" -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" \
       -c "CREATE DATABASE \"${DB_NAME}\";" 2>/dev/null; then
        pr "$GREEN" "  OK  Database '${DB_NAME}' berhasil dibuat"
    else
        pr "$YELLOW" "  WARN  Gagal buat database otomatis. Buat manual jika belum ada:"
        echo "        createdb -U $DB_USER $DB_NAME"
        echo "        atau: sudo -u postgres createdb $DB_NAME"
    fi
fi

printf "\n"

# ── Install dependencies ──
pr "$YELLOW" "  Menginstall dependencies Node.js ..."
cd backend
"$NPM_BIN" install
if [ $? -ne 0 ]; then
    pr "$RED" "ERROR: npm install gagal!"
    exit 1
fi
pr "$GREEN" "OK  Dependencies terinstall"
printf "\n"

# ── Migrasi database ──
pr "$YELLOW" "  Menjalankan migrasi database ..."
"$NODE_BIN" db/migrate.js
if [ $? -ne 0 ]; then
    pr "$RED" "ERROR: Migrasi gagal! Periksa koneksi PostgreSQL dan isi backend/.env"
    exit 1
fi
printf "\n"

# ── Seed data awal ──
pr "$YELLOW" "  Mengisi data awal ..."
"$NODE_BIN" db/seed.js
printf "\n"

cd "$SCRIPT_DIR"

# ── Selesai ──
printf "${BLUE}╔══════════════════════════════════════════╗${NC}\n"
printf "${BLUE}║         SETUP SELESAI!                   ║${NC}\n"
printf "${BLUE}╠══════════════════════════════════════════╣${NC}\n"
printf "${BLUE}║${NC}  Jalankan server:                        ${BLUE}║${NC}\n"
printf "${BLUE}║${NC}    bash start.sh                         ${BLUE}║${NC}\n"
printf "${BLUE}║${NC}    atau: cd backend && npm start         ${BLUE}║${NC}\n"
printf "${BLUE}║${NC}                                          ${BLUE}║${NC}\n"
printf "${BLUE}║${NC}  Buka browser:                           ${BLUE}║${NC}\n"
printf "${BLUE}║${NC}    http://localhost:5700                 ${BLUE}║${NC}\n"
printf "${BLUE}║${NC}                                          ${BLUE}║${NC}\n"
printf "${BLUE}║${NC}  Login default:                          ${BLUE}║${NC}\n"
printf "${BLUE}║${NC}    Admin     : admin / Admin@12345       ${BLUE}║${NC}\n"
printf "${BLUE}║${NC}    Bendahara : bendahara1 / User@12345   ${BLUE}║${NC}\n"
printf "${BLUE}║${NC}    Approver  : approver1 / User@12345    ${BLUE}║${NC}\n"
printf "${BLUE}╚══════════════════════════════════════════╝${NC}\n"
printf "\n"
pr "$YELLOW" "PENTING: Ganti semua password default setelah login pertama!"
pr "$YELLOW" "PENTING: Update Cloudflare Turnstile SITE KEY di frontend/index.html"
printf "\n"

# ── Tanya langsung jalankan? ──
read -rp "Jalankan server sekarang? (y/n) [y]: " RUN_NOW
RUN_NOW="${RUN_NOW:-y}"
if [[ "$RUN_NOW" =~ ^[Yy]$ ]]; then
    printf "\n"
    pr "$GREEN" "Menjalankan server di http://localhost:5700 ..."
    cd backend && "$NODE_BIN" server.js
fi
