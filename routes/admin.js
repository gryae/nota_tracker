const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { verifyToken, isAdmin } = require('../middleware/auth');

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
    const divisions = await db.query('SELECT id, nama_divisi, username, created_at FROM divisi');
    return res.json(divisions);
  } catch (err) {
    console.error('Error fetching divisions:', err.message);
    return res.status(500).json({ error: 'Gagal mengambil data divisi.' });
  }
});

// POST /api/admin/divisi - Create division (max 10, Admin only)
router.post('/divisi', isAdmin, async (req, res) => {
  const { nama_divisi, username, password } = req.body;

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

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await db.query(
      'INSERT INTO divisi (nama_divisi, username, password) VALUES (?, ?, ?)',
      [nama_divisi, username, hashedPassword]
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
  const { nama_divisi, username, password } = req.body;

  if (!nama_divisi || !username) {
    return res.status(400).json({ error: 'Nama divisi dan username wajib diisi.' });
  }

  try {
    // Check if username is already taken by another division
    const checkUser = await db.query('SELECT id FROM divisi WHERE username = ? AND id != ?', [username, id]);
    if (checkUser.length > 0) {
      return res.status(400).json({ error: 'Username sudah digunakan oleh divisi lain.' });
    }

    let result;
    if (password && password.trim() !== '') {
      const hashedPassword = await bcrypt.hash(password, 10);
      result = await db.query(
        'UPDATE divisi SET nama_divisi = ?, username = ?, password = ? WHERE id = ?',
        [nama_divisi, username, hashedPassword, id]
      );
    } else {
      result = await db.query(
        'UPDATE divisi SET nama_divisi = ?, username = ? WHERE id = ?',
        [nama_divisi, username, id]
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

module.exports = router;
