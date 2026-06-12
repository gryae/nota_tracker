const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { verifyToken } = require('../middleware/auth');

// Apply general JWT token verification to all laporan routes
router.use(verifyToken);

// Helper to format date and time separately
function parseDateTime(dateVal) {
  const d = new Date(dateVal);
  const pad = (n) => String(n).padStart(2, '0');

  const day = pad(d.getDate());
  const month = pad(d.getMonth() + 1);
  const year = d.getFullYear();

  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  const seconds = pad(d.getSeconds());

  return {
    tanggal: `${day}/${month}/${year}`,
    jam: `${hours}:${minutes}:${seconds}`
  };
}

// Helper to generate filtered query
function buildFilteredQuery(filters) {
  const { dari, sampai, no_nota, divisi_id } = filters;

  let sql = `
    SELECT s.id, s.no_nota, d.nama_divisi, p.nama_proses, s.scanned_at,
           latest.latest_scanned_at
    FROM scan_log s
    INNER JOIN divisi d ON s.divisi_id = d.id
    INNER JOIN proses p ON s.proses_id = p.id
    INNER JOIN (
      SELECT no_nota, MAX(scanned_at) as latest_scanned_at
      FROM scan_log
      GROUP BY no_nota
    ) latest ON s.no_nota = latest.no_nota
    WHERE s.no_nota IN (
      SELECT DISTINCT no_nota FROM scan_log WHERE 1=1
  `;

  const params = [];

  if (dari) {
    sql += ` AND scanned_at >= ?`;
    params.push(`${dari} 00:00:00`);
  }
  if (sampai) {
    sql += ` AND scanned_at <= ?`;
    params.push(`${sampai} 23:59:59`);
  }
  if (no_nota) {
    sql += ` AND no_nota LIKE ?`;
    params.push(`%${no_nota.trim()}%`);
  }
  if (divisi_id) {
    sql += ` AND divisi_id = ?`;
    params.push(Number(divisi_id));
  }

  sql += `
    )
    ORDER BY s.no_nota ASC, s.scanned_at ASC
  `;

  return { sql, params };
}

// GET /api/laporan/nota - Laporan dengan filter
router.get('/nota', async (req, res) => {
  try {
    const { sql, params } = buildFilteredQuery(req.query);
    const rows = await db.query(sql, params);

    const processedRows = rows.map(r => {
      const { tanggal, jam } = parseDateTime(r.scanned_at);

      // Calculate hours since the latest scan of this specific nota
      const timeDiffMs = Date.now() - new Date(r.latest_scanned_at).getTime();
      const hoursSinceLastMove = timeDiffMs / (1000 * 60 * 60);
      const isStuck24h = hoursSinceLastMove > 24;

      return {
        id: r.id,
        no_nota: r.no_nota,
        nama_divisi: r.nama_divisi,
        nama_proses: r.nama_proses,
        scanned_at: r.scanned_at,
        tanggal,
        jam,
        isStuck24h
      };
    });

    return res.json(processedRows);
  } catch (err) {
    console.error('Error fetching report:', err.message);
    return res.status(500).json({ error: 'Gagal memuat data laporan.' });
  }
});

// GET /api/laporan/nota/:no_nota - Detail perjalanan 1 nota
router.get('/nota/:no_nota', async (req, res) => {
  const { no_nota } = req.params;
  try {
    const rows = await db.query(
      `SELECT s.id, s.no_nota, d.nama_divisi, p.nama_proses, s.scanned_at
       FROM scan_log s
       INNER JOIN divisi d ON s.divisi_id = d.id
       INNER JOIN proses p ON s.proses_id = p.id
       WHERE s.no_nota = ?
       ORDER BY s.scanned_at ASC`,
      [no_nota]
    );

    const journey = rows.map(r => {
      const { tanggal, jam } = parseDateTime(r.scanned_at);
      return {
        id: r.id,
        no_nota: r.no_nota,
        nama_divisi: r.nama_divisi,
        nama_proses: r.nama_proses,
        scanned_at: r.scanned_at,
        tanggal,
        jam
      };
    });

    return res.json(journey);
  } catch (err) {
    console.error('Error fetching single nota details:', err.message);
    return res.status(500).json({ error: 'Gagal mengambil detail perjalanan nota.' });
  }
});

// GET /api/laporan/export-csv - Export CSV of filtered result
router.get('/export-csv', async (req, res) => {
  try {
    const { sql, params } = buildFilteredQuery(req.query);
    const rows = await db.query(sql, params);

    // CSV header
    let csvContent = 'No,No Nota,Divisi,Proses,Tanggal,Jam,Status Tertahan (>24 Jam)\r\n';

    rows.forEach((r, idx) => {
      const { tanggal, jam } = parseDateTime(r.scanned_at);
      const timeDiffMs = Date.now() - new Date(r.latest_scanned_at).getTime();
      const hoursSinceLastMove = timeDiffMs / (1000 * 60 * 60);
      const isStuck24h = hoursSinceLastMove > 24 ? 'YA' : 'TIDAK';

      // Helper to escape values in CSV
      const escape = (val) => {
        const str = String(val);
        return str.includes(',') ? `"${str.replace(/"/g, '""')}"` : str;
      };

      csvContent += `${idx + 1},${escape(r.no_nota)},${escape(r.nama_divisi)},${escape(r.nama_proses)},${tanggal},${jam},${isStuck24h}\r\n`;
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="laporan_nota.csv"');
    return res.status(200).send(csvContent);
  } catch (err) {
    console.error('CSV Export error:', err.message);
    return res.status(500).json({ error: 'Gagal mengekspor CSV.' });
  }
});

// GET /api/laporan/summary - Summary status semua nota aktif
router.get('/summary', async (req, res) => {
  try {
    // MySQL query to fetch the absolute latest scan for each unique no_nota
    const rows = await db.query(
      `SELECT s.no_nota, s.scanned_at, d.nama_divisi, p.nama_proses
       FROM scan_log s
       INNER JOIN (
         SELECT no_nota, MAX(id) as max_id
         FROM scan_log
         GROUP BY no_nota
       ) latest ON s.id = latest.max_id
       INNER JOIN divisi d ON s.divisi_id = d.id
       INNER JOIN proses p ON s.proses_id = p.id
       ORDER BY s.scanned_at DESC`
    );

    const summary = rows.map(r => {
      const { tanggal, jam } = parseDateTime(r.scanned_at);
      const timeDiffMs = Date.now() - new Date(r.scanned_at).getTime();
      const hoursSinceLastScan = timeDiffMs / (1000 * 60 * 60);

      let status = 'Aktif';
      let badge = '🟢';

      if (hoursSinceLastScan > 24) {
        status = 'Tertahan';
        badge = '🔴';
      } else if (hoursSinceLastScan > 4) {
        status = 'Perlu Perhatian';
        badge = '🟡';
      }

      return {
        no_nota: r.no_nota,
        nama_divisi: r.nama_divisi,
        nama_proses: r.nama_proses,
        scanned_at: r.scanned_at,
        tanggal,
        jam,
        hours_elapsed: Number(hoursSinceLastScan.toFixed(1)),
        status,
        badge
      };
    });

    return res.json(summary);
  } catch (err) {
    console.error('Error fetching summary:', err.message);
    return res.status(500).json({ error: 'Gagal memuat ringkasan status nota.' });
  }
});

module.exports = router;
