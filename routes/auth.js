const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const db = require('../config/db');
const { JWT_SECRET, ADMIN_USER, ADMIN_PASS } = require('../server');

// Admin credentials file (created when admin changes credentials via panel)
const ADMIN_CRED_PATH = path.join(__dirname, '../admin_credentials.json');

function getAdminCredentials() {
  if (fs.existsSync(ADMIN_CRED_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(ADMIN_CRED_PATH, 'utf8'));
    } catch (e) {}
  }
  return { username: ADMIN_USER, password: null }; // null = use plaintext ADMIN_PASS
}

// POST /api/auth/login — Unified login (auto-detect role dari username)
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username dan password wajib diisi.' });
  }

  // 1. Cek admin credentials (from file or server.js fallback)
  const adminCreds = getAdminCredentials();
  let adminMatch = false;

  if (username === adminCreds.username) {
    if (adminCreds.password) {
      // Compare against bcrypt hash
      adminMatch = await bcrypt.compare(password, adminCreds.password);
    } else {
      // Compare against plaintext server.js default
      adminMatch = (password === ADMIN_PASS);
    }
  }

  if (adminMatch) {
    const token = jwt.sign(
      { username: adminCreds.username, role: 'admin' },
      JWT_SECRET,
      { expiresIn: '8h' }
    );
    return res.json({ token, username: adminCreds.username, role: 'admin' });
  }

  // 2. Cek divisi credentials dari DB
  try {
    const rows = await db.query('SELECT * FROM divisi WHERE username = ?', [username]);

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Username atau password salah.' });
    }

    const user = rows[0];
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ error: 'Username atau password salah.' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, nama_divisi: user.nama_divisi, role: 'divisi' },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    return res.json({
      token,
      id: user.id,
      username: user.username,
      nama_divisi: user.nama_divisi,
      role: 'divisi'
    });
  } catch (err) {
    console.error('Login error:', err.message);
    return res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  }
});


// POST /api/auth/login-admin (backward compatibility)
router.post('/login-admin', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username dan password wajib diisi.' });
  }
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const token = jwt.sign(
      { username: ADMIN_USER, role: 'admin' },
      JWT_SECRET,
      { expiresIn: '8h' }
    );
    return res.json({ token, username, role: 'admin' });
  }
  return res.status(401).json({ error: 'Username atau password Admin salah.' });
});

// POST /api/auth/login-divisi (backward compatibility)
router.post('/login-divisi', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username dan password wajib diisi.' });
  }
  try {
    const rows = await db.query('SELECT * FROM divisi WHERE username = ?', [username]);
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Username atau password Divisi salah.' });
    }
    const user = rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Username atau password Divisi salah.' });
    }
    const token = jwt.sign(
      { id: user.id, username: user.username, nama_divisi: user.nama_divisi, role: 'divisi' },
      JWT_SECRET,
      { expiresIn: '8h' }
    );
    return res.json({
      token,
      id: user.id,
      username: user.username,
      nama_divisi: user.nama_divisi,
      role: 'divisi'
    });
  } catch (err) {
    console.error('Login error:', err.message);
    return res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  }
});

module.exports = router;
