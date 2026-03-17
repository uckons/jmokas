const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { createAuditLog } = require('../utils/audit');

// Verify Cloudflare Turnstile
async function verifyCaptcha(token) {
  if (process.env.NODE_ENV === 'development' && token === 'dev-bypass') return true;
  try {
    const response = await axios.post('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      secret: process.env.CLOUDFLARE_TURNSTILE_SECRET,
      response: token
    });
    return response.data.success;
  } catch {
    return false;
  }
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password, captchaToken } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username dan password diperlukan' });
  }

  // Verify captcha
  if (!captchaToken) {
    return res.status(400).json({ success: false, message: 'Verifikasi CAPTCHA diperlukan' });
  }
  const captchaValid = await verifyCaptcha(captchaToken);
  if (!captchaValid) {
    return res.status(400).json({ success: false, message: 'Verifikasi CAPTCHA gagal' });
  }

  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE (username = $1 OR email = $1) AND is_active = TRUE',
      [username]
    );

    if (!result.rows.length) {
      return res.status(401).json({ success: false, message: 'Username atau password salah' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      await createAuditLog({
        userId: user.id,
        action: 'LOGIN_FAILED',
        entityType: 'user',
        entityId: user.id,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        description: `Login gagal untuk user ${user.username}`
      });
      return res.status(401).json({ success: false, message: 'Username atau password salah' });
    }

    // Update last login
    await pool.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    await createAuditLog({
      userId: user.id,
      action: 'LOGIN_SUCCESS',
      entityType: 'user',
      entityId: user.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      description: `User ${user.username} berhasil login`
    });

    res.json({
      success: true,
      message: 'Login berhasil',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        fullName: user.full_name,
        role: user.role,
        avatarUrl: user.avatar_url
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req, res) => {
  res.json({ success: true, user: req.user });
});

// POST /api/auth/logout
router.post('/logout', authenticate, async (req, res) => {
  await createAuditLog({
    userId: req.user.id,
    action: 'LOGOUT',
    entityType: 'user',
    entityId: req.user.id,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    description: `User ${req.user.username} logout`
  });
  res.json({ success: true, message: 'Logout berhasil' });
});

// PUT /api/auth/change-password
router.put('/change-password', authenticate, async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ success: false, message: 'Password lama dan baru diperlukan' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ success: false, message: 'Password minimal 8 karakter' });
  }

  try {
    const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const valid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!valid) {
      return res.status(400).json({ success: false, message: 'Password lama tidak sesuai' });
    }

    const newHash = await bcrypt.hash(newPassword, 12);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, req.user.id]);

    await createAuditLog({
      userId: req.user.id,
      action: 'CHANGE_PASSWORD',
      entityType: 'user',
      entityId: req.user.id,
      ipAddress: req.ip,
      description: `User ${req.user.username} mengubah password`
    });

    res.json({ success: true, message: 'Password berhasil diubah' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
