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

// Helper to calculate status of a single nota inside its current division
async function getNotaStatus(no_nota, divisi_id, limit_perhatian, limit_tertahan, latest_scanned_at) {
  try {
    // 1. Get all processes of this latest division
    const processes = await db.query(
      'SELECT id, nama_proses, urutan FROM proses WHERE divisi_id = ? ORDER BY urutan ASC, id ASC',
      [divisi_id]
    );
    if (processes.length === 0) {
      return { status: 'Aktif', hours_elapsed: 0, badge: '🟢' };
    }
    
    const firstProses = processes[0];
    const lastProses = processes[processes.length - 1];

    // 2. Find the first process scan in this division
    const firstScans = await db.query(
      'SELECT scanned_at FROM scan_log WHERE no_nota = ? AND proses_id = ? LIMIT 1',
      [no_nota, firstProses.id]
    );

    let tFirst;
    if (firstScans.length > 0) {
      tFirst = new Date(firstScans[0].scanned_at).getTime();
    } else {
      // Fallback: use oldest scan of this note in this division
      const oldestScans = await db.query(
        'SELECT scanned_at FROM scan_log WHERE no_nota = ? AND divisi_id = ? ORDER BY scanned_at ASC LIMIT 1',
        [no_nota, divisi_id]
      );
      tFirst = oldestScans.length > 0 ? new Date(oldestScans[0].scanned_at).getTime() : new Date(latest_scanned_at).getTime();
    }

    // 3. Check if last process of this division is scanned
    const lastScans = await db.query(
      'SELECT scanned_at FROM scan_log WHERE no_nota = ? AND proses_id = ? LIMIT 1',
      [no_nota, lastProses.id]
    );

    if (lastScans.length > 0) {
      // Completed in this division
      const tLast = new Date(lastScans[0].scanned_at).getTime();
      const minutesElapsed = (tLast - tFirst) / (1000 * 60);
      return { 
        status: 'Aktif', 
        hours_elapsed: Number((minutesElapsed / 60).toFixed(1)), 
        badge: '🟢' 
      };
    } else {
      // Still in progress
      const minutesElapsed = (Date.now() - tFirst) / (1000 * 60);
      let status = 'Aktif';
      let badge = '🟢';
      const limitPerhatian = limit_perhatian !== undefined ? Number(limit_perhatian) : 240;
      const limitTertahan = limit_tertahan !== undefined ? Number(limit_tertahan) : 1440;

      if (minutesElapsed > limitTertahan) {
        status = 'Tertahan';
        badge = '🔴';
      } else if (minutesElapsed > limitPerhatian) {
        status = 'Perlu Perhatian';
        badge = '🟡';
      }
      return { 
        status, 
        hours_elapsed: Number((minutesElapsed / 60).toFixed(1)), 
        badge 
      };
    }
  } catch (err) {
    console.error('Error in getNotaStatus:', err);
    return { status: 'Aktif', hours_elapsed: 0, badge: '🟢' };
  }
}

// Helper to generate filtered query
function buildFilteredQuery(filters) {
  const { dari, sampai, no_nota, divisi_id } = filters;

  let sql = `
    SELECT s.id, s.no_nota, d.nama_divisi, p.nama_proses, s.scanned_at,
           latest.latest_scanned_at, d.id as divisi_id, d.limit_perhatian, d.limit_tertahan, s.proses_id
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

    // Group rows by no_nota to identify unique notes and find their latest step
    const uniqueNotas = [...new Set(rows.map(r => r.no_nota))];

    // Build map of latest division and thresholds for each nota
    const latestDivMap = {};
    rows.forEach(r => {
      // Since rows are ordered by no_nota ASC, scanned_at ASC, 
      // the last encountered row for a note is its latest step.
      latestDivMap[r.no_nota] = {
        divisi_id: r.divisi_id,
        limit_perhatian: r.limit_perhatian,
        limit_tertahan: r.limit_tertahan,
        scanned_at: r.scanned_at
      };
    });

    const statusMap = {};
    await Promise.all(uniqueNotas.map(async (no_nota) => {
      const divInfo = latestDivMap[no_nota];
      if (divInfo) {
        const noteStatus = await getNotaStatus(
          no_nota,
          divInfo.divisi_id,
          divInfo.limit_perhatian,
          divInfo.limit_tertahan,
          divInfo.scanned_at
        );
        statusMap[no_nota] = noteStatus;
      }
    }));

    const processedRows = rows.map(r => {
      const { tanggal, jam } = parseDateTime(r.scanned_at);
      const noteStatus = statusMap[r.no_nota] || { status: 'Aktif' };
      const isStuck24h = noteStatus.status === 'Tertahan';

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

    // Group rows by no_nota to identify unique notes and find their latest step
    const uniqueNotas = [...new Set(rows.map(r => r.no_nota))];

    // Build map of latest division and thresholds for each nota
    const latestDivMap = {};
    rows.forEach(r => {
      latestDivMap[r.no_nota] = {
        divisi_id: r.divisi_id,
        limit_perhatian: r.limit_perhatian,
        limit_tertahan: r.limit_tertahan,
        scanned_at: r.scanned_at
      };
    });

    const statusMap = {};
    await Promise.all(uniqueNotas.map(async (no_nota) => {
      const divInfo = latestDivMap[no_nota];
      if (divInfo) {
        const noteStatus = await getNotaStatus(
          no_nota,
          divInfo.divisi_id,
          divInfo.limit_perhatian,
          divInfo.limit_tertahan,
          divInfo.scanned_at
        );
        statusMap[no_nota] = noteStatus;
      }
    }));

    // Optional status filter (Aktif / Perlu Perhatian / Tertahan)
    const statusFilter = req.query.status ? req.query.status.trim() : '';

    // CSV header
    let csvContent = 'No,No Nota,Divisi,Proses,Tanggal,Jam,Status\r\n';

    let rowNum = 0;
    // Build unique nota summary rows (one row per nota, showing latest step)
    // First, group rows by no_nota keeping only the last scan per nota
    const latestRowPerNota = {};
    rows.forEach(r => {
      if (!latestRowPerNota[r.no_nota] || new Date(r.scanned_at) > new Date(latestRowPerNota[r.no_nota].scanned_at)) {
        latestRowPerNota[r.no_nota] = r;
      }
    });

    for (const no_nota of uniqueNotas) {
      const r = latestRowPerNota[no_nota];
      if (!r) continue;

      const noteStatus = statusMap[no_nota] || { status: 'Aktif' };

      // Apply status filter if provided
      if (statusFilter && noteStatus.status !== statusFilter) continue;

      rowNum++;
      const { tanggal, jam } = parseDateTime(r.scanned_at);

      // Helper to escape values in CSV
      const escape = (val) => {
        const str = String(val);
        return str.includes(',') ? `"${str.replace(/"/g, '""')}"` : str;
      };

      csvContent += `${rowNum},${escape(no_nota)},${escape(r.nama_divisi)},${escape(r.nama_proses)},${tanggal},${jam},${escape(noteStatus.status)}\r\n`;
    }

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
      `SELECT s.no_nota, s.scanned_at, d.nama_divisi, p.nama_proses,
              d.id as divisi_id, d.limit_perhatian, d.limit_tertahan, s.proses_id
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

    const summary = await Promise.all(rows.map(async (r) => {
      const { tanggal, jam } = parseDateTime(r.scanned_at);
      const noteStatus = await getNotaStatus(r.no_nota, r.divisi_id, r.limit_perhatian, r.limit_tertahan, r.scanned_at);

      return {
        no_nota: r.no_nota,
        nama_divisi: r.nama_divisi,
        nama_proses: r.nama_proses,
        scanned_at: r.scanned_at,
        tanggal,
        jam,
        hours_elapsed: noteStatus.hours_elapsed,
        status: noteStatus.status,
        badge: noteStatus.badge
      };
    }));

    return res.json(summary);
  } catch (err) {
    console.error('Error fetching summary:', err.message);
    return res.status(500).json({ error: 'Gagal memuat ringkasan status nota.' });
  }
});

module.exports = router;
