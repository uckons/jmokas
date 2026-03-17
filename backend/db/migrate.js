require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'jakarta_max_kas',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
});

const migrations = `
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(100) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'bendahara', 'approver', 'viewer')),
  avatar_url VARCHAR(255),
  is_active BOOLEAN DEFAULT TRUE,
  last_login TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kas_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('kas_kecil', 'kas_besar')),
  description TEXT,
  color VARCHAR(7) DEFAULT '#6366f1',
  icon VARCHAR(50) DEFAULT 'folder',
  is_active BOOLEAN DEFAULT TRUE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kas_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transaction_number VARCHAR(30) UNIQUE NOT NULL,
  kas_type VARCHAR(20) NOT NULL CHECK (kas_type IN ('kas_kecil', 'kas_besar')),
  transaction_type VARCHAR(10) NOT NULL CHECK (transaction_type IN ('income', 'expense')),
  category_id UUID REFERENCES kas_categories(id),
  amount DECIMAL(15,2) NOT NULL,
  description TEXT NOT NULL,
  reference_number VARCHAR(50),
  transaction_date DATE NOT NULL,
  attachment_url VARCHAR(255),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  created_by UUID NOT NULL REFERENCES users(id),
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transaction_approvals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transaction_id UUID NOT NULL REFERENCES kas_transactions(id) ON DELETE CASCADE,
  approver_id UUID NOT NULL REFERENCES users(id),
  approval_order INTEGER NOT NULL CHECK (approval_order IN (1, 2, 3)),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  comments TEXT,
  approved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(transaction_id, approval_order)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id UUID,
  old_values JSONB,
  new_values JSONB,
  ip_address INET,
  user_agent TEXT,
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kas_balances (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  kas_type VARCHAR(20) NOT NULL CHECK (kas_type IN ('kas_kecil', 'kas_besar')),
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  opening_balance DECIMAL(15,2) DEFAULT 0,
  total_income DECIMAL(15,2) DEFAULT 0,
  total_expense DECIMAL(15,2) DEFAULT 0,
  closing_balance DECIMAL(15,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(kas_type, year, month)
);

CREATE TABLE IF NOT EXISTS member_iuran (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_name VARCHAR(100) NOT NULL,
  member_id VARCHAR(50),
  vehicle_plate VARCHAR(20),
  iuran_type VARCHAR(20) DEFAULT 'monthly',
  amount DECIMAL(15,2) NOT NULL,
  payment_date DATE NOT NULL,
  period_month INTEGER,
  period_year INTEGER,
  status VARCHAR(20) DEFAULT 'paid',
  transaction_id UUID REFERENCES kas_transactions(id),
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_kas_type ON kas_transactions(kas_type);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON kas_transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON kas_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_approvals_transaction ON transaction_approvals(transaction_id);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $func$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$func$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_transactions_updated_at ON kas_transactions;
CREATE TRIGGER trg_transactions_updated_at
  BEFORE UPDATE ON kas_transactions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE VIEW v_kas_summary AS
SELECT 
  kas_type,
  SUM(CASE WHEN transaction_type = 'income' AND status = 'approved' THEN amount ELSE 0 END) as total_income,
  SUM(CASE WHEN transaction_type = 'expense' AND status = 'approved' THEN amount ELSE 0 END) as total_expense,
  SUM(CASE WHEN transaction_type = 'income' AND status = 'approved' THEN amount 
      WHEN transaction_type = 'expense' AND status = 'approved' THEN -amount 
      ELSE 0 END) as current_balance,
  COUNT(*) FILTER (WHERE status = 'pending') as pending_count
FROM kas_transactions
GROUP BY kas_type;
`;

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🚀 Running migrations...');
    await client.query(migrations);
    console.log('✅ Migrations completed successfully!');
  } catch (err) {
    console.error('❌ Migration error:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch(console.error);
