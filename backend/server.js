require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5700;

// Trust the first reverse proxy (e.g. Nginx/PM2) so req.ip and rate limiting
// work correctly when X-Forwarded-For headers are present.
const trustProxySetting = process.env.TRUST_PROXY;
if (typeof trustProxySetting === 'string') {
  if (trustProxySetting === 'true' || trustProxySetting === 'false') {
    app.set('trust proxy', trustProxySetting === 'true');
  } else if (!Number.isNaN(Number(trustProxySetting))) {
    app.set('trust proxy', Number(trustProxySetting));
  } else {
    app.set('trust proxy', trustProxySetting);
  }
} else {
  app.set('trust proxy', 1);
}

// Security middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(morgan('combined'));

// CORS
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  message: { success: false, message: 'Terlalu banyak request, coba lagi nanti' }
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Terlalu banyak percobaan login, coba lagi dalam 15 menit' }
});

app.use('/api/', apiLimiter);
app.use('/api/auth/login', loginLimiter);

// Body parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static files (uploads)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/transactions', require('./routes/transactions'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/export', require('./routes/export'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    service: 'Jakarta Max Owners KAS System',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    port: PORT
  });
});

// Serve frontend (selalu aktif — tidak perlu build step)
app.use(express.static(path.join(__dirname, '../frontend')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, message: 'Internal Server Error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Endpoint tidak ditemukan' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('╔════════════════════════════════════════════╗');
  console.log('║    JAKARTA MAX OWNERS - KAS SYSTEM         ║');
  console.log('╠════════════════════════════════════════════╣');
  console.log(`║  🚀 Server running on port ${PORT}            ║`);
  console.log(`║  📊 API: http://localhost:${PORT}/api          ║`);
  console.log(`║  🏥 Health: http://localhost:${PORT}/api/health ║`);
  console.log('╚════════════════════════════════════════════╝');
});

module.exports = app;
