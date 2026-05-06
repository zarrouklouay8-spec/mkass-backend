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

// POST /api/salons/:salonId/staff/:staffId/services
router.post('/:salonId/staff/:staffId/services', requireSalonAccess, async (req, res) => {
  try {
    const { serviceId, durationMinutes } = req.body;

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

module.exports = router;
