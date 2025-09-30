import express from 'express';
import auth from 'basic-auth';
import dayjs from 'dayjs';
import { pool } from '../db.js';

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

export default router;
