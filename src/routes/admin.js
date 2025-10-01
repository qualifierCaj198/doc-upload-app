import express from 'express';
import auth from 'basic-auth';
import dayjs from 'dayjs';
import { pool } from '../db.js';
import fs from 'fs';
import path from 'path';
import { searchLeadEgress, findLeadIdByNameAndLast4 } from '../services/tld.js';

const router = express.Router();

function requireAuth(req, res, next) {
  const creds = auth(req);
  const user = process.env.ADMIN_USER;
  const pass = process.env.ADMIN_PASS;
  if (!creds || creds.name !== user || creds.pass !== pass) {
    res.set('WWW-Authenticate', 'Basic realm="admin"');
    return res.status(401).send('Access denied');
  }
  next();
}

router.get('/', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM uploads ORDER BY created_at DESC LIMIT 200');
  const data = rows.map(r => ({ ...r, created_at_fmt: dayjs(r.created_at).format('YYYY-MM-DD HH:mm') }));
  res.render('admin', { rows: data });
});

// Secure download of a stored file
router.get('/file/:id/:stored', requireAuth, async (req, res) => {
  try {
    const { id, stored } = req.params;
    const { rows } = await pool.query('SELECT files FROM uploads WHERE id = $1 LIMIT 1', [id]);
    if (!rows.length) return res.status(404).send('Upload not found');

    const files = rows[0].files || [];
    const file = files.find(f => f.stored_as === stored);
    if (!file) return res.status(404).send('File not found');

    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    const base = path.resolve(uploadDir);
    const target = path.resolve(path.join(uploadDir, stored));
    if (!target.startsWith(base)) return res.status(400).send('Invalid path');
    if (!fs.existsSync(target)) return res.status(404).send('File missing on disk');

    return res.download(target, file.originalname);
  } catch (e) {
    console.error('Download error:', e);
    return res.status(500).send('Download error');
  }
});

// NEW: Verify & auto-match by last4 if possible.
// If exactly one match is found by name+last4, we auto-set lead_id and redirect back to /admin.
// Otherwise we fall back to listing matches (still filtered by last4 if provided).
router.get('/verify/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { rows } = await pool.query('SELECT * FROM uploads WHERE id = $1 LIMIT 1', [id]);
  if (!rows.length) return res.status(404).send('Upload not found');

  const u = rows[0];

  // Try to auto-match by name+last4
  try {
    const { lead_id, match } = await findLeadIdByNameAndLast4({
      first_name: u.first_name,
      last_name:  u.last_name,
      ssn_last4:  u.ssn_last4
    });

    if (lead_id) {
      // Store result and mark status
      await pool.query(
        `UPDATE uploads
           SET lead_id = $1,
               tld_status = 'auto_matched',
               tld_meta = COALESCE(tld_meta, '{}'::jsonb) || $2::jsonb
         WHERE id = $3`,
        [lead_id, JSON.stringify({ auto_match: match || null }), id]
      );
      return res.redirect('/admin'); // done — no need to show options
    }
  } catch (e) {
    console.error('Auto-match error:', e?.message || e);
    // Continue to manual list below
  }

  // Fall back: show matches (filter by last4 if provided inside service)
  let matches = [];
  try {
    matches = await searchLeadEgress({
      first_name: u.first_name,
      last_name:  u.last_name,
      ssn_last4:  u.ssn_last4
    });
  } catch (e) {
    console.error('Egress search error:', e?.response?.data || e);
    matches = [{ error: e?.response?.data || String(e) }];
  }
  res.render('verify', { upload: u, matches });
});

// Manually set a lead_id on an upload row
router.post('/set-lead', requireAuth, express.urlencoded({ extended: true }), async (req, res) => {
  const { upload_id, lead_id } = req.body;
  if (!upload_id || !lead_id) return res.status(400).send('Missing upload_id or lead_id');
  await pool.query(
    `UPDATE uploads SET lead_id=$2, tld_status='manually_set' WHERE id=$1`,
    [upload_id, lead_id]
  );
  res.redirect('/admin');
});

// Pretty-print tld_meta JSON
router.get('/debug/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { rows } = await pool.query('SELECT * FROM uploads WHERE id = $1 LIMIT 1', [id]);
  if (!rows.length) return res.status(404).send('Upload not found');

  const u = rows[0];
  res.render('debug', { row: u });
});

export default router;
