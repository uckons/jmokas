require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'jakarta_max_kas',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
});

async function seed() {
  const client = await pool.connect();
  try {
    console.log('🌱 Seeding database...');

    const adminHash = await bcrypt.hash('Admin@12345', 12);
    const userHash = await bcrypt.hash('User@12345', 12);

    // Insert users
    const usersResult = await client.query(`
      INSERT INTO users (username, email, password_hash, full_name, role) VALUES
      ('admin', 'admin@jakartamax.com', $1, 'Administrator System', 'admin'),
      ('bendahara1', 'bendahara@jakartamax.com', $2, 'Budi Santoso', 'bendahara'),
      ('approver1', 'approver1@jakartamax.com', $2, 'Agus Wijaya', 'approver'),
      ('approver2', 'approver2@jakartamax.com', $2, 'Sari Dewi', 'approver'),
      ('approver3', 'approver3@jakartamax.com', $2, 'Hendra Kusuma', 'approver'),
      ('viewer1', 'viewer@jakartamax.com', $2, 'Rini Wulandari', 'viewer')
      ON CONFLICT (username) DO NOTHING
      RETURNING id, role
    `, [adminHash, userHash]);

    console.log(`✅ Users seeded: ${usersResult.rowCount} users`);

    // Get admin user id
    const adminUser = await client.query(`SELECT id FROM users WHERE username = 'admin'`);
    const adminId = adminUser.rows[0].id;

    // Insert categories
    await client.query(`
      INSERT INTO kas_categories (name, type, description, color, icon, created_by) VALUES
      ('Iuran Anggota', 'kas_kecil', 'Iuran bulanan anggota', '#10b981', 'users', $1),
      ('Donasi', 'kas_kecil', 'Donasi dari anggota atau pihak luar', '#3b82f6', 'heart', $1),
      ('ATK & Perlengkapan', 'kas_kecil', 'Alat tulis dan perlengkapan kantor', '#f59e0b', 'pencil', $1),
      ('Konsumsi & Catering', 'kas_kecil', 'Biaya konsumsi kegiatan', '#ef4444', 'coffee', $1),
      ('Transport Operasional', 'kas_kecil', 'Biaya transportasi operasional kecil', '#8b5cf6', 'car', $1),
      ('Iuran Khusus', 'kas_besar', 'Iuran khusus kegiatan besar', '#10b981', 'star', $1),
      ('Sponsorship', 'kas_besar', 'Dana dari sponsor kegiatan', '#3b82f6', 'briefcase', $1),
      ('Event & Gathering', 'kas_besar', 'Biaya pelaksanaan event dan gathering', '#ef4444', 'calendar', $1),
      ('Touring & Perjalanan', 'kas_besar', 'Biaya touring dan perjalanan bersama', '#f59e0b', 'map', $1),
      ('Pembelian Inventaris', 'kas_besar', 'Pembelian barang inventaris klub', '#8b5cf6', 'package', $1),
      ('Biaya Administrasi', 'kas_besar', 'Biaya administrasi dan legal', '#6366f1', 'file-text', $1),
      ('Dana Sosial', 'kas_besar', 'Dana untuk kegiatan sosial dan charity', '#ec4899', 'gift', $1)
      ON CONFLICT DO NOTHING
    `, [adminId]);

    console.log('✅ Categories seeded');
    console.log('');
    console.log('📋 Default Credentials:');
    console.log('  Admin     : admin / Admin@12345');
    console.log('  Bendahara : bendahara1 / User@12345');
    console.log('  Approver 1: approver1 / User@12345');
    console.log('  Approver 2: approver2 / User@12345');
    console.log('  Approver 3: approver3 / User@12345');
    console.log('  Viewer    : viewer1 / User@12345');
    console.log('');
    console.log('🚀 Database ready!');
  } catch (err) {
    console.error('❌ Seed error:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(console.error);
