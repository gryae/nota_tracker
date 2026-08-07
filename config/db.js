const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

// Import configuration from server.js
// To prevent issues during initial boot, we require it dynamically when needed or at load
let DB_CONFIG;
try {
  const server = require('../server');
  DB_CONFIG = server.DB_CONFIG;
} catch (e) {
  // If required before export, use defaults
  DB_CONFIG = {
    host: 'localhost',
    port: 3306,
    user: 'root',
    password: '',
    database: 'nota_tracker'
  };
}

let pool = null;
let isFallbackActive = false;

// Fallback JSON-file DB setup (allows running and testing without MySQL setup)
const fallbackPath = path.join(__dirname, '../database_fallback.json');
let fallbackDb = {
  divisi: [],
  proses: [],
  scan_log: []
};

function loadFallbackDb() {
  if (fs.existsSync(fallbackPath)) {
    try {
      fallbackDb = JSON.parse(fs.readFileSync(fallbackPath, 'utf8'));
      // Ensure arrays exist
      fallbackDb.divisi = fallbackDb.divisi || [];
      fallbackDb.proses = fallbackDb.proses || [];
      fallbackDb.scan_log = fallbackDb.scan_log || [];

      // Auto migrate pre-existing hour limits (4 & 24) to minute limits (240 & 1440)
      let updated = false;
      fallbackDb.divisi.forEach(d => {
        if (d.limit_perhatian === 4) {
          d.limit_perhatian = 240;
          updated = true;
        }
        if (d.limit_tertahan === 24) {
          d.limit_tertahan = 1440;
          updated = true;
        }
      });
      if (updated) {
        saveFallbackDb();
      }
    } catch (err) {
      console.error('❌ Failed to parse fallback database JSON, using empty template.');
    }
  } else {
    saveFallbackDb();
  }
}

function saveFallbackDb() {
  try {
    fs.writeFileSync(fallbackPath, JSON.stringify(fallbackDb, null, 2), 'utf8');
  } catch (err) {
    console.error('❌ Failed to save fallback database JSON:', err.message);
  }
}

// Initialize MySQL pool
async function initDb() {
  try {
    const { DB_CONFIG } = require('../server');
    pool = mysql.createPool({
      ...DB_CONFIG,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });

    // Test the connection
    const conn = await pool.getConnection();
    console.log('✅ Connected to MySQL database successfully.');

    // Auto migrate limit_perhatian & limit_tertahan columns if they don't exist
    try {
      await conn.execute('SELECT limit_perhatian, limit_tertahan FROM divisi LIMIT 1');
    } catch (e) {
      console.log('🌱 Migration: Adding limit_perhatian & limit_tertahan columns to divisi table...');
      await conn.execute('ALTER TABLE divisi ADD COLUMN limit_perhatian INT NOT NULL DEFAULT 240');
      await conn.execute('ALTER TABLE divisi ADD COLUMN limit_tertahan INT NOT NULL DEFAULT 1440');
      console.log('✅ Migration: limit_perhatian and limit_tertahan columns added.');
    }

    // Migrate existing hour-based settings to minute-based settings
    try {
      await conn.execute('UPDATE divisi SET limit_perhatian = 240 WHERE limit_perhatian = 4');
      await conn.execute('UPDATE divisi SET limit_tertahan = 1440 WHERE limit_tertahan = 24');
    } catch (e) {
      console.warn('Migration warning conversion from hours to minutes failed:', e.message);
    }

    // Auto-add performance indexes on scan_log if they don't exist
    const indexMigrations = [
      { name: 'idx_scan_log_no_nota',    sql: 'CREATE INDEX idx_scan_log_no_nota ON scan_log(no_nota)' },
      { name: 'idx_scan_log_scanned_at', sql: 'CREATE INDEX idx_scan_log_scanned_at ON scan_log(scanned_at)' },
      { name: 'idx_scan_log_divisi_id',  sql: 'CREATE INDEX idx_scan_log_divisi_id ON scan_log(divisi_id)' }
    ];
    for (const idx of indexMigrations) {
      try {
        const [existing] = await conn.execute(
          `SELECT COUNT(*) as cnt FROM information_schema.statistics
           WHERE table_schema = DATABASE() AND table_name = 'scan_log' AND index_name = ?`,
          [idx.name]
        );
        if (existing[0].cnt === 0) {
          await conn.execute(idx.sql);
          console.log(`🌱 Migration: Index "${idx.name}" added to scan_log.`);
        }
      } catch (e) {
        console.warn(`Migration warning: could not add index "${idx.name}":`, e.message);
      }
    }

    conn.release();
    isFallbackActive = false;
  } catch (err) {
    console.warn('\n⚠️  WARNING: Could not connect to MySQL database.');
    console.warn(`Error: ${err.message}`);
    console.warn('⚠️  Falling back to local JSON file database (database_fallback.json).\n');
    isFallbackActive = true;
    loadFallbackDb();
  }
}

// Run DB Initialization immediately
initDb().then(() => {
  seedDefaultData();
});

// Seed default client configuration from table image
async function seedDefaultData() {
  const bcrypt = require('bcryptjs');
  try {
    const rows = await query('SELECT COUNT(*) as count FROM divisi');
    if (rows && rows[0] && rows[0].count === 0) {
      console.log('🌱 Database is empty. Seeding default client divisions and processes...');
      
      const seedData = [
        {
          nama_divisi: 'KASIR',
          username: 'maya',
          password: 'maya123',
          processes: [
            { nama_proses: 'CETAK', urutan: 1 },
            { nama_proses: 'ARSIP NOTA', urutan: 2 }
          ]
        },
        {
          nama_divisi: 'ADMIN BLK',
          username: 'fariz',
          password: 'fariz123',
          processes: [
            { nama_proses: 'CETAK', urutan: 1 },
            { nama_proses: 'ARSIP NOTA', urutan: 2 }
          ]
        },
        {
          nama_divisi: 'TOKO ATAS',
          username: 'kury',
          password: 'kury123',
          processes: [
            { nama_proses: 'TERIMA NOTA', urutan: 1 },
            { nama_proses: 'TURUN BARANG', urutan: 2 }
          ]
        },
        {
          nama_divisi: 'TOKO BAWAH',
          username: 'muji',
          password: 'muji123',
          processes: [
            { nama_proses: 'TERIMA NOTA', urutan: 1 },
            { nama_proses: 'BARANG SIAP', urutan: 2 }
          ]
        },
        {
          nama_divisi: 'GUDANG',
          username: 'aden',
          password: 'aden123',
          processes: [
            { nama_proses: 'TERIMA NOTA', urutan: 1 },
            { nama_proses: 'BARANG SIAP', urutan: 2 }
          ]
        }
      ];

      for (const d of seedData) {
        const hashedPassword = await bcrypt.hash(d.password, 10);
        const res = await query(
          'INSERT INTO divisi (nama_divisi, username, password, limit_perhatian, limit_tertahan) VALUES (?, ?, ?, 240, 1440)',
          [d.nama_divisi, d.username, hashedPassword]
        );
        
        const divisiId = res.insertId;
        for (const p of d.processes) {
          await query(
            'INSERT INTO proses (divisi_id, nama_proses, urutan) VALUES (?, ?, ?)',
            [divisiId, p.nama_proses, p.urutan]
          );
        }
      }
      console.log('✅ Default seed data inserted successfully.');
    }
  } catch (err) {
    console.error('❌ Failed to seed default data:', err.message);
  }
}

/**
 * Executes a query using MySQL pool if active, otherwise runs fallback JS logic.
 */
async function query(sql, params = []) {
  if (!isFallbackActive) {
    try {
      const [rows] = await pool.execute(sql, params);
      return rows;
    } catch (err) {
      // If pool error happens post-boot, fall back
      console.error('❌ MySQL query error, falling back:', err.message);
      isFallbackActive = true;
      loadFallbackDb();
      return queryFallback(sql, params);
    }
  } else {
    return queryFallback(sql, params);
  }
}

// Simple regex-based SQL execution fallback for offline/demo use
function queryFallback(sql, params) {
  const cleanSql = sql.replace(/\s+/g, ' ').trim().toLowerCase();
  console.log(`🔍 [Fallback DB] Query: "${cleanSql}" | Params:`, params);
  
  // 1. DIVISI TABLES
  if (cleanSql.includes('from divisi') && !cleanSql.includes('insert') && !cleanSql.includes('update') && !cleanSql.includes('delete')) {
    if (cleanSql.includes('where username = ?')) {
      const found = fallbackDb.divisi.find(d => d.username.toLowerCase() === params[0].toLowerCase());
      return found ? [found] : [];
    }
    if (cleanSql.includes('where id = ?')) {
      const found = fallbackDb.divisi.find(d => d.id === Number(params[0]));
      return found ? [found] : [];
    }
    if (cleanSql.includes('select count(*)')) {
      return [{ count: fallbackDb.divisi.length }];
    }
    return fallbackDb.divisi;
  }

  if (cleanSql.includes('insert into divisi')) {
    // INSERT INTO divisi (nama_divisi, username, password, limit_perhatian, limit_tertahan) VALUES (?, ?, ?, ?, ?)
    const newDivisi = {
      id: fallbackDb.divisi.length > 0 ? Math.max(...fallbackDb.divisi.map(d => d.id)) + 1 : 1,
      nama_divisi: params[0],
      username: params[1],
      password: params[2],
      limit_perhatian: params[3] !== undefined ? Number(params[3]) : 240,
      limit_tertahan: params[4] !== undefined ? Number(params[4]) : 1440,
      created_at: new Date().toISOString()
    };
    fallbackDb.divisi.push(newDivisi);
    saveFallbackDb();
    return { insertId: newDivisi.id };
  }

  if (cleanSql.includes('update divisi')) {
    // UPDATE divisi SET nama_divisi = ?, username = ?, password = ?, limit_perhatian = ?, limit_tertahan = ? WHERE id = ?
    // OR UPDATE divisi SET nama_divisi = ?, username = ?, limit_perhatian = ?, limit_tertahan = ? WHERE id = ?
    const id = params[params.length - 1];
    const index = fallbackDb.divisi.findIndex(d => d.id === Number(id));
    if (index !== -1) {
      fallbackDb.divisi[index].nama_divisi = params[0];
      fallbackDb.divisi[index].username = params[1];
      if (params.length === 6) {
        fallbackDb.divisi[index].password = params[2];
        fallbackDb.divisi[index].limit_perhatian = Number(params[3]);
        fallbackDb.divisi[index].limit_tertahan = Number(params[4]);
      } else if (params.length === 5) {
        fallbackDb.divisi[index].limit_perhatian = Number(params[2]);
        fallbackDb.divisi[index].limit_tertahan = Number(params[3]);
      } else if (params.length === 4) {
        fallbackDb.divisi[index].password = params[2];
      }
      saveFallbackDb();
      return { affectedRows: 1 };
    }
    return { affectedRows: 0 };
  }

  if (cleanSql.includes('delete from divisi')) {
    // DELETE FROM divisi WHERE id = ?
    const id = Number(params[0]);
    fallbackDb.divisi = fallbackDb.divisi.filter(d => d.id !== id);
    // Cascade delete processes
    fallbackDb.proses = fallbackDb.proses.filter(p => p.divisi_id !== id);
    saveFallbackDb();
    return { affectedRows: 1 };
  }

  // 2. PROSES TABLES
  if (cleanSql.includes('from proses') && !cleanSql.includes('insert') && !cleanSql.includes('update') && !cleanSql.includes('delete')) {
    if (cleanSql.includes('where divisi_id = ?')) {
      const list = fallbackDb.proses.filter(p => p.divisi_id === Number(params[0]))
                                    .sort((a, b) => a.urutan - b.urutan);
      if (cleanSql.includes('select count(*)')) {
        return [{ count: list.length }];
      }
      return list;
    }
    if (cleanSql.includes('where id = ?')) {
      const found = fallbackDb.proses.find(p => p.id === Number(params[0]));
      return found ? [found] : [];
    }
    return fallbackDb.proses.sort((a, b) => a.urutan - b.urutan);
  }

  if (cleanSql.includes('insert into proses')) {
    // INSERT INTO proses (divisi_id, nama_proses, urutan) VALUES (?, ?, ?)
    const newProses = {
      id: fallbackDb.proses.length > 0 ? Math.max(...fallbackDb.proses.map(p => p.id)) + 1 : 1,
      divisi_id: Number(params[0]),
      nama_proses: params[1],
      urutan: Number(params[2] || 1)
    };
    fallbackDb.proses.push(newProses);
    saveFallbackDb();
    return { insertId: newProses.id };
  }

  if (cleanSql.includes('update proses')) {
    // UPDATE proses SET nama_proses = ?, urutan = ? WHERE id = ?
    const id = Number(params[2]);
    const index = fallbackDb.proses.findIndex(p => p.id === id);
    if (index !== -1) {
      fallbackDb.proses[index].nama_proses = params[0];
      fallbackDb.proses[index].urutan = Number(params[1]);
      saveFallbackDb();
      return { affectedRows: 1 };
    }
    return { affectedRows: 0 };
  }

  if (cleanSql.includes('delete from proses')) {
    // DELETE FROM proses WHERE id = ?
    const id = Number(params[0]);
    fallbackDb.proses = fallbackDb.proses.filter(p => p.id !== id);
    saveFallbackDb();
    return { affectedRows: 1 };
  }

  // 3. SCAN LOGS
  if (cleanSql.includes('delete from scan_log')) {
    if (cleanSql.includes('scanned_at <= ?')) {
      const limitDate = new Date(params[0]);
      const initialCount = fallbackDb.scan_log.length;
      fallbackDb.scan_log = fallbackDb.scan_log.filter(s => new Date(s.scanned_at) > limitDate);
      saveFallbackDb();
      const affectedRows = initialCount - fallbackDb.scan_log.length;
      return { affectedRows };
    } else if (cleanSql.includes('where id = ?')) {
      const id = Number(params[0]);
      const initialCount = fallbackDb.scan_log.length;
      fallbackDb.scan_log = fallbackDb.scan_log.filter(s => s.id !== id);
      saveFallbackDb();
      const affectedRows = initialCount - fallbackDb.scan_log.length;
      return { affectedRows };
    }
  }

  if (cleanSql.includes('insert into scan_log')) {
    // INSERT INTO scan_log (no_nota, divisi_id, proses_id) VALUES (?, ?, ?)
    const newScan = {
      id: fallbackDb.scan_log.length > 0 ? Math.max(...fallbackDb.scan_log.map(s => s.id)) + 1 : 1,
      no_nota: params[0],
      divisi_id: Number(params[1]),
      proses_id: Number(params[2]),
      scanned_at: new Date().toISOString()
    };
    fallbackDb.scan_log.push(newScan);
    saveFallbackDb();
    return { insertId: newScan.id };
  }

  if (cleanSql.includes('select') && cleanSql.includes('from scan_log')) {
    // Check if unique list of notas query
    if (cleanSql.includes('select distinct no_nota from scan_log') && !cleanSql.includes('where')) {
      const uniqueNotas = [...new Set(fallbackDb.scan_log.map(s => s.no_nota))];
      return uniqueNotas.sort().map(n => ({ no_nota: n }));
    }

    // Check if unique check: no_nota = ? AND proses_id = ?
    if (cleanSql.includes('no_nota = ?') && cleanSql.includes('proses_id = ?')) {
      const found = fallbackDb.scan_log.find(s => s.no_nota.toLowerCase() === params[0].toLowerCase() && s.proses_id === Number(params[1]));
      return found ? [found] : [];
    }

    // Riwayat scan hari ini (today's scan history by divisi)
    // SELECT s.no_nota, p.nama_proses, s.scanned_at ... WHERE s.divisi_id = ? AND DATE(s.scanned_at) = CURDATE()
    if (cleanSql.includes('curdate()') || cleanSql.includes('date(s.scanned_at)')) {
      const divId = Number(params[0]);
      const todayStr = new Date().toISOString().split('T')[0];
      
      const filtered = fallbackDb.scan_log.filter(s => {
        const scanDate = s.scanned_at.split('T')[0];
        return s.divisi_id === divId && scanDate === todayStr;
      });

      // Join with proses details
      const result = filtered.map(s => {
        const p = fallbackDb.proses.find(pr => pr.id === s.proses_id) || {};
        return {
          id: s.id,
          no_nota: s.no_nota,
          nama_proses: p.nama_proses || 'Unknown',
          scanned_at: s.scanned_at,
          // format local time and date for display
          scan_time: new Date(s.scanned_at).toLocaleTimeString('en-US', { hour12: false }),
          scan_date: s.scanned_at.split('T')[0]
        };
      });

      // Sort descending by scanned_at
      return result.sort((a, b) => new Date(b.scanned_at) - new Date(a.scanned_at));
    }
  }

  // 4. REPORTS (LAPORAN) AND SPECIAL QUERIES
  // Detailed full join for reports / summary
  // We will intercept general selects on scan_log to do a join
  const allScansJoined = fallbackDb.scan_log.map(s => {
    const div = fallbackDb.divisi.find(d => d.id === s.divisi_id) || {};
    const pros = fallbackDb.proses.find(p => p.id === s.proses_id) || {};
    return {
      id: s.id,
      no_nota: s.no_nota,
      divisi_id: s.divisi_id,
      nama_divisi: div.nama_divisi || 'Unknown',
      proses_id: s.proses_id,
      nama_proses: pros.nama_proses || 'Unknown',
      urutan: pros.urutan || 1,
      limit_perhatian: div.limit_perhatian !== undefined ? div.limit_perhatian : 240,
      limit_tertahan: div.limit_tertahan !== undefined ? div.limit_tertahan : 1440,
      scanned_at: s.scanned_at
    };
  });

  // Check for CETAK history
  if (cleanSql.includes("p.nama_proses = 'cetak'")) {
    const notaKey = params[0];
    const filtered = allScansJoined.filter(s => 
      s.no_nota.toLowerCase() === notaKey.toLowerCase() && 
      s.nama_proses.toUpperCase() === 'CETAK'
    );
    return filtered;
  }

  // Single nota details: get journey of 1 nota
  // GET /api/laporan/nota/:no_nota
  if (cleanSql.includes('where s.no_nota = ?') || (cleanSql.includes('no_nota') && params.length === 1 && typeof params[0] === 'string' && !params[0].includes('%'))) {
    const notaKey = params[0];
    const filtered = allScansJoined.filter(s => s.no_nota.toLowerCase() === notaKey.toLowerCase());
    return filtered.sort((a, b) => new Date(a.scanned_at) - new Date(b.scanned_at));
  }

  // Filtered reports
  // This will handle the generic report fetch: GET /api/laporan/nota
  // It matches the main reports query containing join filters.
  if (cleanSql.includes('where s.no_nota in') || cleanSql.includes('select distinct no_nota from scan_log')) {
    let results = [...allScansJoined];
    let matchedNotas = fallbackDb.scan_log.map(s => s.no_nota);
    let paramIdx = 0;
    let subqueryScans = [...fallbackDb.scan_log];

    if (cleanSql.includes('scanned_at >= ?')) {
      const dariVal = params[paramIdx++];
      const dariDate = new Date(dariVal);
      subqueryScans = subqueryScans.filter(s => new Date(s.scanned_at) >= dariDate);
    }
    if (cleanSql.includes('scanned_at <= ?')) {
      const sampaiVal = params[paramIdx++];
      const sampaiDate = new Date(sampaiVal);
      subqueryScans = subqueryScans.filter(s => new Date(s.scanned_at) <= sampaiDate);
    }
    if (cleanSql.includes('no_nota like ?')) {
      let likeVal = params[paramIdx++];
      likeVal = likeVal.replace(/%/g, '').toLowerCase().trim();
      subqueryScans = subqueryScans.filter(s => s.no_nota.toLowerCase().includes(likeVal));
    }
    if (cleanSql.includes('divisi_id = ?')) {
      const divId = Number(params[paramIdx++]);
      subqueryScans = subqueryScans.filter(s => s.divisi_id === divId);
    }

    const uniqueMatched = [...new Set(subqueryScans.map(s => s.no_nota.toLowerCase()))];
    results = allScansJoined.filter(r => uniqueMatched.includes(r.no_nota.toLowerCase()));

    // Attach latest_scanned_at for 24h warning checks
    const latestScannedAtMap = {};
    allScansJoined.forEach(s => {
      const existing = latestScannedAtMap[s.no_nota];
      if (!existing || new Date(s.scanned_at) > new Date(existing)) {
        latestScannedAtMap[s.no_nota] = s.scanned_at;
      }
    });

    results = results.map(r => ({
      ...r,
      latest_scanned_at: latestScannedAtMap[r.no_nota]
    }));

    // Sort by no_nota first, then scanned_at ASC for chronological journey representation
    return results.sort((a, b) => {
      const notaCompare = a.no_nota.localeCompare(b.no_nota);
      if (notaCompare !== 0) return notaCompare;
      return new Date(a.scanned_at) - new Date(b.scanned_at);
    });
  }

  // Summary status of active notes
  // SELECT s.no_nota, s.scanned_at, d.nama_divisi, p.nama_proses... GROUP BY no_nota...
  if (cleanSql.includes('group by no_nota') || cleanSql.includes('max_id') || cleanSql.includes('max_scanned_at')) {
    // Find latest scan per no_nota
    const latestMap = {};
    allScansJoined.forEach(s => {
      const existing = latestMap[s.no_nota];
      if (!existing || new Date(s.scanned_at) > new Date(existing.scanned_at)) {
        latestMap[s.no_nota] = s;
      }
    });
    return Object.values(latestMap).sort((a, b) => new Date(b.scanned_at) - new Date(a.scanned_at));
  }

  return allScansJoined;
}

module.exports = {
  query,
  isFallback: () => isFallbackActive
};
