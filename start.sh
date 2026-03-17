#!/usr/bin/env bash
# ============================================================
#  Jakarta Max Owners — KAS System
#  Start Script (mendukung PM2 dan Node langsung)
#  Gunakan: bash start.sh
# ============================================================

# Load nvm jika ada
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"

# Cari node
NODE_BIN=$(which node 2>/dev/null)
if [ -z "$NODE_BIN" ]; then
    for p in /usr/local/bin/node /usr/bin/node /opt/homebrew/bin/node; do
        [ -x "$p" ] && NODE_BIN="$p" && break
    done
fi
if [ -z "$NODE_BIN" ]; then
    echo "ERROR: Node.js tidak ditemukan. Jalankan: bash setup.sh"
    exit 1
fi

NPM_BIN="$(dirname "$NODE_BIN")/npm"
PM2_BIN="$(dirname "$NODE_BIN")/pm2"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo "  Jakarta Max Owners KAS System"
echo "  =============================="

# ── Cek apakah PM2 tersedia ──
if [ -x "$PM2_BIN" ] || command -v pm2 &>/dev/null; then
    PM2_BIN=$(command -v pm2 2>/dev/null || echo "$PM2_BIN")
    echo "  PM2 ditemukan: $PM2_BIN"
    echo ""
    echo "  Pilih mode jalankan:"
    echo "  [1] PM2 (recommended - background, auto-restart)"
    echo "  [2] Node langsung (foreground, Ctrl+C untuk stop)"
    echo ""
    read -rp "  Pilihan [1]: " CHOICE
    CHOICE="${CHOICE:-1}"
else
    echo "  PM2 tidak ditemukan."
    echo ""
    echo "  Install PM2? (recommended untuk production)"
    echo "  [1] Install PM2 sekarang lalu jalankan"
    echo "  [2] Jalankan langsung dengan Node (tanpa PM2)"
    echo ""
    read -rp "  Pilihan [1]: " CHOICE
    if [ "$CHOICE" = "1" ]; then
        echo "  Menginstall PM2..."
        "$NPM_BIN" install -g pm2
        PM2_BIN=$(command -v pm2 2>/dev/null || "$(dirname "$NODE_BIN")/pm2")
        CHOICE="1"
    else
        CHOICE="2"
    fi
fi

echo ""

if [ "$CHOICE" = "1" ]; then
    # ── Jalankan dengan PM2 ──
    mkdir -p "$SCRIPT_DIR/logs"
    cd "$SCRIPT_DIR"

    # Cek apakah sudah running
    if "$PM2_BIN" list 2>/dev/null | grep -q "jmo-kas"; then
        echo "  App 'jmo-kas' sudah berjalan di PM2."
        read -rp "  Restart? (y/n) [y]: " DO_RESTART
        DO_RESTART="${DO_RESTART:-y}"
        if [[ "$DO_RESTART" =~ ^[Yy]$ ]]; then
            "$PM2_BIN" restart jmo-kas
            echo ""
            echo "  OK  Server di-restart"
        fi
    else
        "$PM2_BIN" start ecosystem.config.js
        echo ""
        echo "  OK  Server berjalan di background via PM2"
    fi

    # Simpan agar auto-start saat reboot
    "$PM2_BIN" save 2>/dev/null

    echo ""
    echo "  Perintah PM2 yang berguna:"
    echo "    pm2 status          - lihat status"
    echo "    pm2 logs jmo-kas    - lihat log realtime"
    echo "    pm2 restart jmo-kas - restart server"
    echo "    pm2 stop jmo-kas    - stop server"
    echo "    pm2 startup         - auto-start saat reboot"
    echo ""
    echo "  Buka browser: http://localhost:5700"

else
    # ── Jalankan langsung dengan Node ──
    cd "$SCRIPT_DIR/backend"
    echo "  Menjalankan server (Ctrl+C untuk stop)..."
    echo "  Buka browser: http://localhost:5700"
    echo ""
    "$NODE_BIN" server.js
fi
