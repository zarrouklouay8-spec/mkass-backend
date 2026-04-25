// src/index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

// ── MIDDLEWARE ───────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '10mb' })); // 10mb for base64 cover images
app.use(express.urlencoded({ extended: true }));

// ── HEALTH CHECK ─────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'mkass-api', ts: new Date().toISOString() });
});

// ── ROUTES ───────────────────────────────────────────────────
const authRoutes         = require('./routes/auth');
const salonRoutes        = require('./routes/salons');
const serviceRoutes      = require('./routes/services');
const appointmentRoutes  = require('./routes/appointments');
const balanceRoutes      = require('./routes/balance');
const adminRoutes        = require('./routes/admin');

app.use('/api/auth',    authRoutes);
app.use('/api/salons',  salonRoutes);
app.use('/api/salons',  serviceRoutes);
app.use('/api/salons',  appointmentRoutes);
app.use('/api/salons',  balanceRoutes);
app.use('/api/admin',   adminRoutes);

// ── 404 ──────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// ── ERROR HANDLER ────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── START ────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 Mkass API running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}\n`);
});
