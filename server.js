// ============================================================
// ⚙️  KONFIGURASI — SESUAIKAN INI SEBELUM PRODUCTION
// ============================================================
 
const PORT        = 3000;                  // ← HTTP port (localhost)
const HTTPS_PORT  = 3443;                  // ← HTTPS port (akses dari HP)
const JWT_SECRET  = 'notaTracker_secret';  // ← Ganti dengan string acak panjang
const ADMIN_USER  = 'admin';               // ← Username admin panel
const ADMIN_PASS  = 'admin123';            // ← Password admin panel
 
const DB_CONFIG = {
  host     : 'localhost',      // ← Ganti jika MySQL di server lain
  port     : 3306,             // ← Default MySQL port
  user     : 'root',           // ← MySQL username
  password : '',               // ← MySQL password
  database : 'nota_tracker'    // ← Nama database
};
 
// ============================================================

// Export configuration first so other modules can import it immediately
module.exports = { PORT, JWT_SECRET, ADMIN_USER, ADMIN_PASS, DB_CONFIG };

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const https = require('https');
const http = require('http');
const fs = require('fs');

const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Serve static frontend files from 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// Import Routes (dynamically loaded after module.exports is ready)
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const divisiRoutes = require('./routes/divisi');
const laporanRoutes = require('./routes/laporan');

// Apply API Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/divisi', divisiRoutes);
app.use('/api/laporan', laporanRoutes);

// Fallback: serve login page for undefined paths or redirect to index.html
app.get('*', (req, res, next) => {
  // Check if requesting an API endpoint
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Endpoint not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start HTTP Server (localhost / fallback)
http.createServer(app).listen(PORT, '0.0.0.0', () => {
  console.log(`📡 HTTP  → http://localhost:${PORT}`);
});

// Start HTTPS Server (required for camera access on mobile)
const certPath = path.join(__dirname, 'cert', 'cert.pem');
const keyPath  = path.join(__dirname, 'cert', 'key.pem');

if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  const httpsOptions = {
    cert: fs.readFileSync(certPath),
    key:  fs.readFileSync(keyPath)
  };
  https.createServer(httpsOptions, app).listen(HTTPS_PORT, '0.0.0.0', () => {
    console.log(`=========================================`);
    console.log(`🚀 NOTA TRACKER server is running!`);
    console.log(`💻 Laptop  : http://localhost:${PORT}`);
    console.log(`📱 HP/Mobile: https://192.168.1.15:${HTTPS_PORT}`);
    console.log(`⚙️  Admin credentials: ${ADMIN_USER} / ${ADMIN_PASS}`);
    console.log(`=========================================`);
  });
} else {
  console.log(`=========================================`);
  console.log(`🚀 NOTA TRACKER server is running!`);
  console.log(`📱 Access locally: http://localhost:${PORT}`);
  console.log(`⚠️  HTTPS cert not found — camera may not work on mobile`);
  console.log(`=========================================`);
}
