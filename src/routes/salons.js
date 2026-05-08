// src/routes/salons.js
const router = require('express').Router();
const pool = require('../db/pool');
const bcrypt = require('bcryptjs');
const { requireAuth, requireAdmin, requireSalonAccess } = require('../middleware/auth');

// ── GET /api/salons ──────────────────────────────────────────
// Public — list all salons for Explore page
router.get('/', async (req, res) => {
  try {
    const { type, status, search } = req.query;
    let query = `
      SELECT s.*,
        COALESCE(json_agg(r ORDER BY r.created_at DESC) FILTER (WHERE r.id IS NOT NULL), '[]') AS reviews
      FROM salons s
      LEFT JOIN reviews r ON r.salon_id = s.id
    `;
    const conditions = [];
    const params = [];
    if (type && type !== 'all') {
      params.push(type);
      conditions.push(`s.type = $${params.length}`);
    }
    if (status) {
      params.push(status);
      conditions.push(`s.status = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(s.name ILIKE $${params.length} OR s.address ILIKE $${params.length})`);
    }
    if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
    query += ' GROUP BY s.id ORDER BY s.rating DESC, s.created_at ASC';
    const { rows } = await pool.query(query, params);
    // Strip passwords before sending
    rows.forEach(r => delete r.password);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/salons/:salonId ─────────────────────────────────
// Public — single salon with services and reviews
router.get('/:salonId', async (req, res) => {
  try {
    const { salonId } = req.params;
    const [salonRes, servicesRes, reviewsRes] = await Promise.all([
      pool.query('SELECT * FROM salons WHERE id = $1', [salonId]),
      pool.query('SELECT * FROM services WHERE salon_id = $1 ORDER BY category, name', [salonId]),
      pool.query('SELECT * FROM reviews WHERE salon_id = $1 ORDER BY created_at DESC', [salonId]),
    ]);
    if (!salonRes.rows.length) return res.status(404).json({ error: 'Salon not found' });
    const salon = salonRes.rows[0];
    delete salon.password;
    res.json({ ...salon, services: servicesRes.rows, reviews: reviewsRes.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── PUT /api/salons/:salonId ─────────────────────────────────
// Gérant updates their own salon settings
// ── PUT /api/salons/:salonId ─────────────────────────────────
// Gérant updates their own salon settings
router.put('/:salonId', requireSalonAccess, async (req, res) => {
  try {
    const { salonId } = req.params;

 const {
  name,
  address,
  status,
  icon,
  tags,
  childCut
} = req.body;

const hasCoverImg = Object.prototype.hasOwnProperty.call(req.body, 'cover_img') ||
                    Object.prototype.hasOwnProperty.call(req.body, 'coverImg');

const coverImg = Object.prototype.hasOwnProperty.call(req.body, 'cover_img')
  ? req.body.cover_img
  : req.body.coverImg;

const mapUrl = req.body.map_url || req.body.mapUrl || null;
   const { rows } = await pool.query(`
  UPDATE salons SET
    name       = COALESCE($1, name),
    address    = COALESCE($2, address),
    status     = COALESCE($3, status),
    icon       = COALESCE($4, icon),
    tags       = COALESCE($5, tags),
    child_cut  = COALESCE($6, child_cut),
    cover_img  = CASE WHEN $7 THEN $8 ELSE cover_img END,
    map_url    = COALESCE($9, map_url)
  WHERE id = $10
  RETURNING *
`, [
  name,
  address,
  status,
  icon,
  tags,
  childCut,
  hasCoverImg,
  coverImg,
  mapUrl,
  salonId
]);
    if (!rows.length) {
      return res.status(404).json({ error: 'Salon not found' });
    }

    delete rows[0].password;
    res.json(rows[0]);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/salons ─────────────────────────────────────────
// Admin only — create a new salon / gérant account
// ── POST /api/salons ─────────────────────────────────────────
// Admin only — create a new salon / gérant account
router.post('/', requireAdmin, async (req, res) => {
  try {
    const {
      name,
      username,
      password,
      icon,
      type,
      address,
      dist,
      tags,
      childCut,
      color
    } = req.body;

    const mapUrl = req.body.map_url || req.body.mapUrl || null;

    if (!name || !username || !password) {
      return res.status(400).json({
        error: 'name, username and password are required'
      });
    }

    const id = username.toLowerCase().replace(/\s+/g, '-');
    const hash = await bcrypt.hash(password, 10);

    const { rows } = await pool.query(`
      INSERT INTO salons (
        id,
        name,
        username,
        password,
        icon,
        type,
        address,
        dist,
        tags,
        child_cut,
        color,
        map_url,
        plan,
        subscription_status
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'active')
      RETURNING *
    `, [
      id,
      name,
      username.toLowerCase(),
      hash,
      icon || '',
      type || 'mixte',
      address || '',
      dist || '',
      tags || [],
      childCut || false,
      color || '#C8FF00',
      mapUrl,
      req.body.plan || 'starter'
    ]);

    // Auto-seed default services for the salon type
    const defaultSvcs = getDefaultServices(type || 'mixte');

    for (const sv of defaultSvcs) {
      await pool.query(
        `INSERT INTO services (salon_id, category, name, duration, price)
         VALUES ($1,$2,$3,$4,$5)`,
        [id, sv.cat, sv.name, sv.dur, sv.price]
      );
    }

    delete rows[0].password;
    res.status(201).json(rows[0]);

  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Username already exists' });
    }

    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});
// ── GET /api/salons/:salonId/slots ───────────────────────────
// Public — smart slots based on assigned staff services
// Example: /api/salons/salon-nour/slots?date=2026-05-10&serviceIds=1,2
router.get('/:salonId/slots', async (req, res) => {
  try {
    const { salonId } = req.params;
    const { date, serviceIds, staffId } = req.query;
const requestedStaffId = staffId ? Number(staffId) : null;

    if (!date) {
      return res.status(400).json({ error: 'Date obligatoire' });
    }

    const requestedServiceIds = String(serviceIds || '')
      .split(',')
      .map(x => Number(x.trim()))
      .filter(Boolean);

    const allSlots = [
      '09:00','09:30','10:00','10:30','11:00','11:30',
      '12:00','14:00','14:30','15:00','15:30','16:00',
      '16:30','17:00','17:30'
    ];

    if (requestedServiceIds.length === 0) {
      const { rows: bookedRows } = await pool.query(
        `SELECT appt_time
         FROM appointments
         WHERE salon_id = $1
           AND appt_date = $2
           AND status <> 'cancelled'`,
        [salonId, date]
      );

      const bookedTimes = new Set(bookedRows.map(r => String(r.appt_time).slice(0, 5)));

return res.json(allSlots.map(time => ({
  time,
  available: !bookedTimes.has(time),
  staffId: null,
  staffName: null,
  durationMinutes: 30
})));
    }
const { rows: salonPlanRows } = await pool.query(
  `SELECT plan FROM salons WHERE id = $1`,
  [salonId]
);

const salonPlan = String(salonPlanRows[0]?.plan || 'starter').toLowerCase();

if (salonPlan !== 'pro') {
  const { rows: bookedRows } = await pool.query(
    `SELECT appt_time
     FROM appointments
     WHERE salon_id = $1
       AND appt_date = $2
       AND status <> 'cancelled'`,
    [salonId, date]
  );

  const bookedTimes = new Set(
    bookedRows.map(r => String(r.appt_time).slice(0, 5))
  );

  return res.json(allSlots.map(time => ({
    time,
    available: !bookedTimes.has(time),
    staffId: null,
    staffName: null,
    durationMinutes: 30
  })));
}
    const staffParams = [salonId, requestedServiceIds, requestedServiceIds.length];
let staffFilterSql = '';

if (requestedStaffId) {
  staffParams.push(requestedStaffId);
  staffFilterSql = `AND st.id = $${staffParams.length}`;
}

const { rows: staffRows } = await pool.query(
  `SELECT
     st.id AS staff_id,
     st.name AS staff_name,
     SUM(ss.duration_minutes) AS total_duration,
     COUNT(DISTINCT ss.service_id) AS matched_services
   FROM staff st
   JOIN staff_services ss ON ss.staff_id = st.id
   WHERE st.salon_id = $1
     AND st.active = true
     AND ss.service_id = ANY($2::int[])
     ${staffFilterSql}
   GROUP BY st.id, st.name
   HAVING COUNT(DISTINCT ss.service_id) = $3`,
  staffParams
);

    if (staffRows.length === 0) {
      return res.json(allSlots.map(time => ({
        time,
        available: false,
        staffId: null,
        durationMinutes: 0
      })));
    }

    const { rows: apptRows } = await pool.query(
      `SELECT staff_id, appt_time, duration_minutes
       FROM appointments
       WHERE salon_id = $1
         AND appt_date = $2
         AND status <> 'cancelled'
         AND staff_id IS NOT NULL`,
      [salonId, date]
    );
const selectedDate = new Date(date + 'T12:00:00');
const weekday = selectedDate.getDay();

const { rows: hoursRows } = await pool.query(
  `SELECT staff_id, weekday, start_time, end_time, active
   FROM staff_working_hours
   WHERE staff_id = ANY($1::int[])
     AND weekday = $2`,
  [staffRows.map(s => Number(s.staff_id)), weekday]
);
    function toMinutes(time) {
      const [h, m] = String(time).slice(0, 5).split(':').map(Number);
      return h * 60 + m;
    }

    function overlaps(startA, durationA, startB, durationB) {
      const endA = startA + durationA;
      const endB = startB + durationB;
      return startA < endB && startB < endA;
    }

    const result = allSlots.map(time => {
      const slotStart = toMinutes(time);

      const availableStaff = staffRows.find(staff => {
  const staffId = Number(staff.staff_id);
  const duration = Number(staff.total_duration || 30);

  const hours = hoursRows.find(h => Number(h.staff_id) === staffId);

  // If no working hours were configured yet, keep old behavior:
  // staff is considered available for all default slots.
  if (hours && hours.active === false) {
    return false;
  }

  if (hours) {
    const workStart = toMinutes(hours.start_time);
    const workEnd = toMinutes(hours.end_time);
    const slotEnd = slotStart + duration;

    if (slotStart < workStart || slotEnd > workEnd) {
      return false;
    }
  }

  const staffAppointments = apptRows.filter(a => Number(a.staff_id) === staffId);

  return !staffAppointments.some(appt => {
    return overlaps(
      slotStart,
      duration,
      toMinutes(appt.appt_time),
      Number(appt.duration_minutes || 30)
    );
  });
});

return {
  time,
  available: Boolean(availableStaff),
  staffId: availableStaff ? Number(availableStaff.staff_id) : null,
  staffName: availableStaff ? availableStaff.staff_name : null,
  durationMinutes: availableStaff ? Number(availableStaff.total_duration || 30) : 0
};
    });

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: 'Server error',
      details: err.message
    });
  }
});
// ── DELETE /api/salons/:salonId ──────────────────────────────
// Admin only
router.delete('/:salonId', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM salons WHERE id = $1', [req.params.salonId]);
    res.json({ message: 'Salon deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

function getDefaultServices(type) {
  const all = [
    { cat:'Coupe',    name:'Coupe femme',        dur:'45 min', price:35,  types:['salon','mixte'] },
    { cat:'Coupe',    name:'Coupe homme',         dur:'30 min', price:20,  types:['barbershop','mixte'] },
    { cat:'Coupe',    name:'Coupe enfant',        dur:'20 min', price:15,  types:['salon','barbershop','mixte','enfant'] },
    { cat:'Couleur',  name:'Coloration complète', dur:'90 min', price:80,  types:['salon','mixte'] },
    { cat:'Couleur',  name:'Balayage / Mèches',   dur:'120 min',price:120, types:['salon','mixte'] },
    { cat:'Soin',     name:'Brushing',            dur:'30 min', price:25,  types:['salon','mixte','enfant'] },
    { cat:'Barbe',    name:'Taille de barbe',     dur:'20 min', price:15,  types:['barbershop','mixte'] },
    { cat:'Barbe',    name:'Barbe + coupe',       dur:'50 min', price:35,  types:['barbershop','mixte'] },
    { cat:'Ongles',   name:'Manucure',            dur:'40 min', price:30,  types:['salon','mixte'] },
  ];
  return all.filter(s => s.types.includes(type));
}

module.exports = router;
