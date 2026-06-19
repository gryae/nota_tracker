const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const db = require('../config/db');
const { verifyToken, isAdmin } = require('../middleware/auth');

// Admin credentials file path (overrides server.js hardcoded values)
const ADMIN_CRED_PATH = path.join(__dirname, '../admin_credentials.json');

function readAdminCredentials() {
  if (fs.existsSync(ADMIN_CRED_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(ADMIN_CRED_PATH, 'utf8'));
    } catch (e) {}
  }
  // Fall back to server.js values if no file exists
  const server = require('../server');
  return { username: server.ADMIN_USER, password: null }; // password=null means use server.js plaintext
}

function writeAdminCredentials(creds) {
  fs.writeFileSync(ADMIN_CRED_PATH, JSON.stringify(creds, null, 2), 'utf8');
}

// Custom permission middleware for getting processes
// Allows either Admin OR the specific division user itself to get processes
function canAccessDivisiProses(req, res, next) {
  verifyToken(req, res, () => {
    if (req.user && (req.user.role === 'admin' || (req.user.role === 'divisi' && req.user.id === Number(req.params.id)))) {
      next();
    } else {
      return res.status(403).json({ error: 'Akses ditolak. Anda tidak memiliki wewenang untuk divisi ini.' });
    }
  });
}

// GET /api/admin/divisi - Get all divisions (Admin OR Division users)
router.get('/divisi', verifyToken, async (req, res) => {
  try {
    const divisions = await db.query('SELECT id, nama_divisi, username, limit_perhatian, limit_tertahan, created_at FROM divisi');
    return res.json(divisions);
  } catch (err) {
    console.error('Error fetching divisions:', err.message);
    return res.status(500).json({ error: 'Gagal mengambil data divisi.' });
  }
});

// POST /api/admin/divisi - Create division (max 10, Admin only)
router.post('/divisi', isAdmin, async (req, res) => {
  const { nama_divisi, username, password, limit_perhatian, limit_tertahan } = req.body;

  if (!nama_divisi || !username || !password) {
    return res.status(400).json({ error: 'Semua field (nama_divisi, username, password) wajib diisi.' });
  }

  try {
    // Enforce max 10 divisions
    const countResult = await db.query('SELECT COUNT(*) as count FROM divisi');
    const totalDivisi = countResult[0].count;

    if (totalDivisi >= 10) {
      return res.status(400).json({ error: 'Batas maksimum divisi tercapai (maksimal 10 divisi).' });
    }

    // Check if username already exists
    const checkUser = await db.query('SELECT id FROM divisi WHERE username = ?', [username]);
    if (checkUser.length > 0) {
      return res.status(400).json({ error: 'Username sudah digunakan oleh divisi lain.' });
    }

    const limitPerhatian = limit_perhatian !== undefined ? Number(limit_perhatian) : 4;
    const limitTertahan = limit_tertahan !== undefined ? Number(limit_tertahan) : 24;

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await db.query(
      'INSERT INTO divisi (nama_divisi, username, password, limit_perhatian, limit_tertahan) VALUES (?, ?, ?, ?, ?)',
      [nama_divisi, username, hashedPassword, limitPerhatian, limitTertahan]
    );

    return res.status(201).json({
      message: 'Divisi berhasil dibuat.',
      divisiId: result.insertId
    });
  } catch (err) {
    console.error('Error creating division:', err.message);
    return res.status(500).json({ error: 'Gagal membuat divisi.' });
  }
});

// PUT /api/admin/divisi/:id - Update division (Admin only)
router.put('/divisi/:id', isAdmin, async (req, res) => {
  const { id } = req.params;
  const { nama_divisi, username, password, limit_perhatian, limit_tertahan } = req.body;

  if (!nama_divisi || !username) {
    return res.status(400).json({ error: 'Nama divisi dan username wajib diisi.' });
  }

  try {
    // Check if username is already taken by another division
    const checkUser = await db.query('SELECT id FROM divisi WHERE username = ? AND id != ?', [username, id]);
    if (checkUser.length > 0) {
      return res.status(400).json({ error: 'Username sudah digunakan oleh divisi lain.' });
    }

    const limitPerhatian = limit_perhatian !== undefined ? Number(limit_perhatian) : 4;
    const limitTertahan = limit_tertahan !== undefined ? Number(limit_tertahan) : 24;

    let result;
    if (password && password.trim() !== '') {
      const hashedPassword = await bcrypt.hash(password, 10);
      result = await db.query(
        'UPDATE divisi SET nama_divisi = ?, username = ?, password = ?, limit_perhatian = ?, limit_tertahan = ? WHERE id = ?',
        [nama_divisi, username, hashedPassword, limitPerhatian, limitTertahan, id]
      );
    } else {
      result = await db.query(
        'UPDATE divisi SET nama_divisi = ?, username = ?, limit_perhatian = ?, limit_tertahan = ? WHERE id = ?',
        [nama_divisi, username, limitPerhatian, limitTertahan, id]
      );
    }

    return res.json({ message: 'Divisi berhasil diperbarui.' });
  } catch (err) {
    console.error('Error updating division:', err.message);
    return res.status(500).json({ error: 'Gagal memperbarui divisi.' });
  }
});

// DELETE /api/admin/divisi/:id - Delete division (Admin only)
router.delete('/divisi/:id', isAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM divisi WHERE id = ?', [id]);
    return res.json({ message: 'Divisi berhasil dihapus.' });
  } catch (err) {
    console.error('Error deleting division:', err.message);
    return res.status(500).json({ error: 'Gagal menghapus divisi.' });
  }
});

// GET /api/admin/divisi/:id/proses - Get processes of a division (Admin OR division staff)
router.get('/divisi/:id/proses', canAccessDivisiProses, async (req, res) => {
  const { id } = req.params;
  try {
    const list = await db.query('SELECT * FROM proses WHERE divisi_id = ? ORDER BY urutan ASC', [id]);
    return res.json(list);
  } catch (err) {
    console.error('Error fetching processes:', err.message);
    return res.status(500).json({ error: 'Gagal mengambil data proses.' });
  }
});

// POST /api/admin/divisi/:id/proses - Create process (max 4 per division, Admin only)
router.post('/divisi/:id/proses', isAdmin, async (req, res) => {
  const { id } = req.params; // divisi_id
  const { nama_proses, urutan } = req.body;

  if (!nama_proses || urutan === undefined) {
    return res.status(400).json({ error: 'Nama proses dan urutan wajib diisi.' });
  }

  try {
    // Enforce max 4 processes per division
    const countResult = await db.query('SELECT COUNT(*) as count FROM proses WHERE divisi_id = ?', [id]);
    const totalProses = countResult[0].count;

    if (totalProses >= 4) {
      return res.status(400).json({ error: 'Batas maksimum proses untuk divisi ini tercapai (maksimal 4 proses).' });
    }

    // CETAK restriction: only Kasir or Admin BLK divisions may have CETAK process
    if (nama_proses.trim().toUpperCase() === 'CETAK') {
      const divisiRows = await db.query('SELECT nama_divisi FROM divisi WHERE id = ?', [id]);
      if (divisiRows.length === 0) {
        return res.status(404).json({ error: 'Divisi tidak ditemukan.' });
      }
      const namaDivisi = divisiRows[0].nama_divisi.toLowerCase();
      const isKasirOrAdminBLK = namaDivisi.includes('kasir') || namaDivisi.includes('admin blk');
      if (!isKasirOrAdminBLK) {
        return res.status(403).json({
          error: `Proses CETAK hanya diperbolehkan untuk divisi Kasir atau Admin BLK. Divisi "${divisiRows[0].nama_divisi}" tidak memiliki izin ini.`
        });
      }
    }

    const result = await db.query(
      'INSERT INTO proses (divisi_id, nama_proses, urutan) VALUES (?, ?, ?)',
      [id, nama_proses, urutan]
    );

    return res.status(201).json({
      message: 'Proses berhasil ditambahkan.',
      prosesId: result.insertId
    });
  } catch (err) {
    console.error('Error creating process:', err.message);
    return res.status(500).json({ error: 'Gagal menambahkan proses.' });
  }
});

// PUT /api/admin/proses/:id - Update process (Admin only)
router.put('/proses/:id', isAdmin, async (req, res) => {
  const { id } = req.params;
  const { nama_proses, urutan } = req.body;

  if (!nama_proses || urutan === undefined) {
    return res.status(400).json({ error: 'Nama proses dan urutan wajib diisi.' });
  }

  try {
    await db.query(
      'UPDATE proses SET nama_proses = ?, urutan = ? WHERE id = ?',
      [nama_proses, urutan, id]
    );
    return res.json({ message: 'Proses berhasil diperbarui.' });
  } catch (err) {
    console.error('Error updating process:', err.message);
    return res.status(500).json({ error: 'Gagal memperbarui proses.' });
  }
});

// DELETE /api/admin/proses/:id - Delete process (Admin only)
router.delete('/proses/:id', isAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM proses WHERE id = ?', [id]);
    return res.json({ message: 'Proses berhasil dihapus.' });
  } catch (err) {
    console.error('Error deleting process:', err.message);
    return res.status(500).json({ error: 'Gagal menghapus proses.' });
  }
});

// DELETE /api/admin/scan-log/:id - Delete scan log entry (Admin only)
router.delete('/scan-log/:id', isAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await db.query('DELETE FROM scan_log WHERE id = ?', [id]);
    return res.json({ message: 'Langkah proses scan berhasil dihapus.' });
  } catch (err) {
    console.error('Error deleting scan log:', err.message);
    return res.status(500).json({ error: 'Gagal menghapus langkah proses scan.' });
  }
});

// POST /api/admin/purge-scan-log - Purge scan logs up to date (Admin only)
router.post('/purge-scan-log', isAdmin, async (req, res) => {
  const { date } = req.body;
  if (!date) {
    return res.status(400).json({ error: 'Tanggal pembersihan wajib diisi.' });
  }
  try {
    // Delete logs on or before selected date (23:59:59)
    const result = await db.query(
      'DELETE FROM scan_log WHERE scanned_at <= ?',
      [`${date} 23:59:59`]
    );
    // Handle SQL return (result can be different for fallback or mysql)
    const affectedRows = result && result.affectedRows !== undefined ? result.affectedRows : 0;
    return res.json({ 
      message: `Pembersihan berhasil. Berhasil menghapus ${affectedRows} record log scan sebelum tanggal ${date}.` 
    });
  } catch (err) {
    console.error('Error purging scan logs:', err.message);
    return res.status(500).json({ error: 'Gagal membersihkan data log scan.' });
  }
});

// GET /api/admin/credentials - Get current admin username (password not returned)
router.get('/credentials', isAdmin, (req, res) => {
  const creds = readAdminCredentials();
  return res.json({ username: creds.username });
});

// PUT /api/admin/credentials - Update admin username and/or password
router.put('/credentials', isAdmin, async (req, res) => {
  const { current_password, new_username, new_password } = req.body;

  if (!current_password) {
    return res.status(400).json({ error: 'Password lama wajib diisi untuk konfirmasi.' });
  }
  if (!new_username && !new_password) {
    return res.status(400).json({ error: 'Minimal satu perubahan (username atau password baru) diperlukan.' });
  }

  // Verify current password against server.js config and/or stored credentials
  const server = require('../server');
  const creds = readAdminCredentials();

  let isCurrentValid = false;
  if (creds.password) {
    // Stored as bcrypt hash
    isCurrentValid = await bcrypt.compare(current_password, creds.password);
  } else {
    // Plaintext in server.js (initial state)
    isCurrentValid = (current_password === server.ADMIN_PASS);
  }

  if (!isCurrentValid) {
    return res.status(401).json({ error: 'Password lama tidak benar.' });
  }

  const updatedCreds = { username: new_username || creds.username };
  if (new_password && new_password.trim() !== '') {
    updatedCreds.password = await bcrypt.hash(new_password, 10);
  } else {
    updatedCreds.password = creds.password; // keep existing hash
  }

  writeAdminCredentials(updatedCreds);
  return res.json({ message: 'Kredensial admin berhasil diperbarui. Silakan login kembali.' });
});

module.exports = router;
