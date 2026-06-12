const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../server');

// General token verification middleware
function verifyToken(req, res, next) {
  let token = req.query.token;
  const authHeader = req.headers['authorization'];
  
  if (!token && authHeader) {
    token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : authHeader;
  }

  if (!token) {
    return res.status(401).json({ error: 'Akses ditolak. Token tidak disediakan.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // Contains id, username, role, nama_divisi (if division user)
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token tidak valid atau telah kedaluwarsa.' });
  }
}

// Middleware to restrict access to Admins only
function isAdmin(req, res, next) {
  verifyToken(req, res, () => {
    if (req.user && req.user.role === 'admin') {
      next();
    } else {
      return res.status(403).json({ error: 'Akses ditolak. Khusus Administrator.' });
    }
  });
}

// Middleware to restrict access to Divisi users only
function isDivisi(req, res, next) {
  verifyToken(req, res, () => {
    if (req.user && req.user.role === 'divisi') {
      next();
    } else {
      return res.status(403).json({ error: 'Akses ditolak. Khusus User Divisi.' });
    }
  });
}

module.exports = {
  verifyToken,
  isAdmin,
  isDivisi
};
