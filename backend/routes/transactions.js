const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { createAuditLog } = require('../utils/audit');
const { v4: uuidv4 } = require('uuid');
const moment = require('moment');
const fs = require('fs');
const multer = require('multer');
const path = require('path');


const uploadsDir = path.join(__dirname, '..', 'uploads', 'transactions');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, `${Date.now()}-${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { files: 4, fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/pdf'
    ];

    if (!allowedMimes.includes(file.mimetype)) {
      return cb(new Error('Format attachment tidak didukung. Gunakan JPG, PNG, WEBP, atau PDF'));
    }

    cb(null, true);
  }
});

// Generate transaction number
function generateTxNumber(kasType, txType) {
  const prefix = kasType === 'kas_kecil' ? 'KK' : 'KB';
  const typeCode = txType === 'income' ? 'IN' : 'EX';
  const date = moment().format('YYYYMMDD');
  const random = Math.floor(Math.random() * 9000) + 1000;
  return `${prefix}-${typeCode}-${date}-${random}`;
}

// GET all transactions with filters
router.get('/', authenticate, async (req, res) => {
  const {
    kasType, transactionType, status, startDate, endDate,
    categoryId, page = 1, limit = 20, search
  } = req.query;

  const offset = (page - 1) * limit;
  let conditions = [];
  let params = [];
  let paramIdx = 1;

  if (kasType) { conditions.push(`t.kas_type = $${paramIdx++}`); params.push(kasType); }
  if (transactionType) { conditions.push(`t.transaction_type = $${paramIdx++}`); params.push(transactionType); }
  if (status) { conditions.push(`t.status = $${paramIdx++}`); params.push(status); }
  if (categoryId) { conditions.push(`t.category_id = $${paramIdx++}`); params.push(categoryId); }
  if (startDate) { conditions.push(`t.transaction_date >= $${paramIdx++}`); params.push(startDate); }
  if (endDate) { conditions.push(`t.transaction_date <= $${paramIdx++}`); params.push(endDate); }
  if (search) {
    conditions.push(`(t.description ILIKE $${paramIdx} OR t.transaction_number ILIKE $${paramIdx} OR t.reference_number ILIKE $${paramIdx})`);
    params.push(`%${search}%`);
    paramIdx++;
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM kas_transactions t ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    params.push(limit, offset);
    const result = await pool.query(
      `SELECT t.*, c.name as category_name, c.color as category_color, c.icon as category_icon,
              u.full_name as created_by_name,
              (SELECT COUNT(*) FROM transaction_approvals WHERE transaction_id = t.id AND status = 'approved') as approval_count
       FROM kas_transactions t
       LEFT JOIN kas_categories c ON t.category_id = c.id
       LEFT JOIN users u ON t.created_by = u.id
       ${whereClause}
       ORDER BY t.transaction_date DESC, t.created_at DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      params
    );

    res.json({
      success: true,
      data: result.rows,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / limit) }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET single transaction with approvals
router.get('/:id', authenticate, async (req, res) => {
  try {
    const txResult = await pool.query(
      `SELECT t.*, c.name as category_name, c.color as category_color,
              u.full_name as created_by_name, u.username as created_by_username
       FROM kas_transactions t
       LEFT JOIN kas_categories c ON t.category_id = c.id
       LEFT JOIN users u ON t.created_by = u.id
       WHERE t.id = $1`,
      [req.params.id]
    );

    if (!txResult.rows.length) {
      return res.status(404).json({ success: false, message: 'Transaksi tidak ditemukan' });
    }

    const approvals = await pool.query(
      `SELECT ta.*, u.full_name as approver_name, u.username as approver_username
       FROM transaction_approvals ta
       LEFT JOIN users u ON ta.approver_id = u.id
       WHERE ta.transaction_id = $1 ORDER BY ta.approval_order`,
      [req.params.id]
    );

    res.json({ success: true, data: { ...txResult.rows[0], approvals: approvals.rows } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST create transaction
router.post('/', authenticate, authorize('admin', 'bendahara'), upload.array('attachments', 4), async (req, res) => {
  const {
    kasType, transactionType, categoryId, amount, description,
    referenceNumber, transactionDate, notes
  } = req.body;

  let approverIds = req.body.approverIds;
  if (typeof approverIds === 'string') {
    try {
      approverIds = JSON.parse(approverIds);
    } catch (e) {
      approverIds = [];
    }
  }

  if (!kasType || !transactionType || !amount || !description || !transactionDate) {
    return res.status(400).json({ success: false, message: 'Field wajib tidak lengkap' });
  }

  if (!req.files || req.files.length < 1) {
    return res.status(400).json({ success: false, message: 'Minimal 1 attachment wajib diupload' });
  }

  const attachmentUrls = req.files.slice(0, 4).map((file) => `/uploads/transactions/${file.filename}`);

  // Kas besar expense requires 3 approvers
  if (kasType === 'kas_besar' && transactionType === 'expense') {
    if (!approverIds || approverIds.length !== 3) {
      return res.status(400).json({
        success: false,
        message: 'Pengeluaran Kas Besar membutuhkan tepat 3 approver'
      });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const txNumber = generateTxNumber(kasType, transactionType);
    const status = (kasType === 'kas_besar' && transactionType === 'expense') ? 'pending' : 'approved';

    const txResult = await client.query(
      `INSERT INTO kas_transactions
       (transaction_number, kas_type, transaction_type, category_id, amount, description, reference_number, transaction_date, status, created_by, notes, attachment_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [txNumber, kasType, transactionType, categoryId || null, amount, description, referenceNumber || null, transactionDate, status, req.user.id, notes || null, JSON.stringify(attachmentUrls)]
    );

    const tx = txResult.rows[0];

    // Create approval workflow for kas_besar expenses
    if (kasType === 'kas_besar' && transactionType === 'expense' && approverIds) {
      for (let i = 0; i < approverIds.length; i++) {
        await client.query(
          `INSERT INTO transaction_approvals (transaction_id, approver_id, approval_order) VALUES ($1, $2, $3)`,
          [tx.id, approverIds[i], i + 1]
        );
      }
    }

    await client.query('COMMIT');

    await createAuditLog({
      userId: req.user.id,
      action: 'CREATE_TRANSACTION',
      entityType: 'transaction',
      entityId: tx.id,
      newValues: { txNumber, kasType, transactionType, amount, description, status },
      ipAddress: req.ip,
      description: `Membuat transaksi ${txNumber}`
    });

    res.status(201).json({ success: true, data: tx, message: 'Transaksi berhasil dibuat' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    client.release();
  }
});

// PUT update transaction (only pending, only creator or admin)
router.put('/:id', authenticate, authorize('admin', 'bendahara'), async (req, res) => {
  const { id } = req.params;

  try {
    const old = await pool.query('SELECT * FROM kas_transactions WHERE id = $1', [id]);
    if (!old.rows.length) return res.status(404).json({ success: false, message: 'Transaksi tidak ditemukan' });

    const tx = old.rows[0];
    if (tx.status !== 'pending' && req.user.role !== 'admin') {
      return res.status(400).json({ success: false, message: 'Hanya transaksi pending yang dapat diubah' });
    }
    if (tx.created_by !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Tidak berhak mengubah transaksi ini' });
    }

    const { categoryId, amount, description, referenceNumber, transactionDate, notes } = req.body;

    const result = await pool.query(
      `UPDATE kas_transactions SET
       category_id = COALESCE($1, category_id), amount = COALESCE($2, amount),
       description = COALESCE($3, description), reference_number = COALESCE($4, reference_number),
       transaction_date = COALESCE($5, transaction_date), notes = COALESCE($6, notes)
       WHERE id = $7 RETURNING *`,
      [categoryId, amount, description, referenceNumber, transactionDate, notes, id]
    );

    await createAuditLog({
      userId: req.user.id,
      action: 'UPDATE_TRANSACTION',
      entityType: 'transaction',
      entityId: id,
      oldValues: tx,
      newValues: result.rows[0],
      ipAddress: req.ip,
      description: `Update transaksi ${tx.transaction_number}`
    });

    res.json({ success: true, data: result.rows[0], message: 'Transaksi berhasil diupdate' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// POST approve/reject transaction
router.post('/:id/approve', authenticate, authorize('approver', 'admin'), async (req, res) => {
  const { id } = req.params;
  const { action, comments } = req.body; // action: 'approved' | 'rejected'

  if (!['approved', 'rejected'].includes(action)) {
    return res.status(400).json({ success: false, message: 'Action harus approved atau rejected' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const txResult = await client.query('SELECT * FROM kas_transactions WHERE id = $1', [id]);
    if (!txResult.rows.length) return res.status(404).json({ success: false, message: 'Transaksi tidak ditemukan' });

    const tx = txResult.rows[0];
    if (tx.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Transaksi bukan dalam status pending' });
    }

    // Find this approver's pending approval slot
    const approvalResult = await client.query(
      `SELECT * FROM transaction_approvals
       WHERE transaction_id = $1 AND approver_id = $2 AND status = 'pending'
       ORDER BY approval_order LIMIT 1`,
      [id, req.user.id]
    );

    if (!approvalResult.rows.length) {
      return res.status(403).json({ success: false, message: 'Anda tidak memiliki pending approval untuk transaksi ini' });
    }

    const approval = approvalResult.rows[0];

    // Check previous approvals are done
    if (approval.approval_order > 1) {
      const prevApproval = await client.query(
        `SELECT status FROM transaction_approvals
         WHERE transaction_id = $1 AND approval_order = $2`,
        [id, approval.approval_order - 1]
      );
      if (prevApproval.rows[0]?.status !== 'approved') {
        return res.status(400).json({ success: false, message: 'Approver sebelumnya belum menyetujui' });
      }
    }

    // Update this approval
    await client.query(
      `UPDATE transaction_approvals SET status = $1, comments = $2, approved_at = NOW()
       WHERE id = $3`,
      [action, comments || null, approval.id]
    );

    // If rejected, reject the whole transaction
    if (action === 'rejected') {
      await client.query(
        `UPDATE kas_transactions SET status = 'rejected' WHERE id = $1`,
        [id]
      );
    } else {
      // Check if all 3 approvals done
      const allApprovals = await client.query(
        `SELECT COUNT(*) FROM transaction_approvals WHERE transaction_id = $1 AND status = 'approved'`,
        [id]
      );
      const totalApprovals = await client.query(
        `SELECT COUNT(*) FROM transaction_approvals WHERE transaction_id = $1`,
        [id]
      );

      if (parseInt(allApprovals.rows[0].count) === parseInt(totalApprovals.rows[0].count)) {
        await client.query(
          `UPDATE kas_transactions SET status = 'approved' WHERE id = $1`, [id]
        );
      }
    }

    await client.query('COMMIT');

    await createAuditLog({
      userId: req.user.id,
      action: `TRANSACTION_${action.toUpperCase()}`,
      entityType: 'transaction',
      entityId: id,
      newValues: { action, comments, approvalOrder: approval.approval_order },
      ipAddress: req.ip,
      description: `${action === 'approved' ? 'Menyetujui' : 'Menolak'} transaksi ${tx.transaction_number} (step ${approval.approval_order})`
    });

    res.json({ success: true, message: `Transaksi berhasil ${action === 'approved' ? 'disetujui' : 'ditolak'}` });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    client.release();
  }
});

// GET pending approvals for current approver
router.get('/approvals/pending', authenticate, authorize('approver', 'admin'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.*, ta.approval_order, ta.id as approval_id,
              c.name as category_name, u.full_name as created_by_name
       FROM transaction_approvals ta
       JOIN kas_transactions t ON ta.transaction_id = t.id
       LEFT JOIN kas_categories c ON t.category_id = c.id
       LEFT JOIN users u ON t.created_by = u.id
       WHERE ta.approver_id = $1 AND ta.status = 'pending' AND t.status = 'pending'
       ORDER BY t.created_at ASC`,
      [req.user.id]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// DELETE (cancel) transaction - admin or creator
router.delete('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  try {
    const old = await pool.query('SELECT * FROM kas_transactions WHERE id = $1', [id]);
    if (!old.rows.length) return res.status(404).json({ success: false, message: 'Transaksi tidak ditemukan' });

    const tx = old.rows[0];
    if (tx.status === 'approved' && req.user.role !== 'admin') {
      return res.status(400).json({ success: false, message: 'Transaksi yang sudah diapprove hanya bisa dibatalkan oleh admin' });
    }
    if (tx.created_by !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Tidak berhak membatalkan transaksi ini' });
    }

    await pool.query(`UPDATE kas_transactions SET status = 'cancelled' WHERE id = $1`, [id]);

    await createAuditLog({
      userId: req.user.id,
      action: 'CANCEL_TRANSACTION',
      entityType: 'transaction',
      entityId: id,
      oldValues: { status: tx.status },
      ipAddress: req.ip,
      description: `Membatalkan transaksi ${tx.transaction_number}`
    });

    res.json({ success: true, message: 'Transaksi berhasil dibatalkan' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ success: false, message: 'Maksimal 4 attachment' });
    }
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, message: 'Ukuran file maksimal 5MB per attachment' });
    }
  }

  if (err && err.message && err.message.includes('Format attachment')) {
    return res.status(400).json({ success: false, message: err.message });
  }

  return next(err);
});

module.exports = router;
