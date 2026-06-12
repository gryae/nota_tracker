# Nota Tracker — Setup
 
## Requirements
- Node.js v18+
- MySQL 5.7+ or MariaDB
 
## Install
1. Clone / copy folder to server
2. Open MySQL and run: `CREATE DATABASE nota_tracker;`
3. Import schema: `mysql -u root -p nota_tracker < schema.sql`
4. Edit `server.js` — find the `KONFIGURASI` block and update:
   - `PORT` (default 3000)
   - `JWT_SECRET` (change to a long random string)
   - `ADMIN_USER` / `ADMIN_PASS`
   - `DB_CONFIG` (host, user, password, database)
5. Install packages: `npm install`
6. Start the server: `node server.js` (or `npm run dev` for development)
7. Open browser: [http://localhost:3000](http://localhost:3000)
   Admin panel: [http://localhost:3000/admin.html](http://localhost:3000/admin.html)

> [!TIP]
> **Out-of-the-Box Demo Fallback**:
> If MySQL is not running or not configured, this application will automatically fall back to an in-memory/JSON-file database (`database_fallback.json`). You can start the app and demo its features instantly without setting up MySQL first!

## First Time
1. Login to the admin panel ([http://localhost:3000/admin.html](http://localhost:3000/admin.html)) using the configured admin credentials.
2. Create divisions (max 10).
3. Add processes per division (max 4 each) and assign sequences.
4. Share the credentials of each division with the respective department staff.
5. Division staff can log in at [http://localhost:3000](http://localhost:3000) to scan incoming invoices.
