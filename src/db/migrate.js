// src/db/migrate.js
// Run once: npm run db:migrate
require('dotenv').config();
const pool = require('./pool');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── SALONS ──────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS salons (
        id          TEXT PRIMARY KEY,           -- slug e.g. "salon-nour"
        name        TEXT NOT NULL,
        username    TEXT UNIQUE NOT NULL,       -- login username
        password    TEXT NOT NULL,             -- bcrypt hash
        icon        TEXT DEFAULT '✂️',
        type        TEXT DEFAULT 'mixte',      -- salon | barbershop | mixte | enfant
        address     TEXT DEFAULT '',
        dist        TEXT DEFAULT '',
        status      TEXT DEFAULT 'open',       -- open | busy | closed
        rating      NUMERIC(3,1) DEFAULT 5.0,
        review_count INT DEFAULT 0,
        tags        TEXT[] DEFAULT '{}',
        child_cut   BOOLEAN DEFAULT false,
        color       TEXT DEFAULT '#C8FF00',
        cover_img   TEXT,                      -- base64 or URL
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // ── SERVICES ─────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS services (
        id          SERIAL PRIMARY KEY,
        salon_id    TEXT NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
        category    TEXT NOT NULL DEFAULT 'Autre',
        name        TEXT NOT NULL,
        duration    TEXT NOT NULL DEFAULT '30 min',
        price       NUMERIC(8,2) NOT NULL,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // ── APPOINTMENTS ─────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS appointments (
        id          TEXT PRIMARY KEY,           -- e.g. MKS-1001
        salon_id    TEXT NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
        client_name TEXT NOT NULL,
        client_phone TEXT DEFAULT '',
        services    TEXT[] NOT NULL DEFAULT '{}',
        prices      NUMERIC[] NOT NULL DEFAULT '{}',
        total       NUMERIC(8,2) NOT NULL DEFAULT 0,
        appt_date   DATE NOT NULL,
        appt_time   TEXT NOT NULL,
        status      TEXT DEFAULT 'pending',    -- pending | confirmed | done | cancelled
        note        TEXT DEFAULT '',
        type        TEXT DEFAULT 'booking',    -- booking | walkin
        pay_mode    TEXT DEFAULT 'online',     -- online | cash | card | transfer
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // ── REVIEWS ──────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS reviews (
        id          SERIAL PRIMARY KEY,
        salon_id    TEXT NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
        author_name TEXT NOT NULL,
        stars       INT NOT NULL CHECK (stars BETWEEN 1 AND 5),
        text        TEXT NOT NULL,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // ── INDEXES ──────────────────────────────────────────────
    await client.query(`CREATE INDEX IF NOT EXISTS idx_appt_salon   ON appointments(salon_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_appt_date    ON appointments(appt_date);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_svc_salon    ON services(salon_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_review_salon ON reviews(salon_id);`);

    await client.query('COMMIT');
    console.log('✅ Migration complete — all tables created.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
