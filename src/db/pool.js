import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://localhost:5432/gd_portal',
  // PG_POOL_MAX lets the dev/test harness pin this to 1 when running against a
  // single-connection test backend; real Postgres in production should use the default.
  max: process.env.PG_POOL_MAX ? parseInt(process.env.PG_POOL_MAX, 10) : 10,
});

// A pool-level 'error' listener is required by node-postgres: without one, an error on an
// idle client (e.g. a dropped connection) is an uncaught exception that crashes the process.
pool.on('error', (err) => {
  console.error('Unexpected error on idle database client', err);
});

export async function query(text, params) {
  return pool.query(text, params);
}
