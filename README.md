# 🏍️ Jakarta Max Owners — KAS Management System

Sistem manajemen keuangan kas komunitas motor Jakarta Max Owners.
Dibangun dengan **Node.js + Express + PostgreSQL**. Tidak perlu Docker.

---

## ✨ Fitur Lengkap

| Fitur | Keterangan |
|-------|------------|
| **Multi-Role Auth** | Admin, Bendahara, Approver (3 level), Viewer |
| **Cloudflare Turnstile** | CAPTCHA anti-bot pada halaman login |
| **Kas Kecil & Kas Besar** | Transaksi terpisah, saldo terpisah |
| **3-Step Approval** | Pengeluaran Kas Besar wajib disetujui 3 approver berurutan |
| **Dashboard + Charts** | Grafik arus kas 12 bulan & breakdown per kategori |
| **Audit Log** | Semua aktivitas pengguna tercatat lengkap |
| **Export Excel (.xlsx)** | Laporan enterprise dengan format profesional |
| **Export PDF** | Laporan PDF landscape siap cetak |
| **Rate Limiting** | Proteksi brute force & flooding |
| **JWT Session** | Token aman, sesi 8 jam |

---

## ⚙️ Prasyarat

1. **Node.js** v18+ → https://nodejs.org
2. **PostgreSQL** v14+ → https://www.postgresql.org/download/

Cek di terminal:
```
node -v
psql --version
```

---

## 🚀 Instalasi Cepat

### Windows
Double-click `setup.bat`, atau jalankan di Command Prompt:
```bat
setup.bat
```

### Linux / macOS
```bash
chmod +x setup.sh
./setup.sh
```

Script akan otomatis: buat .env, buat database, migrasi tabel, dan isi data awal.

---

## ▶️ Menjalankan Server

**Windows:** double-click `start.bat`

**Linux/macOS:**
```bash
./start.sh
```

**Manual:**
```bash
cd backend
npm start
```

Buka: **http://localhost:5700**

---

## 🔐 Akun Default

| Role | Username | Password |
|------|----------|----------|
| Admin | `admin` | `Admin@12345` |
| Bendahara | `bendahara1` | `xx!User@*****!!XX` |
| Approver 1 | `approver1` | `xx!User@*****!!XX` |
| Approver 2 | `approver2` | `xx!User@*****!!XX` |
| Approver 3 | `approver3` | `xx!User@*****!!XX` |
| Viewer | `viewer1` | `xx!User@*****!!XX` |

> Segera ganti semua password setelah login pertama!

---

## 🔑 Setup Cloudflare Turnstile (CAPTCHA)

1. Buka https://dash.cloudflare.com → **Turnstile** → **Add site**
2. Daftarkan domain Anda (gunakan `localhost` untuk testing lokal)
3. Salin **Site Key** → paste di `frontend/index.html`:
   ```html
   data-sitekey="PASTE_SITE_KEY_DISINI"
   ```
4. Salin **Secret Key** → paste di `backend/.env`:
   ```
   CLOUDFLARE_TURNSTILE_SECRET=PASTE_SECRET_KEY_DISINI
   ```

> Untuk testing lokal tanpa CAPTCHA aktif, token `dev-bypass` sudah dikecualikan di backend.

---

## 📁 Struktur Proyek

```
jakarta-max-kas/
├── backend/
│   ├── db/
│   │   ├── migrate.js      ← Buat tabel PostgreSQL
│   │   ├── seed.js         ← Data awal
│   │   └── pool.js         ← Koneksi database
│   ├── middleware/
│   │   └── auth.js         ← JWT + role guard
│   ├── routes/
│   │   ├── auth.js         ← Login, logout
│   │   ├── users.js        ← Manajemen user
│   │   ├── transactions.js ← Transaksi + approval
│   │   ├── reports.js      ← Dashboard, laporan, audit
│   │   └── export.js       ← Export Excel & PDF
│   ├── utils/audit.js
│   ├── .env                ← Dibuat saat setup
│   ├── package.json
│   └── server.js           ← Entry point, port 5700
├── frontend/
│   └── index.html          ← SPA, di-serve oleh Express
├── setup.sh / setup.bat    ← Setup otomatis
├── start.sh / start.bat    ← Jalankan server
└── README.md
```

---

## 🔄 Alur Approval Kas Besar

```
Buat Transaksi → Pilih 3 Approver → PENDING
  → Approver #1 Setuju
  → Approver #2 Setuju
  → Approver #3 Setuju
  → APPROVED ✅

Jika salah satu TOLAK → langsung REJECTED ❌
```

---

## 🛡️ Hak Akses

| Fitur | Admin | Bendahara | Approver | Viewer |
|-------|:-----:|:---------:|:--------:|:------:|
| Dashboard & Laporan | ✅ | ✅ | ✅ | ✅ |
| Export Excel/PDF | ✅ | ✅ | ✅ | ✅ |
| Buat Transaksi | ✅ | ✅ | ❌ | ❌ |
| Approve/Tolak | ✅ | ❌ | ✅ | ❌ |
| Manajemen User | ✅ | ❌ | ❌ | ❌ |

---

## 🆘 Troubleshooting

| Masalah | Solusi |
|---------|--------|
| Port sudah dipakai | Ubah `PORT=5800` di `backend/.env` |
| Gagal konek DB | Cek username/password PostgreSQL di `.env` |
| Database tidak ada | `createdb -U postgres jakarta_max_kas` |
| Error modules | `cd backend && rm -rf node_modules && npm install` |
| Reset database | `node db/migrate.js` lalu `node db/seed.js` |
