import dotenv from 'dotenv';
dotenv.config();
import { pool } from '../src/db.js';

const run = async () => {
  // Ensure base table exists
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

  // Add tld_meta to store raw TLD request/response/debug
  await pool.query(`ALTER TABLE uploads ADD COLUMN IF NOT EXISTS tld_meta JSONB;`);

  console.log('DB ensured (schema up to date).');
  process.exit(0);
};

run().catch(err => { 
  console.error('DB init error:', err);
  process.exit(1);
});
