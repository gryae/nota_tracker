const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { isDivisi } = require('../middleware/auth');

// Apply division user protection to all routes in this file
router.use(isDivisi);

// Helper to format date-time
function formatDateTime(dateVal) {
  const d = new Date(dateVal);
  const pad = (n) => String(n).padStart(2, '0');
  
  const day = pad(d.getDate());
  const month = pad(d.getMonth() + 1);
  const year = d.getFullYear();
  
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  const seconds = pad(d.getSeconds());
  
  return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
}

// POST /api/divisi/scan - Scan / input nota
router.post('/scan', async (req, res) => {
  const { no_nota, proses_id } = req.body;
  const divisi_id = req.user.id; // Logged in division user id

  if (!no_nota || !proses_id) {
    return res.status(400).json({ error: 'No Nota dan ID Proses wajib diisi.' });
  }

  const cleanNota = no_nota.trim();

  try {
    // 1. Verify if the process belongs to the logged-in division
    const processRows = await db.query('SELECT id, divisi_id, nama_proses FROM proses WHERE id = ?', [proses_id]);
    if (processRows.length === 0) {
      return res.status(404).json({ error: 'Proses tidak ditemukan.' });
    }

    const targetProses = processRows[0];
    if (targetProses.divisi_id !== divisi_id) {
      return res.status(403).json({ error: 'Akses ditolak. Proses ini tidak berada di divisi Anda.' });
    }

    // 1b. Verify that the nota has already been printed (has a CETAK history log)
    // This restriction does not apply to the CETAK process itself.
    if (targetProses.nama_proses.toUpperCase() !== 'CETAK') {
      const cetakHistory = await db.query(
        `SELECT s.id FROM scan_log s
         INNER JOIN proses p ON s.proses_id = p.id
         WHERE s.no_nota = ? AND p.nama_proses = 'CETAK'
         LIMIT 1`,
        [cleanNota]
      );
      if (cetakHistory.length === 0) {
        return res.status(400).json({
          error: `Gagal memproses. Nota [${cleanNota}] belum dicetak (tidak memiliki riwayat proses CETAK).`
        });
      }
    }

    // 2. Check for duplicate scan: unique key (no_nota, proses_id)
    const existingScan = await db.query(
      'SELECT id, scanned_at FROM scan_log WHERE no_nota = ? AND proses_id = ?',
      [cleanNota, proses_id]
    );

    if (existingScan.length > 0) {
      const scanTime = formatDateTime(existingScan[0].scanned_at);
      return res.status(409).json({
        error: `Nota [${cleanNota}] sudah diproses di bagian ini pada [${scanTime}]`
      });
    }

    // 3. Insert scan log
    await db.query(
      'INSERT INTO scan_log (no_nota, divisi_id, proses_id) VALUES (?, ?, ?)',
      [cleanNota, divisi_id, proses_id]
    );

    const currentTime = formatDateTime(new Date());
    return res.status(201).json({
      message: `Nota [${cleanNota}] berhasil direcord — [${currentTime}]`
    });

  } catch (err) {
    console.error('Scan error:', err.message);
    return res.status(500).json({ error: 'Gagal merecord scan nota.' });
  }
});

// GET /api/divisi/scan/today - Today's scan history for logged-in division
router.get('/scan/today', async (req, res) => {
  const divisi_id = req.user.id;
  try {
    // MySQL query for today's logs of this division
    const rows = await db.query(
      `SELECT s.id, s.no_nota, p.nama_proses, s.scanned_at,
              DATE_FORMAT(s.scanned_at, '%H:%i:%s') as scan_time,
              DATE_FORMAT(s.scanned_at, '%Y-%m-%d') as scan_date
       FROM scan_log s
       INNER JOIN proses p ON s.proses_id = p.id
       WHERE s.divisi_id = ? AND DATE(s.scanned_at) = CURDATE()
       ORDER BY s.scanned_at DESC`,
      [divisi_id]
    );
    return res.json(rows);
  } catch (err) {
    console.error('Error fetching today\'s scans:', err.message);
    return res.status(500).json({ error: 'Gagal mengambil riwayat scan hari ini.' });
  }
});

// GET /api/divisi/scan/nota-list - Get unique list of existing scanned notas
router.get('/scan/nota-list', async (req, res) => {
  try {
    const rows = await db.query(
      'SELECT DISTINCT no_nota FROM scan_log ORDER BY no_nota ASC'
    );
    return res.json(rows.map(r => r.no_nota));
  } catch (err) {
    console.error('Error fetching unique nota list:', err.message);
    return res.status(500).json({ error: 'Gagal mengambil daftar nota.' });
  }
});

module.exports = router;
