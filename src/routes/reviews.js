const router = require('express').Router();
const pool = require('../db/pool');

// POST /api/reviews
router.post('/', async (req, res) => {
  try {
    const { appointmentId, rating, comment } = req.body;

    if (!appointmentId) {
      return res.status(400).json({ error: 'Rendez-vous obligatoire' });
    }

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Note invalide' });
    }

    const apptResult = await pool.query(
      `SELECT id, salon_id, client_name, status
       FROM appointments
       WHERE id = $1`,
      [appointmentId]
    );

    if (!apptResult.rows.length) {
      return res.status(404).json({ error: 'Rendez-vous introuvable' });
    }

    const appt = apptResult.rows[0];

    if (appt.status !== 'done') {
      return res.status(400).json({ error: 'Vous pouvez laisser un avis uniquement après le rendez-vous terminé' });
    }

    const { rows } = await pool.query(
      `INSERT INTO reviews (
        appointment_id,
        salon_id,
        client_name,
        rating,
        comment
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *`,
      [
        appt.id,
        appt.salon_id,
        appt.client_name || 'Client',
        Number(rating),
        comment || ''
      ]
    );

    res.status(201).json(rows[0]);

  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Un avis existe déjà pour ce rendez-vous' });
    }

    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/reviews/salon/:salonId
router.get('/salon/:salonId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT *
       FROM reviews
       WHERE salon_id = $1
       ORDER BY created_at DESC`,
      [req.params.salonId]
    );

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
