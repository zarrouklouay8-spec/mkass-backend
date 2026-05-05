// src/middleware/auth.js
const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = header.split(' ')[1];
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  });
}

function requireSalonAccess(req, res, next) {
  requireAuth(req, res, () => {
    const salonId = req.params.salonId || req.body.salonId;
    if (req.user.role === 'admin' || req.user.salonId === salonId) {
      return next();
    }
    return res.status(403).json({ error: 'Access denied to this salon' });
  });
}

module.exports = { requireAuth, requireAdmin, requireSalonAccess };
