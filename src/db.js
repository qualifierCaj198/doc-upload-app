import dotenv from 'dotenv';
import pkg from 'pg';
dotenv.config();
const { Pool } = pkg;

export const pool = new Pool({
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: false
});

const init = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS uploads (
      id UUID PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT NOT NULL,
      ssn_last4 TEXT NOT NULL,
      lead_id TEXT,
      tld_status TEXT,
      tld_error TEXT,
      connex_status TEXT,
      connex_error TEXT,
      files JSONB NOT NULL
    );
  `);
};
init().catch((e) => { console.error('DB init error:', e); process.exit(1); });
