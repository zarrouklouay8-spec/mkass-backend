const router = require('express').Router();
const pool = require('../db/pool');
const { requireSalonAccess } = require('../middleware/auth');

// GET /api/salons/:salonId/staff
router.get('/:salonId/staff', requireSalonAccess, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM staff WHERE salon_id = $1 ORDER BY created_at ASC`,
      [req.params.salonId]
    );

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/salons/:salonId/staff
router.post('/:salonId/staff', requireSalonAccess, async (req, res) => {
  try {
    const { name, phone } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Nom du personnel obligatoire' });
    }

    const { rows } = await pool.query(
      `INSERT INTO staff (salon_id, name, phone)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [req.params.salonId, name, phone || '']
    );

    const staffId = rows[0].id;

    for (let weekday = 1; weekday <= 6; weekday++) {
      await pool.query(
        `INSERT INTO staff_working_hours (staff_id, weekday, start_time, end_time, active)
         VALUES ($1, $2, '09:00', '18:00', true)
         ON CONFLICT (staff_id, weekday) DO NOTHING`,
        [staffId, weekday]
      );
    }

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});
// GET /api/salons/:salonId/staff/:staffId/services
router.get('/:salonId/staff/:staffId/services', requireSalonAccess, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         ss.id,
         ss.staff_id,
         ss.service_id,
         ss.duration_minutes,
         s.name AS service_name,
         s.price,
         s.category
       FROM staff_services ss
       JOIN services s ON s.id = ss.service_id
       JOIN staff st ON st.id = ss.staff_id
       WHERE ss.staff_id = $1
         AND st.salon_id = $2
       ORDER BY s.name ASC`,
      [req.params.staffId, req.params.salonId]
    );

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error', details: err.message });
  }
});
// POST /api/salons/:salonId/staff/:staffId/services
router.post('/:salonId/staff/:staffId/services', requireSalonAccess, async (req, res) => {
  try {
    const { serviceId, durationMinutes } = req.body;
    const staffCheck = await pool.query(
      `SELECT id FROM staff WHERE id = $1 AND salon_id = $2`,
      [req.params.staffId, req.params.salonId]
    );

    if (staffCheck.rowCount === 0) {
      return res.status(404).json({ error: 'Personnel introuvable' });
    }
    if (!serviceId) {
      return res.status(400).json({ error: 'Service obligatoire' });
    }

    const { rows } = await pool.query(
      `INSERT INTO staff_services (staff_id, service_id, duration_minutes)
       VALUES ($1, $2, $3)
       ON CONFLICT (staff_id, service_id)
       DO UPDATE SET duration_minutes = EXCLUDED.duration_minutes
       RETURNING *`,
      [req.params.staffId, serviceId, durationMinutes || 30]
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});
// ── STAFF WORKING HOURS ──────────────────────────────────────

// GET /api/salons/:salonId/staff/:staffId/hours
router.get('/:salonId/staff/:staffId/hours', requireSalonAccess, async (req, res) => {
  try {
    const { salonId, staffId } = req.params;

    const staffCheck = await pool.query(
      `SELECT id FROM staff WHERE id = $1 AND salon_id = $2`,
      [staffId, salonId]
    );

    if (staffCheck.rowCount === 0) {
      return res.status(404).json({ error: 'Personnel introuvable' });
    }

    const { rows } = await pool.query(
      `SELECT weekday, start_time, end_time, active
       FROM staff_working_hours
       WHERE staff_id = $1
       ORDER BY weekday ASC`,
      [staffId]
    );

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});


// POST /api/salons/:salonId/staff/:staffId/hours
router.post('/:salonId/staff/:staffId/hours', requireSalonAccess, async (req, res) => {
  try {
    const { salonId, staffId } = req.params;
    const { hours } = req.body;

    if (!Array.isArray(hours)) {
      return res.status(400).json({ error: 'Horaires invalides' });
    }

    const staffCheck = await pool.query(
      `SELECT id FROM staff WHERE id = $1 AND salon_id = $2`,
      [staffId, salonId]
    );

    if (staffCheck.rowCount === 0) {
      return res.status(404).json({ error: 'Personnel introuvable' });
    }

    await pool.query('BEGIN');

    for (const h of hours) {
      const weekday = Number(h.weekday);
      const startTime = h.start_time || h.startTime || '09:00';
      const endTime = h.end_time || h.endTime || '18:00';
      const active = h.active !== false;

      if (weekday < 0 || weekday > 6) continue;

      await pool.query(
        `INSERT INTO staff_working_hours (
          staff_id,
          weekday,
          start_time,
          end_time,
          active
        )
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (staff_id, weekday)
        DO UPDATE SET
          start_time = EXCLUDED.start_time,
          end_time = EXCLUDED.end_time,
          active = EXCLUDED.active
        RETURNING *`,
        [staffId, weekday, startTime, endTime, active]
      );
    }

    await pool.query('COMMIT');

    const { rows } = await pool.query(
      `SELECT weekday, start_time, end_time, active
       FROM staff_working_hours
       WHERE staff_id = $1
       ORDER BY weekday ASC`,
      [staffId]
    );

    res.json(rows);
  } catch (err) {
    await pool.query('ROLLBACK').catch(() => {});
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});
module.exports = router;
