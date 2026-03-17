#!/bin/bash
# ============================================================
#  Jakarta Max Owners — KAS System
#  Setup Script untuk Linux / macOS
# ============================================================

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo ""
echo -e "${BLUE}╔══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Jakarta Max Owners — KAS System Setup  ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════╝${NC}"
echo ""

# --- Cek Node.js ---
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js tidak ditemukan!${NC}"
    echo "   Install dari: https://nodejs.org (versi 18 ke atas)"
    exit 1
fi
NODE_VER=$(node -v)
echo -e "${GREEN}✅ Node.js ${NODE_VER} ditemukan${NC}"

# --- Cek npm ---
if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ npm tidak ditemukan!${NC}"
    exit 1
fi
echo -e "${GREEN}✅ npm $(npm -v) ditemukan${NC}"

# --- Cek PostgreSQL ---
if ! command -v psql &> /dev/null; then
    echo -e "${RED}❌ PostgreSQL tidak ditemukan!${NC}"
    echo "   Install dari: https://www.postgresql.org/download/"
    exit 1
fi
echo -e "${GREEN}✅ PostgreSQL $(psql --version | awk '{print $3}') ditemukan${NC}"
echo ""

# --- Buat file .env ---
if [ ! -f "backend/.env" ]; then
    echo -e "${YELLOW}📝 Membuat file konfigurasi backend/.env ...${NC}"
    
    read -p "   PostgreSQL host [localhost]: " DB_HOST
    DB_HOST=${DB_HOST:-localhost}
    
    read -p "   PostgreSQL port [5432]: " DB_PORT
    DB_PORT=${DB_PORT:-5432}
    
    read -p "   PostgreSQL username [postgres]: " DB_USER
    DB_USER=${DB_USER:-postgres}
    
    read -s -p "   PostgreSQL password: " DB_PASSWORD
    echo ""
    
    read -p "   Nama database [jakarta_max_kas]: " DB_NAME
    DB_NAME=${DB_NAME:-jakarta_max_kas}

    JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))" 2>/dev/null || echo "jmo_secret_$(date +%s)_change_this_in_production")

    cat > backend/.env << EOF
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
EOF
    echo -e "${GREEN}   ✅ File .env berhasil dibuat${NC}"
else
    echo -e "${GREEN}✅ File backend/.env sudah ada, melewati konfigurasi${NC}"
    source backend/.env
    DB_NAME=${DB_NAME:-jakarta_max_kas}
    DB_USER=${DB_USER:-postgres}
    DB_HOST=${DB_HOST:-localhost}
    DB_PORT=${DB_PORT:-5432}
fi

echo ""

# --- Buat database ---
echo -e "${YELLOW}🗄️  Membuat database PostgreSQL '${DB_NAME}' ...${NC}"
if psql -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" -lqt 2>/dev/null | cut -d \| -f 1 | grep -qw "$DB_NAME"; then
    echo -e "${GREEN}   ✅ Database sudah ada${NC}"
else
    createdb -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" "$DB_NAME" 2>/dev/null && \
        echo -e "${GREEN}   ✅ Database '${DB_NAME}' berhasil dibuat${NC}" || \
        echo -e "${YELLOW}   ⚠️  Tidak bisa membuat otomatis. Buat manual: createdb ${DB_NAME}${NC}"
fi

echo ""

# --- Install dependencies ---
echo -e "${YELLOW}📦 Menginstall dependencies Node.js ...${NC}"
cd backend
npm install --silent
echo -e "${GREEN}✅ Dependencies terinstall${NC}"
echo ""

# --- Migrasi database ---
echo -e "${YELLOW}🔄 Menjalankan migrasi database ...${NC}"
node db/migrate.js
echo ""

# --- Seed data awal ---
echo -e "${YELLOW}🌱 Mengisi data awal ...${NC}"
node db/seed.js
echo ""

cd ..

# --- Ringkasan ---
echo -e "${BLUE}╔══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║         SETUP SELESAI! 🎉                ║${NC}"
echo -e "${BLUE}╠══════════════════════════════════════════╣${NC}"
echo -e "${BLUE}║${NC}  Jalankan server:                        ${BLUE}║${NC}"
echo -e "${BLUE}║${NC}  ${GREEN}cd backend && npm start${NC}                  ${BLUE}║${NC}"
echo -e "${BLUE}║${NC}                                          ${BLUE}║${NC}"
echo -e "${BLUE}║${NC}  Buka browser:                           ${BLUE}║${NC}"
echo -e "${BLUE}║${NC}  ${GREEN}http://localhost:5700${NC}                    ${BLUE}║${NC}"
echo -e "${BLUE}║${NC}                                          ${BLUE}║${NC}"
echo -e "${BLUE}║${NC}  Login default:                          ${BLUE}║${NC}"
echo -e "${BLUE}║${NC}  Admin     : admin / Admin@12345         ${BLUE}║${NC}"
echo -e "${BLUE}║${NC}  Bendahara : bendahara1 / User@12345     ${BLUE}║${NC}"
echo -e "${BLUE}║${NC}  Approver  : approver1 / User@12345      ${BLUE}║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}⚠️  PENTING: Ganti semua password default setelah login pertama!${NC}"
echo -e "${YELLOW}⚠️  Daftarkan Cloudflare Turnstile dan update SITE KEY di frontend/index.html${NC}"
echo ""

# --- Tanya apakah langsung jalankan ---
read -p "Jalankan server sekarang? (y/n) [y]: " RUN_NOW
RUN_NOW=${RUN_NOW:-y}
if [[ "$RUN_NOW" =~ ^[Yy]$ ]]; then
    echo ""
    echo -e "${GREEN}🚀 Menjalankan server di http://localhost:5700 ...${NC}"
    cd backend && npm start
fi
