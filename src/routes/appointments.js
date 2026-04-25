// src/routes/appointments.js
const router = require('express').Router();
const pool = require('../db/pool');
const { requireAuth, requireSalonAccess } = require('../middleware/auth');

// ── GET /api/salons/:salonId/appointments ────────────────────
// Gérant views their appointments (with filters)
router.get('/:salonId/appointments', requireSalonAccess, async (req, res) => {
  try {
    const { date, status, type } = req.query;
    let q = 'SELECT * FROM appointments WHERE salon_id = $1';
    const params = [req.params.salonId];
    if (date)   { params.push(date);   q += ` AND appt_date = $${params.length}`; }
    if (status) { params.push(status); q += ` AND status = $${params.length}`; }
    if (type)   { params.push(type);   q += ` AND type = $${params.length}`; }
    q += ' ORDER BY appt_date DESC, appt_time ASC';
    const { rows } = await pool.query(q, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/salons/:salonId/appointments/today ──────────────
// Gérant — today's dashboard data
router.get('/:salonId/appointments/today', requireSalonAccess, async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { rows } = await pool.query(
      `SELECT * FROM appointments WHERE salon_id = $1 AND appt_date = $2 ORDER BY appt_time ASC`,
      [req.params.salonId, today]
    );
    const revenue = rows.filter(a => a.status === 'done').reduce((s, a) => s + parseFloat(a.total), 0);
    const stats = {
      total: rows.length,
      confirmed: rows.filter(a => a.status === 'confirmed').length,
      pending: rows.filter(a => a.status === 'pending').length,
      done: rows.filter(a => a.status === 'done').length,
      walkins: rows.filter(a => a.type === 'walkin').length,
      revenue: Math.round(revenue * 100) / 100,
    };
    res.json({ appointments: rows, stats });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/salons/:salonId/slots?date=YYYY-MM-DD ──────────
// Public — available slots for a date (for booking page)
router.get('/:salonId/slots', async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: 'date query param required' });
    const { rows } = await pool.query(
      `SELECT appt_time FROM appointments WHERE salon_id = $1 AND appt_date = $2 AND status != 'cancelled'`,
      [req.params.salonId, date]
    );
    const ALL_SLOTS = ['09:00','09:30','10:00','10:30','11:00','11:30','12:00','14:00','14:30','15:00','15:30','16:00','16:30','17:00','17:30'];
    const taken = rows.map(r => r.appt_time);
    const slots = ALL_SLOTS.map(t => ({ time: t, available: !taken.includes(t) }));
    res.json(slots);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/salons/:salonId/appointments ───────────────────
// Public — client creates a booking
router.post('/:salonId/appointments', async (req, res) => {
  try {
    const { clientName, clientPhone, services, prices, total, date, time, note } = req.body;
    if (!clientName || !services?.length || !date || !time) {
      return res.status(400).json({ error: 'clientName, services, date and time are required' });
    }
    // Check slot not already taken
    const conflict = await pool.query(
      `SELECT id FROM appointments WHERE salon_id=$1 AND appt_date=$2 AND appt_time=$3 AND status != 'cancelled'`,
      [req.params.salonId, date, time]
    );
    if (conflict.rows.length) return res.status(409).json({ error: 'This slot is already taken' });

    const id = 'MKS-' + Date.now();
    const { rows } = await pool.query(`
      INSERT INTO appointments (id, salon_id, client_name, client_phone, services, prices, total, appt_date, appt_time, status, note, type, pay_mode)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10,'booking','online')
      RETURNING *
    `, [id, req.params.salonId, clientName, clientPhone||'', services, prices||[], total||0, date, time, note||'']);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/salons/:salonId/appointments/walkin ────────────
// Gérant — register a walk-in / cash payment
router.post('/:salonId/appointments/walkin', requireSalonAccess, async (req, res) => {
  try {
    const { clientName, services, prices, total, payMode } = req.body;
    if (!services?.length) return res.status(400).json({ error: 'services are required' });
    const now = new Date();
    const id = 'MKS-WI-' + Date.now();
    const time = now.toTimeString().slice(0, 5);
    const date = now.toISOString().slice(0, 10);
    const { rows } = await pool.query(`
      INSERT INTO appointments (id, salon_id, client_name, client_phone, services, prices, total, appt_date, appt_time, status, note, type, pay_mode)
      VALUES ($1,$2,$3,'','$4',$5,$6,$7,$8,'done','','walkin',$9)
      RETURNING *
    `, [id, req.params.salonId, clientName||'Anonyme', `{${services.map(s=>`"${s}"`).join(',')}}`, prices||[], total||0, date, time, payMode||'cash']);

    // Proper array insert
    const id2 = 'MKS-WI-' + Date.now();
    const { rows: rows2 } = await pool.query(`
      INSERT INTO appointments (id, salon_id, client_name, client_phone, services, prices, total, appt_date, appt_time, status, note, type, pay_mode)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'done','',$10,$11)
      RETURNING *
    `, [id2, req.params.salonId, clientName||'Anonyme', '', services, prices||[], total||0, date, time, 'walkin', payMode||'cash']);
    res.status(201).json(rows2[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── PATCH /api/salons/:salonId/appointments/:id/status ───────
// Gérant updates appointment status
router.patch('/:salonId/appointments/:id/status', requireSalonAccess, async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ['pending','confirmed','done','cancelled'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    const { rows } = await pool.query(`
      UPDATE appointments SET status = $1 WHERE id = $2 AND salon_id = $3 RETURNING *
    `, [status, req.params.id, req.params.salonId]);
    if (!rows.length) return res.status(404).json({ error: 'Appointment not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── DELETE /api/salons/:salonId/appointments/:id ─────────────
router.delete('/:salonId/appointments/:id', requireSalonAccess, async (req, res) => {
  try {
    await pool.query('DELETE FROM appointments WHERE id=$1 AND salon_id=$2', [req.params.id, req.params.salonId]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
