require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { exec } = require('child_process'); // ✅ ADDED
const reviewRoutes = require('./routes/reviews');
const gerantRoutes = require('./routes/gerants');
const subscriptionRoutes = require('./routes/subscriptions');
const app = express();

// ── AUTO DB SETUP (NO CLI NEEDED) ───────────────────────────
function runDatabaseSetup() {
  if (process.env.RUN_DB_SETUP !== 'true') return;

  console.log('Running database setup...');

  exec('node src/db/migrate.js && node src/db/seed.js', (error, stdout, stderr) => {
    if (error) {
      console.error('Database setup failed:', error);
      return;
    }

    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
  });
}

// ── MIDDLEWARE ───────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── HEALTH CHECK ─────────────────────────────────────────────
app.get('/run-staff-migration-once', async (req, res) => {
  const pool = require('./db/pool');

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS staff (
        id          SERIAL PRIMARY KEY,
        salon_id    TEXT NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        phone       TEXT DEFAULT '',
        active      BOOLEAN DEFAULT true,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS staff_services (
        id                SERIAL PRIMARY KEY,
        staff_id          INT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
        service_id        INT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
        duration_minutes  INT NOT NULL DEFAULT 30,
        UNIQUE(staff_id, service_id)
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS staff_working_hours (
        id          SERIAL PRIMARY KEY,
        staff_id    INT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
        weekday     INT NOT NULL,
        start_time  TEXT NOT NULL DEFAULT '09:00',
        end_time    TEXT NOT NULL DEFAULT '18:00',
        active      BOOLEAN DEFAULT true,
        UNIQUE(staff_id, weekday)
      );
    `);

    await pool.query(`
      ALTER TABLE appointments
      ADD COLUMN IF NOT EXISTS staff_id INT REFERENCES staff(id) ON DELETE SET NULL;
    `);

    await pool.query(`
      ALTER TABLE appointments
      ADD COLUMN IF NOT EXISTS duration_minutes INT DEFAULT 30;
    `);

    res.json({
      ok: true,
      message: 'Staff migration completed'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      ok: false,
      error: err.message
    });
  }
});
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'mkass-api', ts: new Date().toISOString() });
});

// ── ROUTES ───────────────────────────────────────────────────
const authRoutes         = require('./routes/auth');
const salonRoutes        = require('./routes/salons');
const serviceRoutes      = require('./routes/services');
const appointmentRoutes  = require('./routes/appointments');
const balanceRoutes      = require('./routes/balance');
const staffRoutes        = require('./routes/staff');
const adminRoutes        = require('./routes/admin');

app.use('/api/auth',    authRoutes);
app.use('/api/salons',  salonRoutes);
app.use('/api/salons',  serviceRoutes);
app.use('/api/salons',  appointmentRoutes);
app.use('/api/salons',  balanceRoutes);
app.use('/api/salons',  staffRoutes);
app.use('/api/admin',   adminRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/gerants', gerantRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
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

// ✅ RUN MIGRATIONS AUTOMATICALLY
runDatabaseSetup();

app.listen(PORT, () => {
  console.log(`\n🚀 Mkass API running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}\n`);
});
