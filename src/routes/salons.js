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
      childCut,
      coverImg
    } = req.body;

    const mapUrl = req.body.map_url || req.body.mapUrl || null;

    const { rows } = await pool.query(`
      UPDATE salons SET
        name       = COALESCE($1, name),
        address    = COALESCE($2, address),
        status     = COALESCE($3, status),
        icon       = COALESCE($4, icon),
        tags       = COALESCE($5, tags),
        child_cut  = COALESCE($6, child_cut),
        cover_img  = COALESCE($7, cover_img),
        map_url    = COALESCE($8, map_url)
      WHERE id = $9
      RETURNING *
    `, [
      name,
      address,
      status,
      icon,
      tags,
      childCut,
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
