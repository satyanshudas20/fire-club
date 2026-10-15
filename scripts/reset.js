// Deletes the local database so the next start re-seeds. USE WITH CARE.
const fs = require('fs'), path = require('path');
const dir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
for (const f of ['fireclub.db', 'fireclub.db-wal', 'fireclub.db-shm']) fs.rmSync(path.join(dir, f), { force: true });
console.log('Database removed from', dir);
