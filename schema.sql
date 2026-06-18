-- Run: CREATE DATABASE nota_tracker; first
-- USE nota_tracker;

-- Divisi (max 10 rows enforced at app level)
CREATE TABLE IF NOT EXISTS divisi (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  nama_divisi  VARCHAR(100) NOT NULL,
  username     VARCHAR(50)  UNIQUE NOT NULL,
  password     VARCHAR(255) NOT NULL,
  limit_perhatian INT NOT NULL DEFAULT 4,
  limit_tertahan  INT NOT NULL DEFAULT 24,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
 
-- Proses per divisi (max 4 per divisi, enforced at app level)
CREATE TABLE IF NOT EXISTS proses (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  divisi_id   INT NOT NULL,
  nama_proses VARCHAR(100) NOT NULL,
  urutan      INT NOT NULL DEFAULT 1,
  FOREIGN KEY (divisi_id) REFERENCES divisi(id) ON DELETE CASCADE
);
 
-- Scan log (unique constraint: no double-scan on same proses)
CREATE TABLE IF NOT EXISTS scan_log (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  no_nota     VARCHAR(100) NOT NULL,
  divisi_id   INT NOT NULL,
  proses_id   INT NOT NULL,
  scanned_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_nota_proses (no_nota, proses_id),
  FOREIGN KEY (divisi_id) REFERENCES divisi(id) ON DELETE CASCADE,
  FOREIGN KEY (proses_id) REFERENCES proses(id) ON DELETE CASCADE
);
