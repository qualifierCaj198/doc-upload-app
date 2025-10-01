import express from 'express';
import auth from 'basic-auth';
import dayjs from 'dayjs';
import { pool } from '../db.js';
import fs from 'fs';
import path from 'path';

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

/**
 * Secure download: /admin/file/:id/:stored
 * - Auth required (same as /admin)
 * - Verifies the file belongs to the given upload row
 * - Prevents path traversal, returns original filename
 */
router.get('/file/:id/:stored', requireAuth, async (req, res) => {
  try {
    const { id, stored } = req.params;
    // Look up files for this upload
    const { rows } = await pool.query('SELECT files FROM uploads WHERE id = $1 LIMIT 1', [id]);
    if (!rows.length) return res.status(404).send('Upload not found');

    const files = rows[0].files || [];
    const file = files.find(f => f.stored_as === stored);
    if (!file) return res.status(404).send('File not found');

    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    const base = path.resolve(uploadDir);
    const target = path.resolve(path.join(uploadDir, stored));

    // Path traversal guard
    if (!target.startsWith(base)) return res.status(400).send('Invalid path');

    if (!fs.existsSync(target)) return res.status(404).send('File missing on disk');

    // Download with the original filename
    return res.download(target, file.originalname);
  } catch (e) {
    console.error('Download error:', e);
    return res.status(500).send('Download error');
  }
});

export default router;
