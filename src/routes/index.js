import express from 'express';
import multer from 'multer';
import path from 'path';
import sanitizeHtml from 'sanitize-html';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db.js';
import { upsertLead, uploadFileToTLD } from '../services/tld.js';
import { notifyConnex } from '../services/connex.js';

const router = express.Router();

const allowed = (process.env.ALLOWED_MIMES || '').split(',').filter(Boolean);
const MAX_MB = parseInt(process.env.MAX_FILE_MB || '10', 10);
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, process.env.UPLOAD_DIR || './uploads'),
    filename: (req, file, cb) => {
      const timestamp = Date.now();
      const ext = path.extname(file.originalname);
      const safeBase = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9-_]/g, '_');
      cb(null, `${safeBase}_${timestamp}${ext}`);
    }
  }),
  fileFilter: (req, file, cb) => {
    if (allowed.length && !allowed.includes(file.mimetype)) {
      return cb(new Error('Unsupported file type: ' + file.mimetype));
    }
    cb(null, true);
  },
  limits: { fileSize: MAX_MB * 1024 * 1024 }
});

router.get('/', (req, res) => {
  res.render('upload', { title: 'Secure Document Upload', error: null });
});

router.post('/upload', upload.array('documents', 10), async (req, res) => {
  try {
    const first_name = sanitizeHtml(req.body.first_name || '').trim();
    const last_name = sanitizeHtml(req.body.last_name || '').trim();
    const phone = sanitizeHtml(req.body.phone || '').trim();
    const email = sanitizeHtml(req.body.email || '').trim();
    const ssn_last4 = sanitizeHtml(req.body.ssn_last4 || '').trim();
    const certify = (req.body.certify || '').toString() === 'on';

    if (!first_name || !last_name || !phone || !email || !ssn_last4 || !certify) {
      throw new Error('Missing required fields (or certification not checked)');
    }
    if (!/^[0-9]{4}$/.test(ssn_last4)) {
      throw new Error('SSN last 4 must be 4 digits');
    }

    const files = (req.files || []).map(f => ({
      originalname: f.originalname,
      mimetype: f.mimetype,
      size: f.size,
      stored_as: f.filename,
      path: f.path
    }));

    const id = uuidv4();
    let lead_id = null, tld_status = null, tld_error = null;

    try {
      const up = await upsertLead({ first_name, last_name, phone, email, ssn_last4 });
      lead_id = up.lead_id || null;
      tld_status = lead_id ? 'lead_ok' : 'no_lead_id';
    } catch (e) {
      tld_error = (e?.response?.data) ? JSON.stringify(e.response.data) : String(e);
      tld_status = 'lead_error';
    }

    if (lead_id) {
      for (const f of files) {
        try {
          await uploadFileToTLD(lead_id, f.path);
        } catch (e) {
          tld_error = (tld_error ? tld_error + ' | ' : '') + (e?.response?.data ? JSON.stringify(e.response.data) : String(e));
          tld_status = tld_status || 'file_error';
        }
      }
    }

    let connex_status = null, connex_error = null;
    try {
      const fields = [
        { name: 'lead_id', type: 'string', value: lead_id || '' },
        { name: 'first_name', type: 'string', value: first_name },
        { name: 'last_name', type: 'string', value: last_name },
        { name: 'phone', type: 'string', value: phone },
        { name: 'email', type: 'string', value: email },
        { name: 'ssn_last4', type: 'string', value: ssn_last4 }
      ];
      await notifyConnex({ customer_id: lead_id || 'unknown', fields });
      connex_status = 'ok';
    } catch (e) {
      connex_error = (e?.response?.data) ? JSON.stringify(e.response.data) : String(e);
      connex_status = 'error';
    }

    await pool.query(
      `INSERT INTO uploads(id, first_name, last_name, phone, email, ssn_last4, lead_id, tld_status, tld_error, connex_status, connex_error, files)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [id, first_name, last_name, phone, email, ssn_last4, lead_id, tld_status, tld_error, connex_status, connex_error, JSON.stringify(files)]
    );

    res.render('success', { lead_id, tld_status, connex_status });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(400).render('upload', { title: 'Secure Document Upload', error: String(err) });
  }
});

export default router;
