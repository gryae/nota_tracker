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

/**
 * Bulk approach: dapatkan status semua nota sekaligus dengan minimal DB queries.
 * Menggantikan getNotaStatus() yang lama (N+1 query problem).
 *
 * @param {Array} notaInfoList - array of { no_nota, divisi_id, limit_perhatian, limit_tertahan, scanned_at }
 * @param {Array} allProcesses - semua rows dari tabel proses (sudah di-fetch sekali)
 * @param {Array} relevantScans - scan_log rows yang relevan (sudah di-fetch sekali)
 * @returns {Object} map: no_nota => { status, hours_elapsed, badge }
 */
function getBulkNotaStatuses(notaInfoList, allProcesses, relevantScans) {
  // Build fast lookup maps
  const processesByDivisi = {};
  allProcesses.forEach(p => {
    if (!processesByDivisi[p.divisi_id]) processesByDivisi[p.divisi_id] = [];
    processesByDivisi[p.divisi_id].push(p);
  });
  // Sort each divisi's processes by urutan
  Object.values(processesByDivisi).forEach(arr => arr.sort((a, b) => a.urutan - b.urutan || a.id - b.id));

  // Build scan lookup: { proses_id: { no_nota: scanned_at } }
  const scanByProsesNota = {};
  relevantScans.forEach(s => {
    const key = `${s.proses_id}__${s.no_nota}`;
    if (!scanByProsesNota[key] || new Date(s.scanned_at) < new Date(scanByProsesNota[key])) {
      scanByProsesNota[key] = s.scanned_at;
    }
  });
  // Also build by divisi_nota for fallback (oldest scan per divisi+nota)
  const oldestScanByDivisiNota = {};
  relevantScans.forEach(s => {
    const key = `${s.divisi_id}__${s.no_nota}`;
    if (!oldestScanByDivisiNota[key] || new Date(s.scanned_at) < new Date(oldestScanByDivisiNota[key])) {
      oldestScanByDivisiNota[key] = s.scanned_at;
    }
  });

  const statusMap = {};

  for (const info of notaInfoList) {
    const { no_nota, divisi_id, limit_perhatian, limit_tertahan, scanned_at } = info;
    const processes = processesByDivisi[divisi_id] || [];

    if (processes.length === 0) {
      statusMap[no_nota] = { status: 'Aktif', hours_elapsed: 0, badge: '🟢' };
      continue;
    }

    const firstProses = processes[0];
    const lastProses = processes[processes.length - 1];

    // Find tFirst
    const firstScanKey = `${firstProses.id}__${no_nota}`;
    let tFirst;
    if (scanByProsesNota[firstScanKey]) {
      tFirst = new Date(scanByProsesNota[firstScanKey]).getTime();
    } else {
      const fallbackKey = `${divisi_id}__${no_nota}`;
      tFirst = oldestScanByDivisiNota[fallbackKey]
        ? new Date(oldestScanByDivisiNota[fallbackKey]).getTime()
        : new Date(scanned_at).getTime();
    }

    // Check last process
    const lastScanKey = `${lastProses.id}__${no_nota}`;
    if (scanByProsesNota[lastScanKey]) {
      const tLast = new Date(scanByProsesNota[lastScanKey]).getTime();
      const minutesElapsed = (tLast - tFirst) / (1000 * 60);
      statusMap[no_nota] = {
        status: 'Aktif',
        hours_elapsed: Number((minutesElapsed / 60).toFixed(1)),
        badge: '🟢'
      };
    } else {
      const minutesElapsed = (Date.now() - tFirst) / (1000 * 60);
      const limitP = limit_perhatian !== undefined ? Number(limit_perhatian) : 240;
      const limitT = limit_tertahan !== undefined ? Number(limit_tertahan) : 1440;
      let status = 'Aktif', badge = '🟢';
      if (minutesElapsed > limitT) { status = 'Tertahan'; badge = '🔴'; }
      else if (minutesElapsed > limitP) { status = 'Perlu Perhatian'; badge = '🟡'; }
      statusMap[no_nota] = {
        status,
        hours_elapsed: Number((minutesElapsed / 60).toFixed(1)),
        badge
      };
    }
  }

  return statusMap;
}

/**
 * Fetch all processes and relevant scan_log rows for a set of nota numbers.
 * Returns { allProcesses, relevantScans } — dipakai untuk getBulkNotaStatuses().
 */
async function fetchBulkStatusData(notaNumbers) {
  if (notaNumbers.length === 0) return { allProcesses: [], relevantScans: [] };

  const [allProcesses, relevantScans] = await Promise.all([
    db.query('SELECT id, divisi_id, nama_proses, urutan FROM proses ORDER BY urutan ASC, id ASC'),
    db.query(
      `SELECT proses_id, divisi_id, no_nota, MIN(scanned_at) as scanned_at
       FROM scan_log
       WHERE no_nota IN (${notaNumbers.map(() => '?').join(',')})
       GROUP BY proses_id, divisi_id, no_nota`,
      notaNumbers
    )
  ]);

  return { allProcesses, relevantScans };
}

// Helper to generate filtered query (optimized: no correlated subquery)
function buildFilteredQuery(filters) {
  const { dari, sampai, no_nota, divisi_id } = filters;

  // Use a default 30-day window if no date filter specified to avoid full table scan
  const defaultDari = dari || (() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  })();
  const defaultSampai = sampai || new Date().toISOString().split('T')[0];

  // Step 1: Build inner CTE/subquery to get matching no_notas first using indexed columns
  let innerWhere = 'WHERE scanned_at >= ? AND scanned_at <= ?';
  const innerParams = [`${defaultDari} 00:00:00`, `${defaultSampai} 23:59:59`];

  if (no_nota) {
    innerWhere += ' AND no_nota LIKE ?';
    innerParams.push(`%${no_nota.trim()}%`);
  }
  if (divisi_id) {
    innerWhere += ' AND divisi_id = ?';
    innerParams.push(Number(divisi_id));
  }

  // Optimized: JOIN-based approach, no correlated subquery
  const sql = `
    SELECT s.id, s.no_nota, d.nama_divisi, p.nama_proses, s.scanned_at,
           latest.latest_scanned_at, d.id as divisi_id, d.limit_perhatian, d.limit_tertahan, s.proses_id
    FROM (
      SELECT DISTINCT no_nota FROM scan_log ${innerWhere}
    ) matched
    INNER JOIN scan_log s ON s.no_nota = matched.no_nota
    INNER JOIN divisi d ON s.divisi_id = d.id
    INNER JOIN proses p ON s.proses_id = p.id
    INNER JOIN (
      SELECT no_nota, MAX(scanned_at) as latest_scanned_at
      FROM scan_log
      GROUP BY no_nota
    ) latest ON s.no_nota = latest.no_nota
    ORDER BY s.no_nota ASC, s.scanned_at ASC
  `;

  return { sql, params: innerParams, dateFiltered: { dari: defaultDari, sampai: defaultSampai } };
}

// GET /api/laporan/nota - Laporan dengan filter
router.get('/nota', async (req, res) => {
  try {
    const { sql, params, dateFiltered } = buildFilteredQuery(req.query);
    const rows = await db.query(sql, params);

    if (rows.length === 0) {
      return res.json([]);
    }

    // Build map of latest division info per nota (last row = latest since sorted ASC)
    const latestDivMap = {};
    rows.forEach(r => {
      latestDivMap[r.no_nota] = {
        divisi_id: r.divisi_id,
        limit_perhatian: r.limit_perhatian,
        limit_tertahan: r.limit_tertahan,
        scanned_at: r.scanned_at
      };
    });

    const uniqueNotas = Object.keys(latestDivMap);
    const notaInfoList = uniqueNotas.map(n => ({ no_nota: n, ...latestDivMap[n] }));

    // Bulk fetch — only 2 queries regardless of how many notas
    const { allProcesses, relevantScans } = await fetchBulkStatusData(uniqueNotas);
    const statusMap = getBulkNotaStatuses(notaInfoList, allProcesses, relevantScans);

    const processedRows = rows.map(r => {
      const { tanggal, jam } = parseDateTime(r.scanned_at);
      const noteStatus = statusMap[r.no_nota] || { status: 'Aktif' };
      return {
        id: r.id,
        no_nota: r.no_nota,
        nama_divisi: r.nama_divisi,
        nama_proses: r.nama_proses,
        scanned_at: r.scanned_at,
        tanggal,
        jam,
        isStuck24h: noteStatus.status === 'Tertahan'
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

    const latestDivMap = {};
    rows.forEach(r => {
      latestDivMap[r.no_nota] = {
        divisi_id: r.divisi_id,
        limit_perhatian: r.limit_perhatian,
        limit_tertahan: r.limit_tertahan,
        scanned_at: r.scanned_at
      };
    });

    const uniqueNotas = Object.keys(latestDivMap);
    const notaInfoList = uniqueNotas.map(n => ({ no_nota: n, ...latestDivMap[n] }));

    // Bulk fetch — only 2 queries regardless of how many notas
    const { allProcesses, relevantScans } = await fetchBulkStatusData(uniqueNotas);
    const statusMap = getBulkNotaStatuses(notaInfoList, allProcesses, relevantScans);

    // Optional status filter (Aktif / Perlu Perhatian / Tertahan)
    const statusFilter = req.query.status ? req.query.status.trim() : '';

    // CSV header
    let csvContent = 'No,No Nota,Divisi,Proses,Tanggal,Jam,Status\r\n';

    let rowNum = 0;
    const latestRowPerNota = {};
    rows.forEach(r => {
      if (!latestRowPerNota[r.no_nota] || new Date(r.scanned_at) > new Date(latestRowPerNota[r.no_nota].scanned_at)) {
        latestRowPerNota[r.no_nota] = r;
      }
    });

    const escape = (val) => {
      const str = String(val);
      return str.includes(',') ? `"${str.replace(/"/g, '""')}"` : str;
    };

    for (const no_nota of uniqueNotas) {
      const r = latestRowPerNota[no_nota];
      if (!r) continue;

      const noteStatus = statusMap[no_nota] || { status: 'Aktif' };
      if (statusFilter && noteStatus.status !== statusFilter) continue;

      rowNum++;
      const { tanggal, jam } = parseDateTime(r.scanned_at);
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
// Query param: ?days=N (default 30) untuk batasi window waktu, ?all=1 untuk semua data
router.get('/summary', async (req, res) => {
  try {
    // Default: hanya tampilkan nota yang ada aktivitas dalam 30 hari terakhir
    // Ini mencegah full-scan 38K+ rows setiap kali summary dibuka
    const showAll = req.query.all === '1';
    const days = parseInt(req.query.days) || 30;

    let dateFilter = '';
    const dateParams = [];
    if (!showAll) {
      dateFilter = 'WHERE s.scanned_at >= DATE_SUB(NOW(), INTERVAL ? DAY)';
      dateParams.push(days);
    }

    // Step 1: Get distinct nota numbers within the time window (uses scanned_at index)
    const matchedNotas = await db.query(
      `SELECT DISTINCT no_nota FROM scan_log s ${dateFilter}`,
      dateParams
    );

    if (matchedNotas.length === 0) {
      return res.json([]);
    }

    const notaNumbers = matchedNotas.map(r => r.no_nota);

    // Step 2: Get latest scan per nota (uses no_nota index)
    const rows = await db.query(
      `SELECT s.no_nota, s.scanned_at, d.nama_divisi, p.nama_proses,
              d.id as divisi_id, d.limit_perhatian, d.limit_tertahan, s.proses_id
       FROM scan_log s
       INNER JOIN (
         SELECT no_nota, MAX(id) as max_id
         FROM scan_log
         WHERE no_nota IN (${notaNumbers.map(() => '?').join(',')})
         GROUP BY no_nota
       ) latest ON s.id = latest.max_id
       INNER JOIN divisi d ON s.divisi_id = d.id
       INNER JOIN proses p ON s.proses_id = p.id
       ORDER BY s.scanned_at DESC`,
      notaNumbers
    );

    // Step 3: Bulk status computation — hanya 2 DB queries total untuk semua nota
    const notaInfoList = rows.map(r => ({
      no_nota: r.no_nota,
      divisi_id: r.divisi_id,
      limit_perhatian: r.limit_perhatian,
      limit_tertahan: r.limit_tertahan,
      scanned_at: r.scanned_at
    }));
    const { allProcesses, relevantScans } = await fetchBulkStatusData(notaNumbers);
    const statusMap = getBulkNotaStatuses(notaInfoList, allProcesses, relevantScans);

    const summary = rows.map(r => {
      const { tanggal, jam } = parseDateTime(r.scanned_at);
      const noteStatus = statusMap[r.no_nota] || { status: 'Aktif', hours_elapsed: 0, badge: '🟢' };
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
    });

    return res.json(summary);
  } catch (err) {
    console.error('Error fetching summary:', err.message);
    return res.status(500).json({ error: 'Gagal memuat ringkasan status nota.' });
  }
});

module.exports = router;
