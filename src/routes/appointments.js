// src/routes/appointments.js
const router = require('express').Router();
const pool = require('../db/pool');
const { requireAuth, requireSalonAccess } = require('../middleware/auth');

// ── GET appointments ─────────────────────────────────────────
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

// ── GET today dashboard ──────────────────────────────────────
router.get('/:salonId/appointments/today', requireSalonAccess, async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);

    const { rows } = await pool.query(
      `SELECT * FROM appointments WHERE salon_id = $1 AND appt_date = $2 ORDER BY appt_time ASC`,
      [req.params.salonId, today]
    );

    res.json(rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST booking (FIXED CLEAN) ───────────────────────────────
router.post('/:salonId/appointments', async (req, res) => {
  try {
    let {
      clientName,
      customer_name,
      customerName,
      name,
      phone,
      clientPhone,
      services,
      service_names,
      prices,
      total,
      date,
      appointment_date,
      time,
      appointment_time,
      note
    } = req.body;

    // ✅ Map only (no fake values)
    const finalClientName = clientName || customer_name || customerName || name;
    const finalPhone = clientPhone || phone;

    // ✅ Validate
    if (!finalClientName) {
      return res.status(400).json({ error: 'clientName is required' });
    }

    // Phone validation
    if (finalPhone) {
      const clean = finalPhone.replace(/\s+/g, '');
      if (!/^[0-9]{8}$/.test(clean) && !/^\+216[0-9]{8}$/.test(clean)) {
        return res.status(400).json({ error: 'Invalid phone number' });
      }
      clientPhone = clean;
    }

    // Defaults
    const now = new Date();
    const safeDate = date || appointment_date || now.toISOString().slice(0, 10);
    const safeTime = time || appointment_time || now.toTimeString().slice(0, 5);

    const id = 'MKS-' + Date.now();

    const { rows } = await pool.query(`
      INSERT INTO appointments (
        id, salon_id, client_name, client_phone,
        services, prices, total,
        appt_date, appt_time,
        status, note, type, pay_mode
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,
        'pending',$10,'booking','online'
      )
      RETURNING *
    `, [
      id,
      req.params.salonId,
      finalClientName,
      finalPhone || '',
      services || service_names || [],
      prices || [],
      total || 0,
      safeDate,
      safeTime,
      note || ''
    ]);

    res.status(201).json(rows[0]);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST walk-in (FIXED) ─────────────────────────────────────
router.post('/:salonId/appointments/walkin', requireSalonAccess, async (req, res) => {
  try {
    const { clientName, services, prices, total, payMode } = req.body;

    if (!services?.length) {
      return res.status(400).json({ error: 'services are required' });
    }

    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const time = now.toTimeString().slice(0, 5);

    const id = 'MKS-WI-' + Date.now();

    const { rows } = await pool.query(`
      INSERT INTO appointments (
        id, salon_id, client_name, client_phone,
        services, prices, total,
        appt_date, appt_time,
        status, note, type, pay_mode
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,
        'done','',
        'walkin',$10
      )
      RETURNING *
    `, [
      id,
      req.params.salonId,
      clientName || 'Anonyme',
      '',
      services,
      prices || [],
      total || 0,
      date,
      time,
      payMode || 'cash'
    ]);

    res.status(201).json(rows[0]);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── UPDATE status ────────────────────────────────────────────
router.patch('/:salonId/appointments/:id/status', requireSalonAccess, async (req, res) => {
  try {
    const { status } = req.body;

    const { rows } = await pool.query(
      `UPDATE appointments SET status = $1 WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );

    res.json(rows[0]);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
