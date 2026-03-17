const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const moment = require('moment');

// GET dashboard summary
router.get('/summary', authenticate, async (req, res) => {
  try {
    // Current balances
    const balanceResult = await pool.query(`SELECT * FROM v_kas_summary`);

    const balances = { kas_kecil: {}, kas_besar: {} };
    balanceResult.rows.forEach(r => {
      balances[r.kas_type] = {
        totalIncome: parseFloat(r.total_income) || 0,
        totalExpense: parseFloat(r.total_expense) || 0,
        currentBalance: parseFloat(r.current_balance) || 0,
        pendingCount: parseInt(r.pending_count) || 0
      };
    });

    // Recent transactions
    const recentResult = await pool.query(
      `SELECT t.transaction_number, t.kas_type, t.transaction_type, t.amount, t.description,
              t.status, t.transaction_date, c.name as category_name, u.full_name as created_by_name
       FROM kas_transactions t
       LEFT JOIN kas_categories c ON t.category_id = c.id
       LEFT JOIN users u ON t.created_by = u.id
       ORDER BY t.created_at DESC LIMIT 10`
    );

    // Monthly chart data (last 12 months)
    const chartResult = await pool.query(
      `SELECT 
         DATE_TRUNC('month', transaction_date) as month,
         kas_type,
         SUM(CASE WHEN transaction_type = 'income' AND status = 'approved' THEN amount ELSE 0 END) as income,
         SUM(CASE WHEN transaction_type = 'expense' AND status = 'approved' THEN amount ELSE 0 END) as expense
       FROM kas_transactions
       WHERE transaction_date >= NOW() - INTERVAL '12 months'
       GROUP BY DATE_TRUNC('month', transaction_date), kas_type
       ORDER BY month ASC`
    );

    // Category breakdown (current month)
    const categoryResult = await pool.query(
      `SELECT c.name, c.color, t.kas_type, t.transaction_type,
              SUM(t.amount) as total
       FROM kas_transactions t
       JOIN kas_categories c ON t.category_id = c.id
       WHERE t.status = 'approved'
         AND DATE_TRUNC('month', t.transaction_date) = DATE_TRUNC('month', CURRENT_DATE)
       GROUP BY c.name, c.color, t.kas_type, t.transaction_type
       ORDER BY total DESC`
    );

    // Pending approvals count
    const pendingApprovals = await pool.query(
      `SELECT COUNT(*) FROM kas_transactions WHERE status = 'pending'`
    );

    // User count
    const userCount = await pool.query(
      `SELECT role, COUNT(*) FROM users WHERE is_active = TRUE GROUP BY role`
    );

    res.json({
      success: true,
      data: {
        balances,
        recentTransactions: recentResult.rows,
        chartData: chartResult.rows,
        categoryBreakdown: categoryResult.rows,
        pendingApprovals: parseInt(pendingApprovals.rows[0].count),
        userStats: userCount.rows
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET monthly report
router.get('/monthly', authenticate, async (req, res) => {
  const { year = moment().year(), month = moment().month() + 1, kasType } = req.query;

  try {
    let conditions = `WHERE DATE_PART('year', transaction_date) = $1 AND DATE_PART('month', transaction_date) = $2 AND status = 'approved'`;
    let params = [year, month];

    if (kasType) {
      conditions += ` AND kas_type = $3`;
      params.push(kasType);
    }

    const result = await pool.query(
      `SELECT t.*, c.name as category_name, c.color, u.full_name as created_by_name
       FROM kas_transactions t
       LEFT JOIN kas_categories c ON t.category_id = c.id
       LEFT JOIN users u ON t.created_by = u.id
       ${conditions}
       ORDER BY transaction_date ASC, created_at ASC`,
      params
    );

    // Summary
    const summary = await pool.query(
      `SELECT kas_type, transaction_type, SUM(amount) as total, COUNT(*) as count
       FROM kas_transactions
       ${conditions}
       GROUP BY kas_type, transaction_type`,
      params
    );

    res.json({ success: true, data: { transactions: result.rows, summary: summary.rows } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET audit logs
router.get('/audit', authenticate, async (req, res) => {
  const { page = 1, limit = 50, action, userId, entityType, startDate, endDate } = req.query;
  const offset = (page - 1) * limit;

  let conditions = [];
  let params = [];
  let paramIdx = 1;

  if (action) { conditions.push(`al.action ILIKE $${paramIdx++}`); params.push(`%${action}%`); }
  if (userId) { conditions.push(`al.user_id = $${paramIdx++}`); params.push(userId); }
  if (entityType) { conditions.push(`al.entity_type = $${paramIdx++}`); params.push(entityType); }
  if (startDate) { conditions.push(`al.created_at >= $${paramIdx++}`); params.push(startDate); }
  if (endDate) { conditions.push(`al.created_at <= $${paramIdx++}`); params.push(endDate + ' 23:59:59'); }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const countResult = await pool.query(`SELECT COUNT(*) FROM audit_logs al ${whereClause}`, params);
    const total = parseInt(countResult.rows[0].count);

    params.push(limit, offset);
    const result = await pool.query(
      `SELECT al.*, u.full_name as user_name, u.username, u.role as user_role
       FROM audit_logs al
       LEFT JOIN users u ON al.user_id = u.id
       ${whereClause}
       ORDER BY al.created_at DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      params
    );

    res.json({
      success: true,
      data: result.rows,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / limit) }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET categories
router.get('/categories', authenticate, async (req, res) => {
  const { type } = req.query;
  try {
    const result = await pool.query(
      `SELECT * FROM kas_categories WHERE is_active = TRUE ${type ? 'AND type = $1' : ''} ORDER BY name`,
      type ? [type] : []
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST create category
router.post('/categories', authenticate, async (req, res) => {
  const { name, type, description, color, icon } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO kas_categories (name, type, description, color, icon, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [name, type, description || null, color || '#6366f1', icon || 'folder', req.user.id]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
