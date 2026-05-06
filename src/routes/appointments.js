// src/routes/appointments.js
const router = require('express').Router();
const pool = require('../db/pool');
const { requireSalonAccess } = require('../middleware/auth');

// ── GET bookings by phone ────────────────────────────────────
// Public: /api/salons/appointments/by-phone?phone=...
router.get('/appointments/by-phone', async (req, res) => {
  try {
    let { phone } = req.query;

    if (!phone) {
      return res.status(400).json({ error: 'Numéro de téléphone obligatoire' });
    }

    phone = String(phone).replace(/\s+/g, '').trim();

    const { rows } = await pool.query(
      `SELECT 
         a.*,
         s.name AS salon_name
       FROM appointments a
       LEFT JOIN salons s ON s.id = a.salon_id
       WHERE REPLACE(a.client_phone, ' ', '') = $1
       ORDER BY a.appt_date DESC, a.appt_time DESC`,
      [phone]
    );

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── GET appointments ─────────────────────────────────────────
// Gérant: /api/salons/:salonId/appointments
router.get('/:salonId/appointments', requireSalonAccess, async (req, res) => {
  try {
    const { date, status, type } = req.query;
    let q = `
  SELECT 
    a.*,
    st.name AS staff_name
  FROM appointments a
  LEFT JOIN staff st ON st.id = a.staff_id
  WHERE a.salon_id = $1
`;
    const params = [req.params.salonId];

    if (date) {
  params.push(date);
  q += ` AND a.appt_date = $${params.length}`;
}

if (status) {
  params.push(status);
  q += ` AND a.status = $${params.length}`;
}

if (type) {
  params.push(type);
  q += ` AND a.type = $${params.length}`;
}

q += ' ORDER BY a.appt_date DESC, a.appt_time ASC';
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
      `SELECT *
       FROM appointments
       WHERE salon_id = $1
         AND appt_date = $2
       ORDER BY appt_time ASC`,
      [req.params.salonId, today]
    );

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET slots fallback ───────────────────────────────────────
// This is the old fallback slots route. Smart slots are in src/routes/salons.js.
// Keep this only for compatibility if something still calls /api/salons/:salonId/slots here.
router.get('/:salonId/slots', async (req, res) => {
  try {
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({ error: 'date is required' });
    }

    const ALL_SLOTS = [
      '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
      '12:00', '14:00', '14:30', '15:00', '15:30', '16:00',
      '16:30', '17:00', '17:30'
    ];

    const { rows } = await pool.query(
      `SELECT appt_time
       FROM appointments
       WHERE salon_id = $1
         AND appt_date = $2
         AND status != 'cancelled'`,
      [req.params.salonId, date]
    );

    const taken = rows.map(r => String(r.appt_time).slice(0, 5));

    res.json(ALL_SLOTS.map(time => ({
      time,
      available: !taken.includes(time)
    })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST booking ─────────────────────────────────────────────
// Public customer booking.
// Saves staff_id and duration_minutes when smart slots selected a staff member.
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
      note,
      staff_id,
      staffId,
      duration_minutes,
      durationMinutes
    } = req.body;

    const finalStaffId = staff_id || staffId || null;
    const finalDurationMinutes = duration_minutes || durationMinutes || 30;

    const finalClientName = clientName || customer_name || customerName || name;
    const finalPhone = clientPhone || phone;

    if (!finalClientName) {
      return res.status(400).json({ error: 'Le nom du client est obligatoire' });
    }

    let cleanPhone = '';

    if (finalPhone) {
      cleanPhone = String(finalPhone).replace(/\s+/g, '');

      if (!/^[0-9]{8}$/.test(cleanPhone) && !/^\+216[0-9]{8}$/.test(cleanPhone)) {
        return res.status(400).json({ error: 'Numéro de téléphone invalide' });
      }
    }

    const now = new Date();
    const safeDate = date || appointment_date || now.toISOString().slice(0, 10);
    const safeTime = time || appointment_time || now.toTimeString().slice(0, 5);

    // Booking must be from tomorrow minimum
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const bookingDate = new Date(safeDate + 'T00:00:00');

    if (bookingDate < tomorrow) {
      return res.status(400).json({ error: 'La réservation doit être à partir de demain' });
    }

    // Prevent double booking.
    // If staff_id exists, only block if that exact staff member is busy.
    // If staff_id is missing, fallback to old salon-wide conflict check.
    if (finalStaffId) {
      const conflict = await pool.query(
        `SELECT id
         FROM appointments
         WHERE salon_id = $1
           AND appt_date = $2
           AND appt_time = $3
           AND staff_id = $4
           AND status != 'cancelled'`,
        [req.params.salonId, safeDate, safeTime, finalStaffId]
      );

      if (conflict.rows.length > 0) {
        return res.status(409).json({
          error: 'Ce membre du personnel est déjà réservé à ce créneau'
        });
      }
    } else {
      const conflict = await pool.query(
        `SELECT id
         FROM appointments
         WHERE salon_id = $1
           AND appt_date = $2
           AND appt_time = $3
           AND status != 'cancelled'`,
        [req.params.salonId, safeDate, safeTime]
      );

      if (conflict.rows.length > 0) {
        return res.status(409).json({ error: 'Ce créneau est déjà réservé' });
      }
    }

    const id = 'MKS-' + Date.now();

    const { rows } = await pool.query(`
      INSERT INTO appointments (
        id,
        salon_id,
        client_name,
        client_phone,
        services,
        prices,
        total,
        appt_date,
        appt_time,
        status,
        note,
        type,
        pay_mode,
        staff_id,
        duration_minutes
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,
        'pending',$10,'booking','online',
        $11,$12
      )
      RETURNING *
    `, [
      id,
      req.params.salonId,
      finalClientName,
      cleanPhone,
      services || service_names || [],
      prices || [],
      total || 0,
      safeDate,
      safeTime,
      note || '',
      finalStaffId,
      finalDurationMinutes
    ]);

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST walk-in ─────────────────────────────────────────────
router.post('/:salonId/appointments/walkin', requireSalonAccess, async (req, res) => {
  try {
    const {
      clientName,
      customerName,
      customer_name,
      name,
      services,
      prices,
      total,
      payMode,
      paymentMode,
      payment
    } = req.body;

    const finalClientName = [clientName, customerName, customer_name, name]
      .find(v => typeof v === 'string' && v.trim() !== '') || 'Client';

    const finalPayMode = payMode || paymentMode || payment || 'cash';

    if (!services?.length) {
      return res.status(400).json({ error: 'services are required' });
    }

    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const time = now.toTimeString().slice(0, 5);

    const id = 'MKS-WI-' + Date.now();

    const { rows } = await pool.query(`
      INSERT INTO appointments (
        id,
        salon_id,
        client_name,
        client_phone,
        services,
        prices,
        total,
        appt_date,
        appt_time,
        status,
        note,
        type,
        pay_mode
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
      finalClientName,
      '',
      services,
      prices || [],
      total || 0,
      date,
      time,
      finalPayMode
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
      `UPDATE appointments
       SET status = $1
       WHERE id = $2
         AND salon_id = $3
       RETURNING *`,
      [status, req.params.id, req.params.salonId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Appointment not found' });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
