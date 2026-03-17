const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { createAuditLog } = require('../utils/audit');

// GET all users (admin only)
router.get('/', authenticate, authorize('admin'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, email, full_name, role, is_active, last_login, created_at
       FROM users ORDER BY created_at DESC`
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST create user (admin only)
router.post('/', authenticate, authorize('admin'), async (req, res) => {
  const { username, email, password, fullName, role } = req.body;

  if (!username || !email || !password || !fullName || !role) {
    return res.status(400).json({ success: false, message: 'Semua field diperlukan' });
  }
  if (!['admin', 'bendahara', 'approver', 'viewer'].includes(role)) {
    return res.status(400).json({ success: false, message: 'Role tidak valid' });
  }

  try {
    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (username, email, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, username, email, full_name, role`,
      [username, email, hash, fullName, role]
    );

    await createAuditLog({
      userId: req.user.id,
      action: 'CREATE_USER',
      entityType: 'user',
      entityId: result.rows[0].id,
      newValues: { username, email, fullName, role },
      ipAddress: req.ip,
      description: `Admin membuat user baru: ${username}`
    });

    res.status(201).json({ success: true, data: result.rows[0], message: 'User berhasil dibuat' });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ success: false, message: 'Username atau email sudah digunakan' });
    }
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// PUT update user
router.put('/:id', authenticate, authorize('admin'), async (req, res) => {
  const { id } = req.params;
  const { fullName, email, role, isActive, password } = req.body;

  try {
    const old = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (!old.rows.length) return res.status(404).json({ success: false, message: 'User tidak ditemukan' });

    if (role && !['admin', 'bendahara', 'approver', 'viewer'].includes(role)) {
      return res.status(400).json({ success: false, message: 'Role tidak valid' });
    }
    if (password && password.length < 8) {
      return res.status(400).json({ success: false, message: 'Password minimal 8 karakter' });
    }

    let passwordHash = null;
    if (password) {
      passwordHash = await bcrypt.hash(password, 12);
    }

    const result = await pool.query(
      `UPDATE users SET full_name = COALESCE($1, full_name), email = COALESCE($2, email),
       role = COALESCE($3, role), is_active = COALESCE($4, is_active),
       password_hash = COALESCE($5, password_hash)
       WHERE id = $6 RETURNING id, username, email, full_name, role, is_active`,
      [fullName, email, role, isActive, passwordHash, id]
    );

    await createAuditLog({
      userId: req.user.id,
      action: 'UPDATE_USER',
      entityType: 'user',
      entityId: id,
      oldValues: old.rows[0],
      newValues: result.rows[0],
      ipAddress: req.ip,
      description: `Update user ${old.rows[0].username}`
    });

    res.json({ success: true, data: result.rows[0], message: 'User berhasil diupdate' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// DELETE user (soft delete)
router.delete('/:id', authenticate, authorize('admin'), async (req, res) => {
  const { id } = req.params;
  if (id === req.user.id) {
    return res.status(400).json({ success: false, message: 'Tidak dapat menghapus akun sendiri' });
  }

  try {
    await pool.query('UPDATE users SET is_active = FALSE WHERE id = $1', [id]);
    await createAuditLog({
      userId: req.user.id,
      action: 'DELETE_USER',
      entityType: 'user',
      entityId: id,
      ipAddress: req.ip,
      description: `Admin menonaktifkan user ID: ${id}`
    });
    res.json({ success: true, message: 'User berhasil dinonaktifkan' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});


// DELETE user permanently (admin only)
router.delete('/:id/permanent', authenticate, authorize('admin'), async (req, res) => {
  const { id } = req.params;
  if (id === req.user.id) {
    return res.status(400).json({ success: false, message: 'Tidak dapat menghapus akun sendiri' });
  }

  try {
    const userResult = await pool.query('SELECT id, username, full_name FROM users WHERE id = $1', [id]);
    if (!userResult.rows.length) {
      return res.status(404).json({ success: false, message: 'User tidak ditemukan' });
    }

    const refResult = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM kas_transactions WHERE created_by = $1) AS tx_count,
         (SELECT COUNT(*) FROM transaction_approvals WHERE approver_id = $1) AS approval_count,
         (SELECT COUNT(*) FROM kas_categories WHERE created_by = $1) AS category_count,
         (SELECT COUNT(*) FROM member_iuran WHERE created_by = $1) AS iuran_count`,
      [id]
    );

    const refs = refResult.rows[0];
    const hasReferences = [refs.tx_count, refs.approval_count, refs.category_count, refs.iuran_count]
      .some((count) => Number(count) > 0);

    if (hasReferences) {
      return res.status(400).json({
        success: false,
        message: 'User memiliki data transaksi/approval, gunakan Nonaktifkan untuk menjaga histori'
      });
    }

    await pool.query('DELETE FROM users WHERE id = $1', [id]);

    await createAuditLog({
      userId: req.user.id,
      action: 'PERMANENT_DELETE_USER',
      entityType: 'user',
      entityId: id,
      oldValues: userResult.rows[0],
      ipAddress: req.ip,
      description: `Admin menghapus permanen user: ${userResult.rows[0].username}`
    });

    res.json({ success: true, message: 'User berhasil dihapus permanen' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET approvers list
router.get('/approvers/list', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, full_name, username, email FROM users WHERE role = 'approver' AND is_active = TRUE ORDER BY full_name`
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
