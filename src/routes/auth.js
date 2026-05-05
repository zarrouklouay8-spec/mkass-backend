// src/routes/auth.js
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');

// ── POST /api/auth/login ─────────────────────────────────────
// Body: { username, password }
// Returns: { token, role, salonId, salonName }
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    // ── Admin login ──
    const adminUser = process.env.ADMIN_USERNAME || 'admin';
    const adminPass = process.env.ADMIN_PASSWORD || 'admin';
    if (username.toLowerCase() === adminUser) {
      const valid = password === adminPass; // plain compare for admin env var
      if (!valid) return res.status(401).json({ error: 'Identifiants incorrects' });
      const token = jwt.sign(
        { role: 'admin', username: 'admin' },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
      );
      return res.json({ token, role: 'admin', salonId: null, salonName: 'Administrateur Mkass' });
    }

    // ── Gérant login ──
    const { rows } = await pool.query(
      'SELECT * FROM salons WHERE username = $1',
      [username.toLowerCase()]
    );
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Identifiants incorrects' });
    }
    const salon = rows[0];
    const valid = await bcrypt.compare(password, salon.password);
    if (!valid) return res.status(401).json({ error: 'Identifiants incorrects' });

    const token = jwt.sign(
      { role: 'gerant', salonId: salon.id, username: salon.username },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );
    return res.json({
      token,
      role: 'gerant',
      salonId: salon.id,
      salonName: salon.name,
      icon: salon.icon,
      plan: salon.plan || 'starter',
      subscriptionStatus: salon.subscription_status || 'active',
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/auth/change-password ──────────────────────────
// Gérant changes their own password
const { requireAuth } = require('../middleware/auth');
router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 4) {
      return res.status(400).json({ error: 'New password must be at least 4 characters' });
    }
    if (req.user.role === 'admin') {
      return res.status(400).json({ error: 'Admin password is set via environment variable' });
    }
    const { rows } = await pool.query('SELECT * FROM salons WHERE id = $1', [req.user.salonId]);
    if (!rows.length) return res.status(404).json({ error: 'Salon not found' });
    const valid = await bcrypt.compare(currentPassword, rows[0].password);
    if (!valid) return res.status(401).json({ error: 'Current password incorrect' });
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE salons SET password = $1 WHERE id = $2', [hash, req.user.salonId]);
    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
