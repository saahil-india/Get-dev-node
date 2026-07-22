// Dev-only: runs a real Postgres-wire-protocol server backed by PGlite, so the app can be
// exercised against genuine Postgres SQL semantics without installing a system Postgres.
// NOT used in production — production targets a real PostgreSQL via DATABASE_URL.
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const db = await PGlite.create();
const server = new PGLiteSocketServer({ db, port: 5433, host: '127.0.0.1' });
await server.start();
console.log('PGlite dev Postgres server listening on 127.0.0.1:5433 (db: memory)');

process.on('SIGTERM', async () => { await server.stop(); await db.close(); process.exit(0); });
